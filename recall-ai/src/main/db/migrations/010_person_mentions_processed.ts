import Database from 'better-sqlite3'

const MIGRATION_ID = '010_person_mentions_processed'

const MIGRATION_SQL = `
  -- Add processed flag to person_mentions so MapReduceService
  -- can skip mentions already consumed during knowledge extraction.
  ALTER TABLE person_mentions ADD COLUMN processed INTEGER NOT NULL DEFAULT 0;

  -- Index to make the "find unprocessed" query fast.
  CREATE INDEX IF NOT EXISTS idx_person_mentions_processed ON person_mentions(processed);
`

export function runMigration010(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(MIGRATION_ID)

  if (existing) {
    console.log('[DB] Migration 010_person_mentions_processed already applied — skipping')
    return
  }

  console.log('[DB] Running migration 010_person_mentions_processed...')

  db.transaction(() => {
    db.exec(MIGRATION_SQL)
    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(MIGRATION_ID)
  })()

  console.log('[DB] Migration 010_person_mentions_processed complete')
}
