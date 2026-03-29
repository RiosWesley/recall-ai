var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { app, ipcMain, dialog, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path, { basename } from "node:path";
import Database from "better-sqlite3";
import fs, { createReadStream } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
import { createInterface } from "node:readline";
const MIGRATION_ID = "001_initial";
const SCHEMA_SQL = `
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
    embedding FLOAT[384]
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
  ).get(MIGRATION_ID);
  if (existing) {
    console.log("[DB] Migration 001_initial already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 001_initial...");
  db.transaction(() => {
    db.exec(SCHEMA_SQL);
    const hasSqliteVec = isSqliteVecLoaded(db);
    if (hasSqliteVec) {
      console.log("[DB] sqlite-vec detected — creating vectors + chunks_fts tables");
      db.exec(VIRTUAL_TABLES_SQL);
    } else {
      console.log("[DB] sqlite-vec not detected — creating chunks_fts only");
      db.exec(FTS5_ONLY_SQL);
    }
    db.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(MIGRATION_ID);
  })();
  console.log("[DB] Migration 001_initial complete");
}
function isSqliteVecLoaded(db) {
  try {
    db.prepare("SELECT vec_version()").get();
    return true;
  } catch {
    return false;
  }
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
    console.log("[DB] Database ready");
    return db;
  }
  /**
   * Loads the sqlite-vec extension for vector similarity search.
   * If the extension binary is not found, continues gracefully
   * (vector search will be unavailable until the model is downloaded).
   */
  static loadSqliteVec(db) {
    try {
      const possiblePaths = [
        path.join(app.getPath("userData"), "vec0"),
        path.join(process.resourcesPath ?? "", "vec0"),
        path.join(__dirname, "vec0"),
        // Development: look in node_modules
        path.join(process.cwd(), "node_modules", "sqlite-vec", "vec0")
      ];
      let loaded = false;
      for (const extPath of possiblePaths) {
        if (fs.existsSync(extPath) || fs.existsSync(extPath + ".dll") || fs.existsSync(extPath + ".so") || fs.existsSync(extPath + ".dylib")) {
          db.loadExtension(extPath);
          loaded = true;
          console.log("[DB] sqlite-vec loaded from:", extPath);
          break;
        }
      }
      if (!loaded) {
        try {
          db.loadExtension("vec0");
          loaded = true;
          console.log("[DB] sqlite-vec loaded by name");
        } catch {
          console.warn("[DB] sqlite-vec not found — vector search will be unavailable.");
          console.warn("[DB] Install sqlite-vec to enable semantic search.");
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
  const content = messages.filter((m) => m.type !== "system").map((m) => m.content).join("\n");
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
  timeWindowSeconds: 5 * 60,
  // 5 minutes
  maxTokens: 256,
  overlapMessages: 1
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
      emit({ stage: "parsing", percent: 20, label: "Parseando mensagens", detail: "Extraindo mensagens do formato WhatsApp..." });
      const parseResult = await this.parser.parse(filePath);
      if (parseResult.messages.length === 0) {
        return {
          success: false,
          error: "Nenhuma mensagem encontrada no arquivo. Verifique se o formato é suportado."
        };
      }
      emit({ stage: "parsing", percent: 40, label: "Parseando mensagens", detail: `${parseResult.messages.length.toLocaleString("pt-BR")} mensagens encontradas` });
      emit({ stage: "chunking", percent: 50, label: "Segmentando chunks", detail: "Agrupando mensagens por janela de tempo..." });
      const rawChunks = this.chunker.chunk(parseResult.messages);
      emit({ stage: "chunking", percent: 65, label: "Segmentando chunks", detail: `${rawChunks.length} chunks criados` });
      emit({ stage: "storing", percent: 75, label: "Salvando no banco", detail: "Persistindo chat, mensagens e chunks..." });
      const chatName = basename(filePath).replace(/\.[^/.]+$/, "");
      const chatId = nanoid();
      const chat = chatRepo.create({
        id: chatId,
        name: chatName,
        source: "whatsapp",
        file_hash: fileHash,
        participant_count: parseResult.stats.participants.length,
        message_count: parseResult.messages.length,
        first_message_at: parseResult.stats.firstTimestamp ?? void 0,
        last_message_at: parseResult.stats.lastTimestamp ?? void 0
      });
      const messageRepo = new MessageRepository(db);
      const newMessages = parseResult.messages.map((m) => ({
        id: nanoid(),
        chat_id: chatId,
        sender: m.sender,
        content: m.content,
        timestamp: m.timestamp,
        type: m.type,
        raw: m.raw
      }));
      messageRepo.insertBatch(newMessages);
      emit({ stage: "storing", percent: 88, label: "Salvando no banco", detail: "Indexando chunks no FTS5..." });
      const chunkRepo = new ChunkRepository(db);
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
      chunkRepo.insertBatch(newChunks);
      emit({ stage: "done", percent: 100, label: "Importação concluída", detail: `${parseResult.messages.length.toLocaleString("pt-BR")} mensagens indexadas` });
      return {
        success: true,
        chatId: chat.id,
        chatName: chat.name,
        messageCount: parseResult.messages.length,
        chunkCount: rawChunks.length
      };
    } catch (err) {
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
function registerAllHandlers(win2) {
  registerChatHandlers();
  registerImportHandlers(win2);
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
