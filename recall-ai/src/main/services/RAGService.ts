import { EmbeddingService } from './EmbeddingService'
import { SearchService } from './SearchService'
import { LLMService } from './LLMService'
import { promptTemplates } from './promptTemplates'
import type { RAGOptions, RAGResponse, RAGLatency, SearchResult } from '../../shared/types'
import { SettingsService } from './SettingsService'
import { DatabaseService } from '../db/database'
import { ContactProfileRepository } from '../db/repositories/ContactProfileRepository'

export class RAGService {
  private static instance: RAGService | null = null

  private constructor() {}

  static getInstance(): RAGService {
    if (!RAGService.instance) {
      RAGService.instance = new RAGService()
    }
    return RAGService.instance
  }

  async generateStream(
    question: string,
    onToken: (token: string) => void,
    options?: RAGOptions
  ): Promise<RAGResponse> {
    const totalStart = performance.now()
    const latency: RAGLatency = { embedding: 0, search: 0, generation: 0, total: 0 }
    let context: SearchResult[] = []

    try {
      // 1. Embedding
      const embeddingStart = performance.now()
      const embeddingService = EmbeddingService.getInstance()
      let queryEmbedding: Float32Array
      try {
        queryEmbedding = await embeddingService.embed(question)
        latency.embedding = performance.now() - embeddingStart
      } catch (err) {
        console.error('[RAGService] Error generating embedding:', err)
        // Discard latency and fallback
        queryEmbedding = new Float32Array(384)
      }

      const needsSpecifics = /\b(disse|falou|mandou|exatamente|literalmente|quando|que dia|que hora|última mensagem|print|copia|cole|como assim)\b/i.test(question)
      const profileRepo = new ContactProfileRepository(DatabaseService.getInstance())
      const contactProfile = options?.chatId ? profileRepo.findByChatId(options.chatId) : null
      const config = SettingsService.getInstance().get()

      const searchStart = performance.now()
      
      // If we have a robust profile and the user just asked a generic question, skip vector database completely!
      if (contactProfile && !needsSpecifics) {
        context.push({
          id: `profile-${contactProfile.id}`,
          chatId: contactProfile.contact_id,
          chatName: contactProfile.contact_name,
          score: 1.0,
          content: `PERFIL DA CONVERSA E FATOS GERAIS:\n${contactProfile.profile_text}`,
          date: 'Análise Dossiê',
          sender: '🤖 Sistema',
          chunkId: contactProfile.id!
        })
      } else {
        // We either need specifics, or don't have a profile. Do hybrid RRF search.
        const searchService = SearchService.getInstance()
        context = await searchService.search(question, { hybrid: true, limit: config.topK, chatId: options?.chatId }, queryEmbedding)
        
        // Inject profile at the top if available to give LLM maximum situational awareness
        if (contactProfile) {
          context.unshift({
            id: `profile-${contactProfile.id}`,
            chatId: contactProfile.contact_id,
            chatName: contactProfile.contact_name,
            score: 1.0,
            content: `PERFIL DA CONVERSA:\n${contactProfile.profile_text}`,
            date: 'Análise Dossiê',
            sender: '🤖 Sistema',
            chunkId: contactProfile.id!
          })
        }
      }
      
      latency.search = performance.now() - searchStart

      // 3. Early return if no context is found
      if (context.length === 0) {
        latency.total = performance.now() - totalStart
        return {
          answer: 'Não encontrei trechos de conversa relevantes para a sua pergunta.',
          context,
          tokensUsed: 0,
          latency
        }
      }

      // 4. Prompt Construction
      const { userPrompt } = promptTemplates.buildRAGPrompt(question, context)
      const systemPrompt = config.systemPrompt

      // 5. Generation
      const generationStart = performance.now()
      const llmService = LLMService.getInstance()
      
      let answer = ''
      let tokensUsed = 0

      try {
        answer = await llmService.generateStream(
          userPrompt,
          (token) => {
            tokensUsed++
            if (onToken) onToken(token)
          },
          {
            temperature: options?.temperature ?? config.temperature,
            maxTokens: options?.maxTokens || 1024,
            systemPrompt: systemPrompt
          }
        )
      } catch (llmError) {
        console.error('[RAGService] Error generating response from LLM:', llmError)
        answer = 'Desculpe, ocorreu um erro ao gerar a resposta ou o LLM falhou.\n\nContexto encontrado:' + 
                 context.map((c, i) => `\n[${i+1}] ${c.date} ${c.sender}: ${c.content}`).join('')
      }
      
      latency.generation = performance.now() - generationStart
      latency.total = performance.now() - totalStart

      return {
        answer,
        context,
        tokensUsed,
        latency
      }
    } catch (err) {
      console.error('[RAGService] Fatal error in RAG pipeline:', err)
      throw err
    }
  }
}
