import { DatabaseService } from '../db/database'
import { ChatRepository } from '../db/repositories/ChatRepository'
import { ChunkRepository } from '../db/repositories/ChunkRepository'
import { VectorRepository } from '../db/repositories/VectorRepository'
import { EmbeddingService } from './EmbeddingService'
import type { SearchOptions, SearchResult } from '../../shared/types'

export class SearchService {
  private static instance: SearchService | null = null

  private chatRepo: ChatRepository
  private chunkRepo: ChunkRepository
  private vectorRepo: VectorRepository

  private constructor() {
    const db = DatabaseService.getInstance()
    this.chatRepo = new ChatRepository(db)
    this.chunkRepo = new ChunkRepository(db)
    this.vectorRepo = new VectorRepository(db)
  }

  static getInstance(): SearchService {
    if (!SearchService.instance) {
      SearchService.instance = new SearchService()
    }
    return SearchService.instance
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const start = performance.now()
    const limit = options?.limit || 10
    const isHybrid = options?.hybrid ?? true
    const chatId = options?.chatId

    if (!query.trim()) return []

    console.log(`[SearchService] Querying: "${query}" (hybrid: ${isHybrid}, chatId: ${chatId || 'none'})`)

    // 1. Embed query
    let queryEmbedding: Float32Array
    try {
      const embeddingService = EmbeddingService.getInstance()
      queryEmbedding = await embeddingService.embed(query)
    } catch (err) {
      console.error('[SearchService] Error generating embedding:', err)
      // Fallback empty embed handling
      queryEmbedding = new Float32Array(384)
    }
    
    // 2. Vector Search
    const searchStart = performance.now()
    const vectorResults = isHybrid
      ? this.vectorRepo.hybridSearch(queryEmbedding, query, limit, 0.7, chatId)
      : this.vectorRepo.search(queryEmbedding, limit, chatId)

    // 3. Enrich with Chunks and Chats
    const chunkIds = vectorResults.map((v) => v.chunk_id)
    const chunks = this.chunkRepo.findByIds(chunkIds)

    // Create a map for fast lookup
    const chunkMap = new Map(chunks.map(c => [c.id, c]))
    const chatMap = new Map<string, string>()

    const finalResults: SearchResult[] = []

    for (const vRes of vectorResults) {
      const chunk = chunkMap.get(vRes.chunk_id)
      if (!chunk) continue

      let chatName = chatMap.get(chunk.chat_id)
      if (!chatName) {
        const chat = this.chatRepo.findById(chunk.chat_id)
        chatName = chat ? chat.name : 'Unknown Chat'
        chatMap.set(chunk.chat_id, chatName)
      }

      // Format date (e.g. 15 mar 2024 · 14:32)
      const date = new Date(chunk.start_time * 1000)
      const formattedDate = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date).replace(',', '')

      // Heuristic for score to percentage
      // For hybrid search, we output 1 - score as distance.
      // So the similarity score is 1 - vRes.distance.
      let similarityScore = Math.max(0, 1 - vRes.distance)
      if (isHybrid) {
        // Boost hybrid score slightly for display purposes
        similarityScore = Math.min(1.0, similarityScore * 50)
      }

      finalResults.push({
        id: `res-${vRes.chunk_id}`,
        chatId: chunk.chat_id,
        chatName,
        score: similarityScore,
        content: chunk.display_content,
        date: formattedDate,
        sender: chunk.participants.length > 0 ? chunk.participants[0] : 'Unknown',
        chunkId: vRes.chunk_id
      })
    }

    const end = performance.now()
    console.log(`[SearchService] Search complete in ${Math.round(end - start)}ms (DB: ${Math.round(end - searchStart)}ms). Found ${finalResults.length} results.`)

    return finalResults
  }
}
