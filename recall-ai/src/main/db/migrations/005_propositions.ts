import Database from 'better-sqlite3'

const MIGRATION_ID = '005_propositions'

const SCHEMA_SQL = `
  -- ============================================================
  -- PROPOSITIONS — extracted facts from parent chunks
  -- ============================================================
  CREATE TABLE IF NOT EXISTS propositions (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    parent_chunk_id TEXT REFERENCES parent_chunks(id) ON DELETE CASCADE,
    fact TEXT NOT NULL,
    category TEXT,
    fact_date TEXT,
    actors TEXT,             -- JSON array
    original_quote TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_propositions_chat ON propositions(chat_id);
  CREATE INDEX IF NOT EXISTS idx_propositions_parent ON propositions(parent_chunk_id);
`

const VIRTUAL_TABLES_SQL = `
  -- ============================================================
  -- VECTORS — propositions embeddings via sqlite-vec
  -- ============================================================
  CREATE VIRTUAL TABLE IF NOT EXISTS proposition_vectors USING vec0(
    proposition_id TEXT PRIMARY KEY,
    embedding FLOAT[768]
  );

  -- ============================================================
  -- FTS5 — full text da busca híbrida para proposições
  -- ============================================================
  CREATE VIRTUAL TABLE IF NOT EXISTS propositions_fts USING fts5(
    fact,
    original_quote,
    proposition_id UNINDEXED,
    tokenize='unicode61 remove_diacritics 2'
  );
`

const FTS5_ONLY_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS propositions_fts USING fts5(
    fact,
    original_quote,
    proposition_id UNINDEXED,
    tokenize='unicode61 remove_diacritics 2'
  );
`

export function runMigration005(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(MIGRATION_ID)
  if (existing) {
    console.log('[DB] Migration 005_propositions already applied — skipping')
    return
  }

  console.log('[DB] Running migration 005_propositions...')

  db.transaction(() => {
    db.exec(SCHEMA_SQL)
    
    if (isSqliteVecLoaded(db)) {
      console.log('[DB] sqlite-vec detected — creating proposition_vectors + propositions_fts tables')
      db.exec(VIRTUAL_TABLES_SQL)
    } else {
      console.log('[DB] sqlite-vec not detected — creating propositions_fts only')
      db.exec(FTS5_ONLY_SQL)
    }

    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(MIGRATION_ID)
  })()

  console.log('[DB] Migration 005_propositions complete')
}

function isSqliteVecLoaded(db: Database.Database): boolean {
  try {
    db.prepare("SELECT vec_version()").get()
    return true
  } catch {
    return false
  }
}
