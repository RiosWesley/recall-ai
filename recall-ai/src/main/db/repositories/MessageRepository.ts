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
}
