import Database from 'better-sqlite3'

const MIGRATION_ID = '008_people_schema'

const MIGRATION_SQL = `
  -- ============================================================
  -- PEOPLE — The root nodes for the Identity Graph
  -- ============================================================
  CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    bio TEXT,
    message_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_seen INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- ============================================================
  -- PERSON_ALIASES — Used for resolving names to specific people
  -- ============================================================
  CREATE TABLE IF NOT EXISTS person_aliases (
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    PRIMARY KEY (person_id, alias)
  );
  
  -- Create FTS5 for quick alias matching during mention resolution
  CREATE VIRTUAL TABLE IF NOT EXISTS person_aliases_fts USING fts5(
    alias,
    person_id UNINDEXED,
    tokenize='unicode61'
  );

  -- Trigger to keep FTS updated
  CREATE TRIGGER IF NOT EXISTS person_aliases_ai AFTER INSERT ON person_aliases BEGIN
    INSERT INTO person_aliases_fts(alias, person_id) VALUES (new.alias, new.person_id);
  END;
  CREATE TRIGGER IF NOT EXISTS person_aliases_ad AFTER DELETE ON person_aliases BEGIN
    INSERT INTO person_aliases_fts(person_aliases_fts, alias, person_id) VALUES('delete', old.alias, old.person_id);
  END;

  -- ============================================================
  -- PERSON_RELATIONS — Edges of the Identity Graph
  -- ============================================================
  CREATE TABLE IF NOT EXISTS person_relations (
    source_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    relation_type TEXT,
    strength REAL DEFAULT 0.5,
    PRIMARY KEY (source_id, target_id)
  );

  -- ============================================================
  -- PERSON_MENTIONS — Bridge between a chat session and a person
  -- ============================================================
  CREATE TABLE IF NOT EXISTS person_mentions (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    context TEXT,
    PRIMARY KEY (session_id, person_id)
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_person_mentions_person ON person_mentions(person_id);
  CREATE INDEX IF NOT EXISTS idx_person_mentions_session ON person_mentions(session_id);
  CREATE INDEX IF NOT EXISTS idx_person_relations_target ON person_relations(target_id);
`;

export function runMigration008(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(MIGRATION_ID)
  
  if (existing) {
    console.log('[DB] Migration 008_people_schema already applied — skipping')
    return
  }

  console.log('[DB] Running migration 008_people_schema...')

  db.transaction(() => {
    db.exec(MIGRATION_SQL)
    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(MIGRATION_ID)
  })()

  console.log('[DB] Migration 008_people_schema complete')
}
