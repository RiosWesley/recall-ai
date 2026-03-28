/**
 * ChunkingEngine — Orchestrates the chunking strategy.
 *
 * Usage:
 *   const engine = new ChunkingEngine()
 *   const chunks = engine.chunk(parsedMessages)
 */

import type { ParsedMessage } from '../parser/types'
import { TimeWindowStrategy } from './strategies/TimeWindowStrategy'
import {
  DEFAULT_CHUNKING_CONFIG,
  type ChunkingConfig,
  type RawChunk,
} from './types'

export { DEFAULT_CHUNKING_CONFIG } from './types'
export type { ChunkingConfig, RawChunk } from './types'

export class ChunkingEngine {
  private readonly strategy: TimeWindowStrategy

  constructor(config: Partial<ChunkingConfig> = {}) {
    const mergedConfig: ChunkingConfig = {
      ...DEFAULT_CHUNKING_CONFIG,
      ...config,
    }
    this.strategy = new TimeWindowStrategy(mergedConfig)
  }

  /**
   * Chunk an array of parsed messages into semantic groups.
   * Messages are assumed to be pre-sorted by timestamp ascending.
   */
  chunk(messages: ParsedMessage[]): RawChunk[] {
    // Ensure sorted order (defensive)
    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp)
    return this.strategy.chunk(sorted)
  }
}
