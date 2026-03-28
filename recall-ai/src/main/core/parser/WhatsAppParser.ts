/**
 * WhatsAppParser — Main parser class.
 *
 * Strategy:
 *  1. Detect format from first 20 lines (streaming, no full load)
 *  2. Stream file line-by-line with readline
 *  3. Accumulate multi-line messages
 *  4. Classify message type (text / media / system)
 *  5. Return ParseResult with messages + stats + errors
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { detectFormatFromFile, getPatternById } from './formatDetector'
import { MEDIA_PATTERNS, SYSTEM_PATTERNS } from './patterns'
import type { MessageType } from '../../../shared/types'
import type {
  DetectedFormat,
  ParseError,
  ParseResult,
  ParseStats,
  ParsedMessage,
} from './types'

export class WhatsAppParser {
  /**
   * Parse a WhatsApp export .txt file using streaming (memory-efficient).
   */
  async parse(filePath: string): Promise<ParseResult> {
    // Step 1: Detect format
    let format: DetectedFormat
    try {
      format = await detectFormatFromFile(filePath)
    } catch (err) {
      throw new Error(
        `Failed to detect WhatsApp format: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    const pattern = getPatternById(format.id)
    const messages: ParsedMessage[] = []
    const errors: ParseError[] = []

    let currentMessage: Partial<ParsedMessage> | null = null
    let lineNumber = 0

    // Step 2: Stream file line-by-line
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      lineNumber++

      // Strip BOM on first line if present
      const cleanLine = lineNumber === 1 ? line.replace(/^\uFEFF/, '') : line
      const match = pattern.regex.exec(cleanLine)

      if (match) {
        // Flush previous message
        if (currentMessage && isComplete(currentMessage)) {
          messages.push(finalizeMessage(currentMessage))
        }

        // Parse timestamp — if it fails, record error and skip
        const rawDate = match[pattern.groups.date]
        const rawTime = match[pattern.groups.time]
        let timestamp: number
        try {
          timestamp = parseTimestamp(rawDate, rawTime, format)
        } catch {
          errors.push({ line: lineNumber, content: cleanLine, reason: 'invalid_timestamp' })
          currentMessage = null
          continue
        }

        const rawContent = match[pattern.groups.content] ?? ''
        const sender = match[pattern.groups.sender].trim()

        currentMessage = {
          timestamp,
          sender,
          content: rawContent,
          type: detectMessageType(rawContent, sender),
          raw: cleanLine,
          lineNumber,
        }
      } else if (currentMessage && cleanLine.trim()) {
        // Continuation of a multi-line message
        currentMessage.content = (currentMessage.content ?? '') + '\n' + cleanLine
        currentMessage.raw = (currentMessage.raw ?? '') + '\n' + cleanLine
      } else if (cleanLine.trim() && !currentMessage) {
        // Orphan line — before first matched message
        errors.push({ line: lineNumber, content: cleanLine, reason: 'orphan_line' })
      }
      // Empty lines are silently ignored
    }

    // Flush last message
    if (currentMessage && isComplete(currentMessage)) {
      messages.push(finalizeMessage(currentMessage))
    }

    const participants = [...new Set(messages.map((m) => m.sender))]

    const stats: ParseStats = {
      totalLines: lineNumber,
      totalMessages: messages.length,
      errorCount: errors.length,
      participants,
      firstTimestamp: messages.length > 0 ? messages[0].timestamp : null,
      lastTimestamp: messages.length > 0 ? messages[messages.length - 1].timestamp : null,
    }

    return { messages, format, errors, stats }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isComplete(m: Partial<ParsedMessage>): m is ParsedMessage {
  return (
    m.timestamp !== undefined &&
    m.sender !== undefined &&
    m.content !== undefined &&
    m.type !== undefined &&
    m.raw !== undefined &&
    m.lineNumber !== undefined
  )
}

function finalizeMessage(m: Partial<ParsedMessage>): ParsedMessage {
  return {
    timestamp: m.timestamp!,
    sender: m.sender!,
    content: m.content!.trim(),
    type: detectMessageType(m.content!.trim(), m.sender!),
    raw: m.raw!,
    lineNumber: m.lineNumber!,
  }
}

function detectMessageType(content: string, sender: string): MessageType {
  // System messages have no colon-separated sender in the original line — they
  // only appear after the timestamp directly. However since we only receive the
  // content portion here, we use heuristic patterns.
  const trimmed = content.trim()

  for (const pattern of MEDIA_PATTERNS) {
    if (pattern.test(trimmed)) return 'media'
  }

  // Check system patterns against the raw content
  for (const pattern of SYSTEM_PATTERNS) {
    if (pattern.test(trimmed)) return 'system'
  }

  // System messages often have no real sender (it's the app itself)
  if (!sender || sender.trim() === '') return 'system'

  return 'text'
}

/**
 * Parse a date/time string into a Unix timestamp (seconds).
 * Supports 24h formats (DD/MM/YYYY HH:MM) and 12h formats (M/D/YY H:MM AM/PM).
 */
function parseTimestamp(date: string, time: string, format: DetectedFormat): number {
  let day: number, month: number, year: number

  if (format.locale === 'pt-BR' || format.locale === 'pt-PT') {
    // DD/MM/YYYY
    const [d, m, y] = date.split('/').map(Number)
    day = d; month = m; year = y
  } else if (format.locale === 'en-US') {
    // M/D/YY or M/D/YYYY
    const [m, d, y] = date.split('/').map(Number)
    month = m; day = d; year = y
  } else {
    // Fallback: try DD/MM/YYYY
    const parts = date.split(/[\/\.\-]/).map(Number)
    ;[day, month, year] = parts
  }

  // Normalize 2-digit year
  if (year < 100) year += year < 70 ? 2000 : 1900

  let hours: number, minutes: number

  if (format.timeFormat === '12h') {
    // "2:30 PM" or "2:30:45 PM"
    const isPM = /PM/i.test(time)
    const timePart = time.replace(/\s*[AP]M/i, '')
    const parts = timePart.split(':').map(Number)
    hours = parts[0]
    minutes = parts[1]
    if (isPM && hours !== 12) hours += 12
    if (!isPM && hours === 12) hours = 0
  } else {
    // "14:30" or "14:30:00"
    const parts = time.split(':').map(Number)
    hours = parts[0]
    minutes = parts[1]
  }

  const ts = Date.UTC(year, month - 1, day, hours, minutes) / 1000
  if (isNaN(ts)) throw new Error(`Invalid timestamp: ${date} ${time}`)

  return ts
}
