import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import type { Person, PersonRelation } from '../../../shared/types'

export class PersonRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Creates a new person and associates their first alias.
   * Returns the newly created person ID.
   */
  createPersonWithAlias(name: string, alias: string, color: string): string {
    const personId = nanoid()

    const insertPerson = this.db.prepare(`
      INSERT INTO people (id, name, color) VALUES (@id, @name, @color)
    `)

    const insertAlias = this.db.prepare(`
      INSERT INTO person_aliases (person_id, alias) VALUES (@person_id, @alias)
    `)

    const runAll = this.db.transaction(() => {
      insertPerson.run({ id: personId, name, color })
      insertAlias.run({ person_id: personId, alias })
    })

    runAll()
    return personId
  }

  /**
   * Links a person to a session as a mention.
   */
  linkMention(sessionId: string, personId: string, context: string | null): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO person_mentions (session_id, person_id, context)
      VALUES (@session_id, @person_id, @context)
    `)
    stmt.run({ session_id: sessionId, person_id: personId, context })
  }

  /**
   * Searches for a person by matching an alias using FTS5.
   */
  findProbableMatch(alias: string): Person[] {
    const cleanAlias = alias.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ ]/g, '').trim()
    if (!cleanAlias) return []

    const query = `
      SELECT p.*
      FROM person_aliases_fts fts
      JOIN person_aliases pa ON fts.person_id = pa.person_id AND fts.alias = pa.alias
      JOIN people p ON pa.person_id = p.id
      WHERE person_aliases_fts MATCH ?
      ORDER BY fts.rank LIMIT 5
    `
    const matchQuery = `"${cleanAlias}"*`
    return this.db.prepare(query).all(matchQuery) as Person[]
  }

  /**
   * Returns all person relations.
   */
  findAllRelations(): PersonRelation[] {
    return this.db.prepare(`
      SELECT * FROM person_relations
    `).all() as PersonRelation[]
  }

  /**
   * Returns all people ordered by mention count and recency.
   */
  findAll(): Person[] {
    return this.db.prepare(`
      SELECT * FROM people ORDER BY message_count DESC, last_seen DESC
    `).all() as Person[]
  }
}
