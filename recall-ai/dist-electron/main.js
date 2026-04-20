var Se = Object.defineProperty;
var Ie = (n, e, t) => e in n ? Se(n, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : n[e] = t;
var E = (n, e, t) => Ie(n, typeof e != "symbol" ? e + "" : e, t);
import { app as O, ipcMain as f, utilityProcess as me, dialog as Ee, BrowserWindow as ue } from "electron";
import { fileURLToPath as Q } from "node:url";
import N, { basename as Re } from "node:path";
import ye from "better-sqlite3";
import { webcrypto as Z, createHash as Le } from "node:crypto";
import ee, { createReadStream as K } from "node:fs";
import { createInterface as pe } from "node:readline";
import { resolveModelFile as $, createModelDownloader as Oe } from "node-llama-cpp";
import W from "fs";
import Ae from "path";
const te = "001_initial", we = `
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
`, De = `
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
`, ke = `
  -- FTS5 table only (when sqlite-vec not available)
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    chunk_id UNINDEXED,
    tokenize='unicode61'
  );
`, Fe = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`;
function Ue(n) {
  if (n.exec(Fe), n.prepare(
    "SELECT id FROM _migrations WHERE id = ?"
  ).get(te)) {
    console.log("[DB] Migration 001_initial already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 001_initial..."), n.transaction(() => {
    n.exec(we), Ce(n) ? (console.log("[DB] sqlite-vec detected — creating vectors + chunks_fts tables"), n.exec(De)) : (console.log("[DB] sqlite-vec not detected — creating chunks_fts only"), n.exec(ke)), n.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(te);
  })(), console.log("[DB] Migration 001_initial complete");
}
function Ce(n) {
  try {
    return n.prepare("SELECT vec_version()").get(), !0;
  } catch {
    return !1;
  }
}
const se = "002_add_profile_facts", xe = `
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
`, Pe = `
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
`, Me = `
  -- SQLite-vec table for semantic search on profile_facts
  -- Use vec0 for dynamic loading
  CREATE VIRTUAL TABLE IF NOT EXISTS profile_facts_vectors USING vec0(
    fact_id TEXT PRIMARY KEY,
    embedding FLOAT[768]
  );
`;
function be(n) {
  if (n.prepare(
    "SELECT id FROM _migrations WHERE id = ?"
  ).get(se)) {
    console.log("[DB] Migration 002_add_profile_facts already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 002_add_profile_facts..."), n.transaction(() => {
    n.exec(xe), n.exec(Pe), ve(n) && (console.log("[DB] sqlite-vec detected — creating profile_facts_vectors table"), n.exec(Me)), n.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(se);
  })(), console.log("[DB] Migration 002_add_profile_facts complete");
}
function ve(n) {
  try {
    return n.prepare("SELECT vec_version()").get(), !0;
  } catch {
    return !1;
  }
}
const ne = "003_add_contact_profiles", Be = `
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
function Xe(n) {
  if (n.prepare(
    "SELECT id FROM _migrations WHERE id = ?"
  ).get(ne)) {
    console.log("[DB] Migration 003_add_contact_profiles already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 003_add_contact_profiles..."), n.transaction(() => {
    n.exec(Be), n.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(ne);
  })(), console.log("[DB] Migration 003_add_contact_profiles complete");
}
const ae = "004_parent_child_chunks", Ge = `
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
`, ze = `
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
`, Ye = `
  CREATE VIRTUAL TABLE IF NOT EXISTS child_chunks_fts USING fts5(
    content,
    chunk_id UNINDEXED,
    tokenize='unicode61'
  );
`;
function $e(n) {
  if (n.prepare("SELECT id FROM _migrations WHERE id = ?").get(ae)) {
    console.log("[DB] Migration 004_parent_child_chunks already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 004_parent_child_chunks..."), n.transaction(() => {
    n.exec(Ge), We(n) ? (console.log("[DB] sqlite-vec detected — creating child_vectors + child_chunks_fts tables"), n.exec(ze)) : (console.log("[DB] sqlite-vec not detected — creating child_chunks_fts only"), n.exec(Ye)), n.prepare("INSERT INTO _migrations (id) VALUES (?)").run(ae);
  })(), console.log("[DB] Migration 004_parent_child_chunks complete");
}
function We(n) {
  try {
    return n.prepare("SELECT vec_version()").get(), !0;
  } catch {
    return !1;
  }
}
const ie = "005_propositions", qe = `
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
`, He = `
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
`, Ve = `
  CREATE VIRTUAL TABLE IF NOT EXISTS propositions_fts USING fts5(
    fact,
    original_quote,
    proposition_id UNINDEXED,
    tokenize='unicode61 remove_diacritics 2'
  );
`;
function je(n) {
  if (n.prepare("SELECT id FROM _migrations WHERE id = ?").get(ie)) {
    console.log("[DB] Migration 005_propositions already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 005_propositions..."), n.transaction(() => {
    n.exec(qe), Qe(n) ? (console.log("[DB] sqlite-vec detected — creating proposition_vectors + propositions_fts tables"), n.exec(He)) : (console.log("[DB] sqlite-vec not detected — creating propositions_fts only"), n.exec(Ve)), n.prepare("INSERT INTO _migrations (id) VALUES (?)").run(ie);
  })(), console.log("[DB] Migration 005_propositions complete");
}
function Qe(n) {
  try {
    return n.prepare("SELECT vec_version()").get(), !0;
  } catch {
    return !1;
  }
}
const re = "006_intelligent_ingestion", Ke = `
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
function Je(n) {
  if (n.prepare("SELECT id FROM _migrations WHERE id = ?").get(re)) {
    console.log("[DB] Migration 006_intelligent_ingestion already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 006_intelligent_ingestion..."), n.transaction(() => {
    n.exec(Ke), n.prepare("INSERT INTO _migrations (id) VALUES (?)").run(re);
  })(), console.log("[DB] Migration 006_intelligent_ingestion complete");
}
const oe = "007_search_indexes", Ze = `
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
function et(n) {
  if (n.prepare("SELECT id FROM _migrations WHERE id = ?").get(oe)) {
    console.log("[DB] Migration 007_search_indexes already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 007_search_indexes..."), n.transaction(() => {
    n.exec(Ze), n.prepare("INSERT INTO _migrations (id) VALUES (?)").run(oe);
  })(), console.log("[DB] Migration 007_search_indexes complete");
}
const S = class S {
  static getInstance() {
    if (S.db)
      return S.db;
    const e = O.getPath("userData"), t = N.join(e, "recall-ai.db");
    console.log("[DB] Opening database at:", t);
    const s = new ye(t, {
      verbose: process.env.NODE_ENV === "development" ? console.log : void 0
    });
    return s.pragma("journal_mode = WAL"), s.pragma("foreign_keys = ON"), s.pragma("synchronous = NORMAL"), s.pragma("cache_size = -32000"), s.pragma("temp_store = MEMORY"), S.db = s, Ue(s), be(s), Xe(s), $e(s), je(s), Je(s), et(s), console.log("[DB] Database ready"), s;
  }
  /** Close the database connection (call on app quit) */
  static close() {
    S.db && (S.db.close(), S.db = null, console.log("[DB] Database closed"));
  }
  /** Check if the database is open */
  static isOpen() {
    return S.db !== null && S.db.open;
  }
};
E(S, "db", null);
let R = S, tt = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const st = 128;
let w, M;
function nt(n) {
  !w || w.length < n ? (w = Buffer.allocUnsafe(n * st), Z.getRandomValues(w), M = 0) : M + n > w.length && (Z.getRandomValues(w), M = 0), M += n;
}
function _(n = 21) {
  nt(n |= 0);
  let e = "";
  for (let t = M - n; t < M; t++)
    e += tt[w[t] & 63];
  return e;
}
class b {
  constructor(e) {
    this.db = e;
  }
  create(e) {
    const t = e.id ?? _(), s = Math.floor(Date.now() / 1e3);
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
    ).all().map(ce);
  }
  findById(e) {
    const t = this.db.prepare(
      "SELECT * FROM chats WHERE id = ?"
    ).get(e);
    return t ? ce(t) : null;
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
function ce(n) {
  return {
    ...n,
    metadata: n.metadata ? JSON.parse(n.metadata) : null
  };
}
class J {
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
    this.db.transaction((a) => {
      for (const r of a)
        t.run({
          id: r.id ?? _(),
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
    const a = e.map((c) => c.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ ]/g, "").trim()).filter(Boolean);
    if (a.length === 0) return [];
    const r = a.map((c) => `"${c}"*`).join(" OR "), i = this.db.prepare(`
      SELECT m.id, m.chat_id, m.timestamp 
      FROM messages_fts fts
      JOIN messages m ON fts.message_id = m.id
      WHERE messages_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(r, s), o = [], d = this.db.prepare(`
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
    for (const c of i) {
      const l = d.all(
        c.chat_id,
        c.timestamp,
        t + 1,
        c.chat_id,
        c.timestamp,
        t + 1
      );
      o.push(l);
    }
    return o;
  }
}
class G {
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
    `), a = this.db.prepare(`
      INSERT INTO sessions_fts (summary, session_id)
      VALUES (@summary, @session_id)
    `), r = this.db.prepare(`
      INSERT INTO entities (
        id, session_id, name, normalized_name, type, action
      ) VALUES (
        @id, @session_id, @name, @normalized_name, @type, @action
      )
    `), i = this.db.prepare(`
      INSERT INTO entities_fts (normalized_name, type, action, entity_id)
      VALUES (@normalized_name, @type, @action, @entity_id)
    `);
    this.db.transaction((d, c) => {
      for (const l of d) {
        const m = l.id ?? _();
        s.run({
          id: m,
          chat_id: l.chat_id,
          start_time: l.start_time,
          end_time: l.end_time,
          message_count: l.message_count ?? 0,
          summary: l.summary
        }), a.run({ summary: l.summary, session_id: m });
      }
      for (const l of c) {
        const m = l.id ?? _();
        r.run({
          id: m,
          session_id: l.session_id,
          name: l.name,
          normalized_name: l.normalized_name,
          type: l.type,
          action: l.action
        }), i.run({
          normalized_name: l.normalized_name,
          type: l.type,
          action: l.action,
          entity_id: m
        });
      }
    })(e, t);
  }
  /**
   * Update a session with its NLP summary and insert its entities + FTS5 entries.
   * Used by the background NLP worker.
   */
  updateSessionNLP(e, t, s) {
    const a = this.db.prepare(`
      UPDATE sessions SET summary = @summary WHERE id = @id
    `), r = this.db.prepare(`
      UPDATE sessions_fts SET summary = @summary WHERE session_id = @id
    `), i = this.db.prepare(`
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
      a.run({ summary: t, id: e }), r.run({ summary: t, id: e });
      for (const c of s) {
        const l = c.id ?? _();
        i.run({
          id: l,
          session_id: c.session_id,
          name: c.name,
          normalized_name: c.normalized_name,
          type: c.type,
          action: c.action
        }), o.run({
          normalized_name: c.normalized_name,
          type: c.type,
          action: c.action,
          entity_id: l
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
    const s = this.db.prepare("DELETE FROM sessions WHERE chat_id = ?"), a = this.db.prepare("DELETE FROM sessions_fts WHERE session_id = ?"), r = this.db.prepare(
      "DELETE FROM entities_fts WHERE entity_id IN (SELECT id FROM entities WHERE session_id = ?)"
    );
    this.db.transaction(() => {
      for (const { id: o } of t)
        r.run(o), a.run(o);
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
      let d = "SELECT * FROM sessions";
      const c = [], l = [];
      return s != null && s.dateFrom && (l.push("start_time >= ?"), c.push(s.dateFrom)), s != null && s.dateTo && (l.push("end_time <= ?"), c.push(s.dateTo)), l.length > 0 && (d += " WHERE " + l.join(" AND ")), d += " ORDER BY start_time DESC LIMIT ?", c.push(t), this.db.prepare(d).all(...c).reverse();
    }
    const a = e.map((d) => d.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ]/g, "").trim()).filter(Boolean);
    if (a.length === 0) return [];
    const r = a.map((d) => `"${d}"*`).join(" OR ");
    let i = `
      SELECT s.*
      FROM sessions_fts fts
      JOIN sessions s ON fts.session_id = s.id
      WHERE sessions_fts MATCH ?
    `;
    const o = [r];
    return s != null && s.dateFrom && (i += " AND s.start_time >= ?", o.push(s.dateFrom)), s != null && s.dateTo && (i += " AND s.end_time <= ?", o.push(s.dateTo)), i += " ORDER BY fts.rank LIMIT ?", o.push(t), this.db.prepare(i).all(...o);
  }
  searchAggregation(e, t = 10, s) {
    if (!e || e.length === 0) return [];
    const a = e.map((d) => d.replace(/[^a-zA-Z0-9À-ÖØ-öø-ÿ ]/g, "").trim()).filter(Boolean);
    if (a.length === 0) return [];
    const r = a.map((d) => `"${d}"*`).join(" OR ");
    let i = `
      SELECT e.normalized_name as name, e.type, COUNT(*) as count
      FROM entities_fts fts
      JOIN entities e ON fts.entity_id = e.id
      JOIN sessions s ON e.session_id = s.id
      WHERE entities_fts MATCH ?
    `;
    const o = [r];
    return s != null && s.dateFrom && (i += " AND s.start_time >= ?", o.push(s.dateFrom)), s != null && s.dateTo && (i += " AND s.end_time <= ?", o.push(s.dateTo)), i += " GROUP BY e.normalized_name, e.type ORDER BY count DESC LIMIT ?", o.push(t), this.db.prepare(i).all(...o);
  }
}
function at() {
  f.handle("chats:list", async () => {
    const n = R.getInstance();
    return new b(n).findAll();
  }), f.handle("chats:delete", async (n, e) => {
    const t = R.getInstance();
    t.transaction(() => {
      const a = new J(t), r = new G(t), i = new b(t);
      r.deleteByChatId(e), a.deleteByChatId(e), i.delete(e);
    })();
  });
}
const it = {
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
}, rt = {
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
}, ot = {
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
}, ct = {
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
}, H = [
  it,
  rt,
  ot,
  ct
], dt = [
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
], lt = [
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
], mt = 20;
async function Et(n) {
  const e = await Tt(n, mt);
  return ut(e);
}
function ut(n) {
  for (const e of n) {
    const t = e.trim();
    if (t) {
      for (const s of H)
        if (s.regex.test(t))
          return s.format;
    }
  }
  throw new Error(
    `WhatsApp format not recognized. Tried ${H.length} patterns on ${n.length} sample lines.`
  );
}
function pt(n) {
  const e = H.find((t) => t.id === n);
  if (!e)
    throw new Error(`No pattern registered for format ID: ${n}`);
  return e;
}
async function Tt(n, e) {
  const t = [], s = pe({
    input: K(n, { encoding: "utf-8" }),
    crlfDelay: 1 / 0
  });
  for await (const a of s)
    if (t.push(a), t.length >= e) {
      s.close();
      break;
    }
  return t;
}
class ht {
  /**
   * Parse a WhatsApp export .txt file using streaming (memory-efficient).
   */
  async parse(e) {
    let t;
    try {
      t = await Et(e);
    } catch (m) {
      throw new Error(
        `Failed to detect WhatsApp format: ${m instanceof Error ? m.message : String(m)}`
      );
    }
    const s = pt(t.id), a = [], r = [];
    let i = null, o = 0;
    const d = pe({
      input: K(e, { encoding: "utf-8" }),
      crlfDelay: 1 / 0
    });
    for await (const m of d) {
      o++;
      const p = o === 1 ? m.replace(/^\uFEFF/, "") : m, g = s.regex.exec(p);
      if (g) {
        i && de(i) && a.push(le(i));
        const I = g[s.groups.date], T = g[s.groups.time];
        let y;
        try {
          y = gt(I, T, t);
        } catch {
          r.push({ line: o, content: p, reason: "invalid_timestamp" }), i = null;
          continue;
        }
        const L = g[s.groups.content] ?? "", A = g[s.groups.sender].trim();
        i = {
          timestamp: y,
          sender: A,
          content: L,
          type: Te(L, A),
          raw: p,
          lineNumber: o
        };
      } else i && p.trim() ? (i.content = (i.content ?? "") + `
` + p, i.raw = (i.raw ?? "") + `
` + p) : p.trim() && !i && r.push({ line: o, content: p, reason: "orphan_line" });
    }
    i && de(i) && a.push(le(i));
    const c = [...new Set(a.map((m) => m.sender))], l = {
      totalLines: o,
      totalMessages: a.length,
      errorCount: r.length,
      participants: c,
      firstTimestamp: a.length > 0 ? a[0].timestamp : null,
      lastTimestamp: a.length > 0 ? a[a.length - 1].timestamp : null
    };
    return { messages: a, format: t, errors: r, stats: l };
  }
}
function de(n) {
  return n.timestamp !== void 0 && n.sender !== void 0 && n.content !== void 0 && n.type !== void 0 && n.raw !== void 0 && n.lineNumber !== void 0;
}
function le(n) {
  return {
    timestamp: n.timestamp,
    sender: n.sender,
    content: n.content.trim(),
    type: Te(n.content.trim(), n.sender),
    raw: n.raw,
    lineNumber: n.lineNumber
  };
}
function Te(n, e) {
  const t = n.trim();
  for (const s of lt)
    if (s.test(t)) return "media";
  for (const s of dt)
    if (s.test(t)) return "system";
  return !e || e.trim() === "" ? "system" : "text";
}
function gt(n, e, t) {
  let s, a, r;
  if (t.locale === "pt-BR" || t.locale === "pt-PT") {
    const [c, l, m] = n.split("/").map(Number);
    s = c, a = l, r = m;
  } else if (t.locale === "en-US") {
    const [c, l, m] = n.split("/").map(Number);
    a = c, s = l, r = m;
  } else
    [s, a, r] = n.split(/[\/\.\-]/).map(Number);
  r < 100 && (r += r < 70 ? 2e3 : 1900);
  let i, o;
  if (t.timeFormat === "12h") {
    const c = /PM/i.test(e), m = e.replace(/\s*[AP]M/i, "").split(":").map(Number);
    i = m[0], o = m[1], c && i !== 12 && (i += 12), !c && i === 12 && (i = 0);
  } else {
    const c = e.split(":").map(Number);
    i = c[0], o = c[1];
  }
  const d = Date.UTC(r, a - 1, s, i, o) / 1e3;
  if (isNaN(d)) throw new Error(`Invalid timestamp: ${n} ${e}`);
  return d;
}
class _t {
  constructor(e = 7200, t = 400) {
    E(this, "maxGapSeconds");
    E(this, "maxTokens");
    this.maxGapSeconds = e, this.maxTokens = t;
  }
  /**
   * Groups an array of parsed messages into temporal sessions.
   * A new session starts when the gap between two messages exceeds `maxGapSeconds`,
   * or when the estimated token count exceeds `maxTokens` (adaptive chunking).
   * Messages are assumed to be pre-sorted by timestamp ascending.
   */
  group(e) {
    var d, c;
    if (e.length === 0) return [];
    const t = [...e].sort((l, m) => l.timestamp - m.timestamp), s = [];
    let a = [t[0]], r = t[0].timestamp, i = t[0].timestamp, o = Math.ceil((((d = t[0].content) == null ? void 0 : d.length) || 0) / 4);
    for (let l = 1; l < t.length; l++) {
      const m = t[l], p = m.timestamp - i, g = Math.ceil((((c = m.content) == null ? void 0 : c.length) || 0) / 4);
      p > this.maxGapSeconds || o + g > this.maxTokens ? (s.push({
        messages: a,
        start_time: r,
        end_time: i,
        message_count: a.length
      }), a = [m], r = m.timestamp, o = g) : (a.push(m), o += g), i = m.timestamp;
    }
    return s.push({
      messages: a,
      start_time: r,
      end_time: i,
      message_count: a.length
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
}, ft = ["embedding", "worker", "brain"], D = class D {
  constructor() {
    /** Absolute path to the models directory in Electron's userData */
    E(this, "modelsDir");
    this.modelsDir = N.join(O.getPath("userData"), "models"), ee.mkdirSync(this.modelsDir, { recursive: !0 });
  }
  static getInstance() {
    return D.instance || (D.instance = new D()), D.instance;
  }
  /**
   * Checks whether a model file is present locally without triggering a download.
   *
   * resolveModelFile with `download: false` returns the expected local path
   * without checking the network. We then verify the file actually exists on disk.
   */
  async isAvailable(e) {
    try {
      const t = await $(P[e].uri, {
        directory: this.modelsDir,
        download: !1,
        // never trigger a download in a presence check
        cli: !1
      });
      return ee.existsSync(t);
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
      ft.map(async (t) => {
        const s = P[t], a = await this.isAvailable(t);
        let r;
        if (a)
          try {
            r = await $(s.uri, {
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
          available: a,
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
    const r = await (await Oe({
      modelUri: s.uri,
      dirPath: this.modelsDir,
      showCliProgress: !1,
      onProgress: ({ totalSize: i, downloadedSize: o }) => {
        if (t) {
          const d = i ?? s.sizeEstimate;
          t({
            key: e,
            name: s.name,
            downloadedBytes: o,
            totalBytes: d,
            percent: d > 0 ? Math.round(o / d * 100) : 0,
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
    return $(t.uri, {
      directory: this.modelsDir,
      download: "auto",
      cli: !1
    });
  }
};
E(D, "instance", null);
let v = D;
const Nt = typeof __dirname < "u" ? __dirname : N.dirname(Q(import.meta.url)), k = class k {
  constructor() {
    E(this, "worker", null);
    E(this, "pendingRequests", /* @__PURE__ */ new Map());
    E(this, "initializationPromise", null);
    E(this, "ready", !1);
    // Basic Batch Queue (Will be expanded in 3.4)
    E(this, "batchQueue", []);
    E(this, "processingQueue", !1);
    E(this, "currentModelKey", "worker");
  }
  static getInstance() {
    return k.instance || (k.instance = new k()), k.instance;
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
          } catch (a) {
            console.error("[WorkerProcess] Fallback also failed:", a), this.initializationPromise = null, t(a);
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
      const a = await v.getInstance().resolve(e);
      console.log(`[WorkerProcess] Forking Utility Process for ${e}...`);
      const r = N.join(Nt, "worker-worker.js");
      this.worker = me.fork(r, [], {
        stdio: "inherit"
      }), this.worker.on("message", (o) => this.handleWorkerMessage(o)), this.worker.on("exit", (o) => {
        console.warn(`[WorkerProcess] Utility process exited with code ${o}`), this.ready = !1, this.worker = null, this.rejectAllPending(new Error(`Worker exited unexpectedly with code ${o}`));
      });
      const i = _();
      this.pendingRequests.set(i, {
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
        id: i,
        payload: { modelPath: a }
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
    return (!this.ready || !this.worker) && await this.initialize(), new Promise((a, r) => {
      this.batchQueue.push({ prompt: e, options: s, resolve: a, reject: r, onToken: t }), this.processNextInQueue();
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
    let a = null, r = e;
    for (let i = 1; i <= s; i++)
      try {
        const o = await this.generate(r, t);
        return this.extractJson(o);
      } catch (o) {
        a = o, console.warn(`[WorkerProcess] JSON extraction failed (attempt ${i}/${s}):`, o.message), r = e + `

[SYSTEM FEEDBACK: Your previous response failed JSON parsing with error: ${o.message}. Please return strictly valid JSON without conversational wrapper text.]`;
      }
    throw new Error(`[WorkerProcess] Failed to generate valid JSON after ${s} attempts. Last error: ${a == null ? void 0 : a.message}`);
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
    }, a = await this.generateJson(t, s, 3);
    return ["factual", "aggregation", "narrative", "unknown"].includes(a.intent) || (a.intent = "factual"), (!a.keywords || !Array.isArray(a.keywords)) && (a.keywords = []), a;
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
      const a = await this.generateJson(t, s, 2);
      if (a.expanded && Array.isArray(a.expanded))
        return Array.from(/* @__PURE__ */ new Set([...e, ...a.expanded]));
    } catch (a) {
      console.warn("[WorkerProcess] Failed to expand keywords", a);
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
    }, a = Date.now();
    try {
      const r = await this.generateJson(t, s, 3), i = Date.now() - a;
      return console.log(`[WorkerProcess] extractSessionEntities completed in ${i}ms`), {
        summary: r.summary || "Sessão extraída",
        mentioned_entities: Array.isArray(r.mentioned_entities) ? r.mentioned_entities : []
      };
    } catch (r) {
      const i = Date.now() - a;
      return console.error(`[WorkerProcess] extractSessionEntities completely failed after ${i}ms:`, r.message), {
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
    return new Promise((a, r) => {
      const i = _();
      this.pendingRequests.set(i, { resolve: a, reject: r, onToken: t }), this.worker.postMessage({
        type: "generate",
        id: i,
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
    const { type: t, id: s, error: a, token: r, text: i } = e;
    if (!s || !this.pendingRequests.has(s)) {
      t === "error" && console.error("[Worker Global Error]", a);
      return;
    }
    const { resolve: o, reject: d, onToken: c } = this.pendingRequests.get(s);
    switch (t) {
      case "init-ready":
        this.pendingRequests.delete(s), o();
        break;
      case "token":
        c && r && c(r);
        break;
      case "done":
        this.pendingRequests.delete(s), o(i);
        break;
      case "error":
        this.pendingRequests.delete(s), d(new Error(a));
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
E(k, "instance", null);
let B = k;
const he = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  WorkerProcess: B
}, Symbol.toStringTag, { value: "Module" }));
class St {
  constructor() {
    E(this, "parser", new ht());
    E(this, "sessionEngine", new _t(7200));
  }
  // > 2h gap
  async import(e, t) {
    const s = (r) => {
      t == null || t.send("import:progress", r);
    };
    let a;
    try {
      s({ stage: "reading", percent: 5, label: "Lendo arquivo", detail: "Calculando hash..." });
      const r = await It(e), i = R.getInstance(), o = new b(i);
      if (o.existsByHash(r))
        return { success: !1, duplicate: !0, error: "Arquivo já importado." };
      const d = Re(e).replace(/\.[^/.]+$/, "");
      a = _(), s({ stage: "parsing", percent: 15, label: "Parseando mensagens", detail: "Lendo chat base..." });
      const c = await this.parser.parse(e);
      if (c.messages.length === 0)
        return { success: !1, error: "Nenhuma mensagem encontrada." };
      const l = c.messages.map((T) => ({
        id: _(),
        chat_id: a,
        sender: T.sender,
        content: T.content,
        timestamp: T.timestamp,
        type: T.type,
        raw: T.raw
      }));
      o.create({
        id: a,
        name: d,
        source: "whatsapp",
        file_hash: r,
        participant_count: c.stats.participants.length,
        message_count: c.messages.length,
        first_message_at: c.stats.firstTimestamp ?? void 0,
        last_message_at: c.stats.lastTimestamp ?? void 0
      }), s({ stage: "fts_indexing", percent: 25, label: "Agrupando Sessões", detail: "Topologia Cronológica..." });
      const m = this.sessionEngine.group(c.messages), p = [];
      for (const T of m)
        p.push({
          id: _(),
          chat_id: a,
          start_time: T.start_time,
          end_time: T.end_time,
          message_count: T.message_count,
          summary: "Processando IA em background..."
          // Temporary summary
        });
      return s({ stage: "fts_indexing", percent: 40, label: "Salvando no banco", detail: "Persistindo histórico nativo e Indexando FTS5..." }), new J(i).insertBatch(l), new G(i).insertBatch(p, []), this.runBackgroundNLP(a, m, p, t).catch((T) => {
        console.error("[Background NLP Error]", T);
      }), {
        success: !0,
        chatId: a,
        chatName: d,
        messageCount: c.messages.length,
        chunkCount: p.length
        // total sessions
      };
    } catch (r) {
      if (a)
        try {
          const o = R.getInstance();
          new b(o).delete(a);
        } catch {
        }
      const i = r instanceof Error ? r.message : String(r);
      return console.error("[ChatImportService] Import failed:", i), s({ stage: "error", percent: 0, label: "Erro na importação", detail: i }), { success: !1, error: i };
    }
  }
  /**
   * Background process to extract summaries and entities via Worker
   */
  async runBackgroundNLP(e, t, s, a) {
    const r = (i) => {
      a == null || a.send("import:progress", i);
    };
    try {
      r({ stage: "nlp_summaries", percent: 20, label: "Extração NLP Iniciada", detail: `Processando ${t.length} sessões...`, chatId: e });
      const i = B.getInstance();
      await i.initialize();
      const o = R.getInstance(), d = new G(o);
      let c = 0;
      for (let l = 0; l < t.length; l++) {
        const m = t[l], p = s[l], I = `Read the following chat session and extract the main summary and any notable entities mentioned (names, places, topics) along with their action/intent.
Respond ONLY with a valid JSON strictly matching this schema:
{
  "summary": "general summary of what happened",
  "entities": [
    { "name": "Raw Name", "type": "person/place/game/topic", "action": "What they did or intent" }
  ]
}

CHAT SESSION:
${m.messages.map((h) => `[${new Date(h.timestamp * 1e3).toISOString()}] ${h.sender}: ${h.content}`).join(`
`)}`;
        let T = "Sessão concluída (sem detalhes extraídos)", y = [];
        try {
          const h = await i.generateJson(I, { maxTokens: 800, temperature: 0.1 }, 3);
          h.summary && (T = h.summary), h.entities && Array.isArray(h.entities) && (y = h.entities);
        } catch (h) {
          console.warn("[ChatImportService Worker] Worker extraction failed on session:", h.message);
        }
        const L = [];
        for (const h of y)
          h.name && L.push({
            id: _(),
            session_id: p.id,
            name: h.name,
            normalized_name: h.name.toLowerCase().trim(),
            type: h.type || "unknown",
            action: h.action || "mentioned"
          });
        d.updateSessionNLP(p.id, T, L), c++;
        const A = c > t.length * 0.7;
        (c % 5 === 0 || c === t.length) && r({
          stage: A ? "nlp_entities" : "nlp_summaries",
          percent: 20 + Math.round(c / t.length * 80),
          label: A ? "Resolvendo Entidades" : "Processando Resumos (Batch)",
          detail: `${c} / ${t.length} sessões analisadas...`,
          chatId: e
          // Note: sending chatId along to identify bg process per chat
        });
      }
      r({ stage: "done", percent: 100, label: "Concluído", detail: "Entidades Indexadas para o chat.", chatId: e });
    } catch (i) {
      console.error("[Background NLP Exception]", i);
    }
  }
}
function It(n) {
  return new Promise((e, t) => {
    const s = Le("sha256"), a = K(n);
    a.on("data", (r) => s.update(r)), a.on("end", () => e(s.digest("hex"))), a.on("error", t);
  });
}
const Rt = new St();
function yt(n) {
  f.handle("import:chat", async (e, t) => Rt.import(t, n.webContents)), f.handle("import:file-dialog", async () => {
    const e = await Ee.showOpenDialog(n, {
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
function Lt(n) {
  const e = v.getInstance();
  f.handle("models:check", async () => e.checkAll()), f.handle("models:download", async (t, s) => e.download(s, (a) => {
    n.isDestroyed() || n.webContents.send("models:progress", a);
  })), f.handle("models:select-file", async () => {
    const t = await Ee.showOpenDialog(n, {
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
const F = class F {
  constructor() {
    E(this, "chatRepo");
    E(this, "sessionRepo");
    E(this, "messageRepo");
    const e = R.getInstance();
    this.chatRepo = new b(e), this.sessionRepo = new G(e), this.messageRepo = new J(e);
  }
  static getInstance() {
    return F.instance || (F.instance = new F()), F.instance;
  }
  async search(e, t) {
    console.log(`[SearchService] Resolving deterministic search for: "${e}"`);
    const s = B.getInstance(), a = await s.classifyQuery(e);
    console.log(`[SearchService] Intent: ${a.intent} | Keywords: ${a.keywords.join(", ")}`);
    const r = a.intent, i = a.keywords && a.keywords.length > 0 ? a.keywords : [e], o = {
      dateFrom: t == null ? void 0 : t.dateFrom,
      dateTo: t == null ? void 0 : t.dateTo
    };
    console.log("[SearchService] Executing Ontology Hop (Entity Expansion)...");
    const d = await s.expandKeywords(i), c = Array.from(/* @__PURE__ */ new Set([...i, ...d])), m = this.sessionRepo.searchAggregation(c, 8, o).map((I) => I.name);
    m.length > 0 && console.log(`[SearchService] Ontology hop discovered relevant context entities: ${m.join(", ")}`);
    const p = Array.from(/* @__PURE__ */ new Set([...c, ...m]));
    let g = this.performRouting(r, p, o);
    return g.length === 0 && console.warn("[SearchService] Data inexistent even after lexical and ontological expansions."), g;
  }
  performRouting(e, t, s) {
    const a = [];
    if (e === "aggregation") {
      const r = this.sessionRepo.searchAggregation(t, 20, s);
      if (r.length > 0) {
        let i = `Aggregation Results:
`;
        for (const o of r)
          i += `- Entity: ${o.name} (${o.type}) | Count: ${o.count}
`;
        a.push({
          id: _(),
          chatId: "",
          chatName: "Global Aggregations",
          score: 1,
          content: i,
          date: (/* @__PURE__ */ new Date()).toISOString(),
          sender: "System",
          intent: "aggregation",
          metadata: { items: r }
        });
      }
    } else if (e === "narrative") {
      const r = this.sessionRepo.searchNarrative(t, 5, s);
      for (const i of r) {
        const o = this.chatRepo.findById(i.chat_id);
        a.push({
          id: i.id,
          chatId: i.chat_id,
          chatName: (o == null ? void 0 : o.name) || "Unknown Chat",
          score: 0.9,
          content: `SESSION SUMMARY
${i.summary}`,
          date: new Date(i.start_time * 1e3).toISOString(),
          sender: "System",
          intent: "narrative"
        });
      }
    } else {
      const r = this.messageRepo.searchFactual(t, 15, 5);
      for (const i of r) {
        if (i.length === 0) continue;
        const o = this.chatRepo.findById(i[0].chat_id);
        let d = "";
        for (const c of i) {
          const m = new Date(c.timestamp * 1e3).toISOString().split("T")[1].slice(0, 5);
          d += `[${m}] ${c.sender}: ${c.content}
`;
        }
        a.push({
          id: _(),
          chatId: i[0].chat_id,
          chatName: (o == null ? void 0 : o.name) || "Unknown Chat",
          score: 1,
          content: d.trim(),
          date: new Date(i[0].timestamp * 1e3).toISOString(),
          sender: i[0].sender,
          intent: "factual"
        });
      }
    }
    return a;
  }
};
E(F, "instance", null);
let z = F;
function Ot() {
  f.handle("search:query", async (n, e, t) => {
    try {
      return await z.getInstance().search(e, t);
    } catch (s) {
      return console.error("[SearchHandlers] Error executing search:", s), [];
    }
  });
}
const At = typeof __dirname < "u" ? __dirname : N.dirname(Q(import.meta.url)), U = class U {
  constructor() {
    E(this, "worker", null);
    E(this, "pendingRequests", /* @__PURE__ */ new Map());
    E(this, "initializationPromise", null);
    E(this, "ready", !1);
  }
  static getInstance() {
    return U.instance || (U.instance = new U()), U.instance;
  }
  async initialize() {
    if (!this.ready) {
      if (this.initializationPromise) return this.initializationPromise;
      this.initializationPromise = new Promise(async (e, t) => {
        try {
          console.log("[BrainProcess] Resolving Brain model path...");
          const s = await v.getInstance().resolve("brain");
          console.log("[BrainProcess] Forking Utility Process...");
          const a = N.join(At, "brain-worker.js");
          this.worker = me.fork(a, [], {
            stdio: "inherit"
          }), this.worker.on("message", (i) => this.handleWorkerMessage(i)), this.worker.on("exit", (i) => {
            console.warn(`[BrainProcess] Utility process exited with code ${i}`), this.ready = !1, this.worker = null, this.rejectAllPending(new Error(`Brain Worker exited unexpectedly with code ${i}`));
          });
          const r = _();
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
    return (!this.ready || !this.worker) && await this.initialize(), new Promise((a, r) => {
      const i = _();
      this.pendingRequests.set(i, { resolve: a, reject: r, onToken: t }), this.worker.postMessage({
        type: "generate",
        id: i,
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
    const { type: t, id: s, error: a, token: r, text: i } = e;
    if (!s || !this.pendingRequests.has(s)) {
      t === "error" && console.error("[BrainWorker Global Error]", a);
      return;
    }
    const { resolve: o, reject: d, onToken: c } = this.pendingRequests.get(s);
    switch (t) {
      case "init-ready":
        this.pendingRequests.delete(s), o();
        break;
      case "token":
        c && r && c(r);
        break;
      case "done":
        this.pendingRequests.delete(s), o(i);
        break;
      case "error":
        this.pendingRequests.delete(s), d(new Error(a));
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
E(U, "instance", null);
let Y = U;
const ge = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BrainProcess: Y
}, Symbol.toStringTag, { value: "Module" })), wt = {
  buildRAGPrompt: (n, e) => {
    const t = e.map((i) => `[${i.date} - ${i.sender}]: ${i.content}`).join(`

`);
    let s = "";
    if (e.length > 0) {
      const i = e.map((o) => new Date(o.date).getTime()).filter((o) => !isNaN(o));
      if (i.length > 0) {
        const o = new Date(Math.min(...i)).toISOString().split("T")[0], d = new Date(Math.max(...i)).toISOString().split("T")[0];
        s = `
Regra OBRIGATÓRIA: Baseie-se EXATAMENTE nas datas providenciadas no prompt (de ${o} a ${d}). Nunca alucine datas ou informações fora desse intervalo.`;
      }
    }
    const a = `Você é um assistente cirúrgico que extrai informações de dados históricos. Baseie sua resposta APENAS no contexto fornecido.${s}`, r = `DADOS E CONTEXTO OBTIDOS (Fontes imutáveis):
${t}

PERGUNTA DO USUÁRIO: ${n}

Responda EXATAMENTE o que foi perguntado, formatando de maneira limpa. Se a resposta não estiver nos dados, declare tratar-se de "dados inexistentes".`;
    return { systemPrompt: a, userPrompt: r };
  }
}, q = {
  gpu: "auto",
  temperature: 0.3,
  systemPrompt: "Você é um assistente encarregado de ler históricos de chat. Responda apenas com o que estiver no contexto.",
  topK: 15,
  history: !0,
  analytics: !1,
  customBrainPath: null,
  customWorkerPath: null,
  customEmbeddingPath: null
}, C = class C {
  constructor() {
    E(this, "settingsPath");
    E(this, "currentSettings");
    const e = O.getPath("userData");
    this.settingsPath = Ae.join(e, "settings.json"), this.currentSettings = { ...q }, this.load();
  }
  static getInstance() {
    return C.instance || (C.instance = new C()), C.instance;
  }
  get() {
    return { ...this.currentSettings };
  }
  update(e) {
    const t = e.gpu !== void 0 && e.gpu !== this.currentSettings.gpu, s = "customBrainPath" in e && e.customBrainPath !== this.currentSettings.customBrainPath, a = "customWorkerPath" in e && e.customWorkerPath !== this.currentSettings.customWorkerPath;
    return this.currentSettings = {
      ...this.currentSettings,
      ...e
    }, this.save(), (t || s || a) && setTimeout(async () => {
      console.log("[SettingsService] Critical backend setting changed. Disposing active models for cold-restart.");
      const { WorkerProcess: r } = await Promise.resolve().then(() => he), { BrainProcess: i } = await Promise.resolve().then(() => ge);
      try {
        r.getInstance().dispose();
      } catch {
      }
      try {
        i.getInstance().dispose();
      } catch {
      }
    }, 0), this.get();
  }
  load() {
    try {
      if (W.existsSync(this.settingsPath)) {
        const e = W.readFileSync(this.settingsPath, "utf-8"), t = JSON.parse(e);
        this.currentSettings = {
          ...q,
          ...t
        };
      } else
        this.save();
    } catch (e) {
      console.error("[SettingsService] Failed to load settings:", e), this.currentSettings = { ...q };
    }
  }
  save() {
    try {
      W.writeFileSync(this.settingsPath, JSON.stringify(this.currentSettings, null, 2));
    } catch (e) {
      console.error("[SettingsService] Failed to save settings:", e);
    }
  }
};
E(C, "instance");
let X = C;
const x = class x {
  constructor() {
  }
  static getInstance() {
    return x.instance || (x.instance = new x()), x.instance;
  }
  async generateStream(e, t, s, a) {
    const r = performance.now(), i = { embedding: 0, search: 0, generation: 0, total: 0 };
    let o = [];
    try {
      a && a("booting");
      const d = X.getInstance().get();
      a && a("searching");
      const c = performance.now();
      if (o = await z.getInstance().search(e, {
        limit: d.topK,
        chatId: s == null ? void 0 : s.chatId
      }), i.search = performance.now() - c, o.length === 0)
        return i.total = performance.now() - r, {
          answer: "Dados inexistentes. Não foi possível localizar o contexto ou menções referentes à sua busca neste chat.",
          context: o,
          tokensUsed: 0,
          latency: i
        };
      a && a("processing");
      const { userPrompt: l } = wt.buildRAGPrompt(e, o), m = d.systemPrompt;
      a && a("synthesizing");
      const p = performance.now(), g = Y.getInstance();
      let I = "", T = 0;
      try {
        I = await g.generateStream(
          l,
          (y) => {
            T++, t && t(y);
          },
          {
            temperature: (s == null ? void 0 : s.temperature) ?? d.temperature,
            maxTokens: (s == null ? void 0 : s.maxTokens) || 1024,
            systemPrompt: m
          }
        );
      } catch (y) {
        console.error("[RAGService] Error generating response from BrainProcess:", y), I = `Desculpe, ocorreu um erro ao gerar a resposta ou a IA falhou.

Contexto encontrado:` + o.map((L, A) => `
[${A + 1}] ${L.date} ${L.sender}: ${L.content}`).join("");
      }
      return i.generation = performance.now() - p, i.total = performance.now() - r, {
        answer: I,
        context: o,
        tokensUsed: T,
        latency: i
      };
    } catch (d) {
      throw console.error("[RAGService] Fatal error in RAG pipeline:", d), d;
    }
  }
};
E(x, "instance", null);
let V = x;
function Dt(n) {
  f.handle("rag:query", async (e, t, s) => {
    try {
      const r = await V.getInstance().generateStream(
        t,
        (i) => {
          n.webContents.send("rag:token", i);
        },
        s,
        (i) => {
          n.webContents.send("rag:step", i);
        }
      );
      n.webContents.send("rag:done", r);
    } catch (a) {
      throw console.error("[IPC rag:query] Error:", a), a;
    }
  }), f.handle("rag:status", async () => {
    const { BrainProcess: e } = await Promise.resolve().then(() => ge), { WorkerProcess: t } = await Promise.resolve().then(() => he);
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
function kt() {
  f.handle("settings:get", async () => X.getInstance().get()), f.handle("settings:update", async (n, e) => X.getInstance().update(e));
}
function Ft(n) {
  at(), yt(n), Lt(n), Ot(), Dt(n), kt();
}
const _e = N.dirname(Q(import.meta.url));
process.env.APP_ROOT = N.join(_e, "..");
const j = process.env.VITE_DEV_SERVER_URL, Yt = N.join(process.env.APP_ROOT, "dist-electron"), fe = N.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = j ? N.join(process.env.APP_ROOT, "public") : fe;
let u;
function Ne() {
  u = new ue({
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
      preload: N.join(_e, "preload.mjs"),
      contextIsolation: !0,
      nodeIntegration: !1
    }
  }), u.once("ready-to-show", () => {
    u == null || u.show();
  }), f.on("window:minimize", () => u == null ? void 0 : u.minimize()), f.on("window:maximize", () => {
    u != null && u.isMaximized() ? u.unmaximize() : u == null || u.maximize();
  }), f.on("window:close", () => u == null ? void 0 : u.close()), Ft(u), j ? (u.loadURL(j), u.webContents.openDevTools({ mode: "detach" })) : u.loadFile(N.join(fe, "index.html"));
}
O.on("window-all-closed", () => {
  process.platform !== "darwin" && (O.quit(), u = null);
});
O.on("activate", () => {
  ue.getAllWindows().length === 0 && Ne();
});
O.on("before-quit", () => {
  R.close();
});
O.whenReady().then(() => {
  try {
    R.getInstance();
  } catch (n) {
    console.error("[Main] Failed to initialize database:", n);
  }
  Ne();
});
export {
  Yt as MAIN_DIST,
  fe as RENDERER_DIST,
  j as VITE_DEV_SERVER_URL
};
