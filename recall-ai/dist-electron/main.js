var De = Object.defineProperty;
var ke = (i, e, t) => e in i ? De(i, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : i[e] = t;
var m = (i, e, t) => ke(i, typeof e != "symbol" ? e + "" : e, t);
import { app as A, ipcMain as g, utilityProcess as fe, dialog as Ne, BrowserWindow as Ie } from "electron";
import { fileURLToPath as ee } from "node:url";
import I, { basename as Ce } from "node:path";
import Fe from "better-sqlite3";
import { webcrypto as ae, createHash as Ue } from "node:crypto";
import re, { createReadStream as te } from "node:fs";
import { createInterface as Se } from "node:readline";
import { resolveModelFile as V, createModelDownloader as xe } from "node-llama-cpp";
import j from "fs";
import Pe from "path";
const oe = "001_initial", Me = `
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
`, be = `
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
`, Be = `
  -- FTS5 table only (when sqlite-vec not available)
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    chunk_id UNINDEXED,
    tokenize='unicode61'
  );
`, Xe = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`;
function ve(i) {
  if (i.exec(Xe), i.prepare(
    "SELECT id FROM _migrations WHERE id = ?"
  ).get(oe)) {
    console.log("[DB] Migration 001_initial already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 001_initial..."), i.transaction(() => {
    i.exec(Me), Ge(i) ? (console.log("[DB] sqlite-vec detected — creating vectors + chunks_fts tables"), i.exec(be)) : (console.log("[DB] sqlite-vec not detected — creating chunks_fts only"), i.exec(Be)), i.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(oe);
  })(), console.log("[DB] Migration 001_initial complete");
}
function Ge(i) {
  try {
    return i.prepare("SELECT vec_version()").get(), !0;
  } catch {
    return !1;
  }
}
const ce = "002_add_profile_facts", Ye = `
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
`, ze = `
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
`, qe = `
  -- SQLite-vec table for semantic search on profile_facts
  -- Use vec0 for dynamic loading
  CREATE VIRTUAL TABLE IF NOT EXISTS profile_facts_vectors USING vec0(
    fact_id TEXT PRIMARY KEY,
    embedding FLOAT[768]
  );
`;
function $e(i) {
  if (i.prepare(
    "SELECT id FROM _migrations WHERE id = ?"
  ).get(ce)) {
    console.log("[DB] Migration 002_add_profile_facts already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 002_add_profile_facts..."), i.transaction(() => {
    i.exec(Ye), i.exec(ze), We(i) && (console.log("[DB] sqlite-vec detected — creating profile_facts_vectors table"), i.exec(qe)), i.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(ce);
  })(), console.log("[DB] Migration 002_add_profile_facts complete");
}
function We(i) {
  try {
    return i.prepare("SELECT vec_version()").get(), !0;
  } catch {
    return !1;
  }
}
const de = "003_add_contact_profiles", He = `
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
function Ve(i) {
  if (i.prepare(
    "SELECT id FROM _migrations WHERE id = ?"
  ).get(de)) {
    console.log("[DB] Migration 003_add_contact_profiles already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 003_add_contact_profiles..."), i.transaction(() => {
    i.exec(He), i.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(de);
  })(), console.log("[DB] Migration 003_add_contact_profiles complete");
}
const le = "004_parent_child_chunks", je = `
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
`, Qe = `
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
`, Ke = `
  CREATE VIRTUAL TABLE IF NOT EXISTS child_chunks_fts USING fts5(
    content,
    chunk_id UNINDEXED,
    tokenize='unicode61'
  );
`;
function Je(i) {
  if (i.prepare("SELECT id FROM _migrations WHERE id = ?").get(le)) {
    console.log("[DB] Migration 004_parent_child_chunks already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 004_parent_child_chunks..."), i.transaction(() => {
    i.exec(je), Ze(i) ? (console.log("[DB] sqlite-vec detected — creating child_vectors + child_chunks_fts tables"), i.exec(Qe)) : (console.log("[DB] sqlite-vec not detected — creating child_chunks_fts only"), i.exec(Ke)), i.prepare("INSERT INTO _migrations (id) VALUES (?)").run(le);
  })(), console.log("[DB] Migration 004_parent_child_chunks complete");
}
function Ze(i) {
  try {
    return i.prepare("SELECT vec_version()").get(), !0;
  } catch {
    return !1;
  }
}
const Ee = "005_propositions", et = `
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
`, tt = `
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
`, st = `
  CREATE VIRTUAL TABLE IF NOT EXISTS propositions_fts USING fts5(
    fact,
    original_quote,
    proposition_id UNINDEXED,
    tokenize='unicode61 remove_diacritics 2'
  );
`;
function nt(i) {
  if (i.prepare("SELECT id FROM _migrations WHERE id = ?").get(Ee)) {
    console.log("[DB] Migration 005_propositions already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 005_propositions..."), i.transaction(() => {
    i.exec(et), it(i) ? (console.log("[DB] sqlite-vec detected — creating proposition_vectors + propositions_fts tables"), i.exec(tt)) : (console.log("[DB] sqlite-vec not detected — creating propositions_fts only"), i.exec(st)), i.prepare("INSERT INTO _migrations (id) VALUES (?)").run(Ee);
  })(), console.log("[DB] Migration 005_propositions complete");
}
function it(i) {
  try {
    return i.prepare("SELECT vec_version()").get(), !0;
  } catch {
    return !1;
  }
}
const me = "006_intelligent_ingestion", at = `
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
function rt(i) {
  if (i.prepare("SELECT id FROM _migrations WHERE id = ?").get(me)) {
    console.log("[DB] Migration 006_intelligent_ingestion already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 006_intelligent_ingestion..."), i.transaction(() => {
    i.exec(at), i.prepare("INSERT INTO _migrations (id) VALUES (?)").run(me);
  })(), console.log("[DB] Migration 006_intelligent_ingestion complete");
}
const pe = "007_search_indexes", ot = `
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
function ct(i) {
  if (i.prepare("SELECT id FROM _migrations WHERE id = ?").get(pe)) {
    console.log("[DB] Migration 007_search_indexes already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 007_search_indexes..."), i.transaction(() => {
    i.exec(ot), i.prepare("INSERT INTO _migrations (id) VALUES (?)").run(pe);
  })(), console.log("[DB] Migration 007_search_indexes complete");
}
const ue = "008_people_schema", dt = `
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
function lt(i) {
  if (i.prepare("SELECT id FROM _migrations WHERE id = ?").get(ue)) {
    console.log("[DB] Migration 008_people_schema already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 008_people_schema..."), i.transaction(() => {
    i.exec(dt), i.prepare("INSERT INTO _migrations (id) VALUES (?)").run(ue);
  })(), console.log("[DB] Migration 008_people_schema complete");
}
const R = class R {
  static getInstance() {
    if (R.db)
      return R.db;
    const e = A.getPath("userData"), t = I.join(e, "recall-ai.db");
    console.log("[DB] Opening database at:", t);
    const s = new Fe(t, {
      verbose: process.env.NODE_ENV === "development" ? console.log : void 0
    });
    return s.pragma("journal_mode = WAL"), s.pragma("foreign_keys = ON"), s.pragma("synchronous = NORMAL"), s.pragma("cache_size = -32000"), s.pragma("temp_store = MEMORY"), R.db = s, ve(s), $e(s), Ve(s), Je(s), nt(s), rt(s), ct(s), lt(s), console.log("[DB] Database ready"), s;
  }
  /** Close the database connection (call on app quit) */
  static close() {
    R.db && (R.db.close(), R.db = null, console.log("[DB] Database closed"));
  }
  /** Check if the database is open */
  static isOpen() {
    return R.db !== null && R.db.open;
  }
};
m(R, "db", null);
let N = R, Et = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const mt = 128;
let y, b;
function pt(i) {
  !y || y.length < i ? (y = Buffer.allocUnsafe(i * mt), ae.getRandomValues(y), b = 0) : b + i > y.length && (ae.getRandomValues(y), b = 0), b += i;
}
function f(i = 21) {
  pt(i |= 0);
  let e = "";
  for (let t = b - i; t < b; t++)
    e += Et[y[t] & 63];
  return e;
}
class B {
  constructor(e) {
    this.db = e;
  }
  create(e) {
    const t = e.id ?? f(), s = Math.floor(Date.now() / 1e3);
    return this.db.prepare(`
      INSERT INTO chats (
        id, name, source, participant_count, message_count,
        first_message_at, last_message_at, imported_at, file_hash, metadata
      ) VALUES (
        @id, @name, @source, @participant_count, @message_count,
        @first_message_at, @last_message_at, @imported_at, @file_hash, @metadata
      )
    `).run({
      id: t,
      name: e.name,
      source: e.source ?? "whatsapp",
      participant_count: e.participant_count ?? null,
      message_count: e.message_count ?? 0,
      first_message_at: e.first_message_at ?? null,
      last_message_at: e.last_message_at ?? null,
      imported_at: s,
      file_hash: e.file_hash ?? null,
      metadata: e.metadata ? JSON.stringify(e.metadata) : null
    }), this.findById(t);
  }
  findAll() {
    return this.db.prepare(
      "SELECT * FROM chats ORDER BY imported_at DESC"
    ).all().map(Te);
  }
  findById(e) {
    const t = this.db.prepare(
      "SELECT * FROM chats WHERE id = ?"
    ).get(e);
    return t ? Te(t) : null;
  }
  delete(e) {
    this.db.prepare("DELETE FROM chats WHERE id = ?").run(e);
  }
  existsByHash(e) {
    return this.db.prepare(
      "SELECT id FROM chats WHERE file_hash = ?"
    ).get(e) !== void 0;
  }
  updateMessageCount(e, t) {
    this.db.prepare(
      "UPDATE chats SET message_count = ? WHERE id = ?"
    ).run(t, e);
  }
  updateParticipantCount(e, t) {
    this.db.prepare(
      "UPDATE chats SET participant_count = ? WHERE id = ?"
    ).run(t, e);
  }
  updateTimestamps(e, t, s) {
    this.db.prepare(
      "UPDATE chats SET first_message_at = ?, last_message_at = ? WHERE id = ?"
    ).run(t, s, e);
  }
}
function Te(i) {
  return {
    ...i,
    metadata: i.metadata ? JSON.parse(i.metadata) : null
  };
}
class se {
  constructor(e) {
    this.db = e;
  }
  /**
   * Insert a batch of messages in a single transaction.
   * Duplicate rows (same chat_id + timestamp + sender + content) are silently ignored.
   */
  insertBatch(e) {
    if (e.length === 0) return;
    const t = this.db.prepare(`
      INSERT OR IGNORE INTO messages (id, chat_id, sender, content, timestamp, type, raw)
      VALUES (@id, @chat_id, @sender, @content, @timestamp, @type, @raw)
    `);
    this.db.transaction((n) => {
      for (const r of n)
        t.run({
          id: r.id ?? f(),
          chat_id: r.chat_id,
          sender: r.sender,
          content: r.content,
          timestamp: r.timestamp,
          type: r.type ?? "text",
          raw: r.raw ?? null
        });
    })(e);
  }
  findByChatId(e, t = 1e3, s = 0) {
    return this.db.prepare(`
      SELECT * FROM messages
      WHERE chat_id = ?
      ORDER BY timestamp ASC
      LIMIT ? OFFSET ?
    `).all(e, t, s);
  }
  countByChatId(e) {
    return this.db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE chat_id = ?"
    ).get(e).count;
  }
  /**
   * Returns unique sender names for a given chat, ordered by message count.
   */
  getParticipants(e) {
    return this.db.prepare(`
      SELECT DISTINCT sender
      FROM messages
      WHERE chat_id = ? AND type != 'system'
      GROUP BY sender
      ORDER BY COUNT(*) DESC
    `).all(e).map((s) => s.sender);
  }
  deleteByChatId(e) {
    this.db.prepare("DELETE FROM messages WHERE chat_id = ?").run(e);
  }
  /**
   * Factual Search (Task 4.1): Uses FTS5 to find matches and extracts a
   * sliding window of surrounding messages (+/- windowSize).
   */
  searchFactual(e, t = 15, s = 5) {
    if (!e || e.length === 0) return [];
    const n = e.map((c) => c.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ ]/g, "").trim()).filter(Boolean);
    if (n.length === 0) return [];
    const r = n.map((c) => `"${c}"*`).join(" OR "), a = this.db.prepare(`
      SELECT m.id, m.chat_id, m.timestamp 
      FROM messages_fts fts
      JOIN messages m ON fts.message_id = m.id
      WHERE messages_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(r, s), o = [], l = this.db.prepare(`
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
    for (const c of a) {
      const d = l.all(
        c.chat_id,
        c.timestamp,
        t + 1,
        c.chat_id,
        c.timestamp,
        t + 1
      );
      o.push(d);
    }
    return o;
  }
}
class z {
  constructor(e) {
    this.db = e;
  }
  /**
   * Insert sessions and their FTS5 entries in a single transaction.
   */
  insertBatch(e, t) {
    if (e.length === 0 && t.length === 0) return;
    const s = this.db.prepare(`
      INSERT INTO sessions (
        id, chat_id, start_time, end_time, message_count, summary
      ) VALUES (
        @id, @chat_id, @start_time, @end_time, @message_count, @summary
      )
    `), n = this.db.prepare(`
      INSERT INTO sessions_fts (summary, session_id)
      VALUES (@summary, @session_id)
    `), r = this.db.prepare(`
      INSERT INTO entities (
        id, session_id, name, normalized_name, type, action
      ) VALUES (
        @id, @session_id, @name, @normalized_name, @type, @action
      )
    `), a = this.db.prepare(`
      INSERT INTO entities_fts (normalized_name, type, action, entity_id)
      VALUES (@normalized_name, @type, @action, @entity_id)
    `);
    this.db.transaction((l, c) => {
      for (const d of l) {
        const E = d.id ?? f();
        s.run({
          id: E,
          chat_id: d.chat_id,
          start_time: d.start_time,
          end_time: d.end_time,
          message_count: d.message_count ?? 0,
          summary: d.summary
        }), n.run({ summary: d.summary, session_id: E });
      }
      for (const d of c) {
        const E = d.id ?? f();
        r.run({
          id: E,
          session_id: d.session_id,
          name: d.name,
          normalized_name: d.normalized_name,
          type: d.type,
          action: d.action
        }), a.run({
          normalized_name: d.normalized_name,
          type: d.type,
          action: d.action,
          entity_id: E
        });
      }
    })(e, t);
  }
  /**
   * Update a session with its NLP summary and insert its entities + FTS5 entries.
   * Used by the background NLP worker.
   */
  updateSessionNLP(e, t, s) {
    const n = this.db.prepare(`
      UPDATE sessions SET summary = @summary WHERE id = @id
    `), r = this.db.prepare(`
      UPDATE sessions_fts SET summary = @summary WHERE session_id = @id
    `), a = this.db.prepare(`
      INSERT INTO entities (
        id, session_id, name, normalized_name, type, action
      ) VALUES (
        @id, @session_id, @name, @normalized_name, @type, @action
      )
    `), o = this.db.prepare(`
      INSERT INTO entities_fts (normalized_name, type, action, entity_id)
      VALUES (@normalized_name, @type, @action, @entity_id)
    `);
    this.db.transaction(() => {
      n.run({ summary: t, id: e }), r.run({ summary: t, id: e });
      for (const c of s) {
        const d = c.id ?? f();
        a.run({
          id: d,
          session_id: c.session_id,
          name: c.name,
          normalized_name: c.normalized_name,
          type: c.type,
          action: c.action
        }), o.run({
          normalized_name: c.normalized_name,
          type: c.type,
          action: c.action,
          entity_id: d
        });
      }
    })();
  }
  findByChatId(e) {
    return this.db.prepare(`
      SELECT * FROM sessions
      WHERE chat_id = ?
      ORDER BY start_time ASC
    `).all(e);
  }
  findEntitiesByChatId(e) {
    return this.db.prepare(`
      SELECT e.* FROM entities e
      JOIN sessions s ON s.id = e.session_id
      WHERE s.chat_id = ?
      ORDER BY e.created_at ASC
    `).all(e);
  }
  findById(e) {
    return this.db.prepare(
      "SELECT * FROM sessions WHERE id = ?"
    ).get(e) || null;
  }
  deleteByChatId(e) {
    const t = this.db.prepare(
      "SELECT id FROM sessions WHERE chat_id = ?"
    ).all(e);
    if (t.length === 0)
      return;
    const s = this.db.prepare("DELETE FROM sessions WHERE chat_id = ?"), n = this.db.prepare("DELETE FROM sessions_fts WHERE session_id = ?"), r = this.db.prepare(
      "DELETE FROM entities_fts WHERE entity_id IN (SELECT id FROM entities WHERE session_id = ?)"
    );
    this.db.transaction(() => {
      for (const { id: o } of t)
        r.run(o), n.run(o);
      s.run(e);
    })();
  }
  countByChatId(e) {
    return this.db.prepare(
      "SELECT COUNT(*) as count FROM sessions WHERE chat_id = ?"
    ).get(e).count;
  }
  searchNarrative(e, t = 5, s) {
    if (!e || e.length === 0) return [];
    if (e.includes("#RECENT#")) {
      let l = "SELECT * FROM sessions";
      const c = [], d = [];
      return s != null && s.dateFrom && (d.push("start_time >= ?"), c.push(s.dateFrom)), s != null && s.dateTo && (d.push("end_time <= ?"), c.push(s.dateTo)), d.length > 0 && (l += " WHERE " + d.join(" AND ")), l += " ORDER BY start_time DESC LIMIT ?", c.push(t), this.db.prepare(l).all(...c).reverse();
    }
    const n = e.map((l) => l.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ]/g, "").trim()).filter(Boolean);
    if (n.length === 0) return [];
    const r = n.map((l) => `"${l}"*`).join(" OR ");
    let a = `
      SELECT s.*
      FROM sessions_fts fts
      JOIN sessions s ON fts.session_id = s.id
      WHERE sessions_fts MATCH ?
    `;
    const o = [r];
    return s != null && s.dateFrom && (a += " AND s.start_time >= ?", o.push(s.dateFrom)), s != null && s.dateTo && (a += " AND s.end_time <= ?", o.push(s.dateTo)), a += " ORDER BY fts.rank LIMIT ?", o.push(t), this.db.prepare(a).all(...o);
  }
  searchAggregation(e, t = 10, s) {
    if (!e || e.length === 0) return [];
    const n = e.map((l) => l.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ ]/g, "").trim()).filter(Boolean);
    if (n.length === 0) return [];
    const r = n.map((l) => `"${l}"*`).join(" OR ");
    let a = `
      SELECT e.normalized_name as name, e.type, COUNT(*) as count
      FROM entities_fts fts
      JOIN entities e ON fts.entity_id = e.id
      JOIN sessions s ON e.session_id = s.id
      WHERE entities_fts MATCH ?
    `;
    const o = [r];
    return s != null && s.dateFrom && (a += " AND s.start_time >= ?", o.push(s.dateFrom)), s != null && s.dateTo && (a += " AND s.end_time <= ?", o.push(s.dateTo)), a += " GROUP BY e.normalized_name, e.type ORDER BY count DESC LIMIT ?", o.push(t), this.db.prepare(a).all(...o);
  }
}
function ut() {
  g.handle("chats:list", async () => {
    const i = N.getInstance();
    return new B(i).findAll();
  }), g.handle("chats:delete", async (i, e) => {
    const t = N.getInstance();
    t.transaction(() => {
      const n = new se(t), r = new z(t), a = new B(t);
      r.deleteByChatId(e), n.deleteByChatId(e), a.delete(e);
    })();
  });
}
class Y {
  constructor(e) {
    this.db = e;
  }
  /**
   * Creates a new person and associates their first alias.
   * Returns the newly created person ID.
   */
  createPersonWithAlias(e, t, s) {
    const n = f(), r = this.db.prepare(`
      INSERT INTO people (id, name, color) VALUES (@id, @name, @color)
    `), a = this.db.prepare(`
      INSERT INTO person_aliases (person_id, alias) VALUES (@person_id, @alias)
    `);
    return this.db.transaction(() => {
      r.run({ id: n, name: e, color: s }), a.run({ person_id: n, alias: t });
    })(), n;
  }
  /**
   * Links a person to a session as a mention.
   */
  linkMention(e, t, s) {
    this.db.prepare(`
      INSERT OR IGNORE INTO person_mentions (session_id, person_id, context)
      VALUES (@session_id, @person_id, @context)
    `).run({ session_id: e, person_id: t, context: s });
  }
  /**
   * Searches for a person by matching an alias using FTS5.
   */
  findProbableMatch(e) {
    const t = e.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ ]/g, "").trim();
    if (!t) return [];
    const s = `
      SELECT p.*
      FROM person_aliases_fts fts
      JOIN person_aliases pa ON fts.person_id = pa.person_id AND fts.alias = pa.alias
      JOIN people p ON pa.person_id = p.id
      WHERE person_aliases_fts MATCH ?
      ORDER BY fts.rank LIMIT 5
    `, n = `"${t}"*`;
    return this.db.prepare(s).all(n);
  }
  /**
   * Returns all person relations.
   */
  findAllRelations() {
    return this.db.prepare(`
      SELECT * FROM person_relations
    `).all();
  }
  /**
   * Returns all people ordered by mention count and recency.
   */
  findAll() {
    return this.db.prepare(`
      SELECT * FROM people ORDER BY message_count DESC, last_seen DESC
    `).all();
  }
}
const Tt = {
  id: "android_br",
  regex: /^(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}) - ([^:]+): (.*)$/,
  format: {
    id: "android_br",
    platform: "android",
    locale: "pt-BR",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    hasSeconds: !1,
    hasBrackets: !1
  },
  groups: { date: 1, time: 2, sender: 3, content: 4 }
}, ht = {
  id: "android_br_comma",
  regex: /^(\d{2}\/\d{2}\/\d{4}), (\d{2}:\d{2}) - ([^:]+): (.*)$/,
  format: {
    id: "android_br_comma",
    platform: "android",
    locale: "pt-PT",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    hasSeconds: !1,
    hasBrackets: !1
  },
  groups: { date: 1, time: 2, sender: 3, content: 4 }
}, gt = {
  id: "android_en",
  regex: /^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2} [AP]M) - ([^:]+): (.*)$/,
  format: {
    id: "android_en",
    platform: "android",
    locale: "en-US",
    dateFormat: "M/D/YY",
    timeFormat: "12h",
    hasSeconds: !1,
    hasBrackets: !1
  },
  groups: { date: 1, time: 2, sender: 3, content: 4 }
}, _t = {
  id: "ios_en",
  regex: /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}:\d{2} [AP]M)\] ([^:]+): (.*)$/,
  format: {
    id: "ios_en",
    platform: "ios",
    locale: "en-US",
    dateFormat: "M/D/YY",
    timeFormat: "12h",
    hasSeconds: !0,
    hasBrackets: !0
  },
  groups: { date: 1, time: 2, sender: 3, content: 4 }
}, K = [
  Tt,
  ht,
  gt,
  _t
], ft = [
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
], Nt = [
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
], It = 20;
async function St(i) {
  const e = await Ot(i, It);
  return Rt(e);
}
function Rt(i) {
  for (const e of i) {
    const t = e.trim();
    if (t) {
      for (const s of K)
        if (s.regex.test(t))
          return s.format;
    }
  }
  throw new Error(
    `WhatsApp format not recognized. Tried ${K.length} patterns on ${i.length} sample lines.`
  );
}
function Lt(i) {
  const e = K.find((t) => t.id === i);
  if (!e)
    throw new Error(`No pattern registered for format ID: ${i}`);
  return e;
}
async function Ot(i, e) {
  const t = [], s = Se({
    input: te(i, { encoding: "utf-8" }),
    crlfDelay: 1 / 0
  });
  for await (const n of s)
    if (t.push(n), t.length >= e) {
      s.close();
      break;
    }
  return t;
}
class At {
  /**
   * Parse a WhatsApp export .txt file using streaming (memory-efficient).
   */
  async parse(e) {
    let t;
    try {
      t = await St(e);
    } catch (E) {
      throw new Error(
        `Failed to detect WhatsApp format: ${E instanceof Error ? E.message : String(E)}`
      );
    }
    const s = Lt(t.id), n = [], r = [];
    let a = null, o = 0;
    const l = Se({
      input: te(e, { encoding: "utf-8" }),
      crlfDelay: 1 / 0
    });
    for await (const E of l) {
      o++;
      const p = o === 1 ? E.replace(/^\uFEFF/, "") : E, _ = s.regex.exec(p);
      if (_) {
        a && he(a) && n.push(ge(a));
        const S = _[s.groups.date], h = _[s.groups.time];
        let L;
        try {
          L = yt(S, h, t);
        } catch {
          r.push({ line: o, content: p, reason: "invalid_timestamp" }), a = null;
          continue;
        }
        const O = _[s.groups.content] ?? "", M = _[s.groups.sender].trim();
        a = {
          timestamp: L,
          sender: M,
          content: O,
          type: Re(O, M),
          raw: p,
          lineNumber: o
        };
      } else a && p.trim() ? (a.content = (a.content ?? "") + `
` + p, a.raw = (a.raw ?? "") + `
` + p) : p.trim() && !a && r.push({ line: o, content: p, reason: "orphan_line" });
    }
    a && he(a) && n.push(ge(a));
    const c = [...new Set(n.map((E) => E.sender))], d = {
      totalLines: o,
      totalMessages: n.length,
      errorCount: r.length,
      participants: c,
      firstTimestamp: n.length > 0 ? n[0].timestamp : null,
      lastTimestamp: n.length > 0 ? n[n.length - 1].timestamp : null
    };
    return { messages: n, format: t, errors: r, stats: d };
  }
}
function he(i) {
  return i.timestamp !== void 0 && i.sender !== void 0 && i.content !== void 0 && i.type !== void 0 && i.raw !== void 0 && i.lineNumber !== void 0;
}
function ge(i) {
  return {
    timestamp: i.timestamp,
    sender: i.sender,
    content: i.content.trim(),
    type: Re(i.content.trim(), i.sender),
    raw: i.raw,
    lineNumber: i.lineNumber
  };
}
function Re(i, e) {
  const t = i.trim();
  for (const s of Nt)
    if (s.test(t)) return "media";
  for (const s of ft)
    if (s.test(t)) return "system";
  return !e || e.trim() === "" ? "system" : "text";
}
function yt(i, e, t) {
  let s, n, r;
  if (t.locale === "pt-BR" || t.locale === "pt-PT") {
    const [c, d, E] = i.split("/").map(Number);
    s = c, n = d, r = E;
  } else if (t.locale === "en-US") {
    const [c, d, E] = i.split("/").map(Number);
    n = c, s = d, r = E;
  } else
    [s, n, r] = i.split(/[\/\.\-]/).map(Number);
  r < 100 && (r += r < 70 ? 2e3 : 1900);
  let a, o;
  if (t.timeFormat === "12h") {
    const c = /PM/i.test(e), E = e.replace(/\s*[AP]M/i, "").split(":").map(Number);
    a = E[0], o = E[1], c && a !== 12 && (a += 12), !c && a === 12 && (a = 0);
  } else {
    const c = e.split(":").map(Number);
    a = c[0], o = c[1];
  }
  const l = Date.UTC(r, n - 1, s, a, o) / 1e3;
  if (isNaN(l)) throw new Error(`Invalid timestamp: ${i} ${e}`);
  return l;
}
class wt {
  constructor(e = 7200, t = 400) {
    m(this, "maxGapSeconds");
    m(this, "maxTokens");
    this.maxGapSeconds = e, this.maxTokens = t;
  }
  /**
   * Groups an array of parsed messages into temporal sessions.
   * A new session starts when the gap between two messages exceeds `maxGapSeconds`,
   * or when the estimated token count exceeds `maxTokens` (adaptive chunking).
   * Messages are assumed to be pre-sorted by timestamp ascending.
   */
  group(e) {
    var l, c;
    if (e.length === 0) return [];
    const t = [...e].sort((d, E) => d.timestamp - E.timestamp), s = [];
    let n = [t[0]], r = t[0].timestamp, a = t[0].timestamp, o = Math.ceil((((l = t[0].content) == null ? void 0 : l.length) || 0) / 4);
    for (let d = 1; d < t.length; d++) {
      const E = t[d], p = E.timestamp - a, _ = Math.ceil((((c = E.content) == null ? void 0 : c.length) || 0) / 4);
      p > this.maxGapSeconds || o + _ > this.maxTokens ? (s.push({
        messages: n,
        start_time: r,
        end_time: a,
        message_count: n.length
      }), n = [E], r = E.timestamp, o = _) : (n.push(E), o += _), a = E.timestamp;
    }
    return s.push({
      messages: n,
      start_time: r,
      end_time: a,
      message_count: n.length
    }), s;
  }
}
const P = {
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
}, Dt = ["embedding", "worker", "brain"], w = class w {
  constructor() {
    /** Absolute path to the models directory in Electron's userData */
    m(this, "modelsDir");
    this.modelsDir = I.join(A.getPath("userData"), "models"), re.mkdirSync(this.modelsDir, { recursive: !0 });
  }
  static getInstance() {
    return w.instance || (w.instance = new w()), w.instance;
  }
  /**
   * Checks whether a model file is present locally without triggering a download.
   *
   * resolveModelFile with `download: false` returns the expected local path
   * without checking the network. We then verify the file actually exists on disk.
   */
  async isAvailable(e) {
    try {
      const t = await V(P[e].uri, {
        directory: this.modelsDir,
        download: !1,
        // never trigger a download in a presence check
        cli: !1
      });
      return re.existsSync(t);
    } catch {
      return !1;
    }
  }
  /**
   * Returns the status of all registered models.
   * Runs availability checks in parallel for speed.
   */
  async checkAll() {
    return await Promise.all(
      Dt.map(async (t) => {
        const s = P[t], n = await this.isAvailable(t);
        let r;
        if (n)
          try {
            r = await V(s.uri, {
              directory: this.modelsDir,
              download: !1,
              cli: !1
            });
          } catch {
          }
        return {
          key: t,
          name: s.name,
          quantization: s.quantization,
          sizeEstimate: s.sizeEstimate,
          purpose: s.purpose,
          available: n,
          filePath: r
        };
      })
    );
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
  async download(e, t) {
    const s = P[e];
    console.log(`[ModelManager] Starting download: ${s.name} (${s.uri})`);
    const r = await (await xe({
      modelUri: s.uri,
      dirPath: this.modelsDir,
      showCliProgress: !1,
      onProgress: ({ totalSize: a, downloadedSize: o }) => {
        if (t) {
          const l = a ?? s.sizeEstimate;
          t({
            key: e,
            name: s.name,
            downloadedBytes: o,
            totalBytes: l,
            percent: l > 0 ? Math.round(o / l * 100) : 0,
            speed: 0
            // ipull doesn't expose instantaneous speed in onProgress
          });
        }
      }
    })).download();
    return console.log(`[ModelManager] Download complete: ${s.name} → ${r}`), r;
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
  async resolve(e) {
    const t = P[e];
    return V(t.uri, {
      directory: this.modelsDir,
      download: "auto",
      cli: !1
    });
  }
};
m(w, "instance", null);
let X = w;
const kt = typeof __dirname < "u" ? __dirname : I.dirname(ee(import.meta.url)), D = class D {
  constructor() {
    m(this, "worker", null);
    m(this, "pendingRequests", /* @__PURE__ */ new Map());
    m(this, "initializationPromise", null);
    m(this, "ready", !1);
    // Basic Batch Queue (Will be expanded in 3.4)
    m(this, "batchQueue", []);
    m(this, "processingQueue", !1);
    m(this, "currentModelKey", "worker");
  }
  static getInstance() {
    return D.instance || (D.instance = new D()), D.instance;
  }
  async initialize() {
    if (!this.ready) {
      if (this.initializationPromise) return this.initializationPromise;
      this.initializationPromise = new Promise(async (e, t) => {
        try {
          await this.startWorker("worker"), this.ready = !0, e();
        } catch (s) {
          console.warn("[WorkerProcess] Primary worker failed. Triggering fallback... Error:", s);
          try {
            await this.startWorker("worker_fallback"), this.currentModelKey = "worker_fallback", console.log("[WorkerProcess] Fallback to " + P.worker_fallback.name + " succeeded."), this.ready = !0, e();
          } catch (n) {
            console.error("[WorkerProcess] Fallback also failed:", n), this.initializationPromise = null, t(n);
          }
        }
      });
      try {
        await this.initializationPromise;
      } finally {
        this.initializationPromise = null;
      }
    }
  }
  startWorker(e) {
    return new Promise(async (t, s) => {
      console.log(`[WorkerProcess] Resolving model path for: ${e}...`);
      const n = await X.getInstance().resolve(e);
      console.log(`[WorkerProcess] Forking Utility Process for ${e}...`);
      const r = I.join(kt, "worker-worker.js");
      this.worker = fe.fork(r, [], {
        stdio: "inherit"
      }), this.worker.on("message", (o) => this.handleWorkerMessage(o)), this.worker.on("exit", (o) => {
        console.warn(`[WorkerProcess] Utility process exited with code ${o}`), this.ready = !1, this.worker = null, this.rejectAllPending(new Error(`Worker exited unexpectedly with code ${o}`));
      });
      const a = f();
      this.pendingRequests.set(a, {
        resolve: async () => {
          console.log("[WorkerProcess] Initialized successfully. Running Day-0 test...");
          try {
            await this.internalGenerate("test", { maxTokens: 5 }), t();
          } catch (o) {
            this.dispose(), s(o);
          }
        },
        reject: s
      }), this.worker.postMessage({
        type: "init",
        id: a,
        payload: { modelPath: n }
      });
    });
  }
  isReady() {
    return this.ready;
  }
  getFallbackStatus() {
    return this.currentModelKey === "worker_fallback";
  }
  async generate(e, t) {
    return this.generateStream(e, () => {
    }, t);
  }
  // Queue wrapper
  async generateStream(e, t, s) {
    return (!this.ready || !this.worker) && await this.initialize(), new Promise((n, r) => {
      this.batchQueue.push({ prompt: e, options: s, resolve: n, reject: r, onToken: t }), this.processNextInQueue();
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
  async generateJson(e, t, s = 3) {
    let n = null, r = e;
    for (let a = 1; a <= s; a++)
      try {
        const o = await this.generate(r, t);
        return this.extractJson(o);
      } catch (o) {
        n = o, console.warn(`[WorkerProcess] JSON extraction failed (attempt ${a}/${s}):`, o.message), r = e + `

[SYSTEM FEEDBACK: Your previous response failed JSON parsing with error: ${o.message}. Please return strictly valid JSON without conversational wrapper text.]`;
      }
    throw new Error(`[WorkerProcess] Failed to generate valid JSON after ${s} attempts. Last error: ${n == null ? void 0 : n.message}`);
  }
  /**
   * Helper to strip markdown (e.g. \`\`\`json) and aggressively find the { ... } boundaries.
   */
  extractJson(e) {
    try {
      return JSON.parse(e);
    } catch {
    }
    let t = e.replace(/^```json/im, "").replace(/```$/im, "").trim();
    const s = t.match(/\{.*\}/s) || t.match(/\[.*\]/s);
    if (!s)
      throw new Error("No JSON boundaries ({...} or [...]) found in response");
    return JSON.parse(s[0]);
  }
  async classifyQuery(e) {
    const t = `You are a strict JSON classification tool. You analyze Portuguese queries to search chat logs.
Output ONLY raw JSON.

Intent rules:
- "factual": Specific messages, facts, quotes (e.g. "senha do wifi", "onde vc mandou o link")
- "aggregation": Counts, metrics, rankings (e.g. "quantas vezes", "mais citados", "top assuntos")
- "narrative": Summaries of periods (e.g. "o que rolou ontem", "resuma a briga")

Your task:
1. Identify "intent".
2. Extract ONLY the core topical nouns/entities from the query as "keywords". Exclude ALL conversational stop-words (e.g. "citados", "conversa", "vezes", "falaram", "sobre", "quais", "mais", "aqui"). 
3. *CRITICAL RULE*: If the user asks for a general timeline, summary without a specific topic, or what happened "recently" / "last week" / "yesterday" (e.g. "o que rolou ontem", "o que foi conversado na semana passada", "resumo"), set intent to "narrative" and keywords MUST be exactly ["#RECENT#"]. Do NOT extract "semana" or "passada" as keywords!

Examples:
Query: "quais jogos mais citados na conversa"
{"intent": "aggregation", "keywords": ["jogos"], "dateRange": {"start": null, "end": null}}

Query: "o que falaram sobre o projeto delta ontem?"
{"intent": "narrative", "keywords": ["projeto", "delta"], "dateRange": {"start": "ontem", "end": "ontem"}}

Query: "o que rolou na semana passada?"
{"intent": "narrative", "keywords": ["#RECENT#"], "dateRange": {"start": "semana passada", "end": "semana passada"}}

Query: "qual a senha do wifi"
{"intent": "factual", "keywords": ["senha", "wifi"], "dateRange": {"start": null, "end": null}}

Query: "${e}"
`, s = {
      temperature: 0.05,
      maxTokens: 150,
      systemPrompt: "You are a headless JSON API. Respond only with valid JSON. Never output conversational text."
    }, n = await this.generateJson(t, s, 3);
    return ["factual", "aggregation", "narrative", "unknown"].includes(n.intent) || (n.intent = "factual"), (!n.keywords || !Array.isArray(n.keywords)) && (n.keywords = []), n;
  }
  async expandKeywords(e) {
    const t = `You are a linguistic expansion tool for Portuguese chat logs. Output ONLY raw JSON.
Expand the keywords with exactly 3 common pt-BR synonyms, internet slang, or abbreviations. 
Crucially: If a keyword is a Category/Class (like "jogos", "pessoas", "lugares", "topicos"), you MUST include its direct English translation (e.g. "game", "person", "place", "topic") so it matches our system's internal database classification schema.

Examples:
Keywords: ["jogos"]
{"expanded": ["game", "videogame", "play"]}

Keywords: ["pessoas"]
{"expanded": ["person", "alguém", "galera"]}

Keywords: ["risada", "engraçado"]
{"expanded": ["kkk", "haha", "rsrs"]}

Keywords: ${JSON.stringify(e)}
`, s = {
      temperature: 0.3,
      maxTokens: 100,
      systemPrompt: 'You are a headless JSON API. You MUST respond with exactly this JSON schema: {"expanded": ["str", "str"]}'
    };
    try {
      const n = await this.generateJson(t, s, 2);
      if (n.expanded && Array.isArray(n.expanded))
        return Array.from(/* @__PURE__ */ new Set([...e, ...n.expanded]));
    } catch (n) {
      console.warn("[WorkerProcess] Failed to expand keywords", n);
    }
    return e;
  }
  async extractSessionEntities(e) {
    const t = `You are a strict JSON extraction tool. Analyze this chat session and extract third-party mentions.
Output ONLY raw JSON. Do not output markdown, explanations, or conversational text.

Rules:
1. "summary": A 1-sentence summary of what happened in the session.
2. "mentioned_entities": An array of entities (people, organizations) mentioned.
   - Ignore generic nouns or brands unless they are the primary subject.
   - "name": The extracted name.
   - "type": "person" | "organization" | "other"
   - "context": EXACT words or a very close paraphrase of what was said about them in the chat.
   - "sentiment": "positive" | "negative" | "neutral"
   - "is_participant": true if this person is one of the chat participants, false if it's a third-party mention.

Schema:
{
  "summary": "str",
  "mentioned_entities": [
    { "name": "str", "type": "str", "context": "str", "sentiment": "str", "is_participant": boolean }
  ]
}

Session Text:
${e}
`, s = {
      temperature: 0.1,
      maxTokens: 500,
      systemPrompt: "You are a headless JSON API. You MUST respond with valid JSON matching the exact schema."
    }, n = Date.now();
    try {
      const r = await this.generateJson(t, s, 3), a = Date.now() - n;
      return console.log(`[WorkerProcess] extractSessionEntities completed in ${a}ms`), {
        summary: r.summary || "Sessão extraída",
        mentioned_entities: Array.isArray(r.mentioned_entities) ? r.mentioned_entities : []
      };
    } catch (r) {
      const a = Date.now() - n;
      return console.error(`[WorkerProcess] extractSessionEntities completely failed after ${a}ms:`, r.message), {
        summary: "Sessão extraída via fallback de erro",
        mentioned_entities: []
      };
    }
  }
  async processNextInQueue() {
    if (this.processingQueue || this.batchQueue.length === 0) return;
    this.processingQueue = !0;
    const e = this.batchQueue.shift();
    try {
      const t = await this.internalGenerateStream(e.prompt, e.onToken || (() => {
      }), e.options);
      e.resolve(t);
    } catch (t) {
      e.reject(t);
    } finally {
      this.processingQueue = !1, this.processNextInQueue();
    }
  }
  async internalGenerate(e, t) {
    return this.internalGenerateStream(e, () => {
    }, t);
  }
  async internalGenerateStream(e, t, s) {
    return new Promise((n, r) => {
      const a = f();
      this.pendingRequests.set(a, { resolve: n, reject: r, onToken: t }), this.worker.postMessage({
        type: "generate",
        id: a,
        payload: { prompt: e, options: s }
      });
    });
  }
  getModelInfo() {
    return {
      modelName: P[this.currentModelKey].name,
      parameters: this.currentModelKey === "worker" ? "350M" : "270M"
    };
  }
  async dispose() {
    this.worker && (console.log("[WorkerProcess] Disposing worker..."), this.worker.postMessage({ type: "dispose" }), await new Promise((e) => {
      const t = setTimeout(() => {
        this.worker && this.worker.kill(), e();
      }, 2e3);
      this.worker.once("exit", () => {
        clearTimeout(t), e();
      });
    }), this.worker = null, this.ready = !1, this.rejectAllPending(new Error("WorkerProcess is disposing or shutting down")), this.initializationPromise = null);
  }
  handleWorkerMessage(e) {
    const { type: t, id: s, error: n, token: r, text: a } = e;
    if (!s || !this.pendingRequests.has(s)) {
      t === "error" && console.error("[Worker Global Error]", n);
      return;
    }
    const { resolve: o, reject: l, onToken: c } = this.pendingRequests.get(s);
    switch (t) {
      case "init-ready":
        this.pendingRequests.delete(s), o();
        break;
      case "token":
        c && r && c(r);
        break;
      case "done":
        this.pendingRequests.delete(s), o(a);
        break;
      case "error":
        this.pendingRequests.delete(s), l(new Error(n));
        break;
      default:
        console.warn(`[WorkerProcess] Unrecognized message type '${t}'`);
    }
  }
  rejectAllPending(e) {
    for (const [t, s] of this.pendingRequests.entries())
      s.reject(e), this.pendingRequests.delete(t);
  }
};
m(D, "instance", null);
let v = D;
const Le = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  WorkerProcess: v
}, Symbol.toStringTag, { value: "Module" })), k = class k {
  constructor() {
    m(this, "queue", []);
  }
  static getInstance() {
    return k.instance || (k.instance = new k()), k.instance;
  }
  addMention(e, t, s) {
    const n = {
      id: f(),
      sessionId: e,
      alias: t,
      context: s,
      timestamp: Date.now()
    };
    return this.queue.push(n), n;
  }
  getPending() {
    return [...this.queue];
  }
  getMentionById(e) {
    return this.queue.find((t) => t.id === e);
  }
  removeMention(e) {
    this.queue = this.queue.filter((t) => t.id !== e);
  }
  /**
   * If there are clones (same alias) of an approved/resolved mention, we can auto-resolve them too.
   * This method extracts all clones from the queue so they can be processed by the caller.
   */
  extractClones(e) {
    const t = e.trim().toLowerCase(), s = this.queue.filter((n) => n.alias.trim().toLowerCase() === t);
    return this.queue = this.queue.filter((n) => n.alias.trim().toLowerCase() !== t), s;
  }
  clear() {
    this.queue = [];
  }
};
m(k, "instance");
let q = k;
class Ct {
  constructor() {
    m(this, "parser", new At());
    m(this, "sessionEngine", new wt(7200));
  }
  // > 2h gap
  async import(e, t) {
    const s = (r) => {
      t == null || t.send("import:progress", r);
    };
    let n;
    try {
      s({ stage: "reading", percent: 5, label: "Lendo arquivo", detail: "Calculando hash..." });
      const r = await Ft(e), a = N.getInstance(), o = new B(a);
      if (o.existsByHash(r))
        return { success: !1, duplicate: !0, error: "Arquivo já importado." };
      const l = Ce(e).replace(/\.[^/.]+$/, "");
      n = f(), s({ stage: "parsing", percent: 15, label: "Parseando mensagens", detail: "Lendo chat base..." });
      const c = await this.parser.parse(e);
      if (c.messages.length === 0)
        return { success: !1, error: "Nenhuma mensagem encontrada." };
      const d = c.messages.map((h) => ({
        id: f(),
        chat_id: n,
        sender: h.sender,
        content: h.content,
        timestamp: h.timestamp,
        type: h.type,
        raw: h.raw
      }));
      o.create({
        id: n,
        name: l,
        source: "whatsapp",
        file_hash: r,
        participant_count: c.stats.participants.length,
        message_count: c.messages.length,
        first_message_at: c.stats.firstTimestamp ?? void 0,
        last_message_at: c.stats.lastTimestamp ?? void 0
      }), s({ stage: "fts_indexing", percent: 25, label: "Agrupando Sessões", detail: "Topologia Cronológica..." });
      const E = this.sessionEngine.group(c.messages), p = [];
      for (const h of E)
        p.push({
          id: f(),
          chat_id: n,
          start_time: h.start_time,
          end_time: h.end_time,
          message_count: h.message_count,
          summary: "Processando IA em background..."
          // Temporary summary
        });
      return s({ stage: "fts_indexing", percent: 40, label: "Salvando no banco", detail: "Persistindo histórico nativo e Indexando FTS5..." }), new se(a).insertBatch(d), new z(a).insertBatch(p, []), this.runBackgroundNLP(n, E, p, t).catch((h) => {
        console.error("[Background NLP Error]", h);
      }), {
        success: !0,
        chatId: n,
        chatName: l,
        messageCount: c.messages.length,
        chunkCount: p.length
        // total sessions
      };
    } catch (r) {
      if (n)
        try {
          const o = N.getInstance();
          new B(o).delete(n);
        } catch {
        }
      const a = r instanceof Error ? r.message : String(r);
      return console.error("[ChatImportService] Import failed:", a), s({ stage: "error", percent: 0, label: "Erro na importação", detail: a }), { success: !1, error: a };
    }
  }
  /**
   * Background process to extract summaries and entities via Worker
   */
  async runBackgroundNLP(e, t, s, n) {
    const r = (a) => {
      n == null || n.send("import:progress", a);
    };
    try {
      r({ stage: "nlp_summaries", percent: 20, label: "Extração NLP Iniciada", detail: `Processando ${t.length} sessões...`, chatId: e });
      const a = v.getInstance();
      await a.initialize();
      const o = N.getInstance(), l = new z(o);
      let c = 0;
      for (let d = 0; d < t.length; d++) {
        const E = t[d], p = s[d], _ = E.messages.map((u) => `[${new Date(u.timestamp * 1e3).toISOString()}] ${u.sender}: ${u.content}`).join(`
`);
        let S = "Sessão concluída (sem detalhes extraídos)", h = [];
        try {
          const u = await a.extractSessionEntities(_);
          u.summary && (S = u.summary), u.mentioned_entities && (h = u.mentioned_entities);
        } catch (u) {
          console.warn("[ChatImportService Worker] Worker extraction failed on session:", u.message);
        }
        const L = [], O = new Y(o), M = q.getInstance();
        for (const u of h)
          if (u.name && (L.push({
            id: f(),
            session_id: p.id,
            name: u.name,
            normalized_name: u.name.toLowerCase().trim(),
            type: u.type || "unknown",
            action: u.context || "mentioned"
          }), !u.is_participant && u.type === "person")) {
            const ie = O.findProbableMatch(u.name).find((H) => H.name.toLowerCase() === u.name.toLowerCase());
            if (ie)
              O.linkMention(p.id, ie.id, u.context);
            else {
              const H = M.addMention(p.id, u.name, u.context);
              n == null || n.send("ingest:mention_detected", H);
            }
          }
        l.updateSessionNLP(p.id, S, L), c++;
        const ne = c > t.length * 0.7;
        (c % 5 === 0 || c === t.length) && r({
          stage: ne ? "nlp_entities" : "nlp_summaries",
          percent: 20 + Math.round(c / t.length * 80),
          label: ne ? "Resolvendo Entidades" : "Processando Resumos (Batch)",
          detail: `${c} / ${t.length} sessões analisadas...`,
          chatId: e
          // Note: sending chatId along to identify bg process per chat
        });
      }
      r({ stage: "done", percent: 100, label: "Concluído", detail: "Entidades Indexadas para o chat.", chatId: e });
    } catch (a) {
      console.error("[Background NLP Exception]", a);
    }
  }
}
function Ft(i) {
  return new Promise((e, t) => {
    const s = Ue("sha256"), n = te(i);
    n.on("data", (r) => s.update(r)), n.on("end", () => e(s.digest("hex"))), n.on("error", t);
  });
}
const Ut = new Ct();
function xt(i) {
  g.handle("import:chat", async (e, t) => Ut.import(t, i.webContents)), g.handle("import:file-dialog", async () => {
    const e = await Ne.showOpenDialog(i, {
      title: "Selecionar export do WhatsApp",
      filters: [
        { name: "WhatsApp Export", extensions: ["txt", "zip"] },
        { name: "Todos os arquivos", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
  });
}
function Pt(i) {
  const e = X.getInstance();
  g.handle("models:check", async () => e.checkAll()), g.handle("models:download", async (t, s) => e.download(s, (n) => {
    i.isDestroyed() || i.webContents.send("models:progress", n);
  })), g.handle("models:select-file", async () => {
    const t = await Ne.showOpenDialog(i, {
      title: "Selecionar Modelo GGUF (BYOM)",
      filters: [
        { name: "GGUF Models", extensions: ["gguf"] },
        { name: "Todos os arquivos", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    return t.canceled || t.filePaths.length === 0 ? null : t.filePaths[0];
  });
}
const C = class C {
  constructor() {
    m(this, "chatRepo");
    m(this, "sessionRepo");
    m(this, "messageRepo");
    const e = N.getInstance();
    this.chatRepo = new B(e), this.sessionRepo = new z(e), this.messageRepo = new se(e);
  }
  static getInstance() {
    return C.instance || (C.instance = new C()), C.instance;
  }
  async search(e, t) {
    console.log(`[SearchService] Resolving deterministic search for: "${e}"`);
    const s = v.getInstance(), n = await s.classifyQuery(e);
    console.log(`[SearchService] Intent: ${n.intent} | Keywords: ${n.keywords.join(", ")}`);
    const r = n.intent, a = n.keywords && n.keywords.length > 0 ? n.keywords : [e], o = {
      dateFrom: t == null ? void 0 : t.dateFrom,
      dateTo: t == null ? void 0 : t.dateTo
    };
    console.log("[SearchService] Executing Ontology Hop (Entity Expansion)...");
    const l = await s.expandKeywords(a), c = Array.from(/* @__PURE__ */ new Set([...a, ...l])), E = this.sessionRepo.searchAggregation(c, 8, o).map((S) => S.name);
    E.length > 0 && console.log(`[SearchService] Ontology hop discovered relevant context entities: ${E.join(", ")}`);
    const p = Array.from(/* @__PURE__ */ new Set([...c, ...E]));
    let _ = this.performRouting(r, p, o);
    return _.length === 0 && console.warn("[SearchService] Data inexistent even after lexical and ontological expansions."), _;
  }
  performRouting(e, t, s) {
    const n = [];
    if (e === "aggregation") {
      const r = this.sessionRepo.searchAggregation(t, 20, s);
      if (r.length > 0) {
        let a = `Aggregation Results:
`;
        for (const o of r)
          a += `- Entity: ${o.name} (${o.type}) | Count: ${o.count}
`;
        n.push({
          id: f(),
          chatId: "",
          chatName: "Global Aggregations",
          score: 1,
          content: a,
          date: (/* @__PURE__ */ new Date()).toISOString(),
          sender: "System",
          intent: "aggregation",
          metadata: { items: r }
        });
      }
    } else if (e === "narrative") {
      const r = this.sessionRepo.searchNarrative(t, 5, s);
      for (const a of r) {
        const o = this.chatRepo.findById(a.chat_id);
        n.push({
          id: a.id,
          chatId: a.chat_id,
          chatName: (o == null ? void 0 : o.name) || "Unknown Chat",
          score: 0.9,
          content: `SESSION SUMMARY
${a.summary}`,
          date: new Date(a.start_time * 1e3).toISOString(),
          sender: "System",
          intent: "narrative"
        });
      }
    } else {
      const r = this.messageRepo.searchFactual(t, 15, 5);
      for (const a of r) {
        if (a.length === 0) continue;
        const o = this.chatRepo.findById(a[0].chat_id);
        let l = "";
        for (const c of a) {
          const E = new Date(c.timestamp * 1e3).toISOString().split("T")[1].slice(0, 5);
          l += `[${E}] ${c.sender}: ${c.content}
`;
        }
        n.push({
          id: f(),
          chatId: a[0].chat_id,
          chatName: (o == null ? void 0 : o.name) || "Unknown Chat",
          score: 1,
          content: l.trim(),
          date: new Date(a[0].timestamp * 1e3).toISOString(),
          sender: a[0].sender,
          intent: "factual"
        });
      }
    }
    return n;
  }
};
m(C, "instance", null);
let $ = C;
function Mt() {
  g.handle("search:query", async (i, e, t) => {
    try {
      return await $.getInstance().search(e, t);
    } catch (s) {
      return console.error("[SearchHandlers] Error executing search:", s), [];
    }
  });
}
const bt = typeof __dirname < "u" ? __dirname : I.dirname(ee(import.meta.url)), F = class F {
  constructor() {
    m(this, "worker", null);
    m(this, "pendingRequests", /* @__PURE__ */ new Map());
    m(this, "initializationPromise", null);
    m(this, "ready", !1);
  }
  static getInstance() {
    return F.instance || (F.instance = new F()), F.instance;
  }
  async initialize() {
    if (!this.ready) {
      if (this.initializationPromise) return this.initializationPromise;
      this.initializationPromise = new Promise(async (e, t) => {
        try {
          console.log("[BrainProcess] Resolving Brain model path...");
          const s = await X.getInstance().resolve("brain");
          console.log("[BrainProcess] Forking Utility Process...");
          const n = I.join(bt, "brain-worker.js");
          this.worker = fe.fork(n, [], {
            stdio: "inherit"
          }), this.worker.on("message", (a) => this.handleWorkerMessage(a)), this.worker.on("exit", (a) => {
            console.warn(`[BrainProcess] Utility process exited with code ${a}`), this.ready = !1, this.worker = null, this.rejectAllPending(new Error(`Brain Worker exited unexpectedly with code ${a}`));
          });
          const r = f();
          this.pendingRequests.set(r, {
            resolve: () => {
              console.log("[BrainProcess] Utility Process initialized successfully."), this.ready = !0, e();
            },
            reject: t
          }), this.worker.postMessage({
            type: "init",
            id: r,
            payload: { modelPath: s }
          });
        } catch (s) {
          console.error("[BrainProcess] Failed to initialize:", s), this.initializationPromise = null, t(s);
        }
      });
      try {
        await this.initializationPromise;
      } finally {
        this.initializationPromise = null;
      }
    }
  }
  isReady() {
    return this.ready;
  }
  async generate(e, t) {
    return this.generateStream(e, () => {
    }, t);
  }
  async generateStream(e, t, s) {
    return (!this.ready || !this.worker) && await this.initialize(), new Promise((n, r) => {
      const a = f();
      this.pendingRequests.set(a, { resolve: n, reject: r, onToken: t }), this.worker.postMessage({
        type: "generate",
        id: a,
        payload: { prompt: e, options: s }
      });
    });
  }
  getModelInfo() {
    return {
      modelName: P.brain.name,
      parameters: "4B"
    };
  }
  async dispose() {
    this.worker && (console.log("[BrainProcess] Disposing worker..."), this.worker.postMessage({ type: "dispose" }), await new Promise((e) => {
      const t = setTimeout(() => {
        this.worker && this.worker.kill(), e();
      }, 2e3);
      this.worker.once("exit", () => {
        clearTimeout(t), e();
      });
    }), this.worker = null, this.ready = !1, this.rejectAllPending(new Error("BrainProcess is disposing or shutting down")), this.initializationPromise = null);
  }
  handleWorkerMessage(e) {
    const { type: t, id: s, error: n, token: r, text: a } = e;
    if (!s || !this.pendingRequests.has(s)) {
      t === "error" && console.error("[BrainWorker Global Error]", n);
      return;
    }
    const { resolve: o, reject: l, onToken: c } = this.pendingRequests.get(s);
    switch (t) {
      case "init-ready":
        this.pendingRequests.delete(s), o();
        break;
      case "token":
        c && r && c(r);
        break;
      case "done":
        this.pendingRequests.delete(s), o(a);
        break;
      case "error":
        this.pendingRequests.delete(s), l(new Error(n));
        break;
      default:
        console.warn(`[BrainWorker] Unrecognized message type '${t}'`);
    }
  }
  rejectAllPending(e) {
    for (const [t, s] of this.pendingRequests.entries())
      s.reject(e), this.pendingRequests.delete(t);
  }
};
m(F, "instance", null);
let W = F;
const Oe = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BrainProcess: W
}, Symbol.toStringTag, { value: "Module" })), Bt = {
  buildRAGPrompt: (i, e) => {
    const t = e.map((a) => `[${a.date} - ${a.sender}]: ${a.content}`).join(`

`);
    let s = "";
    if (e.length > 0) {
      const a = e.map((o) => new Date(o.date).getTime()).filter((o) => !isNaN(o));
      if (a.length > 0) {
        const o = new Date(Math.min(...a)).toISOString().split("T")[0], l = new Date(Math.max(...a)).toISOString().split("T")[0];
        s = `
Regra OBRIGATÓRIA: Baseie-se EXATAMENTE nas datas providenciadas no prompt (de ${o} a ${l}). Nunca alucine datas ou informações fora desse intervalo.`;
      }
    }
    const n = `Você é um assistente cirúrgico que extrai informações de dados históricos. Baseie sua resposta APENAS no contexto fornecido.${s}`, r = `DADOS E CONTEXTO OBTIDOS (Fontes imutáveis):
${t}

PERGUNTA DO USUÁRIO: ${i}

Responda EXATAMENTE o que foi perguntado, formatando de maneira limpa. Se a resposta não estiver nos dados, declare tratar-se de "dados inexistentes".`;
    return { systemPrompt: n, userPrompt: r };
  }
}, Q = {
  gpu: "auto",
  temperature: 0.3,
  systemPrompt: "Você é um assistente encarregado de ler históricos de chat. Responda apenas com o que estiver no contexto.",
  topK: 15,
  history: !0,
  analytics: !1,
  customBrainPath: null,
  customWorkerPath: null,
  customEmbeddingPath: null
}, U = class U {
  constructor() {
    m(this, "settingsPath");
    m(this, "currentSettings");
    const e = A.getPath("userData");
    this.settingsPath = Pe.join(e, "settings.json"), this.currentSettings = { ...Q }, this.load();
  }
  static getInstance() {
    return U.instance || (U.instance = new U()), U.instance;
  }
  get() {
    return { ...this.currentSettings };
  }
  update(e) {
    const t = e.gpu !== void 0 && e.gpu !== this.currentSettings.gpu, s = "customBrainPath" in e && e.customBrainPath !== this.currentSettings.customBrainPath, n = "customWorkerPath" in e && e.customWorkerPath !== this.currentSettings.customWorkerPath;
    return this.currentSettings = {
      ...this.currentSettings,
      ...e
    }, this.save(), (t || s || n) && setTimeout(async () => {
      console.log("[SettingsService] Critical backend setting changed. Disposing active models for cold-restart.");
      const { WorkerProcess: r } = await Promise.resolve().then(() => Le), { BrainProcess: a } = await Promise.resolve().then(() => Oe);
      try {
        r.getInstance().dispose();
      } catch {
      }
      try {
        a.getInstance().dispose();
      } catch {
      }
    }, 0), this.get();
  }
  load() {
    try {
      if (j.existsSync(this.settingsPath)) {
        const e = j.readFileSync(this.settingsPath, "utf-8"), t = JSON.parse(e);
        this.currentSettings = {
          ...Q,
          ...t
        };
      } else
        this.save();
    } catch (e) {
      console.error("[SettingsService] Failed to load settings:", e), this.currentSettings = { ...Q };
    }
  }
  save() {
    try {
      j.writeFileSync(this.settingsPath, JSON.stringify(this.currentSettings, null, 2));
    } catch (e) {
      console.error("[SettingsService] Failed to save settings:", e);
    }
  }
};
m(U, "instance");
let G = U;
const x = class x {
  constructor() {
  }
  static getInstance() {
    return x.instance || (x.instance = new x()), x.instance;
  }
  async generateStream(e, t, s, n) {
    const r = performance.now(), a = { embedding: 0, search: 0, generation: 0, total: 0 };
    let o = [];
    try {
      n && n("booting");
      const l = G.getInstance().get();
      n && n("searching");
      const c = performance.now();
      if (o = await $.getInstance().search(e, {
        limit: l.topK,
        chatId: s == null ? void 0 : s.chatId
      }), a.search = performance.now() - c, o.length === 0)
        return a.total = performance.now() - r, {
          answer: "Dados inexistentes. Não foi possível localizar o contexto ou menções referentes à sua busca neste chat.",
          context: o,
          tokensUsed: 0,
          latency: a
        };
      n && n("processing");
      const { userPrompt: d } = Bt.buildRAGPrompt(e, o), E = l.systemPrompt;
      n && n("synthesizing");
      const p = performance.now(), _ = W.getInstance();
      let S = "", h = 0;
      try {
        S = await _.generateStream(
          d,
          (L) => {
            h++, t && t(L);
          },
          {
            temperature: (s == null ? void 0 : s.temperature) ?? l.temperature,
            maxTokens: (s == null ? void 0 : s.maxTokens) || 1024,
            systemPrompt: E
          }
        );
      } catch (L) {
        console.error("[RAGService] Error generating response from BrainProcess:", L), S = `Desculpe, ocorreu um erro ao gerar a resposta ou a IA falhou.

Contexto encontrado:` + o.map((O, M) => `
[${M + 1}] ${O.date} ${O.sender}: ${O.content}`).join("");
      }
      return a.generation = performance.now() - p, a.total = performance.now() - r, {
        answer: S,
        context: o,
        tokensUsed: h,
        latency: a
      };
    } catch (l) {
      throw console.error("[RAGService] Fatal error in RAG pipeline:", l), l;
    }
  }
};
m(x, "instance", null);
let J = x;
function Xt(i) {
  g.handle("rag:query", async (e, t, s) => {
    try {
      const r = await J.getInstance().generateStream(
        t,
        (a) => {
          i.webContents.send("rag:token", a);
        },
        s,
        (a) => {
          i.webContents.send("rag:step", a);
        }
      );
      i.webContents.send("rag:done", r);
    } catch (n) {
      throw console.error("[IPC rag:query] Error:", n), n;
    }
  }), g.handle("rag:status", async () => {
    const { BrainProcess: e } = await Promise.resolve().then(() => Oe), { WorkerProcess: t } = await Promise.resolve().then(() => Le);
    return {
      brain: {
        ready: e.getInstance().isReady()
      },
      worker: {
        ready: t.getInstance().isReady(),
        fallback: t.getInstance().getFallbackStatus()
      }
    };
  });
}
function vt() {
  g.handle("settings:get", async () => G.getInstance().get()), g.handle("settings:update", async (i, e) => G.getInstance().update(e));
}
const _e = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899"
];
function Gt() {
  return _e[Math.floor(Math.random() * _e.length)];
}
function Yt() {
  const i = q.getInstance();
  g.handle("mentions:get_pending", async () => i.getPending()), g.handle("mentions:get_people", async () => {
    const e = N.getInstance();
    return new Y(e).findAll();
  }), g.handle("mentions:get_relations", async () => {
    const e = N.getInstance();
    return new Y(e).findAllRelations();
  }), g.handle("mentions:resolve", async (e, t, s, n) => {
    const r = i.getMentionById(t);
    if (!r)
      throw new Error(`Mention ${t} not found in pending inbox.`);
    const a = N.getInstance(), o = new Y(a), l = i.extractClones(r.alias), c = [r, ...l.filter((d) => d.id !== r.id)];
    try {
      if (s === "create_new") {
        const d = o.createPersonWithAlias(r.alias, r.alias, Gt());
        for (const E of c)
          o.linkMention(E.sessionId, d, E.context);
      } else if (s === "link_existing") {
        if (!n) throw new Error("personId required for link_existing");
        a.prepare("INSERT OR IGNORE INTO person_aliases (person_id, alias) VALUES (?, ?)").run(n, r.alias);
        for (const d of c)
          o.linkMention(d.sessionId, n, d.context);
      }
      i.removeMention(t);
    } catch (d) {
      throw console.error("[PeopleHandlers] Failed to resolve mention:", d), d;
    }
  });
}
function zt(i) {
  ut(), xt(i), Pt(i), Mt(), Xt(i), vt(), Yt();
}
const Ae = I.dirname(ee(import.meta.url));
process.env.APP_ROOT = I.join(Ae, "..");
const Z = process.env.VITE_DEV_SERVER_URL, ss = I.join(process.env.APP_ROOT, "dist-electron"), ye = I.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Z ? I.join(process.env.APP_ROOT, "public") : ye;
let T;
function we() {
  T = new Ie({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: !1,
    // Custom titlebar
    titleBarStyle: "hidden",
    backgroundColor: "#080b0d",
    show: !1,
    // Prevent white flash
    webPreferences: {
      preload: I.join(Ae, "preload.mjs"),
      contextIsolation: !0,
      nodeIntegration: !1
    }
  }), T.once("ready-to-show", () => {
    T == null || T.show();
  }), g.on("window:minimize", () => T == null ? void 0 : T.minimize()), g.on("window:maximize", () => {
    T != null && T.isMaximized() ? T.unmaximize() : T == null || T.maximize();
  }), g.on("window:close", () => T == null ? void 0 : T.close()), zt(T), Z ? (T.loadURL(Z), T.webContents.openDevTools({ mode: "detach" })) : T.loadFile(I.join(ye, "index.html"));
}
A.on("window-all-closed", () => {
  process.platform !== "darwin" && (A.quit(), T = null);
});
A.on("activate", () => {
  Ie.getAllWindows().length === 0 && we();
});
A.on("before-quit", () => {
  N.close();
});
A.whenReady().then(() => {
  try {
    N.getInstance();
  } catch (i) {
    console.error("[Main] Failed to initialize database:", i);
  }
  we();
});
export {
  ss as MAIN_DIST,
  ye as RENDERER_DIST,
  Z as VITE_DEV_SERVER_URL
};
