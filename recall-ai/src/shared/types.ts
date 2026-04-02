/**
 * Shared TypeScript types for Recall.ai entities.
 * Used by both main process (DB repositories) and renderer (React UI).
 */

// ─── CHAT ────────────────────────────────────────────────────────────────────

export interface Chat {
  id: string
  name: string
  source: string
  participant_count: number | null
  message_count: number
  first_message_at: number | null  // Unix timestamp (seconds)
  last_message_at: number | null
  imported_at: number
  file_hash: string | null
  metadata: Record<string, unknown> | null
}

export interface NewChat {
  id?: string
  name: string
  source?: string
  participant_count?: number
  message_count?: number
  first_message_at?: number
  last_message_at?: number
  file_hash?: string
  metadata?: Record<string, unknown>
}

// ─── MESSAGE ─────────────────────────────────────────────────────────────────

export type MessageType = 'text' | 'media' | 'system'

export interface Message {
  id: string
  chat_id: string
  sender: string
  content: string
  timestamp: number  // Unix timestamp (seconds)
  type: MessageType
  raw: string | null
}

export interface NewMessage {
  id?: string
  chat_id: string
  sender: string
  content: string
  timestamp: number
  type?: MessageType
  raw?: string
}

// ─── SESSIONS & ENTITIES ────────────────────────────────────────────────────

export interface Session {
  id: string
  chat_id: string
  start_time: number
  end_time: number
  message_count: number
  summary: string
  created_at: number
}

export interface NewSession {
  id?: string
  chat_id: string
  start_time: number
  end_time: number
  message_count: number
  summary: string
}

export interface Entity {
  id: string
  session_id: string
  name: string
  normalized_name: string
  type: string
  action: string
  created_at: number
}

export interface NewEntity {
  id?: string
  session_id: string
  name: string
  normalized_name: string
  type: string
  action: string
}

// ─── PROFILE FACT ─────────────────────────────────────────────────────────────

export type FactCategory = 'frequent_term' | 'topic' | 'dynamics' | 'co_occurrence'

export interface ProfileFact {
  id?: string
  contact_id: string
  category: FactCategory
  text: string
  evidence: number
}

// ─── SEARCH ──────────────────────────────────────────────────────────────────

export interface SearchOptions {
  hybrid?: boolean
  chatId?: string
  limit?: number
  dateFrom?: number
  dateTo?: number
}

export type SearchIntent = 'factual' | 'aggregation' | 'narrative' | 'unknown'

export interface ClassifiedQuery {
  intent: SearchIntent
  keywords: string[]
  dateRange?: {
    start?: string | null
    end?: string | null
  }
}

export interface SearchResult {
  id: string
  chatId: string
  chatName: string
  score: number // Similarity score (0-1)
  content: string // Formatted string with highlight <mark>
  date: string // Display date
  sender: string
  chunkId?: string // Deprecated post-005, kept for compatibility
  
  // Context Bridging fields (Task 4.1)
  intent?: SearchIntent
  metadata?: Record<string, any> // E.g., for aggregations: { count: 5, type: 'theme' }
}

// ─── QUERY CACHE ─────────────────────────────────────────────────────────────

export interface QueryCache {
  id: string
  query_text: string
  query_embedding: Buffer | null
  result_chunks: string[] | null  // parsed from JSON
  llm_response: string | null
  created_at: number
  hit_count: number
}

// ─── SEARCH HISTORY ──────────────────────────────────────────────────────────

export interface SearchHistory {
  id: string
  query: string
  chat_ids: string[] | null  // parsed from JSON
  result_count: number
  created_at: number
}

// ─── IMPORT ──────────────────────────────────────────────────────────────────

export type ImportStageId =
  | 'reading'
  | 'parsing'
  | 'fts_indexing'
  | 'nlp_summaries'
  | 'nlp_entities'
  | 'done'
  | 'error'

export interface ImportProgress {
  stage: ImportStageId
  /** 0–100 */
  percent: number
  /** Human-readable status label */
  label: string
  /** Detailed description shown under the step */
  detail?: string
}

export interface ImportResult {
  success: boolean
  chatId?: string
  chatName?: string
  messageCount?: number
  chunkCount?: number
  /** Set when success === false */
  error?: string
  /** Set when the file was already imported (same hash) */
  duplicate?: boolean
}

// ─── MODELS ──────────────────────────────────────────────────────────────────

export type ModelKey = 'embedding' | 'worker' | 'brain' | 'worker_fallback'
export type ModelPurpose = 'embedding' | 'generation'

/**
 * Snapshot of a model's local availability — returned by models:check.
 */
export interface ModelStatus {
  key: ModelKey
  name: string
  quantization: string
  /** Approximate file size in bytes for UI display */
  sizeEstimate: number
  purpose: ModelPurpose
  /** True if the model file is present locally */
  available: boolean
  /** Absolute path to the model file (only set when available === true) */
  filePath?: string
}

/**
 * Real-time download progress — emitted on models:progress IPC event.
 */
export interface ModelDownloadProgress {
  key: ModelKey
  name: string
  downloadedBytes: number
  totalBytes: number
  /** 0–100 */
  percent: number
  /** Bytes per second */
  speed: number
}

// ─── RAG ───────────────────────────────────────────────────────────────────

export interface RAGLatency {
  embedding: number
  search: number
  generation: number
  total: number
}

export type RAGStep = 'booting' | 'searching' | 'processing' | 'synthesizing'

export interface RAGOptions {
  chatId?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

export interface RAGResponse {
  answer: string
  context: SearchResult[]
  tokensUsed: number
  latency: RAGLatency
}

// ─── MAP-REDUCE ENGINE ────────────────────────────────────────────────────────

export interface ContactProfile {
  id?: string
  contact_id: string
  contact_name: string
  profile_text: string
  message_count: number
  date_range_start: string
  date_range_end: string
  model_used: string
  block_count: number
  processing_time_ms: number
  created_at?: number
  updated_at?: number
}

export interface BlockSummary {
  id?: string
  contact_id: string
  block_index: number
  start_date: string
  end_date: string
  message_count: number
  summary_text: string
  created_at?: number
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────

export interface AppSettings {
  gpu: string
  temperature: number
  systemPrompt: string
  topK: number
  alpha: number
  history: boolean
  analytics: boolean
  customLlmPath: string | null
  customEmbeddingPath: string | null
}

