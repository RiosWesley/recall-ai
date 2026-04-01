import Database from 'better-sqlite3'

const MIGRATION_ID = '007_search_indexes'

const MIGRATION_SQL = `
  -- Cria VIRTUAL TABLE para permitir busca rapida FTS5 nas mensagens individuais
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    sender,
    content,
    message_id UNINDEXED,
    tokenize='unicode61'
  );

  -- Popula a tabela FTS com dados ja existentes
  INSERT INTO messages_fts(sender, content, message_id)
  SELECT sender, content, id FROM messages;

  -- Triggers para manter messages_fts sincronizada com a tabela messages
  CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(sender, content, message_id)
    VALUES (new.sender, new.content, new.id);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, sender, content, message_id)
    VALUES('delete', old.sender, old.content, old.id);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, sender, content, message_id)
    VALUES('delete', old.sender, old.content, old.id);
    INSERT INTO messages_fts(sender, content, message_id)
    VALUES (new.sender, new.content, new.id);
  END;
`

export function runMigration007(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(MIGRATION_ID)
  
  if (existing) {
    console.log('[DB] Migration 007_search_indexes already applied — skipping')
    return
  }

  console.log('[DB] Running migration 007_search_indexes...')

  db.transaction(() => {
    db.exec(MIGRATION_SQL)
    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(MIGRATION_ID)
  })()

  console.log('[DB] Migration 007_search_indexes complete')
}
