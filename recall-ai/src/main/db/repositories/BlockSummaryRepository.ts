import Database from 'better-sqlite3'
import type { BlockSummary } from '../../../shared/types'
import { nanoid } from 'nanoid'

export class BlockSummaryRepository {
  constructor(private readonly db: Database.Database) {}

  save(summary: Omit<BlockSummary, 'id' | 'created_at'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO block_summaries 
        (id, contact_id, block_index, summary_text, start_date, end_date, message_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(contact_id, block_index) DO UPDATE SET
        summary_text = excluded.summary_text,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        message_count = excluded.message_count,
        created_at = strftime('%s', 'now')
    `)

    stmt.run(
      nanoid(),
      summary.contact_id,
      summary.block_index,
      summary.summary_text,
      summary.start_date,
      summary.end_date,
      summary.message_count
    )
  }

  findByChatId(chatId: string): BlockSummary[] {
    return this.db.prepare(
      'SELECT * FROM block_summaries WHERE contact_id = ? ORDER BY block_index ASC'
    ).all(chatId) as BlockSummary[]
  }

  deleteByChatId(chatId: string): void {
    this.db.prepare('DELETE FROM block_summaries WHERE contact_id = ?').run(chatId)
  }
}
