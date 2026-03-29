/**
 * Model Registry — Declarative catalog of AI models used by Recall.ai.
 * Each entry maps a logical key to its HuggingFace URI, size estimate, and metadata.
 *
 * URI format (node-llama-cpp native):
 *   hf:<user>/<repo>:<quant>
 *
 * The quantization suffix guarantees offline resolution without querying HF metadata,
 * making subsequent app starts faster (no network round-trip for path resolution).
 */

export type ModelKey = 'embedding' | 'llm'

export interface ModelEntry {
  /** Logical key used throughout the codebase */
  key: ModelKey
  /** Human-readable display name */
  name: string
  /** node-llama-cpp native URI — supports hf: scheme and direct https:// */
  uri: string
  /** Approximate uncompressed size in bytes — used for UI progress estimates */
  sizeEstimate: number
  /** What this model is used for */
  purpose: 'embedding' | 'generation'
  /** For embedding models: vector output dimensions */
  dimensions?: number
  /** Quantization format description */
  quantization: string
}

export const MODEL_REGISTRY = {
  /**
   * nomic-embed-text-v1.5 — Extremely capable Semantic Embedding Model, 768 dimensions.
   *
   * Replaces 'all-MiniLM' to provide an industry-leading context window (8192 tokens),
   * ensuring massive monolithic text chunks never overflow the context.
   * Superior multimodal and varied-context search recall.
   * Size: ~80MB (Q4_K_M).
   *
   * Repo: nomic-ai/nomic-embed-text-v1.5-GGUF
   */
  embedding: {
    key: 'embedding',
    name: 'nomic-embed-text-v1.5',
    uri: 'hf:nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M',
    sizeEstimate: 80_000_000, // ~80MB
    purpose: 'embedding',
    dimensions: 768,
    quantization: 'Q4_K_M',
  },

  /**
   * Gemma 3 270M IT — Instruction-tuned generative model.
   *
   * Q4_K_M strikes the optimal balance between inference speed and quality
   * for a 270M parameter model. At this scale, quantization below Q4 becomes
   * noticeably degraded; Q4_K_M maintains coherent output.
   * Size: ~150MB
   *
   * Used in TASK 3.x (LLM service). Downloaded now so the user doesn't wait
   * when they first use the chat feature.
   *
   * Repo: bartowski/google_gemma-3-270m-it-GGUF
   */
  llm: {
    key: 'llm',
    name: 'Gemma 3 270M IT',
    uri: 'hf:bartowski/google_gemma-3-270m-it-GGUF:Q4_K_M',
    sizeEstimate: 150_000_000, // ~150MB
    purpose: 'generation',
    quantization: 'Q4_K_M',
  },
} as const satisfies Record<ModelKey, ModelEntry>

/** All model keys in download-priority order (embedding first — needed sooner) */
export const MODEL_DOWNLOAD_ORDER: ModelKey[] = ['embedding', 'llm']
