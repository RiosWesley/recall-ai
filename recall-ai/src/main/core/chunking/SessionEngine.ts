import type { ParsedMessage } from '../parser/types'

export interface RawSession {
  messages: ParsedMessage[]
  start_time: number
  end_time: number
  message_count: number
}

export class SessionEngine {
  private readonly maxGapSeconds: number
  private readonly maxTokens: number

  constructor(maxGapSeconds = 7200, maxTokens = 1500) {
    this.maxGapSeconds = maxGapSeconds // Default 2 hours gap
    this.maxTokens = maxTokens // Adaptive chunking limit
  }

  /**
   * Groups an array of parsed messages into temporal sessions.
   * A new session starts when the gap between two messages exceeds `maxGapSeconds`,
   * or when the estimated token count exceeds `maxTokens` (adaptive chunking).
   * Messages are assumed to be pre-sorted by timestamp ascending.
   */
  group(messages: ParsedMessage[]): RawSession[] {
    if (messages.length === 0) return []

    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp)
    const sessions: RawSession[] = []

    let currentSessionMessages: ParsedMessage[] = [sorted[0]!]
    let currentStartTime = sorted[0]!.timestamp
    let lastMsgTime = sorted[0]!.timestamp
    let currentTokenEstimate = Math.ceil((sorted[0]!.content?.length || 0) / 4)

    for (let i = 1; i < sorted.length; i++) {
      const msg = sorted[i]!
      const gap = msg.timestamp - lastMsgTime
      const msgTokens = Math.ceil((msg.content?.length || 0) / 4)

      if (gap > this.maxGapSeconds || currentTokenEstimate + msgTokens > this.maxTokens) {
        // Gap exceeded or max tokens reached, close current session and start a new one
        sessions.push({
          messages: currentSessionMessages,
          start_time: currentStartTime,
          end_time: lastMsgTime,
          message_count: currentSessionMessages.length
        })

        // Start new session
        currentSessionMessages = [msg]
        currentStartTime = msg.timestamp
        currentTokenEstimate = msgTokens
      } else {
        currentSessionMessages.push(msg)
        currentTokenEstimate += msgTokens
      }

      lastMsgTime = msg.timestamp
    }

    // Push the final session
    sessions.push({
      messages: currentSessionMessages,
      start_time: currentStartTime,
      end_time: lastMsgTime,
      message_count: currentSessionMessages.length
    })

    return sessions
  }
}
