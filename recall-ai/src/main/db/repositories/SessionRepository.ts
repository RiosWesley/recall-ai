import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import type { Session, NewSession, Entity, NewEntity } from '../../../shared/types'

/**
 * SessionRepository — manages conversational sessions and their entities along with FTS5 index.
 * All inserts are transactional: row + FTS5 entry written together.
 */
export class SessionRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Insert sessions and their FTS5 entries in a single transaction.
   */
  insertBatch(sessions: NewSession[], entities: NewEntity[]): void {
    if (sessions.length === 0 && entities.length === 0) return

    const insertSession = this.db.prepare(`
      INSERT INTO sessions (
        id, chat_id, start_time, end_time, message_count, summary
      ) VALUES (
        @id, @chat_id, @start_time, @end_time, @message_count, @summary
      )
    `)

    const insertSessionFts = this.db.prepare(`
      INSERT INTO sessions_fts (summary, session_id)
      VALUES (@summary, @session_id)
    `)

    const insertEntity = this.db.prepare(`
      INSERT INTO entities (
        id, session_id, name, normalized_name, type, action
      ) VALUES (
        @id, @session_id, @name, @normalized_name, @type, @action
      )
    `)

    const insertEntityFts = this.db.prepare(`
      INSERT INTO entities_fts (normalized_name, type, action, entity_id)
      VALUES (@normalized_name, @type, @action, @entity_id)
    `)

    const runAll = this.db.transaction((sessItems: NewSession[], entItems: NewEntity[]) => {
      // 1. Insert sessions
      for (const sess of sessItems) {
        const id = sess.id ?? nanoid()
        insertSession.run({
          id,
          chat_id: sess.chat_id,
          start_time: sess.start_time,
          end_time: sess.end_time,
          message_count: sess.message_count ?? 0,
          summary: sess.summary,
        })
        insertSessionFts.run({ summary: sess.summary, session_id: id })
      }

      // 2. Insert entities
      for (const ent of entItems) {
        const id = ent.id ?? nanoid()
        insertEntity.run({
          id,
          session_id: ent.session_id,
          name: ent.name,
          normalized_name: ent.normalized_name,
          type: ent.type,
          action: ent.action,
        })
        insertEntityFts.run({ 
          normalized_name: ent.normalized_name, 
          type: ent.type, 
          action: ent.action, 
          entity_id: id 
        })
      }
    })

    runAll(sessions, entities)
  }

  findByChatId(chatId: string): Session[] {
    const rows = this.db.prepare(`
      SELECT * FROM sessions
      WHERE chat_id = ?
      ORDER BY start_time ASC
    `).all(chatId) as Session[]

    return rows
  }

  findEntitiesByChatId(chatId: string): Entity[] {
    const rows = this.db.prepare(`
      SELECT e.* FROM entities e
      JOIN sessions s ON s.id = e.session_id
      WHERE s.chat_id = ?
      ORDER BY e.created_at ASC
    `).all(chatId) as Entity[]

    return rows
  }

  findById(id: string): Session | null {
    const row = this.db.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    ).get(id) as Session | undefined

    return row || null
  }

  deleteByChatId(chatId: string): void {
    // First get all session IDs so we can delete from FTS5 too
    const sessionIds = this.db.prepare(
      'SELECT id FROM sessions WHERE chat_id = ?'
    ).all(chatId) as { id: string }[]

    if (sessionIds.length === 0) {
      return
    }

    const deleteSessions = this.db.prepare('DELETE FROM sessions WHERE chat_id = ?')
    const deleteSessionFts = this.db.prepare('DELETE FROM sessions_fts WHERE session_id = ?')
    const deleteEntityFts = this.db.prepare(
      'DELETE FROM entities_fts WHERE entity_id IN (SELECT id FROM entities WHERE session_id = ?)'
    )

    const runAll = this.db.transaction(() => {
      for (const { id } of sessionIds) {
        deleteEntityFts.run(id)
        deleteSessionFts.run(id)
      }
      deleteSessions.run(chatId)
    })

    runAll()
  }

  countByChatId(chatId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM sessions WHERE chat_id = ?'
    ).get(chatId) as { count: number }

    return row.count
  }

  searchNarrative(keywords: string[], limit = 5, options?: { dateFrom?: number, dateTo?: number }): Session[] {
    if (!keywords || keywords.length === 0) return []
    
    const cleanTokens = keywords.map(k => k.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ ]/g, '').trim()).filter(Boolean)
    if (cleanTokens.length === 0) return []
    const matchQuery = cleanTokens.map(k => `"${k}"*`).join(' OR ')

    let query = `
      SELECT s.*
      FROM sessions_fts fts
      JOIN sessions s ON fts.session_id = s.id
      WHERE sessions_fts MATCH ?
    `
    const params: any[] = [matchQuery]

    if (options?.dateFrom) {
      query += ` AND s.start_time >= ?`
      params.push(options.dateFrom)
    }
    if (options?.dateTo) {
      query += ` AND s.end_time <= ?`
      params.push(options.dateTo)
    }

    query += ` ORDER BY fts.rank LIMIT ?`
    params.push(limit)

    return this.db.prepare(query).all(...params) as Session[]
  }

  searchAggregation(keywords: string[], limit = 10, options?: { dateFrom?: number, dateTo?: number }): { name: string, type: string, count: number }[] {
    if (!keywords || keywords.length === 0) return []
    
    const cleanTokens = keywords.map(k => k.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ ]/g, '').trim()).filter(Boolean)
    if (cleanTokens.length === 0) return []
    const matchQuery = cleanTokens.map(k => `"${k}"*`).join(' OR ')

    let query = `
      SELECT e.normalized_name as name, e.type, COUNT(*) as count
      FROM entities_fts fts
      JOIN entities e ON fts.entity_id = e.id
      JOIN sessions s ON e.session_id = s.id
      WHERE entities_fts MATCH ?
    `
    const params: any[] = [matchQuery]

    if (options?.dateFrom) {
      query += ` AND s.start_time >= ?`
      params.push(options.dateFrom)
    }
    if (options?.dateTo) {
      query += ` AND s.end_time <= ?`
      params.push(options.dateTo)
    }

    query += ` GROUP BY e.normalized_name, e.type ORDER BY count DESC LIMIT ?`
    params.push(limit)

    return this.db.prepare(query).all(...params) as { name: string, type: string, count: number }[]
  }
}
