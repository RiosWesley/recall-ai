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

// ─── CHUNK ───────────────────────────────────────────────────────────────────

export interface Chunk {
  id: string
  chat_id: string
  content: string          // plain text for embedding
  display_content: string  // formatted with names + timestamps
  start_time: number
  end_time: number
  message_count: number
  token_count: number
  participants: string[]   // parsed from JSON
  created_at: number
}

export interface NewChunk {
  id?: string
  chat_id: string
  content: string
  display_content: string
  start_time: number
  end_time: number
  message_count?: number
  token_count?: number
  participants?: string[]
}

// ─── VECTOR ──────────────────────────────────────────────────────────────────

export interface VectorResult {
  chunk_id: string
  distance: number
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
