import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import type { Chunk, NewChunk } from '../../../shared/types'

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
