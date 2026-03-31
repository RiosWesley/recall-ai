import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import type { Chunk, NewChunk, NewParentChunk, NewChildChunk } from '../../../shared/types'

/**
 * ChunkRepository — manages semantic chunks and their FTS5 index.
 * All inserts are transactional: chunk row + FTS5 entry written together.
 */
export class ChunkRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Insert chunks and their FTS5 entries in a single transaction.
   */
  insertBatch(chunks: NewChunk[]): void {
    if (chunks.length === 0) return

    const insertChunk = this.db.prepare(`
      INSERT INTO chunks (
        id, chat_id, content, display_content,
        start_time, end_time, message_count, token_count, participants
      ) VALUES (
        @id, @chat_id, @content, @display_content,
        @start_time, @end_time, @message_count, @token_count, @participants
      )
    `)

    const insertFts = this.db.prepare(`
      INSERT INTO chunks_fts (content, chunk_id)
      VALUES (@content, @chunk_id)
    `)

    const runAll = this.db.transaction((items: NewChunk[]) => {
      for (const chunk of items) {
        const id = chunk.id ?? nanoid()

        insertChunk.run({
          id,
          chat_id: chunk.chat_id,
          content: chunk.content,
          display_content: chunk.display_content,
          start_time: chunk.start_time,
          end_time: chunk.end_time,
          message_count: chunk.message_count ?? 0,
          token_count: chunk.token_count ?? 0,
          participants: chunk.participants ? JSON.stringify(chunk.participants) : null,
        })

        insertFts.run({ content: chunk.content, chunk_id: id })
      }
    })

    runAll(chunks)
  }

  /**
   * Insert parent chunks, child chunks, and child FTS5 entries in a single transaction.
   */
  insertParentChildBatch(parents: NewParentChunk[], children: NewChildChunk[]): void {
    if (parents.length === 0) return

    const insertParent = this.db.prepare(`
      INSERT INTO parent_chunks (
        id, chat_id, content, display_content,
        start_time, end_time, message_count, token_count, participants
      ) VALUES (
        @id, @chat_id, @content, @display_content,
        @start_time, @end_time, @message_count, @token_count, @participants
      )
    `)

    const insertChild = this.db.prepare(`
      INSERT INTO child_chunks (
        id, parent_id, chat_id, content, display_content,
        start_time, end_time, message_count, child_index
      ) VALUES (
        @id, @parent_id, @chat_id, @content, @display_content,
        @start_time, @end_time, @message_count, @child_index
      )
    `)

    const insertFts = this.db.prepare(`
      INSERT INTO child_chunks_fts (content, chunk_id)
      VALUES (@content, @chunk_id)
    `)

    const runAll = this.db.transaction((ps: NewParentChunk[], cs: NewChildChunk[]) => {
      for (const parent of ps) {
        insertParent.run({
          id: parent.id,
          chat_id: parent.chat_id,
          content: parent.content,
          display_content: parent.display_content,
          start_time: parent.start_time,
          end_time: parent.end_time,
          message_count: parent.message_count ?? 0,
          token_count: parent.token_count ?? 0,
          participants: parent.participants ? JSON.stringify(parent.participants) : null,
        })
      }

      for (const child of cs) {
        insertChild.run({
          id: child.id,
          parent_id: child.parent_id,
          chat_id: child.chat_id,
          content: child.content,
          display_content: child.display_content,
          start_time: child.start_time,
          end_time: child.end_time,
          message_count: child.message_count ?? 0,
          child_index: child.child_index,
        })
        insertFts.run({ content: child.content, chunk_id: child.id })
      }
    })

    runAll(parents, children)
  }

  findByChatId(chatId: string): Chunk[] {
    const rows = this.db.prepare(`
      SELECT * FROM chunks
      WHERE chat_id = ?
      ORDER BY start_time ASC
    `).all(chatId) as RawChunk[]

    return rows.map(deserializeChunk)
  }

  findById(id: string): Chunk | null {
    const row = this.db.prepare(
      'SELECT * FROM chunks WHERE id = ?'
    ).get(id) as RawChunk | undefined

    return row ? deserializeChunk(row) : null
  }

  findByIds(ids: string[]): Chunk[] {
    if (ids.length === 0) return []

    // SQLite parameter binding for IN clause
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT * FROM chunks
      WHERE id IN (${placeholders})
    `).all(...ids) as RawChunk[]

    return rows.map(deserializeChunk)
  }

  findParentsByIds(ids: string[]): Chunk[] {
    if (ids.length === 0) return []

    // SQLite parameter binding for IN clause
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT * FROM parent_chunks
      WHERE id IN (${placeholders})
    `).all(...ids) as RawChunk[]

    return rows.map(deserializeChunk)
  }

  findParentsByChildIds(childIds: string[]): Chunk[] {
    if (childIds.length === 0) return []
    const placeholders = childIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT p.* FROM parent_chunks p
      JOIN child_chunks c ON c.parent_id = p.id
      WHERE c.id IN (${placeholders})
    `).all(...childIds) as RawChunk[]
    
    // Deduplicate parents just in case multiple matching children share the same parent
    const uniqueParents = Array.from(new Map(rows.map(row => [row.id, row])).values())
    return uniqueParents.map(deserializeChunk)
  }

  findParentMapByChildIds(childIds: string[]): Map<string, Chunk> {
    if (childIds.length === 0) return new Map()
    const placeholders = childIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT c.id AS child_id, p.* 
      FROM parent_chunks p
      JOIN child_chunks c ON c.parent_id = p.id
      WHERE c.id IN (${placeholders})
    `).all(...childIds) as (RawChunk & { child_id: string })[]

    const map = new Map<string, Chunk>()
    for (const row of rows) {
      map.set(row.child_id, deserializeChunk(row))
    }
    return map
  }

  deleteByChatId(chatId: string): void {
    // First get all chunk IDs so we can delete from FTS5 too
    const chunkIds = this.db.prepare(
      'SELECT id FROM chunks WHERE chat_id = ?'
    ).all(chatId) as { id: string }[]

    const deleteChunks = this.db.prepare('DELETE FROM chunks WHERE chat_id = ?')

    if (chunkIds.length === 0) {
      deleteChunks.run(chatId)
      return
    }

    const deleteFts = this.db.prepare(
      'DELETE FROM chunks_fts WHERE chunk_id = ?'
    )

    const runAll = this.db.transaction(() => {
      for (const { id } of chunkIds) {
        deleteFts.run(id)
      }
      deleteChunks.run(chatId)
    })

    runAll()
  }

  countByChatId(chatId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM chunks WHERE chat_id = ?'
    ).get(chatId) as { count: number }

    return row.count
  }
}

// ─── Serialization helpers ──────────────────────────────────────────────────

interface RawChunk {
  id: string
  chat_id: string
  content: string
  display_content: string
  start_time: number
  end_time: number
  message_count: number
  token_count: number
  participants: string | null
  created_at: number
}

function deserializeChunk(row: RawChunk): Chunk {
  return {
    ...row,
    participants: row.participants ? JSON.parse(row.participants) : [],
  }
}
