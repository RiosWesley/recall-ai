import { LLMService } from './LLMService'

export interface TemporalResolution {
  has_temporal_filter: boolean
  date_from: string | null
  date_to: string | null
  clean_question: string
}

export class TemporalResolver {
  private static instance: TemporalResolver | null = null
  private llm: LLMService

  private constructor() {
    this.llm = LLMService.getInstance()
  }

  static getInstance(): TemporalResolver {
    if (!TemporalResolver.instance) {
      TemporalResolver.instance = new TemporalResolver()
    }
    return TemporalResolver.instance
  }

  private RESOLVE_PROMPT = `Hoje é {today}.
O usuário disse: "{question}"

Extraia o filtro temporal implícito identificando qualquer menção a dias, meses, anos ou referências de tempo como "ontem", "mês passado", etc.
Se houver filtro, defina a data inicial (date_from) e final (date_to) em formato ISO e retire a referência de tempo do "clean_question".
Se for um dia exato, date_from e date_to devem ser iguais.

Responda APENAS com este JSON exato, num formato estrito sem quebras de linha fora do esperado e sem crases:
{
  "has_temporal_filter": true,
  "date_from": "YYYY-MM-DD",
  "date_to": "YYYY-MM-DD",
  "clean_question": "pergunta sem tempo"
}

Exemplos:
- Usuário: "o que compramos mês passado" -> {"has_temporal_filter": true, "date_from": "2025-05-01", "date_to": "2025-05-31", "clean_question": "o que compramos"}
- Usuário: "qual jogo ele gosta de jogar" -> {"has_temporal_filter": false, "date_from": null, "date_to": null, "clean_question": "qual jogo ele gosta de jogar"}
- Usuário: "você lembra o que comemos ontem?" -> (se hoje for 2026-03-30) {"has_temporal_filter": true, "date_from": "2026-03-29", "date_to": "2026-03-29", "clean_question": "você lembra o que comemos"}
`

  async resolve(question: string): Promise<TemporalResolution> {
    const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) // YYYY-MM-DD
    const prompt = this.RESOLVE_PROMPT.replace('{today}', today).replace('{question}', question)

    try {
      const response = await this.llm.generate(prompt, {
        temperature: 0.1,
        maxTokens: 150,
        systemPrompt: "Você é um classificador analítico. Saída estritamente em JSON puro."
      })
      
      // Attempt to clean markdown tags if present
      const cleaned = response.replace(/```json/i, '').replace(/```/g, '').trim()
      
      const parsed = JSON.parse(cleaned) as TemporalResolution
      return {
        has_temporal_filter: parsed.has_temporal_filter ?? false,
        date_from: parsed.date_from ?? null,
        date_to: parsed.date_to ?? null,
        clean_question: parsed.clean_question || question
      }
    } catch (err) {
      console.error('[TemporalResolver] Error resolving temporal filter:', err)
      // Fallback
      return {
        has_temporal_filter: false,
        date_from: null,
        date_to: null,
        clean_question: question
      }
    }
  }
}
