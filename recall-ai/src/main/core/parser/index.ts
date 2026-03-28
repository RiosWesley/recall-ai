/**
 * Parser module — public API.
 */

export { WhatsAppParser } from './WhatsAppParser'
export { detectFormatFromFile, detectFormatFromLines, getPatternById } from './formatDetector'
export { ALL_PATTERNS, ANDROID_BR, ANDROID_EN, IOS_EN, SYSTEM_PATTERNS, MEDIA_PATTERNS } from './patterns'
export type {
  DetectedFormat,
  ParsedMessage,
  ParseResult,
  ParseStats,
  ParseError,
  ParseErrorReason,
  Platform,
  TimeFormat,
} from './types'
