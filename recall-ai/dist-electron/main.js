var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { app, ipcMain, utilityProcess, dialog, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path, { basename } from "node:path";
import Database from "better-sqlite3";
import { webcrypto, createHash } from "node:crypto";
import fs, { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolveModelFile, createModelDownloader } from "node-llama-cpp";
import fs$1 from "fs";
import path$1 from "path";
const MIGRATION_ID$6 = "001_initial";
const SCHEMA_SQL$4 = `
  -- ============================================================
  -- CHATS — imported WhatsApp conversations
  -- ============================================================
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'whatsapp',
    participant_count INTEGER,
    message_count INTEGER DEFAULT 0,
    first_message_at INTEGER,   -- Unix timestamp (seconds)
    last_message_at INTEGER,
    imported_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    file_hash TEXT,             -- SHA-256 for duplicate detection
    metadata TEXT               -- JSON with extra data
  );

  -- ============================================================
  -- MESSAGES — individual parsed messages
  -- ============================================================
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL, -- Unix timestamp (seconds)
    type TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'media' | 'system'
    raw TEXT,                           -- original raw text
    UNIQUE(chat_id, timestamp, sender, content)
  );

  -- ============================================================
  -- CHUNKS — semantic chunks ready for embedding
  -- ============================================================
  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    content TEXT NOT NULL,          -- text for embedding (plain)
    display_content TEXT NOT NULL,  -- text for display (with names + timestamps)
    start_time INTEGER NOT NULL,    -- Unix timestamp of first message in chunk
    end_time INTEGER NOT NULL,      -- Unix timestamp of last message in chunk
    message_count INTEGER DEFAULT 0,
    token_count INTEGER DEFAULT 0,
    participants TEXT,              -- JSON array of sender names
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- ============================================================
  -- QUERY CACHE — cached search results to avoid re-embedding
  -- ============================================================
  CREATE TABLE IF NOT EXISTS query_cache (
    id TEXT PRIMARY KEY,
    query_text TEXT NOT NULL,
    query_embedding BLOB,       -- serialized Float32Array
    result_chunks TEXT,         -- JSON array of chunk IDs
    llm_response TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    hit_count INTEGER NOT NULL DEFAULT 0
  );

  -- ============================================================
  -- SEARCH HISTORY — user's past queries
  -- ============================================================
  CREATE TABLE IF NOT EXISTS search_history (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    chat_ids TEXT,              -- JSON array (filter used)
    result_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- ============================================================
  -- INDEXES
  -- ============================================================
  CREATE INDEX IF NOT EXISTS idx_messages_chat      ON messages(chat_id);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_messages_sender    ON messages(sender);
  CREATE INDEX IF NOT EXISTS idx_chunks_chat        ON chunks(chat_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_time        ON chunks(start_time, end_time);
`;
const VIRTUAL_TABLES_SQL$2 = `
  -- ============================================================
  -- VECTORS — sqlite-vec KNN (created only if extension loaded)
  -- ============================================================
  CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
    chunk_id TEXT PRIMARY KEY,
    embedding FLOAT[768]
  );

  -- ============================================================
  -- FTS5 — full-text search index on chunks
  -- ============================================================
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    chunk_id UNINDEXED,
    tokenize='unicode61'
  );
`;
const FTS5_ONLY_SQL$2 = `
  -- FTS5 table only (when sqlite-vec not available)
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    chunk_id UNINDEXED,
    tokenize='unicode61'
  );
`;
const MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`;
function runMigrations(db) {
  db.exec(MIGRATIONS_TABLE_SQL);
  const existing = db.prepare(
    "SELECT id FROM _migrations WHERE id = ?"
  ).get(MIGRATION_ID$6);
  if (existing) {
    console.log("[DB] Migration 001_initial already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 001_initial...");
  db.transaction(() => {
    db.exec(SCHEMA_SQL$4);
    const hasSqliteVec = isSqliteVecLoaded$3(db);
    if (hasSqliteVec) {
      console.log("[DB] sqlite-vec detected — creating vectors + chunks_fts tables");
      db.exec(VIRTUAL_TABLES_SQL$2);
    } else {
      console.log("[DB] sqlite-vec not detected — creating chunks_fts only");
      db.exec(FTS5_ONLY_SQL$2);
    }
    db.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(MIGRATION_ID$6);
  })();
  console.log("[DB] Migration 001_initial complete");
}
function isSqliteVecLoaded$3(db) {
  try {
    db.prepare("SELECT vec_version()").get();
    return true;
  } catch {
    return false;
  }
}
const MIGRATION_ID$5 = "002_add_profile_facts";
const SCHEMA_SQL$3 = `
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
`;
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
`;
const VECTORS_SQL = `
  -- SQLite-vec table for semantic search on profile_facts
  -- Use vec0 for dynamic loading
  CREATE VIRTUAL TABLE IF NOT EXISTS profile_facts_vectors USING vec0(
    fact_id TEXT PRIMARY KEY,
    embedding FLOAT[768]
  );
`;
function runMigration002(db) {
  const existing = db.prepare(
    "SELECT id FROM _migrations WHERE id = ?"
  ).get(MIGRATION_ID$5);
  if (existing) {
    console.log("[DB] Migration 002_add_profile_facts already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 002_add_profile_facts...");
  db.transaction(() => {
    db.exec(SCHEMA_SQL$3);
    db.exec(FTS5_SQL);
    if (isSqliteVecLoaded$2(db)) {
      console.log("[DB] sqlite-vec detected — creating profile_facts_vectors table");
      db.exec(VECTORS_SQL);
    }
    db.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(MIGRATION_ID$5);
  })();
  console.log("[DB] Migration 002_add_profile_facts complete");
}
function isSqliteVecLoaded$2(db) {
  try {
    db.prepare("SELECT vec_version()").get();
    return true;
  } catch {
    return false;
  }
}
const MIGRATION_ID$4 = "003_add_contact_profiles";
const SCHEMA_SQL$2 = `
  -- ============================================================
  -- CONTACT PROFILES — Generated by LLM Map-Reduce pipeline
  -- ============================================================
  CREATE TABLE IF NOT EXISTS contact_profiles (
    id TEXT PRIMARY KEY,
    contact_id TEXT UNIQUE NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    contact_name TEXT NOT NULL,
    profile_text TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    date_range_start TEXT NOT NULL,
    date_range_end TEXT NOT NULL,
    model_used TEXT DEFAULT 'llm-worker',
    block_count INTEGER NOT NULL,
    processing_time_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- Index to speed up retrieval by contact
  CREATE INDEX IF NOT EXISTS idx_contact_profiles_contact ON contact_profiles(contact_id);

  -- ============================================================
  -- BLOCK SUMMARIES — Intermediate Map-Reduce results
  -- ============================================================
  CREATE TABLE IF NOT EXISTS block_summaries (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    block_index INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    summary_text TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(contact_id, block_index)
  );

  CREATE INDEX IF NOT EXISTS idx_block_summaries_contact ON block_summaries(contact_id);
`;
function runMigration003(db) {
  const existing = db.prepare(
    "SELECT id FROM _migrations WHERE id = ?"
  ).get(MIGRATION_ID$4);
  if (existing) {
    console.log("[DB] Migration 003_add_contact_profiles already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 003_add_contact_profiles...");
  db.transaction(() => {
    db.exec(SCHEMA_SQL$2);
    db.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(MIGRATION_ID$4);
  })();
  console.log("[DB] Migration 003_add_contact_profiles complete");
}
const MIGRATION_ID$3 = "004_parent_child_chunks";
const SCHEMA_SQL$1 = `
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
`;
const VIRTUAL_TABLES_SQL$1 = `
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
`;
const FTS5_ONLY_SQL$1 = `
  CREATE VIRTUAL TABLE IF NOT EXISTS child_chunks_fts USING fts5(
    content,
    chunk_id UNINDEXED,
    tokenize='unicode61'
  );
`;
function runMigration004(db) {
  const existing = db.prepare("SELECT id FROM _migrations WHERE id = ?").get(MIGRATION_ID$3);
  if (existing) {
    console.log("[DB] Migration 004_parent_child_chunks already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 004_parent_child_chunks...");
  db.transaction(() => {
    db.exec(SCHEMA_SQL$1);
    if (isSqliteVecLoaded$1(db)) {
      console.log("[DB] sqlite-vec detected — creating child_vectors + child_chunks_fts tables");
      db.exec(VIRTUAL_TABLES_SQL$1);
    } else {
      console.log("[DB] sqlite-vec not detected — creating child_chunks_fts only");
      db.exec(FTS5_ONLY_SQL$1);
    }
    db.prepare("INSERT INTO _migrations (id) VALUES (?)").run(MIGRATION_ID$3);
  })();
  console.log("[DB] Migration 004_parent_child_chunks complete");
}
function isSqliteVecLoaded$1(db) {
  try {
    db.prepare("SELECT vec_version()").get();
    return true;
  } catch {
    return false;
  }
}
const MIGRATION_ID$2 = "005_propositions";
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
`;
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
`;
const FTS5_ONLY_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS propositions_fts USING fts5(
    fact,
    original_quote,
    proposition_id UNINDEXED,
    tokenize='unicode61 remove_diacritics 2'
  );
`;
function runMigration005(db) {
  const existing = db.prepare("SELECT id FROM _migrations WHERE id = ?").get(MIGRATION_ID$2);
  if (existing) {
    console.log("[DB] Migration 005_propositions already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 005_propositions...");
  db.transaction(() => {
    db.exec(SCHEMA_SQL);
    if (isSqliteVecLoaded(db)) {
      console.log("[DB] sqlite-vec detected — creating proposition_vectors + propositions_fts tables");
      db.exec(VIRTUAL_TABLES_SQL);
    } else {
      console.log("[DB] sqlite-vec not detected — creating propositions_fts only");
      db.exec(FTS5_ONLY_SQL);
    }
    db.prepare("INSERT INTO _migrations (id) VALUES (?)").run(MIGRATION_ID$2);
  })();
  console.log("[DB] Migration 005_propositions complete");
}
function isSqliteVecLoaded(db) {
  try {
    db.prepare("SELECT vec_version()").get();
    return true;
  } catch {
    return false;
  }
}
const MIGRATION_ID$1 = "006_intelligent_ingestion";
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
`;
function runMigration006(db) {
  const existing = db.prepare("SELECT id FROM _migrations WHERE id = ?").get(MIGRATION_ID$1);
  if (existing) {
    console.log("[DB] Migration 006_intelligent_ingestion already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 006_intelligent_ingestion...");
  db.transaction(() => {
    db.exec(DROP_AND_RECREATE_SQL);
    db.prepare("INSERT INTO _migrations (id) VALUES (?)").run(MIGRATION_ID$1);
  })();
  console.log("[DB] Migration 006_intelligent_ingestion complete");
}
const MIGRATION_ID = "007_search_indexes";
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
`;
function runMigration007(db) {
  const existing = db.prepare("SELECT id FROM _migrations WHERE id = ?").get(MIGRATION_ID);
  if (existing) {
    console.log("[DB] Migration 007_search_indexes already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 007_search_indexes...");
  db.transaction(() => {
    db.exec(MIGRATION_SQL);
    db.prepare("INSERT INTO _migrations (id) VALUES (?)").run(MIGRATION_ID);
  })();
  console.log("[DB] Migration 007_search_indexes complete");
}
const _DatabaseService = class _DatabaseService {
  static getInstance() {
    if (_DatabaseService.db) {
      return _DatabaseService.db;
    }
    const userDataPath = app.getPath("userData");
    const dbPath = path.join(userDataPath, "recall-ai.db");
    console.log("[DB] Opening database at:", dbPath);
    const db = new Database(dbPath, {
      verbose: process.env.NODE_ENV === "development" ? console.log : void 0
    });
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = -32000");
    db.pragma("temp_store = MEMORY");
    _DatabaseService.db = db;
    runMigrations(db);
    runMigration002(db);
    runMigration003(db);
    runMigration004(db);
    runMigration005(db);
    runMigration006(db);
    runMigration007(db);
    console.log("[DB] Database ready");
    return db;
  }
  /** Close the database connection (call on app quit) */
  static close() {
    if (_DatabaseService.db) {
      _DatabaseService.db.close();
      _DatabaseService.db = null;
      console.log("[DB] Database closed");
    }
  }
  /** Check if the database is open */
  static isOpen() {
    return _DatabaseService.db !== null && _DatabaseService.db.open;
  }
};
__publicField(_DatabaseService, "db", null);
let DatabaseService = _DatabaseService;
let urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const POOL_SIZE_MULTIPLIER = 128;
let pool, poolOffset;
function fillPool(bytes) {
  if (!pool || pool.length < bytes) {
    pool = Buffer.allocUnsafe(bytes * POOL_SIZE_MULTIPLIER);
    webcrypto.getRandomValues(pool);
    poolOffset = 0;
  } else if (poolOffset + bytes > pool.length) {
    webcrypto.getRandomValues(pool);
    poolOffset = 0;
  }
  poolOffset += bytes;
}
function nanoid(size = 21) {
  fillPool(size |= 0);
  let id = "";
  for (let i = poolOffset - size; i < poolOffset; i++) {
    id += urlAlphabet[pool[i] & 63];
  }
  return id;
}
class ChatRepository {
  constructor(db) {
    this.db = db;
  }
  create(chat) {
    const id = chat.id ?? nanoid();
    const now = Math.floor(Date.now() / 1e3);
    this.db.prepare(`
      INSERT INTO chats (
        id, name, source, participant_count, message_count,
        first_message_at, last_message_at, imported_at, file_hash, metadata
      ) VALUES (
        @id, @name, @source, @participant_count, @message_count,
        @first_message_at, @last_message_at, @imported_at, @file_hash, @metadata
      )
    `).run({
      id,
      name: chat.name,
      source: chat.source ?? "whatsapp",
      participant_count: chat.participant_count ?? null,
      message_count: chat.message_count ?? 0,
      first_message_at: chat.first_message_at ?? null,
      last_message_at: chat.last_message_at ?? null,
      imported_at: now,
      file_hash: chat.file_hash ?? null,
      metadata: chat.metadata ? JSON.stringify(chat.metadata) : null
    });
    return this.findById(id);
  }
  findAll() {
    const rows = this.db.prepare(
      "SELECT * FROM chats ORDER BY imported_at DESC"
    ).all();
    return rows.map(deserializeChat);
  }
  findById(id) {
    const row = this.db.prepare(
      "SELECT * FROM chats WHERE id = ?"
    ).get(id);
    return row ? deserializeChat(row) : null;
  }
  delete(id) {
    this.db.prepare("DELETE FROM chats WHERE id = ?").run(id);
  }
  existsByHash(fileHash) {
    const row = this.db.prepare(
      "SELECT id FROM chats WHERE file_hash = ?"
    ).get(fileHash);
    return row !== void 0;
  }
  updateMessageCount(id, count) {
    this.db.prepare(
      "UPDATE chats SET message_count = ? WHERE id = ?"
    ).run(count, id);
  }
  updateParticipantCount(id, count) {
    this.db.prepare(
      "UPDATE chats SET participant_count = ? WHERE id = ?"
    ).run(count, id);
  }
  updateTimestamps(id, firstAt, lastAt) {
    this.db.prepare(
      "UPDATE chats SET first_message_at = ?, last_message_at = ? WHERE id = ?"
    ).run(firstAt, lastAt, id);
  }
}
function deserializeChat(row) {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null
  };
}
class MessageRepository {
  constructor(db) {
    this.db = db;
  }
  /**
   * Insert a batch of messages in a single transaction.
   * Duplicate rows (same chat_id + timestamp + sender + content) are silently ignored.
   */
  insertBatch(messages) {
    if (messages.length === 0) return;
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO messages (id, chat_id, sender, content, timestamp, type, raw)
      VALUES (@id, @chat_id, @sender, @content, @timestamp, @type, @raw)
    `);
    const runAll = this.db.transaction((msgs) => {
      for (const msg of msgs) {
        insert.run({
          id: msg.id ?? nanoid(),
          chat_id: msg.chat_id,
          sender: msg.sender,
          content: msg.content,
          timestamp: msg.timestamp,
          type: msg.type ?? "text",
          raw: msg.raw ?? null
        });
      }
    });
    runAll(messages);
  }
  findByChatId(chatId, limit = 1e3, offset = 0) {
    return this.db.prepare(`
      SELECT * FROM messages
      WHERE chat_id = ?
      ORDER BY timestamp ASC
      LIMIT ? OFFSET ?
    `).all(chatId, limit, offset);
  }
  countByChatId(chatId) {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE chat_id = ?"
    ).get(chatId);
    return row.count;
  }
  /**
   * Returns unique sender names for a given chat, ordered by message count.
   */
  getParticipants(chatId) {
    const rows = this.db.prepare(`
      SELECT DISTINCT sender
      FROM messages
      WHERE chat_id = ? AND type != 'system'
      GROUP BY sender
      ORDER BY COUNT(*) DESC
    `).all(chatId);
    return rows.map((r) => r.sender);
  }
  deleteByChatId(chatId) {
    this.db.prepare("DELETE FROM messages WHERE chat_id = ?").run(chatId);
  }
  /**
   * Factual Search (Task 4.1): Uses FTS5 to find matches and extracts a
   * sliding window of surrounding messages (+/- windowSize).
   */
  searchFactual(keywords, windowSize = 15, limit = 5) {
    if (!keywords || keywords.length === 0) return [];
    const cleanTokens = keywords.map((k) => k.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ ]/g, "").trim()).filter(Boolean);
    if (cleanTokens.length === 0) return [];
    const matchQuery = cleanTokens.map((k) => `"${k}"*`).join(" OR ");
    const pivots = this.db.prepare(`
      SELECT m.id, m.chat_id, m.timestamp 
      FROM messages_fts fts
      JOIN messages m ON fts.message_id = m.id
      WHERE messages_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(matchQuery, limit);
    const windows = [];
    const fetchWindow = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM messages 
        WHERE chat_id = ? AND timestamp <= ? 
        ORDER BY timestamp DESC LIMIT ?
      ) 
      UNION 
      SELECT * FROM (
        SELECT * FROM messages 
        WHERE chat_id = ? AND timestamp >= ? 
        ORDER BY timestamp ASC LIMIT ?
      )
      ORDER BY timestamp ASC
    `);
    for (const p of pivots) {
      const windowMsgs = fetchWindow.all(
        p.chat_id,
        p.timestamp,
        windowSize + 1,
        p.chat_id,
        p.timestamp,
        windowSize + 1
      );
      windows.push(windowMsgs);
    }
    return windows;
  }
}
class SessionRepository {
  constructor(db) {
    this.db = db;
  }
  /**
   * Insert sessions and their FTS5 entries in a single transaction.
   */
  insertBatch(sessions, entities) {
    if (sessions.length === 0 && entities.length === 0) return;
    const insertSession = this.db.prepare(`
      INSERT INTO sessions (
        id, chat_id, start_time, end_time, message_count, summary
      ) VALUES (
        @id, @chat_id, @start_time, @end_time, @message_count, @summary
      )
    `);
    const insertSessionFts = this.db.prepare(`
      INSERT INTO sessions_fts (summary, session_id)
      VALUES (@summary, @session_id)
    `);
    const insertEntity = this.db.prepare(`
      INSERT INTO entities (
        id, session_id, name, normalized_name, type, action
      ) VALUES (
        @id, @session_id, @name, @normalized_name, @type, @action
      )
    `);
    const insertEntityFts = this.db.prepare(`
      INSERT INTO entities_fts (normalized_name, type, action, entity_id)
      VALUES (@normalized_name, @type, @action, @entity_id)
    `);
    const runAll = this.db.transaction((sessItems, entItems) => {
      for (const sess of sessItems) {
        const id = sess.id ?? nanoid();
        insertSession.run({
          id,
          chat_id: sess.chat_id,
          start_time: sess.start_time,
          end_time: sess.end_time,
          message_count: sess.message_count ?? 0,
          summary: sess.summary
        });
        insertSessionFts.run({ summary: sess.summary, session_id: id });
      }
      for (const ent of entItems) {
        const id = ent.id ?? nanoid();
        insertEntity.run({
          id,
          session_id: ent.session_id,
          name: ent.name,
          normalized_name: ent.normalized_name,
          type: ent.type,
          action: ent.action
        });
        insertEntityFts.run({
          normalized_name: ent.normalized_name,
          type: ent.type,
          action: ent.action,
          entity_id: id
        });
      }
    });
    runAll(sessions, entities);
  }
  /**
   * Update a session with its NLP summary and insert its entities + FTS5 entries.
   * Used by the background NLP worker.
   */
  updateSessionNLP(sessionId, summary, entities) {
    const updateSession = this.db.prepare(`
      UPDATE sessions SET summary = @summary WHERE id = @id
    `);
    const updateSessionFts = this.db.prepare(`
      UPDATE sessions_fts SET summary = @summary WHERE session_id = @id
    `);
    const insertEntity = this.db.prepare(`
      INSERT INTO entities (
        id, session_id, name, normalized_name, type, action
      ) VALUES (
        @id, @session_id, @name, @normalized_name, @type, @action
      )
    `);
    const insertEntityFts = this.db.prepare(`
      INSERT INTO entities_fts (normalized_name, type, action, entity_id)
      VALUES (@normalized_name, @type, @action, @entity_id)
    `);
    const runAll = this.db.transaction(() => {
      updateSession.run({ summary, id: sessionId });
      updateSessionFts.run({ summary, id: sessionId });
      for (const ent of entities) {
        const id = ent.id ?? nanoid();
        insertEntity.run({
          id,
          session_id: ent.session_id,
          name: ent.name,
          normalized_name: ent.normalized_name,
          type: ent.type,
          action: ent.action
        });
        insertEntityFts.run({
          normalized_name: ent.normalized_name,
          type: ent.type,
          action: ent.action,
          entity_id: id
        });
      }
    });
    runAll();
  }
  findByChatId(chatId) {
    const rows = this.db.prepare(`
      SELECT * FROM sessions
      WHERE chat_id = ?
      ORDER BY start_time ASC
    `).all(chatId);
    return rows;
  }
  findEntitiesByChatId(chatId) {
    const rows = this.db.prepare(`
      SELECT e.* FROM entities e
      JOIN sessions s ON s.id = e.session_id
      WHERE s.chat_id = ?
      ORDER BY e.created_at ASC
    `).all(chatId);
    return rows;
  }
  findById(id) {
    const row = this.db.prepare(
      "SELECT * FROM sessions WHERE id = ?"
    ).get(id);
    return row || null;
  }
  deleteByChatId(chatId) {
    const sessionIds = this.db.prepare(
      "SELECT id FROM sessions WHERE chat_id = ?"
    ).all(chatId);
    if (sessionIds.length === 0) {
      return;
    }
    const deleteSessions = this.db.prepare("DELETE FROM sessions WHERE chat_id = ?");
    const deleteSessionFts = this.db.prepare("DELETE FROM sessions_fts WHERE session_id = ?");
    const deleteEntityFts = this.db.prepare(
      "DELETE FROM entities_fts WHERE entity_id IN (SELECT id FROM entities WHERE session_id = ?)"
    );
    const runAll = this.db.transaction(() => {
      for (const { id } of sessionIds) {
        deleteEntityFts.run(id);
        deleteSessionFts.run(id);
      }
      deleteSessions.run(chatId);
    });
    runAll();
  }
  countByChatId(chatId) {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM sessions WHERE chat_id = ?"
    ).get(chatId);
    return row.count;
  }
  searchNarrative(keywords, limit = 5, options) {
    if (!keywords || keywords.length === 0) return [];
    const cleanTokens = keywords.map((k) => k.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ ]/g, "").trim()).filter(Boolean);
    if (cleanTokens.length === 0) return [];
    const matchQuery = cleanTokens.map((k) => `"${k}"*`).join(" OR ");
    let query = `
      SELECT s.*
      FROM sessions_fts fts
      JOIN sessions s ON fts.session_id = s.id
      WHERE sessions_fts MATCH ?
    `;
    const params = [matchQuery];
    if (options == null ? void 0 : options.dateFrom) {
      query += ` AND s.start_time >= ?`;
      params.push(options.dateFrom);
    }
    if (options == null ? void 0 : options.dateTo) {
      query += ` AND s.end_time <= ?`;
      params.push(options.dateTo);
    }
    query += ` ORDER BY fts.rank LIMIT ?`;
    params.push(limit);
    return this.db.prepare(query).all(...params);
  }
  searchAggregation(keywords, limit = 10, options) {
    if (!keywords || keywords.length === 0) return [];
    const cleanTokens = keywords.map((k) => k.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ ]/g, "").trim()).filter(Boolean);
    if (cleanTokens.length === 0) return [];
    const matchQuery = cleanTokens.map((k) => `"${k}"*`).join(" OR ");
    let query = `
      SELECT e.normalized_name as name, e.type, COUNT(*) as count
      FROM entities_fts fts
      JOIN entities e ON fts.entity_id = e.id
      JOIN sessions s ON e.session_id = s.id
      WHERE entities_fts MATCH ?
    `;
    const params = [matchQuery];
    if (options == null ? void 0 : options.dateFrom) {
      query += ` AND s.start_time >= ?`;
      params.push(options.dateFrom);
    }
    if (options == null ? void 0 : options.dateTo) {
      query += ` AND s.end_time <= ?`;
      params.push(options.dateTo);
    }
    query += ` GROUP BY e.normalized_name, e.type ORDER BY count DESC LIMIT ?`;
    params.push(limit);
    return this.db.prepare(query).all(...params);
  }
}
function registerChatHandlers() {
  ipcMain.handle("chats:list", async () => {
    const db = DatabaseService.getInstance();
    const repo = new ChatRepository(db);
    return repo.findAll();
  });
  ipcMain.handle("chats:delete", async (_event, chatId) => {
    const db = DatabaseService.getInstance();
    const deleteOp = db.transaction(() => {
      const msgRepo = new MessageRepository(db);
      const sessionRepo = new SessionRepository(db);
      const chatRepo = new ChatRepository(db);
      sessionRepo.deleteByChatId(chatId);
      msgRepo.deleteByChatId(chatId);
      chatRepo.delete(chatId);
    });
    deleteOp();
  });
}
const ANDROID_BR = {
  id: "android_br",
  regex: /^(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}) - ([^:]+): (.*)$/,
  format: {
    id: "android_br",
    platform: "android",
    locale: "pt-BR",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    hasSeconds: false,
    hasBrackets: false
  },
  groups: { date: 1, time: 2, sender: 3, content: 4 }
};
const ANDROID_BR_COMMA = {
  id: "android_br_comma",
  regex: /^(\d{2}\/\d{2}\/\d{4}), (\d{2}:\d{2}) - ([^:]+): (.*)$/,
  format: {
    id: "android_br_comma",
    platform: "android",
    locale: "pt-PT",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    hasSeconds: false,
    hasBrackets: false
  },
  groups: { date: 1, time: 2, sender: 3, content: 4 }
};
const ANDROID_EN = {
  id: "android_en",
  regex: /^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2} [AP]M) - ([^:]+): (.*)$/,
  format: {
    id: "android_en",
    platform: "android",
    locale: "en-US",
    dateFormat: "M/D/YY",
    timeFormat: "12h",
    hasSeconds: false,
    hasBrackets: false
  },
  groups: { date: 1, time: 2, sender: 3, content: 4 }
};
const IOS_EN = {
  id: "ios_en",
  regex: /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}:\d{2} [AP]M)\] ([^:]+): (.*)$/,
  format: {
    id: "ios_en",
    platform: "ios",
    locale: "en-US",
    dateFormat: "M/D/YY",
    timeFormat: "12h",
    hasSeconds: true,
    hasBrackets: true
  },
  groups: { date: 1, time: 2, sender: 3, content: 4 }
};
const ALL_PATTERNS = [
  ANDROID_BR,
  ANDROID_BR_COMMA,
  ANDROID_EN,
  IOS_EN
];
const SYSTEM_PATTERNS = [
  /criptografia de ponta/i,
  /end-to-end encrypted/i,
  /adicionou/i,
  /removeu/i,
  /\bsaiu\b/i,
  /entrou usando/i,
  /mudou a descrição/i,
  /mudou o ícone/i,
  /mensagem foi apagada/i,
  /this message was deleted/i,
  /criou o grupo/i,
  /agora é admin/i,
  /is now an admin/i,
  /changed the subject/i,
  /changed the group/i,
  /left\b/i,
  /added\s+\+?\d/i,
  /removed\s+\+?\d/i,
  /security code changed/i,
  /código de segurança mudou/i
];
const MEDIA_PATTERNS = [
  /<Mídia oculta>/i,
  /<Media omitted>/i,
  /\.(jpg|jpeg|png|gif|webp|mp4|opus|ogg|pdf|docx?)\s*\(arquivo anexado\)/i,
  /\.(jpg|jpeg|png|gif|webp|mp4|opus|ogg|pdf|docx?)\s*\(file attached\)/i,
  /^(IMG|VID|PTT|STK|DOC|AUD)-\d{8}-WA\d+/,
  /image omitted/i,
  /video omitted/i,
  /audio omitted/i,
  /sticker omitted/i,
  /document omitted/i,
  /GIF omitted/i
];
const SAMPLE_LINE_COUNT = 20;
async function detectFormatFromFile(filePath) {
  const sampleLines = await readSampleLines(filePath, SAMPLE_LINE_COUNT);
  return detectFormatFromLines(sampleLines);
}
function detectFormatFromLines(lines) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const pattern of ALL_PATTERNS) {
      if (pattern.regex.test(trimmed)) {
        return pattern.format;
      }
    }
  }
  throw new Error(
    `WhatsApp format not recognized. Tried ${ALL_PATTERNS.length} patterns on ${lines.length} sample lines.`
  );
}
function getPatternById(formatId) {
  const pattern = ALL_PATTERNS.find((p) => p.id === formatId);
  if (!pattern) {
    throw new Error(`No pattern registered for format ID: ${formatId}`);
  }
  return pattern;
}
async function readSampleLines(filePath, count) {
  const lines = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    lines.push(line);
    if (lines.length >= count) {
      rl.close();
      break;
    }
  }
  return lines;
}
class WhatsAppParser {
  /**
   * Parse a WhatsApp export .txt file using streaming (memory-efficient).
   */
  async parse(filePath) {
    let format;
    try {
      format = await detectFormatFromFile(filePath);
    } catch (err) {
      throw new Error(
        `Failed to detect WhatsApp format: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const pattern = getPatternById(format.id);
    const messages = [];
    const errors = [];
    let currentMessage = null;
    let lineNumber = 0;
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity
    });
    for await (const line of rl) {
      lineNumber++;
      const cleanLine = lineNumber === 1 ? line.replace(/^\uFEFF/, "") : line;
      const match = pattern.regex.exec(cleanLine);
      if (match) {
        if (currentMessage && isComplete(currentMessage)) {
          messages.push(finalizeMessage(currentMessage));
        }
        const rawDate = match[pattern.groups.date];
        const rawTime = match[pattern.groups.time];
        let timestamp;
        try {
          timestamp = parseTimestamp(rawDate, rawTime, format);
        } catch {
          errors.push({ line: lineNumber, content: cleanLine, reason: "invalid_timestamp" });
          currentMessage = null;
          continue;
        }
        const rawContent = match[pattern.groups.content] ?? "";
        const sender = match[pattern.groups.sender].trim();
        currentMessage = {
          timestamp,
          sender,
          content: rawContent,
          type: detectMessageType(rawContent, sender),
          raw: cleanLine,
          lineNumber
        };
      } else if (currentMessage && cleanLine.trim()) {
        currentMessage.content = (currentMessage.content ?? "") + "\n" + cleanLine;
        currentMessage.raw = (currentMessage.raw ?? "") + "\n" + cleanLine;
      } else if (cleanLine.trim() && !currentMessage) {
        errors.push({ line: lineNumber, content: cleanLine, reason: "orphan_line" });
      }
    }
    if (currentMessage && isComplete(currentMessage)) {
      messages.push(finalizeMessage(currentMessage));
    }
    const participants = [...new Set(messages.map((m) => m.sender))];
    const stats = {
      totalLines: lineNumber,
      totalMessages: messages.length,
      errorCount: errors.length,
      participants,
      firstTimestamp: messages.length > 0 ? messages[0].timestamp : null,
      lastTimestamp: messages.length > 0 ? messages[messages.length - 1].timestamp : null
    };
    return { messages, format, errors, stats };
  }
}
function isComplete(m) {
  return m.timestamp !== void 0 && m.sender !== void 0 && m.content !== void 0 && m.type !== void 0 && m.raw !== void 0 && m.lineNumber !== void 0;
}
function finalizeMessage(m) {
  return {
    timestamp: m.timestamp,
    sender: m.sender,
    content: m.content.trim(),
    type: detectMessageType(m.content.trim(), m.sender),
    raw: m.raw,
    lineNumber: m.lineNumber
  };
}
function detectMessageType(content, sender) {
  const trimmed = content.trim();
  for (const pattern of MEDIA_PATTERNS) {
    if (pattern.test(trimmed)) return "media";
  }
  for (const pattern of SYSTEM_PATTERNS) {
    if (pattern.test(trimmed)) return "system";
  }
  if (!sender || sender.trim() === "") return "system";
  return "text";
}
function parseTimestamp(date, time, format) {
  let day, month, year;
  if (format.locale === "pt-BR" || format.locale === "pt-PT") {
    const [d, m, y] = date.split("/").map(Number);
    day = d;
    month = m;
    year = y;
  } else if (format.locale === "en-US") {
    const [m, d, y] = date.split("/").map(Number);
    month = m;
    day = d;
    year = y;
  } else {
    const parts = date.split(/[\/\.\-]/).map(Number);
    [day, month, year] = parts;
  }
  if (year < 100) year += year < 70 ? 2e3 : 1900;
  let hours, minutes;
  if (format.timeFormat === "12h") {
    const isPM = /PM/i.test(time);
    const timePart = time.replace(/\s*[AP]M/i, "");
    const parts = timePart.split(":").map(Number);
    hours = parts[0];
    minutes = parts[1];
    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
  } else {
    const parts = time.split(":").map(Number);
    hours = parts[0];
    minutes = parts[1];
  }
  const ts = Date.UTC(year, month - 1, day, hours, minutes) / 1e3;
  if (isNaN(ts)) throw new Error(`Invalid timestamp: ${date} ${time}`);
  return ts;
}
class SessionEngine {
  constructor(maxGapSeconds = 7200) {
    __publicField(this, "maxGapSeconds");
    this.maxGapSeconds = maxGapSeconds;
  }
  /**
   * Groups an array of parsed messages into temporal sessions.
   * A new session starts when the gap between two messages exceeds `maxGapSeconds`.
   * Messages are assumed to be pre-sorted by timestamp ascending.
   */
  group(messages) {
    if (messages.length === 0) return [];
    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
    const sessions = [];
    let currentSessionMessages = [sorted[0]];
    let currentStartTime = sorted[0].timestamp;
    let lastMsgTime = sorted[0].timestamp;
    for (let i = 1; i < sorted.length; i++) {
      const msg = sorted[i];
      const gap = msg.timestamp - lastMsgTime;
      if (gap > this.maxGapSeconds) {
        sessions.push({
          messages: currentSessionMessages,
          start_time: currentStartTime,
          end_time: lastMsgTime,
          message_count: currentSessionMessages.length
        });
        currentSessionMessages = [msg];
        currentStartTime = msg.timestamp;
      } else {
        currentSessionMessages.push(msg);
      }
      lastMsgTime = msg.timestamp;
    }
    sessions.push({
      messages: currentSessionMessages,
      start_time: currentStartTime,
      end_time: lastMsgTime,
      message_count: currentSessionMessages.length
    });
    return sessions;
  }
}
const MODEL_REGISTRY = {
  /**
   * nomic-embed-text-v1.5
   */
  embedding: {
    key: "embedding",
    name: "nomic-embed-text-v1.5",
    uri: "hf:nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M",
    sizeEstimate: 8e7,
    purpose: "embedding",
    dimensions: 768,
    quantization: "Q4_K_M"
  },
  /**
   * LFM2.5-350M - Worker Process for fast parsing and extraction
   */
  worker: {
    key: "worker",
    name: "LFM2.5 350M",
    uri: "hf:lmstudio-community/LFM2.5-350M-GGUF:Q8_0",
    sizeEstimate: 379e6,
    purpose: "generation",
    quantization: "Q8_0"
  },
  /**
   * Gemma 3 270M IT - Fallback Worker if LFM fails to load due to architecture
   */
  worker_fallback: {
    key: "worker_fallback",
    name: "Llama 3.2 1B IT",
    uri: "hf:bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M",
    sizeEstimate: 8e8,
    purpose: "generation",
    quantization: "Q4_K_M"
  },
  /**
   * Qwen 3.5 4B - Brain Process for synthesis
   */
  brain: {
    key: "brain",
    name: "Qwen 3.5 4B",
    uri: "hf:lmstudio-community/Qwen3.5-4B-GGUF:Q4_K_M",
    sizeEstimate: 271e7,
    // ~2.71GB
    purpose: "generation",
    quantization: "Q4_K_M"
  }
};
const MODEL_DOWNLOAD_ORDER = ["embedding", "worker", "brain"];
const _ModelManager = class _ModelManager {
  constructor() {
    /** Absolute path to the models directory in Electron's userData */
    __publicField(this, "modelsDir");
    this.modelsDir = path.join(app.getPath("userData"), "models");
    fs.mkdirSync(this.modelsDir, { recursive: true });
  }
  static getInstance() {
    if (!_ModelManager.instance) {
      _ModelManager.instance = new _ModelManager();
    }
    return _ModelManager.instance;
  }
  /**
   * Checks whether a model file is present locally without triggering a download.
   *
   * resolveModelFile with `download: false` returns the expected local path
   * without checking the network. We then verify the file actually exists on disk.
   */
  async isAvailable(key) {
    try {
      const modelPath = await resolveModelFile(MODEL_REGISTRY[key].uri, {
        directory: this.modelsDir,
        download: false,
        // never trigger a download in a presence check
        cli: false
      });
      return fs.existsSync(modelPath);
    } catch {
      return false;
    }
  }
  /**
   * Returns the status of all registered models.
   * Runs availability checks in parallel for speed.
   */
  async checkAll() {
    const statuses = await Promise.all(
      MODEL_DOWNLOAD_ORDER.map(async (key) => {
        const entry = MODEL_REGISTRY[key];
        const available = await this.isAvailable(key);
        let filePath;
        if (available) {
          try {
            filePath = await resolveModelFile(entry.uri, {
              directory: this.modelsDir,
              download: false,
              cli: false
            });
          } catch {
          }
        }
        return {
          key,
          name: entry.name,
          quantization: entry.quantization,
          sizeEstimate: entry.sizeEstimate,
          purpose: entry.purpose,
          available,
          filePath
        };
      })
    );
    return statuses;
  }
  /**
   * Downloads a model with real-time progress reporting via the supplied callback.
   *
   * Uses node-llama-cpp's createModelDownloader which:
   *  - Downloads via ipull (parallel connections, fast)
   *  - Handles multi-part GGUF files automatically
   *  - Resumes interrupted downloads
   *  - Skips download if file already exists and size matches (skipExisting: true by default)
   *
   * @param key        - Which model to download
   * @param onProgress - Optional callback called with progress on each chunk
   * @returns          - Absolute path to the downloaded model entrypoint file
   */
  async download(key, onProgress) {
    const entry = MODEL_REGISTRY[key];
    console.log(`[ModelManager] Starting download: ${entry.name} (${entry.uri})`);
    const downloader = await createModelDownloader({
      modelUri: entry.uri,
      dirPath: this.modelsDir,
      showCliProgress: false,
      onProgress: ({ totalSize, downloadedSize }) => {
        if (onProgress) {
          const total = totalSize ?? entry.sizeEstimate;
          onProgress({
            key,
            name: entry.name,
            downloadedBytes: downloadedSize,
            totalBytes: total,
            percent: total > 0 ? Math.round(downloadedSize / total * 100) : 0,
            speed: 0
            // ipull doesn't expose instantaneous speed in onProgress
          });
        }
      }
    });
    const modelPath = await downloader.download();
    console.log(`[ModelManager] Download complete: ${entry.name} → ${modelPath}`);
    return modelPath;
  }
  /**
   * Resolves the absolute file path for a model.
   *
   * If the model is not found locally, this will trigger an automatic download
   * (silent — no progress callback). Prefer `download()` when you need UI feedback.
   *
   * Intended for use inside services (EmbeddingService, LLMService) to get
   * the model path lazily at initialization time.
   */
  async resolve(key) {
    const entry = MODEL_REGISTRY[key];
    return resolveModelFile(entry.uri, {
      directory: this.modelsDir,
      download: "auto",
      cli: false
    });
  }
};
__publicField(_ModelManager, "instance", null);
let ModelManager = _ModelManager;
const _dirname$1 = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const _WorkerProcess = class _WorkerProcess {
  constructor() {
    __publicField(this, "worker", null);
    __publicField(this, "pendingRequests", /* @__PURE__ */ new Map());
    __publicField(this, "initializationPromise", null);
    __publicField(this, "ready", false);
    // Basic Batch Queue (Will be expanded in 3.4)
    __publicField(this, "batchQueue", []);
    __publicField(this, "processingQueue", false);
    __publicField(this, "currentModelKey", "worker");
  }
  static getInstance() {
    if (!_WorkerProcess.instance) {
      _WorkerProcess.instance = new _WorkerProcess();
    }
    return _WorkerProcess.instance;
  }
  async initialize() {
    if (this.ready) return;
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = new Promise(async (resolve, reject) => {
      try {
        await this.startWorker("worker");
        this.ready = true;
        resolve();
      } catch (err) {
        console.warn(`[WorkerProcess] Primary worker failed. Triggering fallback... Error:`, err);
        try {
          await this.startWorker("worker_fallback");
          this.currentModelKey = "worker_fallback";
          console.log("[WorkerProcess] Fallback to " + MODEL_REGISTRY.worker_fallback.name + " succeeded.");
          this.ready = true;
          resolve();
        } catch (fbErr) {
          console.error("[WorkerProcess] Fallback also failed:", fbErr);
          this.initializationPromise = null;
          reject(fbErr);
        }
      }
    });
    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }
  startWorker(modelKey) {
    return new Promise(async (resolve, reject) => {
      console.log(`[WorkerProcess] Resolving model path for: ${modelKey}...`);
      const modelPath = await ModelManager.getInstance().resolve(modelKey);
      console.log(`[WorkerProcess] Forking Utility Process for ${modelKey}...`);
      const workerPath = path.join(_dirname$1, "worker-worker.js");
      this.worker = utilityProcess.fork(workerPath, [], {
        stdio: "inherit"
      });
      this.worker.on("message", (msg) => this.handleWorkerMessage(msg));
      this.worker.on("exit", (code) => {
        console.warn(`[WorkerProcess] Utility process exited with code ${code}`);
        this.ready = false;
        this.worker = null;
        this.rejectAllPending(new Error(`Worker exited unexpectedly with code ${code}`));
      });
      const id = nanoid();
      this.pendingRequests.set(id, {
        resolve: async () => {
          console.log(`[WorkerProcess] Initialized successfully. Running Day-0 test...`);
          try {
            await this.internalGenerate("test", { maxTokens: 5 });
            resolve();
          } catch (e) {
            this.dispose();
            reject(e);
          }
        },
        reject
      });
      this.worker.postMessage({
        type: "init",
        id,
        payload: { modelPath }
      });
    });
  }
  isReady() {
    return this.ready;
  }
  getFallbackStatus() {
    return this.currentModelKey === "worker_fallback";
  }
  async generate(prompt, options) {
    return this.generateStream(prompt, () => {
    }, options);
  }
  // Queue wrapper
  async generateStream(prompt, onToken, options) {
    if (!this.ready || !this.worker) {
      await this.initialize();
    }
    return new Promise((resolve, reject) => {
      this.batchQueue.push({ prompt, options, resolve, reject, onToken });
      this.processNextInQueue();
    });
  }
  /**
   * Generates text via LLM and enforces valid JSON extraction with an aggressive retry loop.
   * Useful since smaller parameter models like LFM2.5-350M can drift out of grammar.
   */
  /**
   * Generates text via LLM and enforces valid JSON extraction with an aggressive retry loop.
   * Useful since smaller parameter models like LFM2.5-350M can drift out of grammar.
   */
  async generateJson(prompt, options, maxRetries = 3) {
    let lastError = null;
    let currentPrompt = prompt;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const rawResponse = await this.generate(currentPrompt, options);
        return this.extractJson(rawResponse);
      } catch (e) {
        lastError = e;
        console.warn(`[WorkerProcess] JSON extraction failed (attempt ${attempt}/${maxRetries}):`, e.message);
        currentPrompt = prompt + `

[SYSTEM FEEDBACK: Your previous response failed JSON parsing with error: ${e.message}. Please return strictly valid JSON without conversational wrapper text.]`;
      }
    }
    throw new Error(`[WorkerProcess] Failed to generate valid JSON after ${maxRetries} attempts. Last error: ${lastError == null ? void 0 : lastError.message}`);
  }
  /**
   * Helper to strip markdown (e.g. \`\`\`json) and aggressively find the { ... } boundaries.
   */
  extractJson(text) {
    try {
      return JSON.parse(text);
    } catch (_) {
    }
    let cleaned = text.replace(/^```json/im, "").replace(/```$/im, "").trim();
    const match = cleaned.match(/\{.*\}/s) || cleaned.match(/\[.*\]/s);
    if (!match) {
      throw new Error("No JSON boundaries ({...} or [...]) found in response");
    }
    return JSON.parse(match[0]);
  }
  async classifyQuery(query) {
    const prompt = `You are a strict JSON classification tool. You analyze Portuguese queries to search chat logs.
Output ONLY raw JSON.

Intent rules:
- "factual": Specific messages, facts, quotes (e.g. "senha do wifi", "onde vc mandou o link")
- "aggregation": Counts, metrics, rankings (e.g. "quantas vezes", "mais citados", "top assuntos")
- "narrative": Summaries of periods (e.g. "o que rolou ontem", "resuma a briga")

Your task:
1. Identify "intent".
2. Extract ONLY the core topical nouns/entities from the query as "keywords". Exclude ALL conversational stop-words (e.g. "citados", "conversa", "vezes", "falaram", "sobre", "quais", "mais", "aqui"). 

Examples:
Query: "quais jogos mais citados na conversa"
{"intent": "aggregation", "keywords": ["jogos"], "dateRange": {"start": null, "end": null}}

Query: "o que falaram sobre o projeto delta ontem?"
{"intent": "narrative", "keywords": ["projeto", "delta"], "dateRange": {"start": "ontem", "end": "ontem"}}

Query: "top assuntos abordados"
{"intent": "aggregation", "keywords": ["assuntos"], "dateRange": {"start": null, "end": null}}

Query: "qual a senha do wifi"
{"intent": "factual", "keywords": ["senha", "wifi"], "dateRange": {"start": null, "end": null}}

Query: "${query}"
`;
    const options = {
      temperature: 0.05,
      maxTokens: 150,
      systemPrompt: "You are a headless JSON API. Respond only with valid JSON. Never output conversational text."
    };
    const res = await this.generateJson(prompt, options, 3);
    const validIntents = ["factual", "aggregation", "narrative", "unknown"];
    if (!validIntents.includes(res.intent)) {
      res.intent = "factual";
    }
    if (!res.keywords || !Array.isArray(res.keywords)) {
      res.keywords = [];
    }
    return res;
  }
  async expandKeywords(keywords) {
    const prompt = `You are a linguistic expansion tool for Portuguese chat logs. Output ONLY raw JSON.
Expand the keywords with exactly 3 common pt-BR synonyms, internet slang, or abbreviations. 
Crucially: If a keyword is a Category/Class (like "jogos", "pessoas", "lugares", "topicos"), you MUST include its direct English translation (e.g. "game", "person", "place", "topic") so it matches our system's internal database classification schema.

Examples:
Keywords: ["jogos"]
{"expanded": ["game", "videogame", "play"]}

Keywords: ["pessoas"]
{"expanded": ["person", "alguém", "galera"]}

Keywords: ["risada", "engraçado"]
{"expanded": ["kkk", "haha", "rsrs"]}

Keywords: ${JSON.stringify(keywords)}
`;
    const options = {
      temperature: 0.3,
      maxTokens: 100,
      systemPrompt: 'You are a headless JSON API. You MUST respond with exactly this JSON schema: {"expanded": ["str", "str"]}'
    };
    try {
      const res = await this.generateJson(prompt, options, 2);
      if (res.expanded && Array.isArray(res.expanded)) {
        return Array.from(/* @__PURE__ */ new Set([...keywords, ...res.expanded]));
      }
    } catch (e) {
      console.warn("[WorkerProcess] Failed to expand keywords", e);
    }
    return keywords;
  }
  async processNextInQueue() {
    if (this.processingQueue || this.batchQueue.length === 0) return;
    this.processingQueue = true;
    const task = this.batchQueue.shift();
    try {
      const res = await this.internalGenerateStream(task.prompt, task.onToken || (() => {
      }), task.options);
      task.resolve(res);
    } catch (e) {
      task.reject(e);
    } finally {
      this.processingQueue = false;
      this.processNextInQueue();
    }
  }
  async internalGenerate(prompt, options) {
    return this.internalGenerateStream(prompt, () => {
    }, options);
  }
  async internalGenerateStream(prompt, onToken, options) {
    return new Promise((resolve, reject) => {
      const id = nanoid();
      this.pendingRequests.set(id, { resolve, reject, onToken });
      this.worker.postMessage({
        type: "generate",
        id,
        payload: { prompt, options }
      });
    });
  }
  getModelInfo() {
    return {
      modelName: MODEL_REGISTRY[this.currentModelKey].name,
      parameters: this.currentModelKey === "worker" ? "350M" : "270M"
    };
  }
  async dispose() {
    if (!this.worker) return;
    console.log("[WorkerProcess] Disposing worker...");
    this.worker.postMessage({ type: "dispose" });
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.worker) this.worker.kill();
        resolve();
      }, 2e3);
      this.worker.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    this.worker = null;
    this.ready = false;
    this.rejectAllPending(new Error("WorkerProcess is disposing or shutting down"));
    this.initializationPromise = null;
  }
  handleWorkerMessage(msg) {
    const { type, id, error, token, text } = msg;
    if (!id || !this.pendingRequests.has(id)) {
      if (type === "error") {
        console.error(`[Worker Global Error]`, error);
      }
      return;
    }
    const { resolve, reject, onToken } = this.pendingRequests.get(id);
    switch (type) {
      case "init-ready":
        this.pendingRequests.delete(id);
        resolve();
        break;
      case "token":
        if (onToken && token) onToken(token);
        break;
      case "done":
        this.pendingRequests.delete(id);
        resolve(text);
        break;
      case "error":
        this.pendingRequests.delete(id);
        reject(new Error(error));
        break;
      default:
        console.warn(`[WorkerProcess] Unrecognized message type '${type}'`);
    }
  }
  rejectAllPending(error) {
    for (const [id, req] of this.pendingRequests.entries()) {
      req.reject(error);
      this.pendingRequests.delete(id);
    }
  }
};
__publicField(_WorkerProcess, "instance", null);
let WorkerProcess = _WorkerProcess;
const WorkerProcess$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  WorkerProcess
}, Symbol.toStringTag, { value: "Module" }));
class ChatImportService {
  constructor() {
    __publicField(this, "parser", new WhatsAppParser());
    __publicField(this, "sessionEngine", new SessionEngine(7200));
  }
  // > 2h gap
  async import(filePath, sender) {
    const emit = (progress) => {
      sender == null ? void 0 : sender.send("import:progress", progress);
    };
    let chatId;
    try {
      emit({ stage: "reading", percent: 5, label: "Lendo arquivo", detail: "Calculando hash..." });
      const fileHash = await computeFileHash(filePath);
      const db = DatabaseService.getInstance();
      const chatRepo = new ChatRepository(db);
      if (chatRepo.existsByHash(fileHash)) {
        return { success: false, duplicate: true, error: "Arquivo já importado." };
      }
      const chatName = basename(filePath).replace(/\.[^/.]+$/, "");
      chatId = nanoid();
      emit({ stage: "parsing", percent: 15, label: "Parseando mensagens", detail: "Lendo chat base..." });
      const parseResult = await this.parser.parse(filePath);
      if (parseResult.messages.length === 0) {
        return { success: false, error: "Nenhuma mensagem encontrada." };
      }
      const newMessages = parseResult.messages.map((m) => ({
        id: nanoid(),
        chat_id: chatId,
        sender: m.sender,
        content: m.content,
        timestamp: m.timestamp,
        type: m.type,
        raw: m.raw
      }));
      chatRepo.create({
        id: chatId,
        name: chatName,
        source: "whatsapp",
        file_hash: fileHash,
        participant_count: parseResult.stats.participants.length,
        message_count: parseResult.messages.length,
        first_message_at: parseResult.stats.firstTimestamp ?? void 0,
        last_message_at: parseResult.stats.lastTimestamp ?? void 0
      });
      emit({ stage: "fts_indexing", percent: 25, label: "Agrupando Sessões", detail: "Topologia Cronológica..." });
      const rawSessions = this.sessionEngine.group(parseResult.messages);
      const newSessions = [];
      for (const rawSess of rawSessions) {
        newSessions.push({
          id: nanoid(),
          chat_id: chatId,
          start_time: rawSess.start_time,
          end_time: rawSess.end_time,
          message_count: rawSess.message_count,
          summary: "Processando IA em background..."
          // Temporary summary
        });
      }
      emit({ stage: "fts_indexing", percent: 40, label: "Salvando no banco", detail: "Persistindo histórico nativo e Indexando FTS5..." });
      const messageRepo = new MessageRepository(db);
      messageRepo.insertBatch(newMessages);
      const sessionRepo = new SessionRepository(db);
      sessionRepo.insertBatch(newSessions, []);
      this.runBackgroundNLP(chatId, rawSessions, newSessions, sender).catch((err) => {
        console.error("[Background NLP Error]", err);
      });
      return {
        success: true,
        chatId,
        chatName,
        messageCount: parseResult.messages.length,
        chunkCount: newSessions.length
        // total sessions
      };
    } catch (err) {
      if (chatId) {
        try {
          const db = DatabaseService.getInstance();
          new ChatRepository(db).delete(chatId);
        } catch (e) {
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ChatImportService] Import failed:", message);
      emit({ stage: "error", percent: 0, label: "Erro na importação", detail: message });
      return { success: false, error: message };
    }
  }
  /**
   * Background process to extract summaries and entities via Worker
   */
  async runBackgroundNLP(chatId, rawSessions, dbSessions, sender) {
    const emit = (progress) => {
      sender == null ? void 0 : sender.send("import:progress", progress);
    };
    try {
      emit({ stage: "nlp_summaries", percent: 20, label: "Extração NLP Iniciada", detail: `Processando ${rawSessions.length} sessões...`, chatId });
      const worker = WorkerProcess.getInstance();
      await worker.initialize();
      const db = DatabaseService.getInstance();
      const sessionRepo = new SessionRepository(db);
      let processed = 0;
      for (let i = 0; i < rawSessions.length; i++) {
        const rawSess = rawSessions[i];
        const dbSess = dbSessions[i];
        const convoContext = rawSess.messages.map((m) => `[${new Date(m.timestamp * 1e3).toISOString()}] ${m.sender}: ${m.content}`).join("\n");
        const prompt = `Read the following chat session and extract the main summary and any notable entities mentioned (names, places, topics) along with their action/intent.
Respond ONLY with a valid JSON strictly matching this schema:
{
  "summary": "general summary of what happened",
  "entities": [
    { "name": "Raw Name", "type": "person/place/game/topic", "action": "What they did or intent" }
  ]
}

CHAT SESSION:
${convoContext}`;
        let summary = "Sessão concluída (sem detalhes extraídos)";
        let extractedEntities = [];
        try {
          const result = await worker.generateJson(prompt, { maxTokens: 800, temperature: 0.1 }, 3);
          if (result.summary) summary = result.summary;
          if (result.entities && Array.isArray(result.entities)) {
            extractedEntities = result.entities;
          }
        } catch (e) {
          console.warn("[ChatImportService Worker] Worker extraction failed on session:", e.message);
        }
        const newEntities = [];
        for (const ent of extractedEntities) {
          if (!ent.name) continue;
          newEntities.push({
            id: nanoid(),
            session_id: dbSess.id,
            name: ent.name,
            normalized_name: ent.name.toLowerCase().trim(),
            type: ent.type || "unknown",
            action: ent.action || "mentioned"
          });
        }
        sessionRepo.updateSessionNLP(dbSess.id, summary, newEntities);
        processed++;
        const isEntitiesPhase = processed > rawSessions.length * 0.7;
        if (processed % 5 === 0 || processed === rawSessions.length) {
          emit({
            stage: isEntitiesPhase ? "nlp_entities" : "nlp_summaries",
            percent: 20 + Math.round(processed / rawSessions.length * 80),
            label: isEntitiesPhase ? "Resolvendo Entidades" : "Processando Resumos (Batch)",
            detail: `${processed} / ${rawSessions.length} sessões analisadas...`,
            chatId
            // Note: sending chatId along to identify bg process per chat
          });
        }
      }
      emit({ stage: "done", percent: 100, label: "Concluído", detail: `Entidades Indexadas para o chat.`, chatId });
    } catch (err) {
      console.error("[Background NLP Exception]", err);
    }
  }
}
function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}
const importService = new ChatImportService();
function registerImportHandlers(win2) {
  ipcMain.handle("import:chat", async (_event, filePath) => {
    return importService.import(filePath, win2.webContents);
  });
  ipcMain.handle("import:file-dialog", async () => {
    const result = await dialog.showOpenDialog(win2, {
      title: "Selecionar export do WhatsApp",
      filters: [
        { name: "WhatsApp Export", extensions: ["txt", "zip"] },
        { name: "Todos os arquivos", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
function registerModelHandlers(win2) {
  const manager = ModelManager.getInstance();
  ipcMain.handle("models:check", async () => {
    return manager.checkAll();
  });
  ipcMain.handle("models:download", async (_, key) => {
    return manager.download(key, (progress) => {
      if (!win2.isDestroyed()) {
        win2.webContents.send("models:progress", progress);
      }
    });
  });
  ipcMain.handle("models:select-file", async () => {
    const result = await dialog.showOpenDialog(win2, {
      title: "Selecionar Modelo GGUF (BYOM)",
      filters: [
        { name: "GGUF Models", extensions: ["gguf"] },
        { name: "Todos os arquivos", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
const _SearchService = class _SearchService {
  constructor() {
    __publicField(this, "chatRepo");
    __publicField(this, "sessionRepo");
    __publicField(this, "messageRepo");
    const db = DatabaseService.getInstance();
    this.chatRepo = new ChatRepository(db);
    this.sessionRepo = new SessionRepository(db);
    this.messageRepo = new MessageRepository(db);
  }
  static getInstance() {
    if (!_SearchService.instance) {
      _SearchService.instance = new _SearchService();
    }
    return _SearchService.instance;
  }
  async search(query, options) {
    console.log(`[SearchService] Resolving deterministic search for: "${query}"`);
    const worker = WorkerProcess.getInstance();
    const classification = await worker.classifyQuery(query);
    console.log(`[SearchService] Intent: ${classification.intent} | Keywords: ${classification.keywords.join(", ")}`);
    const intent = classification.intent;
    const initialKeywords = classification.keywords && classification.keywords.length > 0 ? classification.keywords : [query];
    const dbOptions = {
      dateFrom: options == null ? void 0 : options.dateFrom,
      dateTo: options == null ? void 0 : options.dateTo
    };
    console.log(`[SearchService] Executing Ontology Hop (Entity Expansion)...`);
    const expandedKeywords = await worker.expandKeywords(initialKeywords);
    const combinedKeywords = Array.from(/* @__PURE__ */ new Set([...initialKeywords, ...expandedKeywords]));
    const topEntities = this.sessionRepo.searchAggregation(combinedKeywords, 8, dbOptions);
    const entityNames = topEntities.map((e) => e.name);
    if (entityNames.length > 0) {
      console.log(`[SearchService] Ontology hop discovered relevant context entities: ${entityNames.join(", ")}`);
    }
    const finalKeywords = Array.from(/* @__PURE__ */ new Set([...combinedKeywords, ...entityNames]));
    let results = this.performRouting(intent, finalKeywords, dbOptions);
    if (results.length === 0) {
      console.warn(`[SearchService] Data inexistent even after lexical and ontological expansions.`);
    }
    return results;
  }
  performRouting(intent, keywords, dbOptions) {
    const results = [];
    if (intent === "aggregation") {
      const aggs = this.sessionRepo.searchAggregation(keywords, 20, dbOptions);
      if (aggs.length > 0) {
        let content = "Aggregation Results:\n";
        for (const a of aggs) {
          content += `- Entity: ${a.name} (${a.type}) | Count: ${a.count}
`;
        }
        results.push({
          id: nanoid(),
          chatId: "",
          chatName: "Global Aggregations",
          score: 1,
          content,
          date: (/* @__PURE__ */ new Date()).toISOString(),
          sender: "System",
          intent: "aggregation",
          metadata: { items: aggs }
        });
      }
    } else if (intent === "narrative") {
      const sessions = this.sessionRepo.searchNarrative(keywords, 5, dbOptions);
      for (const s of sessions) {
        const chat = this.chatRepo.findById(s.chat_id);
        results.push({
          id: s.id,
          chatId: s.chat_id,
          chatName: (chat == null ? void 0 : chat.name) || "Unknown Chat",
          score: 0.9,
          content: `SESSION SUMMARY
${s.summary}`,
          date: new Date(s.start_time * 1e3).toISOString(),
          sender: "System",
          intent: "narrative"
        });
      }
    } else {
      const windows = this.messageRepo.searchFactual(keywords, 15, 5);
      for (const window of windows) {
        if (window.length === 0) continue;
        const chat = this.chatRepo.findById(window[0].chat_id);
        let contentBlock = "";
        for (const msg of window) {
          const date = new Date(msg.timestamp * 1e3);
          const tStr = date.toISOString().split("T")[1].slice(0, 5);
          contentBlock += `[${tStr}] ${msg.sender}: ${msg.content}
`;
        }
        results.push({
          id: nanoid(),
          chatId: window[0].chat_id,
          chatName: (chat == null ? void 0 : chat.name) || "Unknown Chat",
          score: 1,
          content: contentBlock.trim(),
          date: new Date(window[0].timestamp * 1e3).toISOString(),
          sender: window[0].sender,
          intent: "factual"
        });
      }
    }
    return results;
  }
};
__publicField(_SearchService, "instance", null);
let SearchService = _SearchService;
function registerSearchHandlers() {
  ipcMain.handle("search:query", async (_event, query, options) => {
    try {
      return await SearchService.getInstance().search(query, options);
    } catch (err) {
      console.error("[SearchHandlers] Error executing search:", err);
      return [];
    }
  });
}
const _dirname = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const _BrainProcess = class _BrainProcess {
  constructor() {
    __publicField(this, "worker", null);
    __publicField(this, "pendingRequests", /* @__PURE__ */ new Map());
    __publicField(this, "initializationPromise", null);
    __publicField(this, "ready", false);
  }
  static getInstance() {
    if (!_BrainProcess.instance) {
      _BrainProcess.instance = new _BrainProcess();
    }
    return _BrainProcess.instance;
  }
  async initialize() {
    if (this.ready) return;
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = new Promise(async (resolve, reject) => {
      try {
        console.log("[BrainProcess] Resolving Brain model path...");
        const modelPath = await ModelManager.getInstance().resolve("brain");
        console.log("[BrainProcess] Forking Utility Process...");
        const workerPath = path.join(_dirname, "brain-worker.js");
        this.worker = utilityProcess.fork(workerPath, [], {
          stdio: "inherit"
        });
        this.worker.on("message", (msg) => this.handleWorkerMessage(msg));
        this.worker.on("exit", (code) => {
          console.warn(`[BrainProcess] Utility process exited with code ${code}`);
          this.ready = false;
          this.worker = null;
          this.rejectAllPending(new Error(`Brain Worker exited unexpectedly with code ${code}`));
        });
        const id = nanoid();
        this.pendingRequests.set(id, {
          resolve: () => {
            console.log("[BrainProcess] Utility Process initialized successfully.");
            this.ready = true;
            resolve();
          },
          reject
        });
        this.worker.postMessage({
          type: "init",
          id,
          payload: { modelPath }
        });
      } catch (err) {
        console.error("[BrainProcess] Failed to initialize:", err);
        this.initializationPromise = null;
        reject(err);
      }
    });
    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }
  isReady() {
    return this.ready;
  }
  async generate(prompt, options) {
    return this.generateStream(prompt, () => {
    }, options);
  }
  async generateStream(prompt, onToken, options) {
    if (!this.ready || !this.worker) {
      await this.initialize();
    }
    return new Promise((resolve, reject) => {
      const id = nanoid();
      this.pendingRequests.set(id, { resolve, reject, onToken });
      this.worker.postMessage({
        type: "generate",
        id,
        payload: { prompt, options }
      });
    });
  }
  getModelInfo() {
    return {
      modelName: MODEL_REGISTRY.brain.name,
      parameters: "4B"
    };
  }
  async dispose() {
    if (!this.worker) return;
    console.log("[BrainProcess] Disposing worker...");
    this.worker.postMessage({ type: "dispose" });
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.worker) this.worker.kill();
        resolve();
      }, 2e3);
      this.worker.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    this.worker = null;
    this.ready = false;
    this.rejectAllPending(new Error("BrainProcess is disposing or shutting down"));
    this.initializationPromise = null;
  }
  handleWorkerMessage(msg) {
    const { type, id, error, token, text } = msg;
    if (!id || !this.pendingRequests.has(id)) {
      if (type === "error") {
        console.error(`[BrainWorker Global Error]`, error);
      }
      return;
    }
    const { resolve, reject, onToken } = this.pendingRequests.get(id);
    switch (type) {
      case "init-ready":
        this.pendingRequests.delete(id);
        resolve();
        break;
      case "token":
        if (onToken && token) onToken(token);
        break;
      case "done":
        this.pendingRequests.delete(id);
        resolve(text);
        break;
      case "error":
        this.pendingRequests.delete(id);
        reject(new Error(error));
        break;
      default:
        console.warn(`[BrainWorker] Unrecognized message type '${type}'`);
    }
  }
  rejectAllPending(error) {
    for (const [id, req] of this.pendingRequests.entries()) {
      req.reject(error);
      this.pendingRequests.delete(id);
    }
  }
};
__publicField(_BrainProcess, "instance", null);
let BrainProcess = _BrainProcess;
const BrainProcess$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BrainProcess
}, Symbol.toStringTag, { value: "Module" }));
const promptTemplates = {
  buildRAGPrompt: (question, chunks) => {
    const formattedChunks = chunks.map((c) => `[${c.date} - ${c.sender}]: ${c.content}`).join("\n\n");
    let dateContext = "";
    if (chunks.length > 0) {
      const dates = chunks.map((c) => new Date(c.date).getTime()).filter((t) => !isNaN(t));
      if (dates.length > 0) {
        const minDate = new Date(Math.min(...dates)).toISOString().split("T")[0];
        const maxDate = new Date(Math.max(...dates)).toISOString().split("T")[0];
        dateContext = `
Regra OBRIGATÓRIA: Baseie-se EXATAMENTE nas datas providenciadas no prompt (de ${minDate} a ${maxDate}). Nunca alucine datas ou informações fora desse intervalo.`;
      }
    }
    const systemPrompt = `Você é um assistente cirúrgico que extrai informações de dados históricos. Baseie sua resposta APENAS no contexto fornecido.${dateContext}`;
    const userPrompt = `DADOS E CONTEXTO OBTIDOS (Fontes imutáveis):
${formattedChunks}

PERGUNTA DO USUÁRIO: ${question}

Responda EXATAMENTE o que foi perguntado, formatando de maneira limpa. Se a resposta não estiver nos dados, declare tratar-se de "dados inexistentes".`;
    return { systemPrompt, userPrompt };
  }
};
const DEFAULT_SETTINGS = {
  gpu: "auto",
  temperature: 0.3,
  systemPrompt: "Você é um assistente encarregado de ler históricos de chat. Responda apenas com o que estiver no contexto.",
  topK: 15,
  history: true,
  analytics: false,
  customBrainPath: null,
  customWorkerPath: null
};
const _SettingsService = class _SettingsService {
  constructor() {
    __publicField(this, "settingsPath");
    __publicField(this, "currentSettings");
    const userData = app.getPath("userData");
    this.settingsPath = path$1.join(userData, "settings.json");
    this.currentSettings = { ...DEFAULT_SETTINGS };
    this.load();
  }
  static getInstance() {
    if (!_SettingsService.instance) {
      _SettingsService.instance = new _SettingsService();
    }
    return _SettingsService.instance;
  }
  get() {
    return { ...this.currentSettings };
  }
  update(partial) {
    const hasGpuChanged = partial.gpu !== void 0 && partial.gpu !== this.currentSettings.gpu;
    const hasBrainChanged = "customBrainPath" in partial && partial.customBrainPath !== this.currentSettings.customBrainPath;
    const hasWorkerChanged = "customWorkerPath" in partial && partial.customWorkerPath !== this.currentSettings.customWorkerPath;
    this.currentSettings = {
      ...this.currentSettings,
      ...partial
    };
    this.save();
    if (hasGpuChanged || hasBrainChanged || hasWorkerChanged) {
      setTimeout(async () => {
        console.log("[SettingsService] Critical backend setting changed. Disposing active models for cold-restart.");
        const { WorkerProcess: WorkerProcess2 } = await Promise.resolve().then(() => WorkerProcess$1);
        const { BrainProcess: BrainProcess2 } = await Promise.resolve().then(() => BrainProcess$1);
        try {
          WorkerProcess2.getInstance().dispose();
        } catch (e) {
        }
        try {
          BrainProcess2.getInstance().dispose();
        } catch (e) {
        }
      }, 0);
    }
    return this.get();
  }
  load() {
    try {
      if (fs$1.existsSync(this.settingsPath)) {
        const data = fs$1.readFileSync(this.settingsPath, "utf-8");
        const parsed = JSON.parse(data);
        this.currentSettings = {
          ...DEFAULT_SETTINGS,
          ...parsed
        };
      } else {
        this.save();
      }
    } catch (error) {
      console.error("[SettingsService] Failed to load settings:", error);
      this.currentSettings = { ...DEFAULT_SETTINGS };
    }
  }
  save() {
    try {
      fs$1.writeFileSync(this.settingsPath, JSON.stringify(this.currentSettings, null, 2));
    } catch (error) {
      console.error("[SettingsService] Failed to save settings:", error);
    }
  }
};
__publicField(_SettingsService, "instance");
let SettingsService = _SettingsService;
const _RAGService = class _RAGService {
  constructor() {
  }
  static getInstance() {
    if (!_RAGService.instance) {
      _RAGService.instance = new _RAGService();
    }
    return _RAGService.instance;
  }
  async generateStream(question, onToken, options, onStep) {
    const totalStart = performance.now();
    const latency = { embedding: 0, search: 0, generation: 0, total: 0 };
    let context = [];
    try {
      if (onStep) onStep("booting");
      const config = SettingsService.getInstance().get();
      if (onStep) onStep("searching");
      const searchStart = performance.now();
      context = await SearchService.getInstance().search(question, {
        limit: config.topK,
        chatId: options == null ? void 0 : options.chatId
      });
      latency.search = performance.now() - searchStart;
      if (context.length === 0) {
        latency.total = performance.now() - totalStart;
        return {
          answer: "Dados inexistentes. Não foi possível localizar o contexto ou menções referentes à sua busca neste chat.",
          context,
          tokensUsed: 0,
          latency
        };
      }
      if (onStep) onStep("processing");
      const { userPrompt } = promptTemplates.buildRAGPrompt(question, context);
      const systemPrompt = config.systemPrompt;
      if (onStep) onStep("synthesizing");
      const generationStart = performance.now();
      const brainProcess = BrainProcess.getInstance();
      let answer = "";
      let tokensUsed = 0;
      try {
        answer = await brainProcess.generateStream(
          userPrompt,
          (token) => {
            tokensUsed++;
            if (onToken) onToken(token);
          },
          {
            temperature: (options == null ? void 0 : options.temperature) ?? config.temperature,
            maxTokens: (options == null ? void 0 : options.maxTokens) || 1024,
            systemPrompt
          }
        );
      } catch (llmError) {
        console.error("[RAGService] Error generating response from BrainProcess:", llmError);
        answer = "Desculpe, ocorreu um erro ao gerar a resposta ou a IA falhou.\n\nContexto encontrado:" + context.map((c, i) => `
[${i + 1}] ${c.date} ${c.sender}: ${c.content}`).join("");
      }
      latency.generation = performance.now() - generationStart;
      latency.total = performance.now() - totalStart;
      return {
        answer,
        context,
        tokensUsed,
        latency
      };
    } catch (err) {
      console.error("[RAGService] Fatal error in RAG pipeline:", err);
      throw err;
    }
  }
};
__publicField(_RAGService, "instance", null);
let RAGService = _RAGService;
function registerRagHandlers(win2) {
  ipcMain.handle("rag:query", async (_event, question, options) => {
    try {
      const ragService = RAGService.getInstance();
      const response = await ragService.generateStream(
        question,
        (token) => {
          win2.webContents.send("rag:token", token);
        },
        options,
        (step) => {
          win2.webContents.send("rag:step", step);
        }
      );
      win2.webContents.send("rag:done", response);
    } catch (error) {
      console.error("[IPC rag:query] Error:", error);
      throw error;
    }
  });
  ipcMain.handle("rag:status", async () => {
    const { BrainProcess: BrainProcess2 } = await Promise.resolve().then(() => BrainProcess$1);
    const { WorkerProcess: WorkerProcess2 } = await Promise.resolve().then(() => WorkerProcess$1);
    return {
      brain: {
        ready: BrainProcess2.getInstance().isReady()
      },
      worker: {
        ready: WorkerProcess2.getInstance().isReady(),
        fallback: WorkerProcess2.getInstance().getFallbackStatus()
      }
    };
  });
}
function registerSettingsHandlers() {
  ipcMain.handle("settings:get", async () => {
    return SettingsService.getInstance().get();
  });
  ipcMain.handle("settings:update", async (_event, partial) => {
    return SettingsService.getInstance().update(partial);
  });
}
function registerAllHandlers(win2) {
  registerChatHandlers();
  registerImportHandlers(win2);
  registerModelHandlers(win2);
  registerSearchHandlers();
  registerRagHandlers(win2);
  registerSettingsHandlers();
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    // Custom titlebar
    titleBarStyle: "hidden",
    backgroundColor: "#080b0d",
    show: false,
    // Prevent white flash
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.once("ready-to-show", () => {
    win == null ? void 0 : win.show();
  });
  ipcMain.on("window:minimize", () => win == null ? void 0 : win.minimize());
  ipcMain.on("window:maximize", () => {
    if (win == null ? void 0 : win.isMaximized()) win.unmaximize();
    else win == null ? void 0 : win.maximize();
  });
  ipcMain.on("window:close", () => win == null ? void 0 : win.close());
  registerAllHandlers(win);
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.on("before-quit", () => {
  DatabaseService.close();
});
app.whenReady().then(() => {
  try {
    DatabaseService.getInstance();
  } catch (err) {
    console.error("[Main] Failed to initialize database:", err);
  }
  createWindow();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
