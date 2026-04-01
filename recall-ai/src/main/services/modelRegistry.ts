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

export type ModelKey = 'embedding' | 'worker' | 'brain' | 'worker_fallback'

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
   * nomic-embed-text-v1.5
   */
  embedding: {
    key: 'embedding',
    name: 'nomic-embed-text-v1.5',
    uri: 'hf:nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M',
    sizeEstimate: 80_000_000,
    purpose: 'embedding',
    dimensions: 768,
    quantization: 'Q4_K_M',
  },

  /**
   * LFM2.5-350M - Worker Process for fast parsing and extraction
   */
  worker: {
    key: 'worker',
    name: 'LFM2.5 350M',
    uri: 'hf:lmstudio-community/LFM2.5-350M-GGUF:Q4_K_M',
    sizeEstimate: 200_000_000,
    purpose: 'generation',
    quantization: 'Q4_K_M',
  },

  /**
   * Gemma 3 270M IT - Fallback Worker if LFM fails to load due to architecture
   */
  worker_fallback: {
    key: 'worker_fallback',
    name: 'Gemma 3 270M IT',
    uri: 'hf:bartowski/google_gemma-3-270m-it-GGUF:Q4_K_M',
    sizeEstimate: 150_000_000,
    purpose: 'generation',
    quantization: 'Q4_K_M',
  },

  /**
   * Qwen 3.5 4B - Brain Process for synthesis
   */
  brain: {
    key: 'brain',
    name: 'Qwen 3.5 4B',
    uri: 'hf:lmstudio-community/Qwen3.5-4B-GGUF:Q4_K_M',
    sizeEstimate: 2_500_000_000, // ~2.5GB
    purpose: 'generation',
    quantization: 'Q4_K_M',
  },
} as const satisfies Record<ModelKey, ModelEntry>

/** All model keys in download-priority order (embedding first — needed sooner) */
export const MODEL_DOWNLOAD_ORDER: ModelKey[] = ['embedding', 'worker', 'brain']
