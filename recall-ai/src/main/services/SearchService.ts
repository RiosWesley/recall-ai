import { DatabaseService } from '../db/database'
import { ChatRepository } from '../db/repositories/ChatRepository'
import { ChunkRepository } from '../db/repositories/ChunkRepository'
import { VectorRepository } from '../db/repositories/VectorRepository'
import { ProfileFactRepository } from '../db/repositories/ProfileFactRepository'
import { EmbeddingService } from './EmbeddingService'
import type { SearchOptions, SearchResult } from '../../shared/types'
import { SettingsService } from './SettingsService'

export class SearchService {
  private static instance: SearchService | null = null

  private chatRepo: ChatRepository
  private chunkRepo: ChunkRepository
  private vectorRepo: VectorRepository
  private factRepo: ProfileFactRepository

  private constructor() {
    const db = DatabaseService.getInstance()
    this.chatRepo = new ChatRepository(db)
    this.chunkRepo = new ChunkRepository(db)
    this.vectorRepo = new VectorRepository(db)
    this.factRepo = new ProfileFactRepository(db)
  }

  static getInstance(): SearchService {
    if (!SearchService.instance) {
      SearchService.instance = new SearchService()
    }
    return SearchService.instance
  }

  async search(query: string, options?: SearchOptions, precomputedEmbedding?: Float32Array): Promise<SearchResult[]> {
    const start = performance.now()
    const config = SettingsService.getInstance().get()
    const limit = options?.limit || config.topK
    const isHybrid = options?.hybrid ?? true
    const alpha = config.alpha
    const chatId = options?.chatId
    const dateFrom = options?.dateFrom
    const dateTo = options?.dateTo

    if (!query.trim()) return []

    console.log(`[SearchService] Querying: "${query}" (hybrid: ${isHybrid}, chatId: ${chatId || 'none'})`)

    // 1. Embed query
    let queryEmbedding: Float32Array
    if (precomputedEmbedding) {
      queryEmbedding = precomputedEmbedding
    } else {
      try {
        const embeddingService = EmbeddingService.getInstance()
        queryEmbedding = await embeddingService.embed(query)
      } catch (err) {
        console.error('[SearchService] Error generating embedding:', err)
        // Fallback empty embed handling
        queryEmbedding = new Float32Array(384)
      }
    }
    
    // 2. Vector Search
    const searchStart = performance.now()
    
    // FTS5 syntax restricts certain characters (like ?, *, ", -, etc.) without escaping.
    // Use an OR logic to make keyword matching much more resilient.
    const STOPWORDS = new Set([
      'que', 'não', 'pra', 'com', 'uma', 'por', 'mas', 'como', 'mais', 'isso', 
      'esse', 'essa', 'tem', 'tá', 'vai', 'vou', 'foi', 'era', 'são', 'nos', 
      'das', 'dos', 'ele', 'ela', 'meu', 'sua', 'seu', 'pro', 'sim', 'qual', 'o', 'a', 'de', 'da', 'do'
    ])

    const ftsQuery = query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !STOPWORDS.has(w))
      .join(' OR ')

    const isPatternQuery = /sempre|frequente|geralmente|costume|toda hora|mais|quantas|padr/i.test(query)
    
    let vectorResults = []
    let propVectorResults: any[] = []
    let factVectorResults: any[] = []

    if (isHybrid && ftsQuery.length > 0) {
      if (isPatternQuery) {
        factVectorResults = this.vectorRepo.hybridSearchFacts(queryEmbedding, ftsQuery, Math.max(limit, 5), alpha, chatId)
        vectorResults = this.vectorRepo.hybridSearch(queryEmbedding, ftsQuery, limit, alpha, chatId, dateFrom, dateTo)
        propVectorResults = this.vectorRepo.hybridSearchPropositions(queryEmbedding, ftsQuery, limit, alpha, chatId, dateFrom, dateTo)
      } else {
        factVectorResults = this.vectorRepo.hybridSearchFacts(queryEmbedding, ftsQuery, 3, alpha, chatId)
        vectorResults = this.vectorRepo.hybridSearch(queryEmbedding, ftsQuery, limit, alpha, chatId, dateFrom, dateTo)
        propVectorResults = this.vectorRepo.hybridSearchPropositions(queryEmbedding, ftsQuery, limit, alpha, chatId, dateFrom, dateTo)
      }
    } else {
      vectorResults = this.vectorRepo.search(queryEmbedding, limit, chatId, dateFrom, dateTo)
      // Since native VectorRepository.search doesn't have a specific table parameter easily exposed, 
      // we'll rely on it returning primarily chunks.
    }

    // Reciprocal Rank Fusion of the three result sets
    const combinedScores = new Map<string, { id: string, type: 'chunk' | 'prop' | 'fact', score: number }>()

