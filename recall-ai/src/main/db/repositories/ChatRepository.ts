import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import type { Chat, NewChat } from '../../../shared/types'

/**
 * ChatRepository — CRUD + queries for the `chats` table.
 */
export class ChatRepository {
  constructor(private readonly db: Database.Database) {}

  create(chat: NewChat): Chat {
    const id = chat.id ?? nanoid()
    const now = Math.floor(Date.now() / 1000)

    this.db.prepare(`
      INSERT INTO chats (
        id, name, source, participant_count, message_count,
        first_message_at, last_message_at, imported_at, file_hash, metadata
      ) VALUES (
        @id, @name, @source, @participant_count, @message_count,
        @first_message_at, @last_message_at, @imported_at, @file_hash, @metadata
      )
    `).run({
      id,
      name: chat.name,
      source: chat.source ?? 'whatsapp',
      participant_count: chat.participant_count ?? null,
      message_count: chat.message_count ?? 0,
      first_message_at: chat.first_message_at ?? null,
      last_message_at: chat.last_message_at ?? null,
      imported_at: now,
      file_hash: chat.file_hash ?? null,
      metadata: chat.metadata ? JSON.stringify(chat.metadata) : null,
    })

    return this.findById(id)!
  }

  findAll(): Chat[] {
    const rows = this.db.prepare(
      'SELECT * FROM chats ORDER BY imported_at DESC'
    ).all() as RawChat[]

    return rows.map(deserializeChat)
  }

  findById(id: string): Chat | null {
    const row = this.db.prepare(
      'SELECT * FROM chats WHERE id = ?'
    ).get(id) as RawChat | undefined

    return row ? deserializeChat(row) : null
  }

  delete(id: string): void {
    // ON DELETE CASCADE will handle messages/chunks automatically
    this.db.prepare('DELETE FROM chats WHERE id = ?').run(id)
  }

  existsByHash(fileHash: string): boolean {
    const row = this.db.prepare(
      'SELECT id FROM chats WHERE file_hash = ?'
    ).get(fileHash)

    return row !== undefined
  }

  updateMessageCount(id: string, count: number): void {
    this.db.prepare(
      'UPDATE chats SET message_count = ? WHERE id = ?'
    ).run(count, id)
  }

  updateParticipantCount(id: string, count: number): void {
    this.db.prepare(
      'UPDATE chats SET participant_count = ? WHERE id = ?'
    ).run(count, id)
  }

  updateTimestamps(id: string, firstAt: number, lastAt: number): void {
    this.db.prepare(
      'UPDATE chats SET first_message_at = ?, last_message_at = ? WHERE id = ?'
    ).run(firstAt, lastAt, id)
  }
}

// ─── Raw row type (metadata/participants stored as JSON strings) ────────────

interface RawChat {
  id: string
  name: string
  source: string
  participant_count: number | null
  message_count: number
  first_message_at: number | null
  last_message_at: number | null
  imported_at: number
  file_hash: string | null
  metadata: string | null
}

function deserializeChat(row: RawChat): Chat {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }
}
