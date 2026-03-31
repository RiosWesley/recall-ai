import { LLMService } from './LLMService'
import { SearchService } from './SearchService'
import type { SearchResult } from '../../shared/types'
import { EmbeddingService } from './EmbeddingService'

export class MultiQueryRetriever {
  private static instance: MultiQueryRetriever | null = null
  private llm: LLMService
  private search: SearchService
  private embeddingService: EmbeddingService

  private constructor() {
    this.llm = LLMService.getInstance()
    this.search = SearchService.getInstance()
    this.embeddingService = EmbeddingService.getInstance()
  }

  static getInstance(): MultiQueryRetriever {
    if (!MultiQueryRetriever.instance) {
      MultiQueryRetriever.instance = new MultiQueryRetriever()
    }
    return MultiQueryRetriever.instance
  }

  private REWRITE_PROMPT = `Você vai ajudar a buscar informações em conversas de WhatsApp. 
Dada a pergunta do usuário contextualizada, gere 4 variações que poderiam encontrar a informação desejada se lidas literalmente em um chat PT-BR informal. Pense como as pessoas falam na prática no dia a dia.

Pense em:
1. Como a informação apareceria LITERALMENTE na conversa (ex: "tem prova?")
2. Sinônimos e gírias casuais (ex: "bora", "trampando", "suave", "trampo")
3. Variações com verbos diferentes ou afirmações diretas.

Pergunta original: {question}
Nome do Contato (opcional): {contact_name}

Gere exatamente 4 queries de busca como um JSON array contendo strings. Retorne APENAS o JSON puro, sem formatação markdown ou explicações antes ou depois.
Exemplo de saída:
["convite pra sair final de semana", "vamo dar um role na sexta", "onde a gente vai beber amanhã", "topa barzinho hoje"]
`

  async retrieve(
    question: string,
    topK: number,
    contactName: string = 'Desconhecido',
    chatId?: string,
    dateFrom?: number,
    dateTo?: number
  ): Promise<SearchResult[]> {
    const prompt = this.REWRITE_PROMPT.replace('{question}', question).replace('{contact_name}', contactName)
    let queries = [question]

    try {
      const response = await this.llm.generate(prompt, {
        temperature: 0.7,
        maxTokens: 250,
        systemPrompt: "Você é um assistente cirúrgico que cria variações semânticas de perguntas de buscas para data mining."
      })
      
      const cleaned = response.replace(/```json/i, '').replace(/```/g, '').trim()
      const generatedQueries = JSON.parse(cleaned)
      
      if (Array.isArray(generatedQueries)) {
        queries = [question, ...generatedQueries.slice(0, 4)]
      }
    } catch (err) {
      console.warn('[MultiQueryRetriever] Failed to generate query variations, falling back to original query only.', err)
      // will proceed with only original question
    }

    console.log(`[MultiQueryRetriever] Executing hybrid searches for queries:`, queries)

    const allResults = new Map<string, SearchResult & { query_hits: number }>()

    // Run searches sequentially to prevent freezing the database (sqlite-vec is single threaded)
    for (const query of queries) {
      // Small optimization: if multiple generated queries are identical, skip.
      const queryTrimmed = query.trim()
      if (!queryTrimmed) continue

      let queryEmbedding = new Float32Array(384) as Float32Array
      try {
        queryEmbedding = await this.embeddingService.embed(queryTrimmed) as Float32Array
      } catch (err) {
         console.warn(`[MultiQueryRetriever] Error embedding query variation "${queryTrimmed}", skipping.`, err)
         continue
      }

      const results = await this.search.search(queryTrimmed, { 
          hybrid: true, 
          limit: topK, 
          chatId, 
          dateFrom, 
          dateTo 
      }, queryEmbedding)
      
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        const existing = allResults.get(r.id)
        
        // Reciprocal Rank Fusion implementation
        // score for this position = 1 / (60 + rank) where rank is (i + 1)
        const fusionScore = 1.0 / (60.0 + i + 1)
        
        if (existing) {
          existing.score += fusionScore
          existing.query_hits += 1
        } else {
          allResults.set(r.id, {
            ...r,
            score: fusionScore,
            query_hits: 1
          })
        }
      }
    }

    // Re-rank combined results based on fused scores
    // A document retrieved in top positions by 3 queries will naturally float to the top
    const rankedResults = Array.from(allResults.values()).sort((a, b) => {
        // Tie breaker based on query hits
        if (Math.abs(b.score - a.score) < 0.001) {
            return b.query_hits - a.query_hits
        }
        return b.score - a.score
    })

    // Return the topK elements (not the combined list, but strictly topK after RRF re-ranking)
    const finalResults = rankedResults.slice(0, topK)
    
    // Normalize RRF scores back to a more readable 0.0-1.0 visually scaling them up a bit
    // as RRF scores are naturally small e.g., 0.016
    const maxScore = finalResults.length > 0 ? finalResults[0].score : 1
    for (const res of finalResults) {
        res.score = Math.min(1.0, res.score / maxScore) 
    }

    return finalResults
  }
}
