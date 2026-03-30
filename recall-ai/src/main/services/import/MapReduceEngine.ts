import { LLMService } from '../LLMService'
import { DatabaseService } from '../../db/database'
import { ContactProfileRepository } from '../../db/repositories/ContactProfileRepository'
import { BlockSummaryRepository } from '../../db/repositories/BlockSummaryRepository'
import type { Message, ImportProgress, ContactProfile } from '../../../shared/types'

// ─── PROMPTS ───

const EXTRACT_PROMPT = `
Leia o trecho de conversa fornecido e liste os fatos concretos mais importantes para entender os padrões de relacionamento entre as duas pessoas.

Diretrizes:
- Liste um fato por linha, começando com "- "
- Foque em interesses comuns, hobbies, problemas, dinâmicas de poder/iniciativa, etc.
- NÃO escreva introduções, conclusões ou comentários, não dê 'ok' ou 'claro'.
- Se não houver fatos relevantes, não escreva nada irrelevante, apenas diga "NENHUM".
- Responda apenas com a lista e nada mais.

Conversa:
"""
{conversation}
"""
`

const CONSOLIDATE_PROMPT = `
Abaixo estão fatos extraídos sequencialmente de uma conversa completa ao longo do tempo.

Sua tarefa é CONSOLIDAR esses perfis em um "Perfil de Contato" robusto, coeso e descritivo, agrupando os fatos nas seguintes categorias (caso existam informações pertinentes):

- Interações Frequentes (dinâmica de contato, quem chama mais)
- Tópicos Principais (assuntos que sempre voltam a ser discutidos)
- Hobbies, Comidas e Interesses compartilhados
- Menções a Problemas e Eventos Importantes 
- Características comportamentais / Tom geral da conversa

Diretrizes:
- Escreva de forma fluída e conectada. Use parágrafos claros.
- Redija na terceira pessoa (ex: "O usuário e a pessoa conversam...", ou se citar a pessoa nominalmente, use o nome).
- Não invente informações. Se uma seção não tem fatos listados, não a preencha.
- Evite listar com "bullet points" vazios.
- Vá direto ao ponto! Nada de "Pode deixar, aqui está o resumo:"

Fatos do Bloco Histórico:
{summaries}
`

export interface Block {
  messages: Message[]
  index: number
  startDate: string
  endDate: string
  estimatedTokens: number
}

// ─── ENGINE ───
export class MapReduceEngine {
  private profileRepo: ContactProfileRepository
  private summaryRepo: BlockSummaryRepository
  private llmService: LLMService

  constructor() {
    const db = DatabaseService.getInstance()
    this.profileRepo = new ContactProfileRepository(db)
    this.summaryRepo = new BlockSummaryRepository(db)
    this.llmService = LLMService.getInstance()
  }

  /**
   * Run the Map-Reduce pipeline to generate a Contact Profile.
   */
  async runMapReduce(
    messages: Message[],
    contactName: string,
    contactId: string,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ContactProfile | null> {
    const startTime = Date.now()
    
    // 1. Divider as mensagens em Blocos
    const blocks = this.splitIntoBlocks(messages, 4500) // 4500 conservative to fit in ~8k Window + output limits
    
    if (blocks.length === 0) return null

    onProgress?.({
      stage: 'parsing', // Mantemos a compatibilidade visual com os estágios já existentes ou criamos um novo
      percent: 30, // Entre o "Parsing" e "Chunking" tradicional
      label: 'Dividindo Blocos (Map-Reduce)',
      detail: `${blocks.length} blocos gerados com ~4.5k tokens cada. Iniciando análise...`
    })

    const summariesList: { period: string; text: string; messageCount: number }[] = []

    // 2. Fase MAP: Extrair fatos por bloco iterando
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i]
        
        onProgress?.({
            stage: 'parsing',
            percent: 30 + Math.round((i / blocks.length) * 40), // Pula de 30 para 70% durante o Map
            label: `Analisando Bloco ${i + 1}/${blocks.length}`,
            detail: 'Processamento Local LLM (Map Phase)'
        })

        const convoText = block.messages
          .map(m => `[${new Date(m.timestamp * 1000).toLocaleString('pt-BR')}][${m.sender}]: ${m.content}`)
          .join('\\n')

        const prompt = EXTRACT_PROMPT.replace('{conversation}', convoText)

        let factsText = await this.llmService.generate(prompt, {
            maxTokens: 1024,
            temperature: 0.1,
            clearCache: true,
            systemPrompt: 'Você é um bot analista neutro focado em extrair fatos frios. Nenhuma enrolação.'
        })

        if (!factsText.toUpperCase().includes('NENHUM') && factsText.trim().length > 10) {
            summariesList.push({
                period: `${block.startDate} até ${block.endDate}`,
                text: factsText,
                messageCount: block.messages.length
            })

            // Salva intermediário no repositório (Recoverability future plan)
            this.summaryRepo.save({
                contact_id: contactId,
                block_index: block.index,
                start_date: block.startDate,
                end_date: block.endDate,
                message_count: block.messages.length,
                summary_text: factsText
            })
        }
    }

