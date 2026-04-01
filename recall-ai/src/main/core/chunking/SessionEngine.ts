import type { ParsedMessage } from '../parser/types'

export interface RawSession {
  messages: ParsedMessage[]
  start_time: number
  end_time: number
  message_count: number
}

export class SessionEngine {
  private readonly maxGapSeconds: number

  constructor(maxGapSeconds = 7200) {
    this.maxGapSeconds = maxGapSeconds // Default 2 hours gap
  }

  /**
   * Groups an array of parsed messages into temporal sessions.
   * A new session starts when the gap between two messages exceeds `maxGapSeconds`.
   * Messages are assumed to be pre-sorted by timestamp ascending.
   */
  group(messages: ParsedMessage[]): RawSession[] {
    if (messages.length === 0) return []

    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp)
    const sessions: RawSession[] = []

    let currentSessionMessages: ParsedMessage[] = [sorted[0]!]
    let currentStartTime = sorted[0]!.timestamp
    let lastMsgTime = sorted[0]!.timestamp

    for (let i = 1; i < sorted.length; i++) {
      const msg = sorted[i]!
      const gap = msg.timestamp - lastMsgTime

      if (gap > this.maxGapSeconds) {
        // Gap exceeded, close current session and start a new one
        sessions.push({
          messages: currentSessionMessages,
          start_time: currentStartTime,
          end_time: lastMsgTime,
          message_count: currentSessionMessages.length
        })

        // Start new session
        currentSessionMessages = [msg]
        currentStartTime = msg.timestamp
      } else {
        currentSessionMessages.push(msg)
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
