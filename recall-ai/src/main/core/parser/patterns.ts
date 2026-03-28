/**
 * Regex patterns for each WhatsApp export format.
 * Each pattern captures: (date)(time)(sender)(content)
 */

import type { DetectedFormat } from './types'

// ─── Pattern Definitions ──────────────────────────────────────────────────────

export interface PatternDefinition {
  id: string
  regex: RegExp
  format: DetectedFormat
  /**
   * Group indices: [dateGroup, timeGroup, senderGroup, contentGroup]
   * (1-indexed, matching regex capture groups)
   */
  groups: {
    date: number
    time: number
    sender: number
    content: number
  }
}

/**
 * Android BR: `01/05/2024 14:30 - Sender: Content`
 */
export const ANDROID_BR: PatternDefinition = {
  id: 'android_br',
  regex: /^(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}) - ([^:]+): (.*)$/,
  format: {
    id: 'android_br',
    platform: 'android',
    locale: 'pt-BR',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    hasSeconds: false,
    hasBrackets: false,
  },
  groups: { date: 1, time: 2, sender: 3, content: 4 },
}

/**
 * Android BR with comma: `01/05/2024, 14:30 - Sender: Content` (Portugal variant)
 */
export const ANDROID_BR_COMMA: PatternDefinition = {
  id: 'android_br_comma',
  regex: /^(\d{2}\/\d{2}\/\d{4}), (\d{2}:\d{2}) - ([^:]+): (.*)$/,
  format: {
    id: 'android_br_comma',
    platform: 'android',
    locale: 'pt-PT',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    hasSeconds: false,
    hasBrackets: false,
  },
  groups: { date: 1, time: 2, sender: 3, content: 4 },
}

/**
 * Android EN: `5/1/24, 2:30 PM - Sender: Content`
 */
export const ANDROID_EN: PatternDefinition = {
  id: 'android_en',
  regex: /^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2} [AP]M) - ([^:]+): (.*)$/,
  format: {
    id: 'android_en',
    platform: 'android',
    locale: 'en-US',
    dateFormat: 'M/D/YY',
    timeFormat: '12h',
    hasSeconds: false,
    hasBrackets: false,
  },
  groups: { date: 1, time: 2, sender: 3, content: 4 },
}

/**
 * iOS EN: `[5/1/24, 2:30:45 PM] Sender: Content`
 */
export const IOS_EN: PatternDefinition = {
  id: 'ios_en',
  regex: /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}:\d{2} [AP]M)\] ([^:]+): (.*)$/,
  format: {
    id: 'ios_en',
    platform: 'ios',
    locale: 'en-US',
    dateFormat: 'M/D/YY',
    timeFormat: '12h',
    hasSeconds: true,
    hasBrackets: true,
  },
  groups: { date: 1, time: 2, sender: 3, content: 4 },
}

/**
 * All patterns in priority order (most common first).
 */
export const ALL_PATTERNS: PatternDefinition[] = [
  ANDROID_BR,
  ANDROID_BR_COMMA,
  ANDROID_EN,
  IOS_EN,
]

// ─── System Message Patterns ──────────────────────────────────────────────────

export const SYSTEM_PATTERNS: RegExp[] = [
  /criptografia de ponta/i,
  /end-to-end encrypted/i,
  /adicionou/i,
  /removeu/i,
  /\bsaiu\b/i,
  /entrou usando/i,
  /mudou a descrição/i,
  /mudou o ícone/i,
  /mensagem foi apagada/i,
  /this message was deleted/i,
  /criou o grupo/i,
  /agora é admin/i,
  /is now an admin/i,
  /changed the subject/i,
  /changed the group/i,
  /left\b/i,
  /added\s+\+?\d/i,
  /removed\s+\+?\d/i,
  /security code changed/i,
  /código de segurança mudou/i,
]

// ─── Media Message Patterns ───────────────────────────────────────────────────

export const MEDIA_PATTERNS: RegExp[] = [
  /<Mídia oculta>/i,
  /<Media omitted>/i,
  /\.(jpg|jpeg|png|gif|webp|mp4|opus|ogg|pdf|docx?)\s*\(arquivo anexado\)/i,
  /\.(jpg|jpeg|png|gif|webp|mp4|opus|ogg|pdf|docx?)\s*\(file attached\)/i,
  /^(IMG|VID|PTT|STK|DOC|AUD)-\d{8}-WA\d+/,
  /image omitted/i,
  /video omitted/i,
  /audio omitted/i,
  /sticker omitted/i,
  /document omitted/i,
  /GIF omitted/i,
]
