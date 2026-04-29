import { nanoid } from 'nanoid'
import type Database from 'better-sqlite3'
import type { PendingMention } from '../../shared/types'

export class PendingMentionsManager {
  private static instance: PendingMentionsManager
  private db: Database.Database | null = null
  private queue: PendingMention[] = []

  private constructor() {}

  public static getInstance(): PendingMentionsManager {
    if (!PendingMentionsManager.instance) {
      PendingMentionsManager.instance = new PendingMentionsManager()
    }
    return PendingMentionsManager.instance
  }

  /**
   * Initializes the manager by loading existing pending mentions from the DB.
   */
  public initialize(db: Database.Database): void {
    this.db = db
    try {
      const rows = this.db.prepare(`
        SELECT id, session_id as sessionId, alias, context, timestamp 
        FROM pending_mentions 
        ORDER BY timestamp ASC
      `).all() as PendingMention[]
      
      this.queue = rows
      console.log(`[PendingMentionsManager] Loaded ${this.queue.length} mentions from DB.`)
    } catch (err) {
      console.error('[PendingMentionsManager] Failed to load from DB:', err)
      this.queue = []
    }
  }

  public addMention(sessionId: string, alias: string, context: string | null): PendingMention {
    const mention: PendingMention = {
      id: nanoid(),
      sessionId,
      alias,
      context,
      timestamp: Date.now()
    }

    // Persist to DB if available
    if (this.db) {
      try {
        this.db.prepare(`
          INSERT INTO pending_mentions (id, session_id, alias, context, timestamp)
          VALUES (@id, @sessionId, @alias, @context, @timestamp)
        `).run(mention)
      } catch (err) {
        console.error('[PendingMentionsManager] Failed to persist mention:', err)
      }
    }

    this.queue.push(mention)
    return mention
  }

  public getPending(): PendingMention[] {
    return [...this.queue]
  }

  public getMentionById(id: string): PendingMention | undefined {
    return this.queue.find(m => m.id === id)
  }

  public removeMention(id: string): void {
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM pending_mentions WHERE id = ?').run(id)
      } catch (err) {
        console.error('[PendingMentionsManager] Failed to delete mention from DB:', err)
      }
    }
    this.queue = this.queue.filter(m => m.id !== id)
  }

  /**
   * If there are clones (same alias) of an approved/resolved mention, we can auto-resolve them too.
   * This method extracts all clones from the queue so they can be processed by the caller.
   */
  public extractClones(alias: string): PendingMention[] {
    const cleanAlias = alias.trim().toLowerCase()
    const clones = this.queue.filter(m => m.alias.trim().toLowerCase() === cleanAlias)
    
    // Remove from DB
    if (this.db && clones.length > 0) {
      try {
        const ids = clones.map(c => `'${c.id}'`).join(',')
        this.db.prepare(`DELETE FROM pending_mentions WHERE id IN (${ids})`).run()
      } catch (err) {
        console.error('[PendingMentionsManager] Failed to delete clones from DB:', err)
      }
    }

    // Remove from memory
    this.queue = this.queue.filter(m => m.alias.trim().toLowerCase() !== cleanAlias)
    return clones
  }

  public clear(): void {
    if (this.db) {
      this.db.prepare('DELETE FROM pending_mentions').run()
    }
    this.queue = []
  }
}
