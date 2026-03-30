/**
 * Types for the Chunking Engine.
 */

// ─── Chunking Config ──────────────────────────────────────────────────────────

export interface ChunkingConfig {
  /**
   * Maximum time gap (in seconds) between messages within the same chunk.
   * Default: 5 minutes = 300 seconds
   */
  timeWindowSeconds: number

  /**
   * Maximum token count per chunk before forcing a split.
   * Default: 256
   */
  maxTokens: number

  /**
   * Number of messages to carry over from previous chunk (overlap for context).
   * Default: 1
   */
  overlapMessages: number
}

// ─── Raw Chunk ────────────────────────────────────────────────────────────────

export interface RawChunk {
  /** Plain text — used for embedding. No names/timestamps. */
  content: string

  /** Formatted text with sender names + relative timestamps — used for UI display. */
  displayContent: string

  /** Unix timestamp (seconds) of first message in chunk. */
  startTime: number

  /** Unix timestamp (seconds) of last message in chunk. */
  endTime: number

  /** Number of messages in this chunk. */
  messageCount: number

  /** Estimated token count. */
  tokenCount: number

  /** Unique senders within this chunk. */
  participants: string[]
}

// ─── Default Config ───────────────────────────────────────────────────────────

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  timeWindowSeconds: 10 * 60, // 10 minutos (era 5)
  maxTokens: 512,             // (era 256)
  overlapMessages: 3,         // (era 1)
}