    const K = 60
    vectorResults.forEach((r, i) => {
      combinedScores.set(`chunk-${r.chunk_id}`, { id: r.chunk_id, type: 'chunk', score: 1 / (K + i + 1) })
    })
    propVectorResults.forEach((r, i) => {
      const key = `prop-${r.chunk_id}`
      const existing = combinedScores.get(key)
      if (existing) {
        existing.score += 1 / (K + i + 1)
      } else {
        combinedScores.set(key, { id: r.chunk_id, type: 'prop', score: 1 / (K + i + 1) })
      }
    })
    factVectorResults.forEach((r, i) => {
      const key = `fact-${r.chunk_id}`
      const existing = combinedScores.get(key)
      if (existing) {
        existing.score += 1 / (K + i + 1)
      } else {
        combinedScores.set(key, { id: r.chunk_id, type: 'fact', score: 1 / (K + i + 1) })
      }
    })

    const sortedMerged = [...combinedScores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    const childChunkIds = sortedMerged.filter(s => s.type === 'chunk').map(s => s.id)
    const chunkMap = this.chunkRepo.findParentMapByChildIds(childChunkIds)

    const propIds = sortedMerged.filter(s => s.type === 'prop').map(s => s.id)
    
    // We need to fetch the parent_chunks for the propositions too
    // For now we can fetch the propositions from the DB directly to get their parent_chunk_id
    let propMap = new Map<string, any>()
    let propParentMap = new Map<string, any>()
    
    if (propIds.length > 0) {
      const db = DatabaseService.getInstance()
      const ph = propIds.map(() => '?').join(', ')
      const props = db.prepare(`SELECT * FROM propositions WHERE id IN (${ph})`).all(...propIds) as any[]
      const propParentIds = props.map(p => p.parent_chunk_id).filter(Boolean)
      
      const pChunks = this.chunkRepo.findParentsByIds(propParentIds)
      
      propMap = new Map(props.map(p => [p.id, p]))
      propParentMap = new Map(pChunks.map(c => [c.id, c]))
    }

    const factIds = sortedMerged.filter(s => s.type === 'fact').map(s => s.id)
    const sampleParent = chunkMap.size > 0 ? Array.from(chunkMap.values())[0] : null
    // Directly fetch facts using basic query as ProfileFactRepository returns all or by contact
    const allFacts = factIds.length > 0 ? this.factRepo.findByChatId(chatId || sampleParent?.chat_id || '') : []
    const factMap = new Map(allFacts.map(f => [f.id!, f]))

    const chatMap = new Map<string, string>()
    const finalResults: SearchResult[] = []

    // Helper to get chat name
    const getChatName = (cId: string) => {
      if (chatMap.has(cId)) return chatMap.get(cId)!
      const chat = this.chatRepo.findById(cId)
      const name = chat ? chat.name : 'Unknown Chat'
      chatMap.set(cId, name)
      return name
    }

    for (const res of sortedMerged) {
      if (res.type === 'chunk') {
        const chunk = chunkMap.get(res.id)
        if (!chunk) continue

        const chatName = getChatName(chunk.chat_id)
        const date = new Date(chunk.start_time * 1000)
        const formattedDate = new Intl.DateTimeFormat('pt-BR', {
          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }).format(date).replace(',', '')

        finalResults.push({
          id: `chunk-${chunk.id}`,
          chatId: chunk.chat_id,
          chatName,
          score: Math.min(1.0, res.score * 10), // Boost RRF visual score
          content: chunk.display_content,
          date: formattedDate,
          sender: chunk.participants.length > 0 ? chunk.participants[0] : 'Unknown',
          chunkId: chunk.id
        })
      } else if (res.type === 'prop') {
        const prop = propMap.get(res.id)
        if (!prop) continue

        const parentChunk = propParentMap.get(prop.parent_chunk_id)
        const chatName = getChatName(prop.chat_id)
        
        let dateStr = 'Fato Isolado'
        if (prop.fact_date) dateStr = prop.fact_date
        else if (parentChunk) {
            const date = new Date(parentChunk.start_time * 1000)
            dateStr = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
        }
        
        // Pass both the fact logic and the full surrounding parent chunk context
        const contentStr = `🎯 *Proposição Atômica*: "${prop.fact}"\n\nContexto Original:\n${parentChunk?.display_content || prop.original_quote}`
        
        finalResults.push({
          id: `prop-${prop.id}`,
          chatId: prop.chat_id,
          chatName,
          score: Math.min(1.0, res.score * 10),
          content: contentStr,
          date: dateStr,
          sender: '🤖 Fato Analisado',
          chunkId: parentChunk?.id || prop.id
        })
      } else {
        const fact = factMap.get(res.id)
        if (!fact) continue

        const chatName = getChatName(fact.contact_id)
        
        finalResults.push({
          id: `fact-${fact.id}`,
          chatId: fact.contact_id,
          chatName,
          score: Math.min(1.0, res.score * 10), // Boost RRF visual score
          content: `📊 *Fato de Perfil*\n${fact.text}`,
          date: 'Análise Estatística',
          sender: '🤖 Sistema',
          chunkId: fact.id!
        })
      }
    }

    const end = performance.now()
    console.log(`[SearchService] Search complete in ${Math.round(end - start)}ms (DB: ${Math.round(end - searchStart)}ms). Found ${finalResults.length} results.`)

    return finalResults
  }
}
