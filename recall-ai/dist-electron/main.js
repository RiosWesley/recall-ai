var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { app, ipcMain, utilityProcess, dialog, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path, { basename } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { webcrypto, createHash } from "node:crypto";
import fs, { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolveModelFile, createModelDownloader, getLlama } from "node-llama-cpp";
import fs$1 from "fs";
import path$1 from "path";
const MIGRATION_ID$2 = "001_initial";
const SCHEMA_SQL$2 = `
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
const VIRTUAL_TABLES_SQL = `
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
const FTS5_ONLY_SQL = `
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
  ).get(MIGRATION_ID$2);
  if (existing) {
    console.log("[DB] Migration 001_initial already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 001_initial...");
  db.transaction(() => {
    db.exec(SCHEMA_SQL$2);
    const hasSqliteVec = isSqliteVecLoaded$1(db);
    if (hasSqliteVec) {
      console.log("[DB] sqlite-vec detected — creating vectors + chunks_fts tables");
      db.exec(VIRTUAL_TABLES_SQL);
    } else {
      console.log("[DB] sqlite-vec not detected — creating chunks_fts only");
      db.exec(FTS5_ONLY_SQL);
    }
    db.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(MIGRATION_ID$2);
  })();
  console.log("[DB] Migration 001_initial complete");
}
function isSqliteVecLoaded$1(db) {
  try {
    db.prepare("SELECT vec_version()").get();
    return true;
  } catch {
    return false;
  }
}
const MIGRATION_ID$1 = "002_add_profile_facts";
const SCHEMA_SQL$1 = `
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
  ).get(MIGRATION_ID$1);
  if (existing) {
    console.log("[DB] Migration 002_add_profile_facts already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 002_add_profile_facts...");
  db.transaction(() => {
    db.exec(SCHEMA_SQL$1);
    db.exec(FTS5_SQL);
    if (isSqliteVecLoaded(db)) {
      console.log("[DB] sqlite-vec detected — creating profile_facts_vectors table");
      db.exec(VECTORS_SQL);
    }
    db.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(MIGRATION_ID$1);
  })();
  console.log("[DB] Migration 002_add_profile_facts complete");
}
function isSqliteVecLoaded(db) {
  try {
    db.prepare("SELECT vec_version()").get();
    return true;
  } catch {
    return false;
  }
}
const MIGRATION_ID = "003_add_contact_profiles";
const SCHEMA_SQL = `
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
  ).get(MIGRATION_ID);
  if (existing) {
    console.log("[DB] Migration 003_add_contact_profiles already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 003_add_contact_profiles...");
  db.transaction(() => {
    db.exec(SCHEMA_SQL);
    db.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(MIGRATION_ID);
  })();
  console.log("[DB] Migration 003_add_contact_profiles complete");
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
    _DatabaseService.loadSqliteVec(db);
    _DatabaseService.db = db;
    runMigrations(db);
    runMigration002(db);
    runMigration003(db);
    console.log("[DB] Database ready");
    return db;
  }
  static loadSqliteVec(db) {
    try {
      let loaded = false;
      try {
        sqliteVec.load(db);
        loaded = true;
        console.log("[DB] sqlite-vec loaded via NPM package");
      } catch (e) {
        console.warn("[DB] Failed to load sqlite-vec via NPM:", e);
      }
      if (!loaded) {
        try {
          db.loadExtension("vec0");
          loaded = true;
          console.log("[DB] sqlite-vec loaded by name");
        } catch {
          console.warn("[DB] sqlite-vec not found — vector search will be unavailable.");
        }
      }
      if (loaded) {
        const result = db.prepare("SELECT vec_version() as version").get();
        console.log("[DB] sqlite-vec version:", result.version);
      }
    } catch (err) {
      console.error("[DB] Failed to load sqlite-vec:", err);
    }
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
}
class ChunkRepository {
  constructor(db) {
    this.db = db;
  }
  /**
   * Insert chunks and their FTS5 entries in a single transaction.
   */
  insertBatch(chunks) {
    if (chunks.length === 0) return;
    const insertChunk = this.db.prepare(`
      INSERT INTO chunks (
        id, chat_id, content, display_content,
        start_time, end_time, message_count, token_count, participants
      ) VALUES (
        @id, @chat_id, @content, @display_content,
        @start_time, @end_time, @message_count, @token_count, @participants
      )
    `);
    const insertFts = this.db.prepare(`
      INSERT INTO chunks_fts (content, chunk_id)
      VALUES (@content, @chunk_id)
    `);
    const runAll = this.db.transaction((items) => {
      for (const chunk of items) {
        const id = chunk.id ?? nanoid();
        insertChunk.run({
          id,
          chat_id: chunk.chat_id,
          content: chunk.content,
          display_content: chunk.display_content,
          start_time: chunk.start_time,
          end_time: chunk.end_time,
          message_count: chunk.message_count ?? 0,
          token_count: chunk.token_count ?? 0,
          participants: chunk.participants ? JSON.stringify(chunk.participants) : null
        });
        insertFts.run({ content: chunk.content, chunk_id: id });
      }
    });
    runAll(chunks);
  }
  findByChatId(chatId) {
    const rows = this.db.prepare(`
      SELECT * FROM chunks
      WHERE chat_id = ?
      ORDER BY start_time ASC
    `).all(chatId);
    return rows.map(deserializeChunk);
  }
  findById(id) {
    const row = this.db.prepare(
      "SELECT * FROM chunks WHERE id = ?"
    ).get(id);
    return row ? deserializeChunk(row) : null;
  }
  findByIds(ids) {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT * FROM chunks
      WHERE id IN (${placeholders})
    `).all(...ids);
    return rows.map(deserializeChunk);
  }
  deleteByChatId(chatId) {
    const chunkIds = this.db.prepare(
      "SELECT id FROM chunks WHERE chat_id = ?"
    ).all(chatId);
    const deleteChunks = this.db.prepare("DELETE FROM chunks WHERE chat_id = ?");
    if (chunkIds.length === 0) {
      deleteChunks.run(chatId);
      return;
    }
    const deleteFts = this.db.prepare(
      "DELETE FROM chunks_fts WHERE chunk_id = ?"
    );
    const runAll = this.db.transaction(() => {
      for (const { id } of chunkIds) {
        deleteFts.run(id);
      }
      deleteChunks.run(chatId);
    });
    runAll();
  }
  countByChatId(chatId) {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM chunks WHERE chat_id = ?"
    ).get(chatId);
    return row.count;
  }
}
function deserializeChunk(row) {
  return {
    ...row,
    participants: row.participants ? JSON.parse(row.participants) : []
  };
}
class VectorRepository {
  constructor(db) {
    __publicField(this, "isAvailable");
    this.db = db;
    this.isAvailable = this.checkAvailability();
  }
  /**
   * Store a chunk's embedding vector.
   * @param chunkId - ID of the chunk being embedded
   * @param embedding - Float32Array of length 384
   */
  insert(chunkId, embedding) {
    if (!this.isAvailable) {
      console.warn("[VectorRepository] sqlite-vec not available — skipping insert");
      return;
    }
    const buffer = Buffer.from(embedding.buffer);
    this.db.prepare(`
      INSERT OR REPLACE INTO vectors (chunk_id, embedding)
      VALUES (?, ?)
    `).run(chunkId, buffer);
  }
  /**
   * Store multiple chunks' embeddings in a single transaction.
   * @param items - Array of { chunkId, embedding }
   */
  insertBatch(items) {
    if (!this.isAvailable) {
      console.warn("[VectorRepository] sqlite-vec not available — skipping batch insert");
      return;
    }
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO vectors (chunk_id, embedding)
      VALUES (?, ?)
    `);
    this.db.transaction((vectors) => {
      for (const item of vectors) {
        stmt.run(item.chunkId, Buffer.from(item.embedding.buffer));
      }
    })(items);
  }
  /**
   * Store multiple facts' embeddings in a single transaction.
   * @param items - Array of { factId, embedding }
   */
  insertFactBatch(items) {
    if (!this.isAvailable) {
      console.warn("[VectorRepository] sqlite-vec not available — skipping fact batch insert");
      return;
    }
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO profile_facts_vectors (fact_id, embedding)
      VALUES (?, ?)
    `);
    this.db.transaction((vectors) => {
      for (const item of vectors) {
        stmt.run(item.factId, Buffer.from(item.embedding.buffer));
      }
    })(items);
  }
  /**
   * Perform a KNN search for the closest chunks to a query embedding.
   * @param queryEmbedding - Float32Array of length 384
   * @param topK - Number of results to return
   * @param chatId - Optional chat ID to filter results by
   */
  search(queryEmbedding, topK = 10, chatId) {
    if (!this.isAvailable) {
      console.warn("[VectorRepository] sqlite-vec not available — returning empty results");
      return [];
    }
    const buffer = Buffer.from(queryEmbedding.buffer);
    let sql = `
      SELECT v.chunk_id, v.distance
      FROM vectors v
    `;
    const params = [buffer];
    if (chatId) {
      sql += ` JOIN chunks c ON c.id = v.chunk_id
      WHERE v.embedding MATCH ? AND c.chat_id = ? `;
      params.push(chatId);
    } else {
      sql += ` WHERE v.embedding MATCH ? `;
    }
    sql += ` ORDER BY v.distance ASC LIMIT ? `;
    params.push(topK);
    const rows = this.db.prepare(sql).all(...params);
    return rows;
  }
  /**
   * Hybrid search: combines semantic similarity (KNN) with FTS5 keyword scoring
   * utilizing the Reciprocal Rank Fusion (RRF) algorithm for robust score normalization.
   * @param queryEmbedding - Float32Array of length 384
   * @param queryText - Original query string for FTS5
   * @param topK - Number of results
   * @param alpha - Weight for semantic score (1 - alpha = FTS5 weight). Default 0.7
   * @param chatId - Optional chat ID to filter results by
   */
  hybridSearch(queryEmbedding, queryText, topK = 10, alpha = 0.7, chatId) {
    return this._hybridSearchCore(
      "chunks",
      "chunk_id",
      "vectors",
      "chunks_fts",
      queryEmbedding,
      queryText,
      topK,
      alpha,
      chatId,
      "chat_id",
      "content"
    );
  }
  /**
   * Hybrid search optimized for Profile Facts.
   */
  hybridSearchFacts(queryEmbedding, queryText, topK = 10, alpha = 0.7, chatId) {
    return this._hybridSearchCore(
      "profile_facts",
      "fact_id",
      "profile_facts_vectors",
      "profile_facts_fts",
      queryEmbedding,
      queryText,
      topK,
      alpha,
      chatId,
      "contact_id",
      "text"
    );
  }
  _hybridSearchCore(baseTable, idColumn, vecTable, ftsTable, queryEmbedding, queryText, topK, alpha, chatId, chatIdColumn = "chat_id", ftsContentColumn = "content") {
    if (!this.isAvailable) {
      return this.ftsOnly(queryText, topK, chatId, ftsTable, baseTable, idColumn, chatIdColumn);
    }
    const buffer = Buffer.from(queryEmbedding.buffer);
    const beta = 1 - alpha;
    const fetchCount = topK * 5;
    const semTable = chatId ? `${vecTable} v JOIN ${baseTable} c ON c.id = v.${idColumn}` : `${vecTable} v`;
    const semWhere = chatId ? `v.embedding MATCH ? AND v.k = ? AND c.${chatIdColumn} = ?` : `v.embedding MATCH ? AND v.k = ?`;
    const kwTable = chatId ? `${ftsTable} f JOIN ${baseTable} c ON c.id = f.${idColumn}` : `${ftsTable} f`;
    const kwWhere = chatId ? `f.${ftsContentColumn} MATCH ? AND c.${chatIdColumn} = ?` : `f.${ftsContentColumn} MATCH ?`;
    const sql = `
      WITH semantic AS (
        SELECT v.${idColumn} as record_id, v.distance as sem_dist,
               row_number() OVER (ORDER BY v.distance ASC) as sem_rank
        FROM ${semTable}
        WHERE ${semWhere}
      ),
      keyword AS (
        SELECT f.${idColumn} as record_id, f.rank as kw_score,
               row_number() OVER (ORDER BY f.rank ASC) as kw_rank
        FROM ${kwTable}
        WHERE ${kwWhere}
        LIMIT ?
      ),
      combined AS (
        SELECT
          COALESCE(s.record_id, k.record_id) AS record_id,
          (? * COALESCE(1.0 / (60.0 + s.sem_rank), 0.0))
          + (? * COALESCE(1.0 / (60.0 + k.kw_rank), 0.0)) AS score
        FROM semantic s
        FULL OUTER JOIN keyword k ON s.record_id = k.record_id
      )
      SELECT record_id as chunk_id, (1.0 - score) AS distance
      FROM combined
      ORDER BY score DESC
      LIMIT ?
    `;
    const params = [];
    params.push(buffer, fetchCount);
    if (chatId) params.push(chatId);
    params.push(queryText);
    if (chatId) params.push(chatId);
    params.push(fetchCount, alpha, beta, topK);
    return this.db.prepare(sql).all(...params);
  }
  /**
   * Delete all vectors for a given chat's chunks.
   */
  deleteByChatId(chatId) {
    if (!this.isAvailable) return;
    const chunkIds = this.db.prepare(
      "SELECT id FROM chunks WHERE chat_id = ?"
    ).all(chatId);
    if (chunkIds.length === 0) return;
    const deleteStmt = this.db.prepare("DELETE FROM vectors WHERE chunk_id = ?");
    const runAll = this.db.transaction(() => {
      for (const { id } of chunkIds) {
        deleteStmt.run(id);
      }
    });
    runAll();
  }
  /** Returns true if the sqlite-vec extension is loaded and the vectors table exists. */
  checkAvailability() {
    try {
      this.db.prepare("SELECT vec_version()").get();
      const tableExists = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='vectors'
      `).get();
      if (!tableExists) {
        console.log("[VectorRepository] Self-healing: creating missing vectors table");
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
            chunk_id TEXT PRIMARY KEY,
            embedding FLOAT[768]
          );
        `);
      }
      return true;
    } catch {
      return false;
    }
  }
  /** Pure FTS5 fallback when sqlite-vec is unavailable. */
  ftsOnly(queryText, topK, chatId, ftsTable = "chunks_fts", baseTable = "chunks", idColumn = "chunk_id", chatIdColumn = "chat_id") {
    try {
      let sql = `SELECT f.${idColumn} as chunk_id, f.rank as distance FROM ${ftsTable} f`;
      const params = [];
      const contentCol = ftsTable === "chunks_fts" ? "content" : "text";
      if (chatId) {
        sql += ` JOIN ${baseTable} c ON c.id = f.${idColumn} WHERE f.${contentCol} MATCH ? AND c.${chatIdColumn} = ?`;
        params.push(queryText, chatId);
      } else {
        sql += ` WHERE f.${contentCol} MATCH ?`;
        params.push(queryText);
      }
      sql += ` ORDER BY f.rank LIMIT ?`;
      params.push(topK);
      return this.db.prepare(sql).all(...params);
    } catch (err) {
      console.warn("[VectorRepository] ftsOnly failed:", err);
      return [];
    }
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
      const chunkRepo = new ChunkRepository(db);
      const chatRepo = new ChatRepository(db);
      const vectorRepo = new VectorRepository(db);
      vectorRepo.deleteByChatId(chatId);
      chunkRepo.deleteByChatId(chatId);
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
class TimeWindowStrategy {
  constructor(config) {
    this.config = config;
  }
  chunk(messages) {
    if (messages.length === 0) return [];
    const chunks = [];
    let windowMessages = [];
    const flushChunk = () => {
      if (windowMessages.length === 0) return;
      chunks.push(buildChunk(windowMessages));
    };
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (windowMessages.length === 0) {
        windowMessages.push(msg);
        continue;
      }
      const lastMsg = windowMessages[windowMessages.length - 1];
      const gap = msg.timestamp - lastMsg.timestamp;
      const currentTokens = estimateTokenCount(windowMessages);
      const msgTokens = estimateTokensForMessage(msg);
      const exceedsTimeWindow = gap > this.config.timeWindowSeconds;
      const exceedsTokenBudget = currentTokens + msgTokens > this.config.maxTokens;
      if (exceedsTimeWindow || exceedsTokenBudget) {
        flushChunk();
        const overlapStart = Math.max(
          0,
          windowMessages.length - this.config.overlapMessages
        );
        windowMessages = windowMessages.slice(overlapStart);
        windowMessages.push(msg);
      } else {
        windowMessages.push(msg);
      }
    }
    flushChunk();
    return chunks;
  }
}
function buildChunk(messages) {
  const participants = [...new Set(messages.map((m) => m.sender))];
  const content = messages.filter((m) => m.type !== "system").map((m) => `${m.sender}: ${m.content}`).join("\n");
  const displayContent = messages.map((m) => {
    const timeStr = formatTime(m.timestamp);
    return `${m.sender} [${timeStr}]: ${m.content}`;
  }).join("\n");
  const startTime = messages[0].timestamp;
  const endTime = messages[messages.length - 1].timestamp;
  return {
    content,
    displayContent,
    startTime,
    endTime,
    messageCount: messages.length,
    tokenCount: estimateTokenCount(messages),
    participants
  };
}
function estimateTokenCount(messages) {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(totalChars / 4);
}
function estimateTokensForMessage(msg) {
  return Math.ceil(msg.content.length / 4);
}
function formatTime(unixSeconds) {
  const d = new Date(unixSeconds * 1e3);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
const DEFAULT_CHUNKING_CONFIG = {
  timeWindowSeconds: 10 * 60,
  // 10 minutos (era 5)
  maxTokens: 512,
  // (era 256)
  overlapMessages: 3
  // (era 1)
};
class ChunkingEngine {
  constructor(config = {}) {
    __publicField(this, "strategy");
    const mergedConfig = {
      ...DEFAULT_CHUNKING_CONFIG,
      ...config
    };
    this.strategy = new TimeWindowStrategy(mergedConfig);
  }
  /**
   * Chunk an array of parsed messages into semantic groups.
   * Messages are assumed to be pre-sorted by timestamp ascending.
   */
  chunk(messages) {
    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
    return this.strategy.chunk(sorted);
  }
}
const MODEL_REGISTRY = {
  /**
   * nomic-embed-text-v1.5 — Extremely capable Semantic Embedding Model, 768 dimensions.
   *
   * Replaces 'all-MiniLM' to provide an industry-leading context window (8192 tokens),
   * ensuring massive monolithic text chunks never overflow the context.
   * Superior multimodal and varied-context search recall.
   * Size: ~80MB (Q4_K_M).
   *
   * Repo: nomic-ai/nomic-embed-text-v1.5-GGUF
   */
  embedding: {
    key: "embedding",
    name: "nomic-embed-text-v1.5",
    uri: "hf:nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M",
    sizeEstimate: 8e7,
    // ~80MB
    purpose: "embedding",
    dimensions: 768,
    quantization: "Q4_K_M"
  },
  /**
   * Gemma 3 270M IT — Instruction-tuned generative model.
   *
   * Q4_K_M strikes the optimal balance between inference speed and quality
   * for a 270M parameter model. At this scale, quantization below Q4 becomes
   * noticeably degraded; Q4_K_M maintains coherent output.
   * Size: ~150MB
   *
   * Used in TASK 3.x (LLM service). Downloaded now so the user doesn't wait
   * when they first use the chat feature.
   *
   * Repo: bartowski/google_gemma-3-270m-it-GGUF
   */
  llm: {
    key: "llm",
    name: "Gemma 3 270M IT",
    uri: "hf:bartowski/google_gemma-3-270m-it-GGUF:Q4_K_M",
    sizeEstimate: 15e7,
    // ~150MB
    purpose: "generation",
    quantization: "Q4_K_M"
  }
};
const MODEL_DOWNLOAD_ORDER = ["embedding", "llm"];
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
async function detectGpu() {
  const llama = await getLlama();
  const backend = llama.gpu;
  return {
    vulkan: backend === "vulkan",
    cuda: backend === "cuda",
    metal: backend === "metal",
    backend
  };
}
const DEFAULT_SETTINGS = {
  gpu: "auto",
  temperature: 0.3,
  systemPrompt: "Você é um assistente encarregado de ler históricos de chat. Responda apenas com o que estiver no contexto.",
  topK: 5,
  alpha: 0.7,
  history: true,
  analytics: false,
  customLlmPath: null,
  customEmbeddingPath: null
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
    const hasLlmChanged = "customLlmPath" in partial && partial.customLlmPath !== this.currentSettings.customLlmPath;
    const hasEmbChanged = "customEmbeddingPath" in partial && partial.customEmbeddingPath !== this.currentSettings.customEmbeddingPath;
    this.currentSettings = {
      ...this.currentSettings,
      ...partial
    };
    this.save();
    if (hasGpuChanged || hasLlmChanged || hasEmbChanged) {
      setTimeout(async () => {
        console.log("[SettingsService] Critical backend setting changed. Disposing active models for cold-restart.");
        const { LLMService: LLMService2 } = await Promise.resolve().then(() => LLMService$1);
        const { EmbeddingService: EmbeddingService2 } = await Promise.resolve().then(() => EmbeddingService$1);
        try {
          LLMService2.getInstance().dispose();
        } catch (e) {
        }
        try {
          EmbeddingService2.getInstance().dispose();
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
const _EmbeddingService = class _EmbeddingService {
  constructor() {
    __publicField(this, "llama", null);
    __publicField(this, "model", null);
    __publicField(this, "context", null);
    // LlamaEmbeddingContext type varies in exports depending on the wrapper
    __publicField(this, "initPromise", null);
    __publicField(this, "gpuAccelerated", false);
  }
  static getInstance() {
    if (!_EmbeddingService.instance) {
      _EmbeddingService.instance = new _EmbeddingService();
    }
    return _EmbeddingService.instance;
  }
  /**
   * Lazily initializes the node-llama-cpp runtime, resolves the embedding model 
   * via ModelManager, and allocates the embedding context.
   */
  async initialize() {
    if (this.isReady()) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        console.log("[EmbeddingService] Initializing node-llama-cpp runtime...");
        this.llama = await getLlama();
        const gpuInfo = await detectGpu();
        this.gpuAccelerated = gpuInfo.backend !== false;
        console.log(`[EmbeddingService] GPU Detected: ${gpuInfo.backend || "none"}`);
        console.log("[EmbeddingService] Resolving embedding model...");
        const customPath = SettingsService.getInstance().get().customEmbeddingPath;
        let modelPath = customPath && fs.existsSync(customPath) ? customPath : await ModelManager.getInstance().resolve("embedding");
        this.model = await this.llama.loadModel({
          modelPath,
          // Since embeddings are fast, we can offload layers fully to GPU if available
          gpuLayers: "max"
        });
        this.context = await this.model.createEmbeddingContext({
          contextSize: Math.max(4096, this.model.trainContextSize ?? 0)
        });
        console.log(`[EmbeddingService] Initialization complete. Hardware acceleration: ${this.gpuAccelerated}`);
      } catch (err) {
        console.error("[EmbeddingService] Failed to initialize:", err);
        throw err;
      }
    })();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }
  isReady() {
    return this.model !== null && this.context !== null;
  }
  /**
   * Generates an L2-normalized embedding for a single text block.
   */
  async embed(text) {
    if (!this.isReady()) {
      await this.initialize();
    }
    if (!text.trim()) {
      return new Float32Array(MODEL_REGISTRY.embedding.dimensions);
    }
    const safeText = text.length > 1e4 ? text.substring(0, 1e4) : text;
    const start = performance.now();
    const { vector } = await this.context.getEmbeddingFor(safeText);
    const normalized = this.normalizeL2(vector);
    const floatArr = Float32Array.from(normalized);
    const end = performance.now();
    console.log(`[EmbeddingService] Embed single: ${Math.round(end - start)}ms`);
    return floatArr;
  }
  /**
   * Processes an array of text chunks sequentially to prevent VRAM overflow
   * and context contention. Useful for bulk importing.
   */
  async embedBatch(texts) {
    if (!this.isReady()) {
      await this.initialize();
    }
    console.log(`[EmbeddingService] Starting batch embed for ${texts.length} items...`);
    const start = performance.now();
    const results = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    const end = performance.now();
    console.log(`[EmbeddingService] Batch embed complete. Total items: ${texts.length}. Time: ${Math.round(end - start)}ms. Avg: ${Math.round((end - start) / texts.length)}ms/item.`);
    return results;
  }
  /**
   * Normalizes a vector to L2 unit length.
   * This is mathematically required to treat Euclidean Distance as Cosine Distance.
   */
  normalizeL2(vector) {
    const norm = Math.sqrt(vector.reduce((acc, val) => acc + val * val, 0));
    if (norm === 0) return vector;
    return vector.map((val) => val / norm);
  }
  getInfo() {
    return {
      modelName: MODEL_REGISTRY.embedding.name,
      dimensions: MODEL_REGISTRY.embedding.dimensions,
      gpuAccelerated: this.gpuAccelerated
    };
  }
  /**
   * Frees C++ bindings and clears VRAM. 
   * MUST be called during application shutdown to avoid memory leaks.
   */
  dispose() {
    if (this.context) {
      this.context.dispose();
      this.context = null;
    }
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.llama = null;
    console.log("[EmbeddingService] Disposed and cleared memory.");
  }
};
__publicField(_EmbeddingService, "instance", null);
let EmbeddingService = _EmbeddingService;
const EmbeddingService$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  EmbeddingService
}, Symbol.toStringTag, { value: "Module" }));
const STOPWORDS = /* @__PURE__ */ new Set([
  "que",
  "não",
  "pra",
  "com",
  "uma",
  "por",
  "mas",
  "como",
  "mais",
  "isso",
  "esse",
  "essa",
  "tem",
  "tá",
  "vai",
  "vou",
  "foi",
  "era",
  "são",
  "nos",
  "das",
  "dos",
  "ele",
  "ela",
  "meu",
  "sua",
  "seu",
  "pro",
  "sim",
  "tbm",
  "aqui",
  "ali",
  "hj",
  "aí",
  "né",
  "tô",
  "vc",
  "voce",
  "kkk",
  "kkkk",
  "kkkkk",
  "haha",
  "hahaha",
  "rsrs",
  "lol",
  "para",
  "nao",
  "q",
  "tb",
  "da",
  "de",
  "do",
  "e",
  "o",
  "a",
  "os",
  "as",
  "em",
  "um",
  "umas",
  "uns",
  "no",
  "na",
  "se",
  "ao",
  "aos"
]);
function computeTermStats(messages) {
  const stats = /* @__PURE__ */ new Map();
  for (const msg of messages) {
    if (msg.type !== "text") continue;
    const words = msg.content.toLowerCase().replace(/[?.!,;:'"()\\[\\]{}]/g, "").split(/\\s+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
    const ngrams = [];
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        const gram = words.slice(i, i + n).join(" ");
        if (gram.length >= 3) {
          ngrams.push(gram);
        }
      }
    }
    for (const gram of ngrams) {
      const existing = stats.get(gram);
      if (existing) {
        existing.totalCount++;
        existing.countBySender[msg.sender] = (existing.countBySender[msg.sender] || 0) + 1;
        if (msg.timestamp < existing.firstSeen) existing.firstSeen = msg.timestamp;
        if (msg.timestamp > existing.lastSeen) existing.lastSeen = msg.timestamp;
        if (existing.sampleMessages.length < 5) {
          const sample = `[${msg.sender}]: ${msg.content}`;
          if (!existing.sampleMessages.includes(sample)) {
            existing.sampleMessages.push(sample);
          }
        }
      } else {
        stats.set(gram, {
          term: gram,
          totalCount: 1,
          countBySender: { [msg.sender]: 1 },
          firstSeen: msg.timestamp,
          lastSeen: msg.timestamp,
          sampleMessages: [`[${msg.sender}]: ${msg.content}`]
        });
      }
    }
  }
  const totalMsgs = messages.length;
  return [...stats.values()].filter((s) => {
    if (s.totalCount < 3) return false;
    if (s.totalCount / totalMsgs > 0.3) return false;
    if (/^\\d+$/.test(s.term)) return false;
    return true;
  }).sort((a, b) => b.totalCount - a.totalCount);
}
const TOPIC_PROBES = {
  gaming: ["vamos jogar um jogo online video game pc console", "bora uma partida rankeada"],
  going_out: ["vamos sair esse fim de semana bar festa role", "combinar de ir jantar almocar"],
  tech: ["meu celular pc notebook formatar ssd", "aplicativo erro bug software hardware"],
  work: ["trabalho reuniao chefe relatorio demanda", "meu trampo projeto cliente faturamento"],
  study: ["tenho prova amanha faculdade escola curso", "preciso estudar tcc certificado apostila"],
  relationships: ["brigou com o namorado relacionamento casal beijo", "to ficando sentindo saudade crush"],
  food: ["pedir comida delivery ifood pizza lanche", "vamos comer onde janta almoco fome"],
  media: ["assisti um filme muito bom cinema roteiro", "serie nova anime tv assistir ep"],
  finances: ["me empresta um dinheiro pix banco nubank", "to sem grana preco caro barato salario"],
  health: ["fui no medico hospital remedio farmacia", "to passando mal dor de cabeca febre tonto"]
};
const TOPIC_LABELS = {
  gaming: "jogos e partidas",
  going_out: "sair e encontros",
  tech: "tecnologia e problemas técnicos",
  work: "trabalho e demandas profissionais",
  study: "estudos e educação",
  relationships: "relacionamentos sentimentais",
  food: "comida e refeições",
  media: "filmes, séries e mídia",
  finances: "finanças, bancos e dinheiro",
  health: "saúde e bem-estar"
};
class TopicClassifier {
  constructor() {
    __publicField(this, "centroids", /* @__PURE__ */ new Map());
  }
  async init() {
    console.log("[TopicClassifier] Initializing general zero-shot probes...");
    const embedder = EmbeddingService.getInstance();
    for (const [topic, probes] of Object.entries(TOPIC_PROBES)) {
      const vectors = await embedder.embedBatch(probes);
      const centroid = this.averageVectors(vectors);
      this.centroids.set(topic, centroid);
    }
    console.log("[TopicClassifier] Initialized", this.centroids.size, "topics");
  }
  classify(chunkEmbedding) {
    let best = { topic: "", score: -1 };
    for (const [topic, centroid] of this.centroids.entries()) {
      const sim = this.cosineSimilarity(chunkEmbedding, centroid);
      if (sim > best.score) {
        best = { topic, score: sim };
      }
    }
    return best.score >= 0.35 ? best : null;
  }
  averageVectors(vectors) {
    if (!vectors.length) return new Float32Array(384);
    const dim = vectors[0].length;
    const centroid = new Float32Array(dim);
    for (const v of vectors) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += v[i];
      }
    }
    for (let i = 0; i < dim; i++) {
      centroid[i] /= vectors.length;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      norm += centroid[i] * centroid[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        centroid[i] /= norm;
      }
    }
    return centroid;
  }
  cosineSimilarity(a, b) {
    let dotProduct = 0;
    let aMagnitude = 0;
    let bMagnitude = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      aMagnitude += a[i] * a[i];
      bMagnitude += b[i] * b[i];
    }
    if (aMagnitude === 0 || bMagnitude === 0) return 0;
    return dotProduct / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude));
  }
}
function buildProfileFacts(contactName, contactId, termStats, topicCounts, totalChunks) {
  const facts = [];
  const topTerms = termStats.slice(0, 20);
  for (const term of topTerms) {
    const topSender = Object.entries(term.countBySender).sort((a, b) => b[1] - a[1])[0];
    const firstSeenDate = new Date(term.firstSeen * 1e3).toLocaleDateString("pt-BR");
    const lastSeenDate = new Date(term.lastSeen * 1e3).toLocaleDateString("pt-BR");
    facts.push({
      contact_id: contactId,
      text: `O assunto ou termo "${term.term}" é mencionado frequentemente na conversa com ${contactName}. Apareceu ${term.totalCount} vezes. ${topSender[0]} é quem mais fala sobre "${term.term}" (${topSender[1]} vezes). Período de citação: ${firstSeenDate} a ${lastSeenDate}. Exemplo na conversa: ${term.sampleMessages[0]}`,
      evidence: term.totalCount,
      category: "frequent_term"
    });
  }
  for (const [topic, count] of topicCounts.entries()) {
    if (count < 2) continue;
    const pct = (count / totalChunks * 100).toFixed(0);
    const label = TOPIC_LABELS[topic];
    facts.push({
      contact_id: contactId,
      text: `${contactName} e o usuário conversam ativamente sobre ${label}. Este assunto apareceu em aproximadamente ${pct}% das conversas (${count} de ${totalChunks} agrupamentos).`,
      evidence: count,
      category: "topic"
    });
  }
  const coOccurrences = findCoOccurrences(termStats);
  for (const co of coOccurrences.slice(0, 5)) {
    facts.push({
      contact_id: contactId,
      text: `"${co.termA}" e "${co.termB}" são assuntos que aparecem juntos frequentemente na conversa com ${contactName}. Isso ocorreu ${co.count} vezes diferentes em períodos similares.`,
      evidence: co.count,
      category: "co_occurrence"
    });
  }
  return facts;
}
function findCoOccurrences(termStats) {
  const pairs = [];
  const candidateTerms = termStats.slice(0, 15);
  for (let i = 0; i < candidateTerms.length; i++) {
    for (let j = i + 1; j < candidateTerms.length; j++) {
      const a = candidateTerms[i];
      const b = candidateTerms[j];
      let overlapCount = 0;
      for (const msgA of a.sampleMessages) {
        for (const msgB of b.sampleMessages) {
          if (msgA === msgB) overlapCount++;
        }
      }
      if (overlapCount > 0 && !a.term.includes(b.term) && !b.term.includes(a.term)) {
        pairs.push({ termA: a.term, termB: b.term, count: overlapCount });
      }
    }
  }
  return pairs.sort((a, b) => b.count - a.count);
}
class ProfileFactRepository {
  constructor(db) {
    this.db = db;
  }
  /**
   * Insert a batch of ProfileFacts into the database.
   */
  insertBatch(facts) {
    const stmt = this.db.prepare(`
      INSERT INTO profile_facts (id, contact_id, category, text, evidence)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.db.transaction((items) => {
      for (const item of items) {
        stmt.run(item.id, item.contact_id, item.category, item.text, item.evidence);
      }
    })(facts);
  }
  /**
   * Delete all profile facts for a specific chat.
   */
  deleteByChatId(chatId) {
    this.db.prepare("DELETE FROM profile_facts WHERE contact_id = ?").run(chatId);
  }
  /**
   * Retrieve all profile facts for a specific chat, ordered by highest evidence.
   */
  findByChatId(chatId) {
    return this.db.prepare(`
      SELECT * FROM profile_facts 
      WHERE contact_id = ? 
      ORDER BY evidence DESC
    `).all(chatId);
  }
}
const _dirname = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const _LLMService = class _LLMService {
  constructor() {
    __publicField(this, "worker", null);
    __publicField(this, "pendingRequests", /* @__PURE__ */ new Map());
    __publicField(this, "initializationPromise", null);
    __publicField(this, "ready", false);
  }
  static getInstance() {
    if (!_LLMService.instance) {
      _LLMService.instance = new _LLMService();
    }
    return _LLMService.instance;
  }
  async initialize() {
    if (this.ready) return;
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = new Promise(async (resolve, reject) => {
      try {
        console.log("[LLMService] Resolving LLM model path...");
        const customPath = SettingsService.getInstance().get().customLlmPath;
        let modelPath = customPath && fs.existsSync(customPath) ? customPath : await ModelManager.getInstance().resolve("llm");
        console.log("[LLMService] Forking Utility Process...");
        const workerPath = path.join(_dirname, "llm-worker.js");
        this.worker = utilityProcess.fork(workerPath, [], {
          stdio: "inherit"
          // Permite ler a stdout/stderr do child process no terminal
        });
        this.worker.on("message", (msg) => this.handleWorkerMessage(msg));
        this.worker.on("exit", (code) => {
          console.warn(`[LLMService] Utility process exited with code ${code}`);
          this.ready = false;
          this.worker = null;
          this.rejectAllPending(new Error(`LLM Worker exited unexpectedly with code ${code}`));
        });
        const id = nanoid();
        this.pendingRequests.set(id, {
          resolve: () => {
            console.log("[LLMService] Utility Process initialized successfully.");
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
        console.error("[LLMService] Failed to initialize:", err);
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
      modelName: MODEL_REGISTRY.llm.name,
      parameters: "270M"
    };
  }
  async dispose() {
    if (!this.worker) return;
    console.log("[LLMService] Disposing worker...");
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
    this.rejectAllPending(new Error("LLMService is disposing or shutting down"));
    this.initializationPromise = null;
  }
  handleWorkerMessage(msg) {
    const { type, id, error, token, text } = msg;
    if (!id || !this.pendingRequests.has(id)) {
      if (type === "error") {
        console.error(`[LLMWorker Global Error]`, error);
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
        console.warn(`[LLMWorker] Unrecognized message type '${type}'`);
    }
  }
  rejectAllPending(error) {
    for (const [id, req] of this.pendingRequests.entries()) {
      req.reject(error);
      this.pendingRequests.delete(id);
    }
  }
};
__publicField(_LLMService, "instance", null);
let LLMService = _LLMService;
const LLMService$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  LLMService
}, Symbol.toStringTag, { value: "Module" }));
class ContactProfileRepository {
  constructor(db) {
    this.db = db;
  }
  save(profile) {
    const stmt = this.db.prepare(`
      INSERT INTO contact_profiles 
        (id, contact_id, contact_name, profile_text, message_count,
         date_range_start, date_range_end, model_used, block_count, processing_time_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(contact_id) DO UPDATE SET
        contact_name = excluded.contact_name,
        profile_text = excluded.profile_text,
        message_count = excluded.message_count,
        date_range_start = excluded.date_range_start,
        date_range_end = excluded.date_range_end,
        model_used = excluded.model_used,
        block_count = excluded.block_count,
        processing_time_ms = excluded.processing_time_ms,
        updated_at = strftime('%s', 'now')
    `);
    stmt.run(
      profile.id || profile.contact_id,
      // fallback se não passar id
      profile.contact_id,
      profile.contact_name,
      profile.profile_text,
      profile.message_count,
      profile.date_range_start,
      profile.date_range_end,
      profile.model_used || "llm-worker",
      profile.block_count,
      profile.processing_time_ms
    );
  }
  findByChatId(chatId) {
    const row = this.db.prepare(
      "SELECT * FROM contact_profiles WHERE contact_id = ?"
    ).get(chatId);
    return row || null;
  }
  deleteByChatId(chatId) {
    this.db.prepare("DELETE FROM contact_profiles WHERE contact_id = ?").run(chatId);
  }
}
class BlockSummaryRepository {
  constructor(db) {
    this.db = db;
  }
  save(summary) {
    const stmt = this.db.prepare(`
      INSERT INTO block_summaries 
        (id, contact_id, block_index, summary_text, start_date, end_date, message_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(contact_id, block_index) DO UPDATE SET
        summary_text = excluded.summary_text,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        message_count = excluded.message_count,
        created_at = strftime('%s', 'now')
    `);
    stmt.run(
      nanoid(),
      summary.contact_id,
      summary.block_index,
      summary.summary_text,
      summary.start_date,
      summary.end_date,
      summary.message_count
    );
  }
  findByChatId(chatId) {
    return this.db.prepare(
      "SELECT * FROM block_summaries WHERE contact_id = ? ORDER BY block_index ASC"
    ).all(chatId);
  }
  deleteByChatId(chatId) {
    this.db.prepare("DELETE FROM block_summaries WHERE contact_id = ?").run(chatId);
  }
}
const EXTRACT_PROMPT = `
Leia o trecho de conversa fornecido e liste os fatos concretos mais importantes para entender os padrões de relacionamento entre as duas pessoas.

Diretrizes:
- Liste um fato por linha, começando com "- "
- Foque em interesses comuns, hobbies, problemas, dinâmicas de poder/iniciativa, etc.
- NÃO escreva introduções, conclusões ou comentários, não dê 'ok' ou 'claro'.
- Se não houver fatos relevantes, não escreva nada irrelevante, apenas diga "NENHUM".
- Responda apenas com a lista e nada mais.

Conversa:
"""
{conversation}
"""
`;
const CONSOLIDATE_PROMPT = `
Abaixo estão fatos extraídos sequencialmente de uma conversa completa ao longo do tempo.

Sua tarefa é CONSOLIDAR esses perfis em um "Perfil de Contato" robusto, coeso e descritivo, agrupando os fatos nas seguintes categorias (caso existam informações pertinentes):

- Interações Frequentes (dinâmica de contato, quem chama mais)
- Tópicos Principais (assuntos que sempre voltam a ser discutidos)
- Hobbies, Comidas e Interesses compartilhados
- Menções a Problemas e Eventos Importantes 
- Características comportamentais / Tom geral da conversa

Diretrizes:
- Escreva de forma fluída e conectada. Use parágrafos claros.
- Redija na terceira pessoa (ex: "O usuário e a pessoa conversam...", ou se citar a pessoa nominalmente, use o nome).
- Não invente informações. Se uma seção não tem fatos listados, não a preencha.
- Evite listar com "bullet points" vazios.
- Vá direto ao ponto! Nada de "Pode deixar, aqui está o resumo:"

Fatos do Bloco Histórico:
{summaries}
`;
class MapReduceEngine {
  constructor() {
    __publicField(this, "profileRepo");
    __publicField(this, "summaryRepo");
    __publicField(this, "llmService");
    const db = DatabaseService.getInstance();
    this.profileRepo = new ContactProfileRepository(db);
    this.summaryRepo = new BlockSummaryRepository(db);
    this.llmService = LLMService.getInstance();
  }
  /**
   * Run the Map-Reduce pipeline to generate a Contact Profile.
   */
  async runMapReduce(messages, contactName, contactId, onProgress) {
    const startTime = Date.now();
    const blocks = this.splitIntoBlocks(messages, 4500);
    if (blocks.length === 0) return null;
    onProgress == null ? void 0 : onProgress({
      stage: "parsing",
      // Mantemos a compatibilidade visual com os estágios já existentes ou criamos um novo
      percent: 30,
      // Entre o "Parsing" e "Chunking" tradicional
      label: "Dividindo Blocos (Map-Reduce)",
      detail: `${blocks.length} blocos gerados com ~4.5k tokens cada. Iniciando análise...`
    });
    const summariesList = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      onProgress == null ? void 0 : onProgress({
        stage: "parsing",
        percent: 30 + Math.round(i / blocks.length * 40),
        // Pula de 30 para 70% durante o Map
        label: `Analisando Bloco ${i + 1}/${blocks.length}`,
        detail: "Processamento Local LLM (Map Phase)"
      });
      const convoText = block.messages.map((m) => `[${new Date(m.timestamp * 1e3).toLocaleString("pt-BR")}][${m.sender}]: ${m.content}`).join("\\n");
      const prompt = EXTRACT_PROMPT.replace("{conversation}", convoText);
      let factsText = await this.llmService.generate(prompt, {
        maxTokens: 1024,
        temperature: 0.1,
        clearCache: true,
        systemPrompt: "Você é um bot analista neutro focado em extrair fatos frios. Nenhuma enrolação."
      });
      if (!factsText.toUpperCase().includes("NENHUM") && factsText.trim().length > 10) {
        summariesList.push({
          period: `${block.startDate} até ${block.endDate}`,
          text: factsText,
          messageCount: block.messages.length
        });
        this.summaryRepo.save({
          contact_id: contactId,
          block_index: block.index,
          start_date: block.startDate,
          end_date: block.endDate,
          message_count: block.messages.length,
          summary_text: factsText
        });
      }
    }
    if (summariesList.length === 0) {
      console.warn("[MapReduceEngine] Nenhuma fato relevante encontrado em nenhum bloco.");
      return null;
    }
    onProgress == null ? void 0 : onProgress({
      stage: "parsing",
      percent: 71,
      // Em tese a UI já está lá em cima
      label: "Consolidando Arquivo de Perfil",
      detail: "Redigindo dossiê completo (Reduce Phase)"
    });
    const consolidacaoRaw = summariesList.map((s) => `--- Período das conversas ${s.period} ---
${s.text}`).join("\n\n");
    const estimatedTokens = Math.ceil(consolidacaoRaw.length / 3.5);
    let finalProfileText = "";
    if (estimatedTokens > 6e3) {
      console.warn(`[MapReduceEngine] Reduzindo input de consolidação. Estimativa excedeu limites (${estimatedTokens})`);
      finalProfileText = await this.reduceRecursively(summariesList, contactName);
    } else {
      const promptConsolidate = CONSOLIDATE_PROMPT.replace("{summaries}", consolidacaoRaw);
      finalProfileText = await this.llmService.generate(promptConsolidate, {
        maxTokens: 2048,
        temperature: 0.2,
        systemPrompt: "Você é um perito sociológico construindo um perfil coeso baseando-se única e exclusivamente nos fatos anotados."
      });
    }
    const processingTime = Date.now() - startTime;
    const contactProfile = {
      contact_id: contactId,
      contact_name: contactName,
      profile_text: finalProfileText,
      message_count: messages.length,
      date_range_start: new Date(messages[0].timestamp * 1e3).toISOString(),
      date_range_end: new Date(messages[messages.length - 1].timestamp * 1e3).toISOString(),
      model_used: "qwen2.5/llama-worker",
      // We will fix standard naming soon
      block_count: blocks.length,
      processing_time_ms: processingTime
    };
    this.profileRepo.save(contactProfile);
    return contactProfile;
  }
  async reduceRecursively(summaries, contactName) {
    const promptConsolidate = CONSOLIDATE_PROMPT.replace("{summaries}", summaries.map((s) => s.text).join("\n"));
    return await this.llmService.generate(promptConsolidate, {
      maxTokens: 2048,
      temperature: 0.2
    });
  }
  splitIntoBlocks(messages, maxTokens) {
    var _a;
    const blocks = [];
    let current = [];
    let currentTokens = 0;
    let blockIndex = 0;
    for (const msg of messages) {
      const lineLen = msg.sender.length + (((_a = msg.content) == null ? void 0 : _a.length) || 0) + 20;
      const tokens = Math.ceil(lineLen / 3.5);
      if (currentTokens + tokens > maxTokens && current.length > 0) {
        blocks.push({
          messages: current,
          index: blockIndex++,
          startDate: new Date(current[0].timestamp * 1e3).toLocaleDateString("pt-BR"),
          endDate: new Date(current[current.length - 1].timestamp * 1e3).toLocaleDateString("pt-BR"),
          estimatedTokens: currentTokens
        });
        current = [];
        currentTokens = 0;
      }
      current.push(msg);
      currentTokens += tokens;
    }
    if (current.length > 0) {
      blocks.push({
        messages: current,
        index: blockIndex++,
        startDate: new Date(current[0].timestamp * 1e3).toLocaleDateString("pt-BR"),
        endDate: new Date(current[current.length - 1].timestamp * 1e3).toLocaleDateString("pt-BR"),
        estimatedTokens: currentTokens
      });
    }
    return blocks;
  }
}
class ChatImportService {
  constructor() {
    __publicField(this, "parser", new WhatsAppParser());
    __publicField(this, "chunker", new ChunkingEngine());
  }
  /**
   * Import a WhatsApp export .txt file.
   * @param filePath  Absolute path to the .txt file
   * @param sender    WebContents of the renderer window (for progress events)
   */
  async import(filePath, sender) {
    const emit = (progress) => {
      sender == null ? void 0 : sender.send("import:progress", progress);
    };
    let chatId;
    try {
      emit({ stage: "reading", percent: 5, label: "Lendo arquivo", detail: "Calculando hash do arquivo..." });
      const fileHash = await computeFileHash(filePath);
      const db = DatabaseService.getInstance();
      const chatRepo = new ChatRepository(db);
      const isDuplicate = chatRepo.existsByHash(fileHash);
      if (isDuplicate) {
        return {
          success: false,
          duplicate: true,
          error: "Este arquivo já foi importado anteriormente."
        };
      }
      const chatName = basename(filePath).replace(/\.[^/.]+$/, "");
      chatId = nanoid();
      emit({ stage: "parsing", percent: 20, label: "Parseando mensagens", detail: "Extraindo mensagens do formato WhatsApp..." });
      const parseResult = await this.parser.parse(filePath);
      if (parseResult.messages.length === 0) {
        return {
          success: false,
          error: "Nenhuma mensagem encontrada no arquivo. Verifique se o formato é suportado."
        };
      }
      emit({ stage: "parsing", percent: 40, label: "Parseando mensagens", detail: `${parseResult.messages.length.toLocaleString("pt-BR")} mensagens encontradas` });
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
      const mapReduceEngine = new MapReduceEngine();
      await mapReduceEngine.runMapReduce(newMessages, chatName, chatId, emit);
      emit({ stage: "chunking", percent: 50, label: "Segmentando chunks", detail: "Agrupando mensagens por janela de tempo..." });
      const rawChunks = this.chunker.chunk(parseResult.messages);
      const newChunks = rawChunks.map((c) => ({
        id: nanoid(),
        chat_id: chatId,
        content: c.content,
        display_content: c.displayContent,
        start_time: c.startTime,
        end_time: c.endTime,
        message_count: c.messageCount,
        token_count: c.tokenCount,
        participants: c.participants
      }));
      emit({ stage: "chunking", percent: 65, label: "Segmentando chunks", detail: `${rawChunks.length} chunks criados` });
      emit({ stage: "embedding", percent: 66, label: "Preparando IA", detail: "Verificando motor de busca semântica..." });
      const modelManager = ModelManager.getInstance();
      const isAvailable = await modelManager.isAvailable("embedding");
      if (!isAvailable) {
        emit({ stage: "embedding", percent: 66, label: "Baixando modelo", detail: "Iniciando download (apenas na 1ª vez)..." });
        await modelManager.download("embedding", (progress) => {
          const mbDownloaded = (progress.downloadedBytes / 1024 / 1024).toFixed(1);
          const mbTotal = (progress.totalBytes / 1024 / 1024).toFixed(1);
          emit({
            stage: "embedding",
            percent: 66 + Math.round(progress.percent * 0.08),
            // from 66 to 74%
            label: "Baixando modelo",
            detail: `${progress.percent}% — ${mbDownloaded}MB / ${mbTotal}MB`
          });
        });
      }
      emit({ stage: "embedding", percent: 74, label: "Inicializando IA", detail: "Carregando modelo na memória..." });
      const embeddingService = EmbeddingService.getInstance();
      await embeddingService.initialize();
      const vectorsToInsert = [];
      const BATCH_SIZE = 100;
      let processed = 0;
      for (let i = 0; i < newChunks.length; i += BATCH_SIZE) {
        const batch = newChunks.slice(i, i + BATCH_SIZE);
        const texts = batch.map((c) => c.content);
        const embeddings = await embeddingService.embedBatch(texts);
        for (let j = 0; j < batch.length; j++) {
          vectorsToInsert.push({ chunkId: batch[j].id, embedding: embeddings[j] });
        }
        processed += batch.length;
        emit({
          stage: "embedding",
          percent: 74 + Math.round(processed / newChunks.length * 11),
          // maps to 74-85%
          label: "Gerando embeddings",
          detail: `${processed} / ${newChunks.length} chunks`
        });
      }
      emit({ stage: "embedding", percent: 85, label: "Analisando perfil", detail: "Calculando N-grams e identificando tópicos..." });
      const termStats = computeTermStats(newMessages);
      const topicClassifier = new TopicClassifier();
      await topicClassifier.init();
      const topicCounts = /* @__PURE__ */ new Map();
      for (const { embedding } of vectorsToInsert) {
        const result = topicClassifier.classify(embedding);
        if (result) {
          topicCounts.set(result.topic, (topicCounts.get(result.topic) || 0) + 1);
        }
      }
      emit({ stage: "embedding", percent: 86, label: "Analisando perfil", detail: "Gerando Profile Facts (memórias sintéticas)..." });
      const rawFacts = buildProfileFacts(chatName, chatId, termStats, topicCounts, newChunks.length);
      const factsToInsert = [];
      const factVectorsToInsert = [];
      for (let i = 0; i < rawFacts.length; i += BATCH_SIZE) {
        const batch = rawFacts.slice(i, i + BATCH_SIZE);
        const texts = batch.map((f) => f.text);
        const embeddings = await embeddingService.embedBatch(texts);
        for (let j = 0; j < batch.length; j++) {
          const factId = nanoid();
          factsToInsert.push({ ...batch[j], id: factId });
          factVectorsToInsert.push({ factId, embedding: embeddings[j] });
        }
      }
      emit({ stage: "storing", percent: 88, label: "Salvando no banco", detail: "Persistindo dados da importação..." });
      const messageRepo = new MessageRepository(db);
      messageRepo.insertBatch(newMessages);
      emit({ stage: "storing", percent: 90, label: "Salvando no banco", detail: "Indexando chunks no FTS5..." });
      const chunkRepo = new ChunkRepository(db);
      chunkRepo.insertBatch(newChunks);
      emit({ stage: "storing", percent: 95, label: "Salvando no banco", detail: "Inserindo vetores e fatos de perfil..." });
      const vectorRepo = new VectorRepository(db);
      vectorRepo.insertBatch(vectorsToInsert);
      vectorRepo.insertFactBatch(factVectorsToInsert);
      const profileFactRepo = new ProfileFactRepository(db);
      profileFactRepo.insertBatch(factsToInsert);
      emit({ stage: "done", percent: 100, label: "Importação concluída", detail: `${parseResult.messages.length.toLocaleString("pt-BR")} mensagens indexadas` });
      return {
        success: true,
        chatId,
        chatName,
        messageCount: parseResult.messages.length,
        chunkCount: rawChunks.length
      };
    } catch (err) {
      try {
        if (chatId) {
          const db = DatabaseService.getInstance();
          const chatRepo = new ChatRepository(db);
          chatRepo.delete(chatId);
        }
      } catch (cleanupErr) {
        console.error("[ChatImportService] Cleanup failed:", cleanupErr);
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ChatImportService] Import failed:", message);
      emit({ stage: "error", percent: 0, label: "Erro na importação", detail: message });
      return { success: false, error: message };
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
    __publicField(this, "chunkRepo");
    __publicField(this, "vectorRepo");
    __publicField(this, "factRepo");
    const db = DatabaseService.getInstance();
    this.chatRepo = new ChatRepository(db);
    this.chunkRepo = new ChunkRepository(db);
    this.vectorRepo = new VectorRepository(db);
    this.factRepo = new ProfileFactRepository(db);
  }
  static getInstance() {
    if (!_SearchService.instance) {
      _SearchService.instance = new _SearchService();
    }
    return _SearchService.instance;
  }
  async search(query, options, precomputedEmbedding) {
    var _a;
    const start = performance.now();
    const config = SettingsService.getInstance().get();
    const limit = (options == null ? void 0 : options.limit) || config.topK;
    const isHybrid = (options == null ? void 0 : options.hybrid) ?? true;
    const alpha = config.alpha;
    const chatId = options == null ? void 0 : options.chatId;
    if (!query.trim()) return [];
    console.log(`[SearchService] Querying: "${query}" (hybrid: ${isHybrid}, chatId: ${chatId || "none"})`);
    let queryEmbedding;
    if (precomputedEmbedding) {
      queryEmbedding = precomputedEmbedding;
    } else {
      try {
        const embeddingService = EmbeddingService.getInstance();
        queryEmbedding = await embeddingService.embed(query);
      } catch (err) {
        console.error("[SearchService] Error generating embedding:", err);
        queryEmbedding = new Float32Array(384);
      }
    }
    const searchStart = performance.now();
    const STOPWORDS2 = /* @__PURE__ */ new Set([
      "que",
      "não",
      "pra",
      "com",
      "uma",
      "por",
      "mas",
      "como",
      "mais",
      "isso",
      "esse",
      "essa",
      "tem",
      "tá",
      "vai",
      "vou",
      "foi",
      "era",
      "são",
      "nos",
      "das",
      "dos",
      "ele",
      "ela",
      "meu",
      "sua",
      "seu",
      "pro",
      "sim",
      "qual",
      "o",
      "a",
      "de",
      "da",
      "do"
    ]);
    const ftsQuery = query.toLowerCase().replace(/[^\p{L}\p{N}\s_]/gu, " ").split(/\s+/).filter((w) => w.length >= 2 && !STOPWORDS2.has(w)).join(" OR ");
    const isPatternQuery = /sempre|frequente|geralmente|costume|toda hora|mais|quantas|padr/i.test(query);
    let vectorResults = [];
    let factVectorResults = [];
    if (isHybrid && ftsQuery.length > 0) {
      if (isPatternQuery) {
        factVectorResults = this.vectorRepo.hybridSearchFacts(queryEmbedding, ftsQuery, Math.max(limit, 5), alpha, chatId);
        vectorResults = this.vectorRepo.hybridSearch(queryEmbedding, ftsQuery, limit, alpha, chatId);
      } else {
        factVectorResults = this.vectorRepo.hybridSearchFacts(queryEmbedding, ftsQuery, 3, alpha, chatId);
        vectorResults = this.vectorRepo.hybridSearch(queryEmbedding, ftsQuery, limit, alpha, chatId);
      }
    } else {
      vectorResults = this.vectorRepo.search(queryEmbedding, limit, chatId);
    }
    const combinedScores = /* @__PURE__ */ new Map();
    const K = 60;
    vectorResults.forEach((r, i) => {
      combinedScores.set(`chunk-${r.chunk_id}`, { id: r.chunk_id, type: "chunk", score: 1 / (K + i + 1) });
    });
    factVectorResults.forEach((r, i) => {
      const key = `fact-${r.chunk_id}`;
      const existing = combinedScores.get(key);
      if (existing) {
        existing.score += 1 / (K + i + 1);
      } else {
        combinedScores.set(key, { id: r.chunk_id, type: "fact", score: 1 / (K + i + 1) });
      }
    });
    const sortedMerged = [...combinedScores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    const chunkIds = sortedMerged.filter((s) => s.type === "chunk").map((s) => s.id);
    const chunks = this.chunkRepo.findByIds(chunkIds);
    const chunkMap = new Map(chunks.map((c) => [c.id, c]));
    const factIds = sortedMerged.filter((s) => s.type === "fact").map((s) => s.id);
    const allFacts = factIds.length > 0 ? this.factRepo.findByChatId(chatId || ((_a = chunks[0]) == null ? void 0 : _a.chat_id) || "") : [];
    const factMap = new Map(allFacts.map((f) => [f.id, f]));
    const chatMap = /* @__PURE__ */ new Map();
    const finalResults = [];
    const getChatName = (cId) => {
      if (chatMap.has(cId)) return chatMap.get(cId);
      const chat = this.chatRepo.findById(cId);
      const name = chat ? chat.name : "Unknown Chat";
      chatMap.set(cId, name);
      return name;
    };
    for (const res of sortedMerged) {
      if (res.type === "chunk") {
        const chunk = chunkMap.get(res.id);
        if (!chunk) continue;
        const chatName = getChatName(chunk.chat_id);
        const date = new Date(chunk.start_time * 1e3);
        const formattedDate = new Intl.DateTimeFormat("pt-BR", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        }).format(date).replace(",", "");
        finalResults.push({
          id: `chunk-${chunk.id}`,
          chatId: chunk.chat_id,
          chatName,
          score: Math.min(1, res.score * 10),
          // Boost RRF visual score
          content: chunk.display_content,
          date: formattedDate,
          sender: chunk.participants.length > 0 ? chunk.participants[0] : "Unknown",
          chunkId: chunk.id
        });
      } else {
        const fact = factMap.get(res.id);
        if (!fact) continue;
        const chatName = getChatName(fact.contact_id);
        finalResults.push({
          id: `fact-${fact.id}`,
          chatId: fact.contact_id,
          chatName,
          score: Math.min(1, res.score * 10),
          // Boost RRF visual score
          content: `📊 *Fato de Perfil*
${fact.text}`,
          date: "Análise Estatística",
          sender: "🤖 Sistema",
          chunkId: fact.id
        });
      }
    }
    const end = performance.now();
    console.log(`[SearchService] Search complete in ${Math.round(end - start)}ms (DB: ${Math.round(end - searchStart)}ms). Found ${finalResults.length} results.`);
    return finalResults;
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
const promptTemplates = {
  buildRAGPrompt: (question, chunks) => {
    const formattedChunks = chunks.map((c) => `[${c.date} - ${c.sender}]: ${c.content}`).join("\n\n");
    const systemPrompt = `Você é um assistente que responde perguntas sobre históricos de conversa. Baseie sua resposta apenas no contexto fornecido.`;
    const userPrompt = `Contexto das mensagens:
${formattedChunks}

Pergunta: ${question}

Responda de forma direta com base apenas no contexto acima.`;
    return { systemPrompt, userPrompt };
  }
};
const _RAGService = class _RAGService {
  constructor() {
  }
  static getInstance() {
    if (!_RAGService.instance) {
      _RAGService.instance = new _RAGService();
    }
    return _RAGService.instance;
  }
  async generateStream(question, onToken, options) {
    const totalStart = performance.now();
    const latency = { embedding: 0, search: 0, generation: 0, total: 0 };
    let context = [];
    try {
      const embeddingStart = performance.now();
      const embeddingService = EmbeddingService.getInstance();
      let queryEmbedding;
      try {
        queryEmbedding = await embeddingService.embed(question);
        latency.embedding = performance.now() - embeddingStart;
      } catch (err) {
        console.error("[RAGService] Error generating embedding:", err);
        queryEmbedding = new Float32Array(384);
      }
      const needsSpecifics = /\b(disse|falou|mandou|exatamente|literalmente|quando|que dia|que hora|última mensagem|print|copia|cole|como assim)\b/i.test(question);
      const profileRepo = new ContactProfileRepository(DatabaseService.getInstance());
      const contactProfile = (options == null ? void 0 : options.chatId) ? profileRepo.findByChatId(options.chatId) : null;
      const config = SettingsService.getInstance().get();
      const searchStart = performance.now();
      if (contactProfile && !needsSpecifics) {
        context.push({
          id: `profile-${contactProfile.id}`,
          chatId: contactProfile.contact_id,
          chatName: contactProfile.contact_name,
          score: 1,
          content: `PERFIL DA CONVERSA E FATOS GERAIS:
${contactProfile.profile_text}`,
          date: "Análise Dossiê",
          sender: "🤖 Sistema",
          chunkId: contactProfile.id
        });
      } else {
        const searchService = SearchService.getInstance();
        context = await searchService.search(question, { hybrid: true, limit: config.topK, chatId: options == null ? void 0 : options.chatId }, queryEmbedding);
        if (contactProfile) {
          context.unshift({
            id: `profile-${contactProfile.id}`,
            chatId: contactProfile.contact_id,
            chatName: contactProfile.contact_name,
            score: 1,
            content: `PERFIL DA CONVERSA:
${contactProfile.profile_text}`,
            date: "Análise Dossiê",
            sender: "🤖 Sistema",
            chunkId: contactProfile.id
          });
        }
      }
      latency.search = performance.now() - searchStart;
      if (context.length === 0) {
        latency.total = performance.now() - totalStart;
        return {
          answer: "Não encontrei trechos de conversa relevantes para a sua pergunta.",
          context,
          tokensUsed: 0,
          latency
        };
      }
      const { userPrompt } = promptTemplates.buildRAGPrompt(question, context);
      const systemPrompt = config.systemPrompt;
      const generationStart = performance.now();
      const llmService = LLMService.getInstance();
      let answer = "";
      let tokensUsed = 0;
      try {
        answer = await llmService.generateStream(
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
        console.error("[RAGService] Error generating response from LLM:", llmError);
        answer = "Desculpe, ocorreu um erro ao gerar a resposta ou o LLM falhou.\n\nContexto encontrado:" + context.map((c, i) => `
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
        options
      );
      win2.webContents.send("rag:done", response);
    } catch (error) {
      console.error("[IPC rag:query] Error:", error);
      throw error;
    }
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
