import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { runMigrations } from './migrations/001_initial'

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

    // Attempt to load the sqlite-vec extension (vector search)
    DatabaseService.loadSqliteVec(db)

    DatabaseService.db = db

    // Run migrations
    runMigrations(db)

    console.log('[DB] Database ready')

    return db
  }

  /**
   * Loads the sqlite-vec extension for vector similarity search.
   * If the extension binary is not found, continues gracefully
   * (vector search will be unavailable until the model is downloaded).
   */
  private static loadSqliteVec(db: Database.Database): void {
    try {
      // Try to load sqlite-vec from multiple possible locations
      const possiblePaths = [
        path.join(app.getPath('userData'), 'vec0'),
        path.join(process.resourcesPath ?? '', 'vec0'),
        path.join(__dirname, 'vec0'),
        // Development: look in node_modules
        path.join(process.cwd(), 'node_modules', 'sqlite-vec', 'vec0'),
      ]

      // On Windows the extension is a .dll (no extension needed when using loadExtension)
      let loaded = false
      for (const extPath of possiblePaths) {
        if (fs.existsSync(extPath) || fs.existsSync(extPath + '.dll') ||
            fs.existsSync(extPath + '.so') || fs.existsSync(extPath + '.dylib')) {
          db.loadExtension(extPath)
          loaded = true
          console.log('[DB] sqlite-vec loaded from:', extPath)
          break
        }
      }

      if (!loaded) {
        // Try loading by name (if it's in PATH / LD_LIBRARY_PATH)
        try {
          db.loadExtension('vec0')
          loaded = true
          console.log('[DB] sqlite-vec loaded by name')
        } catch {
          console.warn('[DB] sqlite-vec not found — vector search will be unavailable.')
          console.warn('[DB] Install sqlite-vec to enable semantic search.')
        }
      }

      if (loaded) {
        // Verify the extension works
        const result = db.prepare("SELECT vec_version() as version").get() as { version: string }
        console.log('[DB] sqlite-vec version:', result.version)
      }
    } catch (err) {
      console.error('[DB] Failed to load sqlite-vec:', err)
      // Non-fatal — app continues without vector search
    }
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
