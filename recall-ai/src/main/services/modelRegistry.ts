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
   * all-MiniLM-L6-v2 — Sentence embedding model, 384 dimensions.
   *
   * F16 (half-precision float) is used for maximum embedding quality.
   * For RAG use cases, embedding fidelity directly impacts search recall.
   * Size: ~46MB — acceptable for a one-time first-run download.
   *
   * Repo: second-state/All-MiniLM-L6-v2-Embedding-GGUF
   * This repo is purpose-built for embedding usage with proper pooling support.
   */
  embedding: {
    key: 'embedding',
    name: 'all-MiniLM-L6-v2',
    uri: 'hf:second-state/All-MiniLM-L6-v2-Embedding-GGUF:F16',
    sizeEstimate: 46_000_000, // ~46MB
    purpose: 'embedding',
    dimensions: 384,
    quantization: 'F16 (full half-precision)',
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
