import Database from 'better-sqlite3'

const MIGRATION_ID = '004_parent_child_chunks'

const SCHEMA_SQL = `
  -- ============================================================
  -- PARENT CHUNKS — contexto completo retornado ao LLM
  -- ============================================================
  CREATE TABLE IF NOT EXISTS parent_chunks (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    display_content TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    message_count INTEGER DEFAULT 0,
    token_count INTEGER DEFAULT 0,
    participants TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- ============================================================
  -- CHILD CHUNKS — menor granularidade para embeddings precisos
  -- ============================================================
  CREATE TABLE IF NOT EXISTS child_chunks (
    id TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL REFERENCES parent_chunks(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    display_content TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    message_count INTEGER DEFAULT 0,
    child_index INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_parent_chunks_chat ON parent_chunks(chat_id);
  CREATE INDEX IF NOT EXISTS idx_child_chunks_parent ON child_chunks(parent_id);
  CREATE INDEX IF NOT EXISTS idx_child_chunks_time ON child_chunks(start_time, end_time);
`

const VIRTUAL_TABLES_SQL = `
  -- ============================================================
  -- VECTORS — child embeddings via sqlite-vec
  -- ============================================================
  CREATE VIRTUAL TABLE IF NOT EXISTS child_vectors USING vec0(
    chunk_id TEXT PRIMARY KEY,
    embedding FLOAT[768]
  );

  -- ============================================================
  -- FTS5 — full text da busca híbrida para children
  -- ============================================================
  CREATE VIRTUAL TABLE IF NOT EXISTS child_chunks_fts USING fts5(
    content,
    chunk_id UNINDEXED,
    tokenize='unicode61'
  );
`

const FTS5_ONLY_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS child_chunks_fts USING fts5(
    content,
    chunk_id UNINDEXED,
    tokenize='unicode61'
  );
`

export function runMigration004(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(MIGRATION_ID)
  if (existing) {
    console.log('[DB] Migration 004_parent_child_chunks already applied — skipping')
    return
  }

  console.log('[DB] Running migration 004_parent_child_chunks...')

  db.transaction(() => {
    db.exec(SCHEMA_SQL)
    
    if (isSqliteVecLoaded(db)) {
      console.log('[DB] sqlite-vec detected — creating child_vectors + child_chunks_fts tables')
      db.exec(VIRTUAL_TABLES_SQL)
    } else {
      console.log('[DB] sqlite-vec not detected — creating child_chunks_fts only')
      db.exec(FTS5_ONLY_SQL)
    }

    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(MIGRATION_ID)
  })()

  console.log('[DB] Migration 004_parent_child_chunks complete')
}

function isSqliteVecLoaded(db: Database.Database): boolean {
  try {
    db.prepare("SELECT vec_version()").get()
    return true
  } catch {
    return false
  }
}
