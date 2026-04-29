import Database from 'better-sqlite3'

const MIGRATION_ID = '012_pending_mentions_persistence'

const MIGRATION_SQL = `
  -- ============================================================
  -- PENDING_MENTIONS — Mentions found by AI but not yet resolved
  -- ============================================================
  CREATE TABLE IF NOT EXISTS pending_mentions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    context TEXT,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- Index to make retrieval fast
  CREATE INDEX IF NOT EXISTS idx_pending_mentions_session ON pending_mentions(session_id);
`

export function runMigration012(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(MIGRATION_ID)

  if (existing) {
    console.log('[DB] Migration 012_pending_mentions_persistence already applied — skipping')
    return
  }

  console.log('[DB] Running migration 012_pending_mentions_persistence...')

  db.transaction(() => {
    db.exec(MIGRATION_SQL)
    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(MIGRATION_ID)
  })()

  console.log('[DB] Migration 012_pending_mentions_persistence complete')
}
