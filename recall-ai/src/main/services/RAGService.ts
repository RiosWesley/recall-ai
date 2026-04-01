import { BrainProcess } from './BrainProcess'
import { promptTemplates } from './promptTemplates'
import type { RAGOptions, RAGResponse, RAGLatency, SearchResult } from '../../shared/types'
import { SettingsService } from './SettingsService'
import { SearchService } from './SearchService'

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
      const config = SettingsService.getInstance().get()

      const searchStart = performance.now()
      
      // Temporary fallback search call until Task 4.1 routing is complete
      context = await SearchService.getInstance().search(question, { 
        limit: config.topK, 
        chatId: options?.chatId 
      })
      
      latency.search = performance.now() - searchStart

      if (context.length === 0) {
        latency.total = performance.now() - totalStart
        return {
          answer: 'Aguardando implementação da Fase 4.1 (Motor FTS5) para buscas completas.',
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
      const brainProcess = BrainProcess.getInstance()
      
      let answer = ''
      let tokensUsed = 0

      try {
        answer = await brainProcess.generateStream(
          userPrompt,
          (token: string) => {
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
        console.error('[RAGService] Error generating response from BrainProcess:', llmError)
        answer = 'Desculpe, ocorreu um erro ao gerar a resposta ou a IA falhou.\n\nContexto encontrado:' + 
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
