import Database from 'better-sqlite3'

const MIGRATION_ID = '009_person_knowledge_schema'

const MIGRATION_SQL = `
  -- ============================================================
  -- PERSON_TAGS — Short labels extracted by the Worker LLM
  -- e.g. "gamer", "league of legends", "trabalha remoto"
  -- ============================================================
  CREATE TABLE IF NOT EXISTS person_tags (
    id      TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    source  TEXT NOT NULL DEFAULT 'map_reduce',  -- who generated this tag
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- Unique constraint so the same tag isn't duplicated per person
  CREATE UNIQUE INDEX IF NOT EXISTS uq_person_tags
    ON person_tags (person_id, tag);

  CREATE INDEX IF NOT EXISTS idx_person_tags_person
    ON person_tags (person_id);

  -- ============================================================
  -- PERSON_KEY_MEMORIES — Factual biographical snippets
  -- e.g. "Viajou para Portugal em jan/2024"
  -- ============================================================
  CREATE TABLE IF NOT EXISTS person_key_memories (
    id        TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    memory    TEXT NOT NULL,
    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_person_key_memories_person
    ON person_key_memories (person_id);
`

export function runMigration009(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(MIGRATION_ID)

  if (existing) {
    console.log('[DB] Migration 009_person_knowledge_schema already applied — skipping')
    return
  }

  console.log('[DB] Running migration 009_person_knowledge_schema...')

  db.transaction(() => {
    db.exec(MIGRATION_SQL)
    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(MIGRATION_ID)
  })()

  console.log('[DB] Migration 009_person_knowledge_schema complete')
}