    if (summariesList.length === 0) {
        console.warn('[MapReduceEngine] Nenhuma fato relevante encontrado em nenhum bloco.')
        return null
    }

    // 3. Fase REDUCE: Criar um Profile descritivo combinando tudo
    onProgress?.({
        stage: 'parsing',
        percent: 71, // Em tese a UI já está lá em cima
        label: 'Consolidando Arquivo de Perfil',
        detail: 'Redigindo dossiê completo (Reduce Phase)'
    })

    const consolidacaoRaw = summariesList.map(s => `--- Período das conversas ${s.period} ---\n${s.text}`).join('\n\n')
    
    // Check if the aggregated text is too big for the context window
    const estimatedTokens = Math.ceil(consolidacaoRaw.length / 3.5)
    
    let finalProfileText = ''

    if (estimatedTokens > 6000) {
         // Should chunk the reduce too if the text got incredibly large. 
         // For now, let's truncate gracefully to fit inside ~8192 parameters.
         console.warn(`[MapReduceEngine] Reduzindo input de consolidação. Estimativa excedeu limites (${estimatedTokens})`)
         finalProfileText = await this.reduceRecursively(summariesList, contactName)
    } else {
         const promptConsolidate = CONSOLIDATE_PROMPT.replace('{summaries}', consolidacaoRaw)
         finalProfileText = await this.llmService.generate(promptConsolidate, {
             maxTokens: 2048,
             temperature: 0.2,
             systemPrompt: 'Você é um perito sociológico construindo um perfil coeso baseando-se única e exclusivamente nos fatos anotados.'
         })
    }

    const processingTime = Date.now() - startTime

    const contactProfile: ContactProfile = {
        contact_id: contactId,
        contact_name: contactName,
        profile_text: finalProfileText,
        message_count: messages.length,
        date_range_start: new Date(messages[0].timestamp * 1000).toISOString(),
        date_range_end: new Date(messages[messages.length - 1].timestamp * 1000).toISOString(),
        model_used: 'qwen2.5/llama-worker', // We will fix standard naming soon
        block_count: blocks.length,
        processing_time_ms: processingTime
    }

    this.profileRepo.save(contactProfile)

    return contactProfile
  }

  private async reduceRecursively(summaries: { period: string; text: string }[], contactName: string): Promise<string> {
      // Future-proof for extreme large chats: Split the summaries in half, consolidate each, then consolidate the two results.
      // Currently simplified fallback to avoid over-engineering if not necessary right now.
      const promptConsolidate = CONSOLIDATE_PROMPT.replace('{summaries}', summaries.map(s => s.text).join('\n'))
      return await this.llmService.generate(promptConsolidate, {
          maxTokens: 2048,
          temperature: 0.2
      })
  }

  private splitIntoBlocks(messages: Message[], maxTokens: number): Block[] {
    const blocks: Block[] = []
    let current: Message[] = []
    let currentTokens = 0
    let blockIndex = 0

    for (const msg of messages) {
      // estimate tokens ~ chars / 3.5 in pt-BR
      const lineLen = msg.sender.length + (msg.content?.length || 0) + 20
      const tokens = Math.ceil(lineLen / 3.5)

      if (currentTokens + tokens > maxTokens && current.length > 0) {
        blocks.push({
          messages: current,
          index: blockIndex++,
          startDate: new Date(current[0].timestamp * 1000).toLocaleDateString('pt-BR'),
          endDate: new Date(current[current.length - 1].timestamp * 1000).toLocaleDateString('pt-BR'),
          estimatedTokens: currentTokens
        })
        current = []
        currentTokens = 0
      }

      current.push(msg)
      currentTokens += tokens
    }

    if (current.length > 0) {
        blocks.push({
          messages: current,
          index: blockIndex++,
          startDate: new Date(current[0].timestamp * 1000).toLocaleDateString('pt-BR'),
          endDate: new Date(current[current.length - 1].timestamp * 1000).toLocaleDateString('pt-BR'),
          estimatedTokens: currentTokens
        })
    }

    return blocks
  }
}
