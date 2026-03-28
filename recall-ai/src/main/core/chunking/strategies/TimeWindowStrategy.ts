/**
 * TimeWindowStrategy — groups messages into chunks based on a time gap.
 *
 * Algorithm:
 *  1. Iterate messages ordered by timestamp (assumed pre-sorted)
 *  2. Start a new chunk whenever the gap to the previous message > timeWindowSeconds
 *  3. If the current chunk exceeds maxTokens, force-split and start a new chunk
 *  4. Carry `overlapMessages` from the previous chunk for context
 *
 * Output per chunk:
 *  - `content`        — plain text for embedding (no names/timestamps)
 *  - `displayContent` — formatted: "Sender [HH:MM]: content" per message
 */

import type { ParsedMessage } from '../../parser/types'
import type { ChunkingConfig, RawChunk } from '../types'

export class TimeWindowStrategy {
  constructor(private readonly config: ChunkingConfig) {}

  chunk(messages: ParsedMessage[]): RawChunk[] {
    if (messages.length === 0) return []

    const chunks: RawChunk[] = []
    let windowMessages: ParsedMessage[] = []

    const flushChunk = (): void => {
      if (windowMessages.length === 0) return
      chunks.push(buildChunk(windowMessages))
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      if (windowMessages.length === 0) {
        windowMessages.push(msg)
        continue
      }

      const lastMsg = windowMessages[windowMessages.length - 1]
      const gap = msg.timestamp - lastMsg.timestamp
      const currentTokens = estimateTokenCount(windowMessages)
      const msgTokens = estimateTokensForMessage(msg)

      const exceedsTimeWindow = gap > this.config.timeWindowSeconds
      const exceedsTokenBudget = currentTokens + msgTokens > this.config.maxTokens

      if (exceedsTimeWindow || exceedsTokenBudget) {
        flushChunk()

        // Carry overlap messages for context continuity
        const overlapStart = Math.max(
          0,
          windowMessages.length - this.config.overlapMessages
        )
        windowMessages = windowMessages.slice(overlapStart)
        windowMessages.push(msg)
      } else {
        windowMessages.push(msg)
      }
    }

    flushChunk()
    return chunks
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildChunk(messages: ParsedMessage[]): RawChunk {
  const participants = [...new Set(messages.map((m) => m.sender))]

  // content = plain text, no metadata, separated by newlines
  const content = messages
    .filter((m) => m.type !== 'system') // exclude system noise from embedding
    .map((m) => m.content)
    .join('\n')

  // displayContent = human-readable with sender and time
  const displayContent = messages
    .map((m) => {
      const timeStr = formatTime(m.timestamp)
      return `${m.sender} [${timeStr}]: ${m.content}`
    })
    .join('\n')

  const startTime = messages[0].timestamp
  const endTime = messages[messages.length - 1].timestamp

  return {
    content,
    displayContent,
    startTime,
    endTime,
    messageCount: messages.length,
    tokenCount: estimateTokenCount(messages),
    participants,
  }
}

/**
 * Simple whitespace-based token estimator (~4 chars per token, GPT heuristic).
 * Accurate enough for chunking purposes without a full tokenizer dependency.
 */
function estimateTokenCount(messages: ParsedMessage[]): number {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0)
  return Math.ceil(totalChars / 4)
}

function estimateTokensForMessage(msg: ParsedMessage): number {
  return Math.ceil(msg.content.length / 4)
}

function formatTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
