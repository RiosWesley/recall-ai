import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import type { Message, NewMessage } from '../../../shared/types'

/**
 * MessageRepository — batch inserts and queries for the `messages` table.
 * All batch operations run inside transactions for maximum performance.
 */
export class MessageRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Insert a batch of messages in a single transaction.
   * Duplicate rows (same chat_id + timestamp + sender + content) are silently ignored.
   */
  insertBatch(messages: NewMessage[]): void {
    if (messages.length === 0) return

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO messages (id, chat_id, sender, content, timestamp, type, raw)
      VALUES (@id, @chat_id, @sender, @content, @timestamp, @type, @raw)
    `)

    const runAll = this.db.transaction((msgs: NewMessage[]) => {
      for (const msg of msgs) {
        insert.run({
          id: msg.id ?? nanoid(),
          chat_id: msg.chat_id,
          sender: msg.sender,
          content: msg.content,
          timestamp: msg.timestamp,
          type: msg.type ?? 'text',
          raw: msg.raw ?? null,
        })
      }
    })

    runAll(messages)
  }

  findByChatId(chatId: string, limit = 1000, offset = 0): Message[] {
    return this.db.prepare(`
      SELECT * FROM messages
      WHERE chat_id = ?
      ORDER BY timestamp ASC
      LIMIT ? OFFSET ?
    `).all(chatId, limit, offset) as Message[]
  }

  countByChatId(chatId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE chat_id = ?'
    ).get(chatId) as { count: number }

    return row.count
  }

  /**
   * Returns unique sender names for a given chat, ordered by message count.
   */
  getParticipants(chatId: string): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT sender
      FROM messages
      WHERE chat_id = ? AND type != 'system'
      GROUP BY sender
      ORDER BY COUNT(*) DESC
    `).all(chatId) as { sender: string }[]

    return rows.map(r => r.sender)
  }

  deleteByChatId(chatId: string): void {
    this.db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId)
  }

  /**
   * Factual Search (Task 4.1): Uses FTS5 to find matches and extracts a
   * sliding window of surrounding messages (+/- windowSize).
   */
  searchFactual(keywords: string[], windowSize = 15, limit = 5): Message[][] {
    if (!keywords || keywords.length === 0) return []
    
    // Build OR query for keywords. We can also use AND if they are meant to be exact.
    // For general robustness, we prefix match each token avoiding syntax errors.
    const cleanTokens = keywords.map(k => k.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ ]/g, '').trim()).filter(Boolean)
    if (cleanTokens.length === 0) return []
    const matchQuery = cleanTokens.map(k => `"${k}"*`).join(' OR ')
    
    // 1. Find the pivot points
    const pivots = this.db.prepare(`
      SELECT m.id, m.chat_id, m.timestamp 
      FROM messages_fts fts
      JOIN messages m ON fts.message_id = m.id
      WHERE messages_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(matchQuery, limit) as { id: string, chat_id: string, timestamp: number }[]

    const windows: Message[][] = []

    // 2. Fetch the sliding window for each pivot
    const fetchWindow = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM messages 
        WHERE chat_id = ? AND timestamp <= ? 
        ORDER BY timestamp DESC LIMIT ?
      ) 
      UNION 
      SELECT * FROM (
        SELECT * FROM messages 
        WHERE chat_id = ? AND timestamp >= ? 
        ORDER BY timestamp ASC LIMIT ?
      )
      ORDER BY timestamp ASC
    `)

    for (const p of pivots) {
      const windowMsgs = fetchWindow.all(
        p.chat_id, p.timestamp, windowSize + 1, 
        p.chat_id, p.timestamp, windowSize + 1
      ) as Message[]
      windows.push(windowMsgs)
    }

    return windows
  }

  /**
   * Finds the message containing the snippet within a session and returns its neighbors.
   * Useful for "Disambiguation UI" where the user needs to see the real chat flow.
   */
  getNeighborsByContext(sessionId: string, contextSnippet: string, limit = 4): Message[] {
    // 1. Get session boundaries
    const session = this.db.prepare(`
      SELECT chat_id, start_time, end_time FROM sessions WHERE id = ?
    `).get(sessionId) as { chat_id: string, start_time: number, end_time: number } | undefined

    if (!session) return []

    // 2. Find the pivot message that contains the contextSnippet
    // We use LIKE for simple partial match within the session
    const pivot = this.db.prepare(`
      SELECT * FROM messages
      WHERE chat_id = ? AND timestamp >= ? AND timestamp <= ?
      AND content LIKE ?
      LIMIT 1
    `).get(session.chat_id, session.start_time, session.end_time, `%${contextSnippet}%`) as Message | undefined

    if (!pivot) {
      // Fallback: If we can't find the exact text (LLM might have cleaned it), 
      // just return the beginning of the session.
      return this.db.prepare(`
        SELECT * FROM messages
        WHERE chat_id = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC LIMIT ?
      `).all(session.chat_id, session.start_time, session.end_time, limit * 2) as Message[]
    }

    // 3. Fetch neighbors (limit before, pivot, limit after)
    return this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM messages 
        WHERE chat_id = ? AND timestamp < ? AND timestamp >= ?
        ORDER BY timestamp DESC LIMIT ?
      ) 
      UNION ALL
      SELECT * FROM (
        SELECT * FROM messages 
        WHERE id = ?
      )
      UNION ALL
      SELECT * FROM (
        SELECT * FROM messages 
        WHERE chat_id = ? AND timestamp > ? AND timestamp <= ?
        ORDER BY timestamp ASC LIMIT ?
      )
      ORDER BY timestamp ASC
    `).all(
      session.chat_id, pivot.timestamp, session.start_time, limit,
      pivot.id,
      session.chat_id, pivot.timestamp, session.end_time, limit
    ) as Message[]
  }
}

