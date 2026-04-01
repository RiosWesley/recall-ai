import Database from 'better-sqlite3'

const MIGRATION_ID = '006_intelligent_ingestion'

const DROP_AND_RECREATE_SQL = `
  -- We drop vector and chunks tables since we are moving away from vector embeddings and strict token chunks
  DROP TABLE IF EXISTS proposition_vectors;
  DROP TABLE IF EXISTS fact_vectors;
  DROP TABLE IF EXISTS child_vectors;
  DROP TABLE IF EXISTS vectors;
  DROP TABLE IF EXISTS propositions_fts;
  DROP TABLE IF EXISTS propositions;
  DROP TABLE IF EXISTS child_chunks_fts;
  DROP TABLE IF EXISTS child_chunks;
  DROP TABLE IF EXISTS parent_chunks;
  DROP TABLE IF EXISTS chunks_fts;
  DROP TABLE IF EXISTS chunks;

  -- ============================================================
  -- SESSIONS — natural chronological blocks of messages (> 2 hours gap)
  -- ============================================================
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    message_count INTEGER DEFAULT 0,
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- ============================================================
  -- SESSIONS_FTS — full text search over session summaries
  -- ============================================================
  CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
    summary,
    session_id UNINDEXED,
    tokenize='unicode61'
  );

  -- ============================================================
  -- ENTITIES — strongly typed NLP objects extracted from sessions
  -- ============================================================
  CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    type TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- ============================================================
  -- ENTITIES_FTS — full text search over entities data
  -- ============================================================
  CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
    normalized_name,
    type,
    action,
    entity_id UNINDEXED,
    tokenize='unicode61'
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_chat ON sessions(chat_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_time ON sessions(start_time, end_time);
  CREATE INDEX IF NOT EXISTS idx_entities_session ON entities(session_id);
`

export function runMigration006(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(MIGRATION_ID)
  
  if (existing) {
    console.log('[DB] Migration 006_intelligent_ingestion already applied — skipping')
    return
  }

  console.log('[DB] Running migration 006_intelligent_ingestion...')

  db.transaction(() => {
    // We execute the drop and create commands
    db.exec(DROP_AND_RECREATE_SQL)

    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(MIGRATION_ID)
  })()

  console.log('[DB] Migration 006_intelligent_ingestion complete')
}
