import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'

import { runMigrations } from './migrations/001_initial'
import { runMigration002 } from './migrations/002_add_profile_facts'
import { runMigration003 } from './migrations/003_add_contact_profiles'
import { runMigration004 } from './migrations/004_parent_child_chunks'
import { runMigration005 } from './migrations/005_propositions'
import { runMigration006 } from './migrations/006_intelligent_ingestion'

let instance: Database.Database | null = null

/**
 * DatabaseService — Singleton connection to the SQLite database.
 * The DB is created on first access (not on Electron startup).
 * WAL mode is enabled for concurrent read performance.
 */
export class DatabaseService {
  private static db: Database.Database | null = null

  static getInstance(): Database.Database {
    if (DatabaseService.db) {
      return DatabaseService.db
    }

    const userDataPath = app.getPath('userData')
    const dbPath = path.join(userDataPath, 'recall-ai.db')

    console.log('[DB] Opening database at:', dbPath)

    const db = new Database(dbPath, {
      verbose: process.env.NODE_ENV === 'development' ? console.log : undefined,
    })

    // Enable WAL mode for better concurrent read performance
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('synchronous = NORMAL')
    db.pragma('cache_size = -32000') // 32MB cache
    db.pragma('temp_store = MEMORY')

    DatabaseService.db = db

    runMigrations(db)
    runMigration002(db)
    runMigration003(db)
    runMigration004(db)
    runMigration005(db)
    runMigration006(db)

    console.log('[DB] Database ready')

    return db
  }

  /** Close the database connection (call on app quit) */
  static close(): void {
    if (DatabaseService.db) {
      DatabaseService.db.close()
      DatabaseService.db = null
      console.log('[DB] Database closed')
    }
  }

  /** Check if the database is open */
  static isOpen(): boolean {
    return DatabaseService.db !== null && DatabaseService.db.open
  }
}

// Legacy export for convenience
export function getDatabase(): Database.Database {
  return DatabaseService.getInstance()
}

export { instance }
