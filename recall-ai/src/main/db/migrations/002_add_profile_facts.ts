import Database from 'better-sqlite3'

const MIGRATION_ID = '002_add_profile_facts'

const SCHEMA_SQL = `
  -- ============================================================
  -- PROFILE FACTS — synthetic sentences about conversation patterns
  -- ============================================================
  CREATE TABLE IF NOT EXISTS profile_facts (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    category TEXT, -- 'frequent_term', 'topic', 'dynamics', 'co_occurrence'
    text TEXT NOT NULL,
    evidence INTEGER DEFAULT 1,
    embedding BLOB, -- serialized Float32Array (nomic-embed-text)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- Index to speed up retrieval by contact
  CREATE INDEX IF NOT EXISTS idx_profile_facts_contact ON profile_facts(contact_id);
`

const FTS5_SQL = `
  -- FTS5 table for profile_facts mapping rowid to id
  CREATE VIRTUAL TABLE IF NOT EXISTS profile_facts_fts USING fts5(
    text,
    fact_id UNINDEXED,
    tokenize='unicode61 remove_diacritics 2'
  );

  -- Triggers to auto-sync FTS table
  CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON profile_facts 
  BEGIN
    INSERT INTO profile_facts_fts(rowid, text, fact_id) VALUES (new.rowid, new.text, new.id);
  END;

  CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON profile_facts 
  BEGIN
    DELETE FROM profile_facts_fts WHERE fact_id = old.id;
  END;
`

const VECTORS_SQL = `
  -- SQLite-vec table for semantic search on profile_facts
  -- Use vec0 for dynamic loading
  CREATE VIRTUAL TABLE IF NOT EXISTS profile_facts_vectors USING vec0(
    fact_id TEXT PRIMARY KEY,
    embedding FLOAT[768]
  );
`

export function runMigration002(db: Database.Database): void {
  // Check if this migration was already applied
  const existing = db.prepare(
    'SELECT id FROM _migrations WHERE id = ?'
  ).get(MIGRATION_ID)

  if (existing) {
    console.log('[DB] Migration 002_add_profile_facts already applied — skipping')
    return
  }

  console.log('[DB] Running migration 002_add_profile_facts...')

  db.transaction(() => {
    // Apply base schema
    db.exec(SCHEMA_SQL)
    db.exec(FTS5_SQL)

    // Attempt to create virtual tables for vectors if sqlite-vec is available
    if (isSqliteVecLoaded(db)) {
      console.log('[DB] sqlite-vec detected — creating profile_facts_vectors table')
      db.exec(VECTORS_SQL)
    }

    // Mark migration as applied
    db.prepare(
      'INSERT INTO _migrations (id) VALUES (?)'
    ).run(MIGRATION_ID)
  })()

  console.log('[DB] Migration 002_add_profile_facts complete')
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
