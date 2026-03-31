import { LLMService } from '../LLMService'

export interface Proposition {
  fact: string
  category: string
  fact_date: string | null
  actors: string[]
  original_quote: string
}

export class PropositionExtractor {
  private llm: LLMService

  constructor() {
    this.llm = LLMService.getInstance()
  }

  private PROMPT = `Leia o bloco de mensagens e extraia os fatos auto-contidos mais importantes (Proposições Atômicas).
Cada fato deve fazer sentido isoladamente, sem precisar do contexto anterior. Ex: "João convidou a Maria para comer pizza na sexta-feira".

As categorias permitidas são: "local", "evento", "opinião", "compra", "hobbie", "trabalho", "pessoal", "outro".
Se a data for mencionada de forma implícita ou explícita (ex: "amanhã", "dia 15"), tente inferir e colocar no formato YYYY-MM-DD se possível, ou apenas algo descritivo, ou null.

Bloco de Conversa:
{text}

Retorne APENAS um JSON no formato de array. Não inclua blocos markdown ( \`\`\`json ). Exemplo de saída:
[
  {
    "fact": "João comprou um PlayStation 5",
    "category": "compra",
    "fact_date": null,
    "actors": ["João"],
    "original_quote": "João: comprei um ps5 hj"
  }
]
`

  async extract(parentContent: string): Promise<Proposition[]> {
    if (!parentContent || parentContent.trim() === '') return []
    
    // Safety check - if too large, we might need to truncate
    // But parent chunks are already size-limited (~1024 tokens)
    const prompt = this.PROMPT.replace('{text}', parentContent)

    try {
      const response = await this.llm.generate(prompt, {
        temperature: 0.1,
        maxTokens: 512,
        systemPrompt: "Você é um classificador analítico. Saída estritamente em JSON puro."
      })
      
      const cleaned = response.replace(/```json/i, '').replace(/```/g, '').trim()
      let parsed: Proposition[] = []
      
      try {
        parsed = JSON.parse(cleaned)
      } catch (parseErr) {
        console.warn('[PropositionExtractor] JSON parse error from LLM response', cleaned.substring(0, 100))
        return []
      }

      if (Array.isArray(parsed)) {
        return parsed.map(p => ({
          fact: typeof p.fact === 'string' ? p.fact.substring(0, 300) : '',
          category: typeof p.category === 'string' ? p.category : 'outro',
          fact_date: p.fact_date ? String(p.fact_date) : null,
          actors: Array.isArray(p.actors) ? p.actors.map(String) : [],
          original_quote: typeof p.original_quote === 'string' ? p.original_quote.substring(0, 500) : ''
        })).filter(p => p.fact.length > 5)
      }
      
      return []
    } catch (err) {
      console.warn('[PropositionExtractor] Error during fact extraction', err)
      return []
    }
  }
}
