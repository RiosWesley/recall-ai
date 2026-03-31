import type { ParsedMessage } from '../../parser/types'
import type { ChunkingConfig, ParentChunk, ChildChunk } from '../types'
import { TimeWindowStrategy } from './TimeWindowStrategy'
import { CHILD_CHUNKING_CONFIG } from '../types'
import crypto from 'node:crypto'

export interface ParentChildResult {
  parents: ParentChunk[]
  children: ChildChunk[]
}

export class ParentChildStrategy {
  private baseStrategy: TimeWindowStrategy

  constructor(config: ChunkingConfig) {
    this.baseStrategy = new TimeWindowStrategy(config)
  }

  chunk(messages: ParsedMessage[]): ParentChildResult {
    // 1. Generate normal time-based chunks (these become the PARENTS)
    const parents: ParentChunk[] = []
    const children: ChildChunk[] = []

    // Map each raw message to its original index or just work with the chunk contents?
    // We already have messages grouped by the base strategy, but base strategy only returns
    // RawChunk (strings). We need the actual messages!
    
    // Quick workaround: we'll re-implement the chunk extraction to get message slices
    // Or we just slice the original messages by matching timestamps?
    // Instead of completely rewriting TimeWindow, we can slice `messages` array for children
    // but the overlap logic in TimeWindowStrategy makes it non-linear.
    
    // Instead, let's just re-implement a cleaner TimeWindow that yields the message array.
    const chunksAndMessages = this.chunkWithMessages(messages, this.baseStrategy['config'])

    // 2. Generate children via sliding window over parent messages
    for (const { rawChunk, chunkMessages } of chunksAndMessages) {
      const parentId = crypto.randomUUID()
      parents.push({
        ...rawChunk,
        id: parentId
      })

      const childSize = CHILD_CHUNKING_CONFIG.windowMessages
      const stride = CHILD_CHUNKING_CONFIG.strideMessages
      let childIdx = 0

      for (let i = 0; i < chunkMessages.length; i += stride) {
        // If we are getting too close to the end, just grab the remaining
        const slice = chunkMessages.slice(i, i + childSize)
        
        children.push({
          parentId,
          childIndex: childIdx++,
          content: this.formatContent(slice),
          displayContent: this.formatDisplayContent(slice),
          startTime: slice[0].timestamp,
          endTime: slice[slice.length - 1].timestamp,
          messageCount: slice.length,
          tokenCount: this.estimateTokenCount(slice),
          participants: [...new Set(slice.map((m) => m.sender))]
        })

        if (i + childSize >= chunkMessages.length) break
      }
    }

    return { parents, children }
  }

  private chunkWithMessages(messages: ParsedMessage[], config: ChunkingConfig) {
    if (messages.length === 0) return []

    const chunksAndMessages: Array<{ rawChunk: any, chunkMessages: ParsedMessage[] }> = []
    let windowMessages: ParsedMessage[] = []

    const flushChunk = (): void => {
      if (windowMessages.length === 0) return
      chunksAndMessages.push({
          rawChunk: this.buildRawChunk(windowMessages),
          chunkMessages: [...windowMessages]
      })
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      if (windowMessages.length === 0) {
        windowMessages.push(msg)
        continue
      }

      const lastMsg = windowMessages[windowMessages.length - 1]
      const gap = msg.timestamp - lastMsg.timestamp
      const currentTokens = this.estimateTokenCount(windowMessages)
      const msgTokens = Math.ceil(msg.content.length / 4)

      const exceedsTimeWindow = gap > config.timeWindowSeconds
      const exceedsTokenBudget = currentTokens + msgTokens > config.maxTokens

      if (exceedsTimeWindow || exceedsTokenBudget) {
        flushChunk()
        const overlapStart = Math.max(0, windowMessages.length - config.overlapMessages)
        windowMessages = windowMessages.slice(overlapStart)
        windowMessages.push(msg)
      } else {
        windowMessages.push(msg)
      }
    }

    flushChunk()
    return chunksAndMessages
  }

  private buildRawChunk(messages: ParsedMessage[]) {
    return {
      content: this.formatContent(messages),
      displayContent: this.formatDisplayContent(messages),
      startTime: messages[0].timestamp,
      endTime: messages[messages.length - 1].timestamp,
      messageCount: messages.length,
      tokenCount: this.estimateTokenCount(messages),
      participants: [...new Set(messages.map((m) => m.sender))],
    }
  }

  private formatContent(messages: ParsedMessage[]): string {
    return messages
      .filter((m) => m.type !== 'system')
      .map((m) => `${m.sender}: ${m.content}`)
      .join('\n')
  }

  private formatDisplayContent(messages: ParsedMessage[]): string {
    return messages
      .map((m) => {
        const timeStr = this.formatTime(m.timestamp)
        return `${m.sender} [${timeStr}]: ${m.content}`
      })
      .join('\n')
  }

  private estimateTokenCount(messages: ParsedMessage[]): number {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0)
    return Math.ceil(totalChars / 4)
  }

  private formatTime(unixSeconds: number): string {
    const d = new Date(unixSeconds * 1000)
    const hh = String(d.getUTCHours()).padStart(2, '0')
    const mm = String(d.getUTCMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }
}
