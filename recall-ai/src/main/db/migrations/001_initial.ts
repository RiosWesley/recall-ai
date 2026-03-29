import Database from 'better-sqlite3'

const MIGRATION_ID = '001_initial'

const SCHEMA_SQL = `
  -- ============================================================
  -- CHATS — imported WhatsApp conversations
  -- ============================================================
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'whatsapp',
    participant_count INTEGER,
    message_count INTEGER DEFAULT 0,
    first_message_at INTEGER,   -- Unix timestamp (seconds)
    last_message_at INTEGER,
    imported_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    file_hash TEXT,             -- SHA-256 for duplicate detection
    metadata TEXT               -- JSON with extra data
  );

  -- ============================================================
  -- MESSAGES — individual parsed messages
  -- ============================================================
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL, -- Unix timestamp (seconds)
    type TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'media' | 'system'
    raw TEXT,                           -- original raw text
    UNIQUE(chat_id, timestamp, sender, content)
  );

  -- ============================================================
  -- CHUNKS — semantic chunks ready for embedding
  -- ============================================================
  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    content TEXT NOT NULL,          -- text for embedding (plain)
    display_content TEXT NOT NULL,  -- text for display (with names + timestamps)
    start_time INTEGER NOT NULL,    -- Unix timestamp of first message in chunk
    end_time INTEGER NOT NULL,      -- Unix timestamp of last message in chunk
    message_count INTEGER DEFAULT 0,
    token_count INTEGER DEFAULT 0,
    participants TEXT,              -- JSON array of sender names
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- ============================================================
  -- QUERY CACHE — cached search results to avoid re-embedding
  -- ============================================================
  CREATE TABLE IF NOT EXISTS query_cache (
    id TEXT PRIMARY KEY,
    query_text TEXT NOT NULL,
    query_embedding BLOB,       -- serialized Float32Array
    result_chunks TEXT,         -- JSON array of chunk IDs
    llm_response TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    hit_count INTEGER NOT NULL DEFAULT 0
  );

  -- ============================================================
  -- SEARCH HISTORY — user's past queries
  -- ============================================================
  CREATE TABLE IF NOT EXISTS search_history (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    chat_ids TEXT,              -- JSON array (filter used)
    result_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- ============================================================
  -- INDEXES
  -- ============================================================
  CREATE INDEX IF NOT EXISTS idx_messages_chat      ON messages(chat_id);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_messages_sender    ON messages(sender);
  CREATE INDEX IF NOT EXISTS idx_chunks_chat        ON chunks(chat_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_time        ON chunks(start_time, end_time);
`

const VIRTUAL_TABLES_SQL = `
  -- ============================================================
  -- VECTORS — sqlite-vec KNN (created only if extension loaded)
  -- ============================================================
  CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
    chunk_id TEXT PRIMARY KEY,
    embedding FLOAT[768]
  );

  -- ============================================================
  -- FTS5 — full-text search index on chunks
  -- ============================================================
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    chunk_id UNINDEXED,
    tokenize='unicode61'
  );
`

const FTS5_ONLY_SQL = `
  -- FTS5 table only (when sqlite-vec not available)
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    chunk_id UNINDEXED,
    tokenize='unicode61'
  );
`

const MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`

/**
 * Run all pending migrations.
 * Idempotent: safe to call multiple times.
 */
export function runMigrations(db: Database.Database): void {
  // Ensure migrations tracking table exists
  db.exec(MIGRATIONS_TABLE_SQL)

  // Check if this migration was already applied
  const existing = db.prepare(
    'SELECT id FROM _migrations WHERE id = ?'
  ).get(MIGRATION_ID)

  if (existing) {
    console.log('[DB] Migration 001_initial already applied — skipping')
    return
  }

  console.log('[DB] Running migration 001_initial...')

  db.transaction(() => {
    // Apply base schema
    db.exec(SCHEMA_SQL)

    // Attempt to create virtual tables
    const hasSqliteVec = isSqliteVecLoaded(db)

    if (hasSqliteVec) {
      console.log('[DB] sqlite-vec detected — creating vectors + chunks_fts tables')
      db.exec(VIRTUAL_TABLES_SQL)
    } else {
      console.log('[DB] sqlite-vec not detected — creating chunks_fts only')
      db.exec(FTS5_ONLY_SQL)
    }

    // Mark migration as applied
    db.prepare(
      'INSERT INTO _migrations (id) VALUES (?)'
    ).run(MIGRATION_ID)
  })()

  console.log('[DB] Migration 001_initial complete')
}

/** Check if sqlite-vec extension is loaded by calling vec_version() */
function isSqliteVecLoaded(db: Database.Database): boolean {
  try {
    db.prepare("SELECT vec_version()").get()
    return true
  } catch {
    return false
  }
}
