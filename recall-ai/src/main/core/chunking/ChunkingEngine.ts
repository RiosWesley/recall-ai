/**
 * ChunkingEngine — Orchestrates the chunking strategy.
 *
 * Usage:
 *   const engine = new ChunkingEngine()
 *   const chunks = engine.chunk(parsedMessages)
 */

import type { ParsedMessage } from '../parser/types'
import { ParentChildStrategy, type ParentChildResult } from './strategies/ParentChildStrategy'
import {
  DEFAULT_CHUNKING_CONFIG,
  type ChunkingConfig,
  type ParentChunk,
  type ChildChunk
} from './types'

export { DEFAULT_CHUNKING_CONFIG } from './types'
export type { ChunkingConfig, ParentChunk, ChildChunk } from './types'
export type { ParentChildResult } from './strategies/ParentChildStrategy'

export class ChunkingEngine {
  private readonly strategy: ParentChildStrategy

  constructor(config: Partial<ChunkingConfig> = {}) {
    const mergedConfig: ChunkingConfig = {
      ...DEFAULT_CHUNKING_CONFIG,
      ...config,
    }
    this.strategy = new ParentChildStrategy(mergedConfig)
  }

  /**
   * Chunk an array of parsed messages into parent-child hierarchal semantic groups.
   * Messages are assumed to be pre-sorted by timestamp ascending.
   */
  chunk(messages: ParsedMessage[]): ParentChildResult {
    // Ensure sorted order (defensive)
    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp)
    return this.strategy.chunk(sorted)
  }
}
