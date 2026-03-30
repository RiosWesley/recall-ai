import Database from 'better-sqlite3'
import type { ProfileFact } from '../../../shared/types'

export class ProfileFactRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Insert a batch of ProfileFacts into the database.
   */
  insertBatch(facts: ProfileFact[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO profile_facts (id, contact_id, category, text, evidence)
      VALUES (?, ?, ?, ?, ?)
    `)

    this.db.transaction((items: ProfileFact[]) => {
      for (const item of items) {
        stmt.run(item.id, item.contact_id, item.category, item.text, item.evidence)
      }
    })(facts)
  }

  /**
   * Delete all profile facts for a specific chat.
   */
  deleteByChatId(chatId: string): void {
    this.db.prepare('DELETE FROM profile_facts WHERE contact_id = ?').run(chatId)
  }

  /**
   * Retrieve all profile facts for a specific chat, ordered by highest evidence.
   */
  findByChatId(chatId: string): ProfileFact[] {
    return this.db.prepare(`
      SELECT * FROM profile_facts 
      WHERE contact_id = ? 
      ORDER BY evidence DESC
    `).all(chatId) as ProfileFact[]
  }
}
