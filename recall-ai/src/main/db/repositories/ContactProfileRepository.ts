import Database from 'better-sqlite3'
import type { ContactProfile } from '../../../shared/types'

export class ContactProfileRepository {
  constructor(private readonly db: Database.Database) {}

  save(profile: ContactProfile): void {
    const stmt = this.db.prepare(`
      INSERT INTO contact_profiles 
        (id, contact_id, contact_name, profile_text, message_count,
         date_range_start, date_range_end, model_used, block_count, processing_time_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(contact_id) DO UPDATE SET
        contact_name = excluded.contact_name,
        profile_text = excluded.profile_text,
        message_count = excluded.message_count,
        date_range_start = excluded.date_range_start,
        date_range_end = excluded.date_range_end,
        model_used = excluded.model_used,
        block_count = excluded.block_count,
        processing_time_ms = excluded.processing_time_ms,
        updated_at = strftime('%s', 'now')
    `)

    stmt.run(
      profile.id || profile.contact_id, // fallback se não passar id
      profile.contact_id,
      profile.contact_name,
      profile.profile_text,
      profile.message_count,
      profile.date_range_start,
      profile.date_range_end,
      profile.model_used || 'llm-worker',
      profile.block_count,
      profile.processing_time_ms
    )
  }

  findByChatId(chatId: string): ContactProfile | null {
    const row = this.db.prepare(
      'SELECT * FROM contact_profiles WHERE contact_id = ?'
    ).get(chatId) as ContactProfile | undefined

    return row || null
  }

  deleteByChatId(chatId: string): void {
    this.db.prepare('DELETE FROM contact_profiles WHERE contact_id = ?').run(chatId)
  }
}
