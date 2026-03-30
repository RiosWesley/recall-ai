import type { NewMessage } from '../../../shared/types'
import { EmbeddingService } from '../EmbeddingService'

export interface TermStats {
  term: string
  totalCount: number
  countBySender: Record<string, number>
  firstSeen: number
  lastSeen: number
  sampleMessages: string[]
}

const STOPWORDS = new Set([
  'que', 'não', 'pra', 'com', 'uma', 'por', 'mas', 'como',
  'mais', 'isso', 'esse', 'essa', 'tem', 'tá', 'vai', 'vou',
  'foi', 'era', 'são', 'nos', 'das', 'dos', 'ele', 'ela',
  'meu', 'sua', 'seu', 'pro', 'sim', 'tbm', 'aqui', 'ali',
  'hj', 'aí', 'né', 'tô', 'vc', 'voce', 'kkk', 'kkkk',
  'kkkkk', 'haha', 'hahaha', 'rsrs', 'lol', 'para', 'nao',
  'q', 'tb', 'da', 'de', 'do', 'e', 'o', 'a', 'os', 'as',
  'em', 'um', 'umas', 'uns', 'no', 'na', 'se', 'ao', 'aos'
])

export function computeTermStats(messages: NewMessage[]): TermStats[] {
  const stats = new Map<string, TermStats>()
  
  for (const msg of messages) {
    if (msg.type !== 'text') continue
    
    // Normalize string: lowercase, basic cleanup, filter short words and stopwords
    const words = msg.content
      .toLowerCase()
      .replace(/[?.!,;:'"()\\[\\]{}]/g, '')
      .split(/\\s+/)
      .filter((w) => w.length >= 2 && !STOPWORDS.has(w))

    const ngrams: string[] = []
    
    // Generate Unigrams, Bigrams, Trigrams
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        const gram = words.slice(i, i + n).join(' ')
        // Ensure the entire n-gram isn't just a very short/meaningless string
        if (gram.length >= 3) {
          ngrams.push(gram)
        }
      }
    }

    // Accumulate stats
    for (const gram of ngrams) {
      const existing = stats.get(gram)
      if (existing) {
        existing.totalCount++
        existing.countBySender[msg.sender] = (existing.countBySender[msg.sender] || 0) + 1
        
        if (msg.timestamp < existing.firstSeen) existing.firstSeen = msg.timestamp
        if (msg.timestamp > existing.lastSeen) existing.lastSeen = msg.timestamp
        
        if (existing.sampleMessages.length < 5) {
          // ensure we don't just add identical sample messages
          const sample = `[${msg.sender}]: ${msg.content}`
          if (!existing.sampleMessages.includes(sample)) {
            existing.sampleMessages.push(sample)
          }
        }
      } else {
        stats.set(gram, {
          term: gram,
          totalCount: 1,
          countBySender: { [msg.sender]: 1 },
          firstSeen: msg.timestamp,
          lastSeen: msg.timestamp,
          sampleMessages: [`[${msg.sender}]: ${msg.content}`],
        })
      }
    }
  }

  const totalMsgs = messages.length

  // Filter heuristics
  return [...stats.values()]
    .filter((s) => {
      // Must appear at least 3 times to be a pattern
      if (s.totalCount < 3) return false
      // Cannot be over-represented (if it appears in > 30% of messages, it's likely a hidden stopword)
      if (s.totalCount / totalMsgs > 0.3) return false
      
      // Additional heuristic: pure number strings are not insightful as topics
      if (/^\\d+$/.test(s.term)) return false
        
      return true
    })
    .sort((a, b) => b.totalCount - a.totalCount)
}

// ─── TOPIC CLASSIFIER ────────────────────────────────────────────────────────

export const TOPIC_PROBES: Record<string, string[]> = {
  gaming: ['vamos jogar um jogo online video game pc console', 'bora uma partida rankeada'],
  going_out: ['vamos sair esse fim de semana bar festa role', 'combinar de ir jantar almocar'],
  tech: ['meu celular pc notebook formatar ssd', 'aplicativo erro bug software hardware'],
  work: ['trabalho reuniao chefe relatorio demanda', 'meu trampo projeto cliente faturamento'],
  study: ['tenho prova amanha faculdade escola curso', 'preciso estudar tcc certificado apostila'],
  relationships: ['brigou com o namorado relacionamento casal beijo', 'to ficando sentindo saudade crush'],
  food: ['pedir comida delivery ifood pizza lanche', 'vamos comer onde janta almoco fome'],
  media: ['assisti um filme muito bom cinema roteiro', 'serie nova anime tv assistir ep'],
  finances: ['me empresta um dinheiro pix banco nubank', 'to sem grana preco caro barato salario'],
  health: ['fui no medico hospital remedio farmacia', 'to passando mal dor de cabeca febre tonto']
}

export const TOPIC_LABELS: Record<string, string> = {
  gaming: 'jogos e partidas',
  going_out: 'sair e encontros',
  tech: 'tecnologia e problemas técnicos',
  work: 'trabalho e demandas profissionais',
  study: 'estudos e educação',
  relationships: 'relacionamentos sentimentais',
  food: 'comida e refeições',
  media: 'filmes, séries e mídia',
  finances: 'finanças, bancos e dinheiro',
  health: 'saúde e bem-estar'
}

export class TopicClassifier {
  private centroids: Map<string, Float32Array> = new Map()

  async init() {
    console.log('[TopicClassifier] Initializing general zero-shot probes...')
    const embedder = EmbeddingService.getInstance()
    
    for (const [topic, probes] of Object.entries(TOPIC_PROBES)) {
      const vectors = await embedder.embedBatch(probes)
      const centroid = this.averageVectors(vectors)
      this.centroids.set(topic, centroid)
    }
    console.log('[TopicClassifier] Initialized', this.centroids.size, 'topics')
  }

  classify(chunkEmbedding: Float32Array): { topic: string; score: number } | null {
    let best = { topic: '', score: -1 }
    
    for (const [topic, centroid] of this.centroids.entries()) {
      const sim = this.cosineSimilarity(chunkEmbedding, centroid)
      if (sim > best.score) {
        best = { topic, score: sim }
      }
    }
    
    // Only accept if strongly correlated to the conversational archetype
    return best.score >= 0.35 ? best : null
  }

  private averageVectors(vectors: Float32Array[]): Float32Array {
    if (!vectors.length) return new Float32Array(384)
    const dim = vectors[0].length
    const centroid = new Float32Array(dim)
    for (const v of vectors) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += v[i]
      }
    }
    for (let i = 0; i < dim; i++) {
      centroid[i] /= vectors.length
    }
    // L2 Normalize
    let norm = 0
    for (let i = 0; i < dim; i++) {
      norm += centroid[i] * centroid[i]
    }
    norm = Math.sqrt(norm)
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        centroid[i] /= norm
      }
    }
    return centroid
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0
    let aMagnitude = 0
    let bMagnitude = 0
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      aMagnitude += a[i] * a[i]
      bMagnitude += b[i] * b[i]
    }
    if (aMagnitude === 0 || bMagnitude === 0) return 0
    return dotProduct / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude))
  }
}
