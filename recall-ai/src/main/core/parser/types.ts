/**
 * Types for the WhatsApp parser module.
 */

import type { MessageType } from '../../../shared/types'

// ─── Detected Format ─────────────────────────────────────────────────────────

export type Platform = 'android' | 'ios'
export type TimeFormat = '12h' | '24h'

export interface DetectedFormat {
  id: string           // e.g. 'android_br', 'android_en', 'ios_en'
  platform: Platform
  locale: string       // e.g. 'pt-BR', 'en-US'
  dateFormat: string   // e.g. 'DD/MM/YYYY', 'M/D/YY'
  timeFormat: TimeFormat
  hasSeconds: boolean
  hasBrackets: boolean
}

// ─── Parsed Message ───────────────────────────────────────────────────────────

export interface ParsedMessage {
  timestamp: number     // Unix timestamp (seconds)
  sender: string
  content: string
  type: MessageType
  raw: string           // Original line(s) as-is
  lineNumber: number
}

// ─── Parse Stats ─────────────────────────────────────────────────────────────

export interface ParseStats {
  totalLines: number
  totalMessages: number
  errorCount: number
  participants: string[]
  firstTimestamp: number | null
  lastTimestamp: number | null
}

// ─── Parse Error ─────────────────────────────────────────────────────────────

export type ParseErrorReason = 'orphan_line' | 'invalid_timestamp' | 'unknown_format'

export interface ParseError {
  line: number
  content: string
  reason: ParseErrorReason
}

// ─── Parse Result ─────────────────────────────────────────────────────────────

export interface ParseResult {
  messages: ParsedMessage[]
  format: DetectedFormat
  errors: ParseError[]
  stats: ParseStats
}
