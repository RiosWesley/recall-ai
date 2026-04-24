import Database from 'better-sqlite3'

const MIGRATION_ID = '011_fix_fts_triggers'

const MIGRATION_SQL = `
  -- Fix messages_fts triggers
  DROP TRIGGER IF EXISTS messages_ad;
  DROP TRIGGER IF EXISTS messages_au;

  CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE message_id = old.id;
  END;

  CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
    DELETE FROM messages_fts WHERE message_id = old.id;
    INSERT INTO messages_fts(sender, content, message_id)
    VALUES (new.sender, new.content, new.id);
  END;

  -- Fix person_aliases_fts triggers
  DROP TRIGGER IF EXISTS person_aliases_ad;

  CREATE TRIGGER person_aliases_ad AFTER DELETE ON person_aliases BEGIN
    DELETE FROM person_aliases_fts WHERE person_id = old.person_id AND alias = old.alias;
  END;
`

export function runMigration011(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(MIGRATION_ID)
  
  if (existing) {
    console.log('[DB] Migration 011_fix_fts_triggers already applied — skipping')
    return
  }

  console.log('[DB] Running migration 011_fix_fts_triggers...')

  db.transaction(() => {
    db.exec(MIGRATION_SQL)
    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(MIGRATION_ID)
  })()

  console.log('[DB] Migration 011_fix_fts_triggers complete')
}
