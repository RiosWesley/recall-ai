/**
 * Format detector — reads first 20 lines of a file and identifies the
 * WhatsApp export format, without loading the full file.
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { ALL_PATTERNS, type PatternDefinition } from './patterns'
import type { DetectedFormat } from './types'

const SAMPLE_LINE_COUNT = 20

/**
 * Detect WhatsApp export format from the first lines of a file.
 * Throws if no known format is identified.
 */
export async function detectFormatFromFile(filePath: string): Promise<DetectedFormat> {
  const sampleLines = await readSampleLines(filePath, SAMPLE_LINE_COUNT)
  return detectFormatFromLines(sampleLines)
}

/**
 * Detect format from an array of sample lines (for testing without file I/O).
 */
export function detectFormatFromLines(lines: string[]): DetectedFormat {
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    for (const pattern of ALL_PATTERNS) {
      if (pattern.regex.test(trimmed)) {
        return pattern.format
      }
    }
  }

  throw new Error(
    `WhatsApp format not recognized. Tried ${ALL_PATTERNS.length} patterns on ${lines.length} sample lines.`
  )
}

/**
 * Get the matching PatternDefinition for a detected format ID.
 */
export function getPatternById(formatId: string): PatternDefinition {
  const pattern = ALL_PATTERNS.find((p) => p.id === formatId)
  if (!pattern) {
    throw new Error(`No pattern registered for format ID: ${formatId}`)
  }
  return pattern
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

async function readSampleLines(filePath: string, count: number): Promise<string[]> {
  const lines: string[] = []

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    lines.push(line)
    if (lines.length >= count) {
      rl.close()
      break
    }
  }

  return lines
}
