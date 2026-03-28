var p = Object.defineProperty;
var h = (t, s, n) => s in t ? p(t, s, { enumerable: !0, configurable: !0, writable: !0, value: n }) : t[s] = n;
var N = (t, s, n) => h(t, typeof s != "symbol" ? s + "" : s, n);
import { app as c, BrowserWindow as I, ipcMain as l } from "electron";
import { fileURLToPath as u } from "node:url";
import a from "node:path";
import S from "better-sqlite3";
import r from "node:fs";
const m = "001_initial", A = `
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
`, O = `
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
`, g = `
  -- FTS5 table only (when sqlite-vec not available)
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    chunk_id UNINDEXED,
    tokenize='unicode61'
  );
`, f = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`;
function U(t) {
  if (t.exec(f), t.prepare(
    "SELECT id FROM _migrations WHERE id = ?"
  ).get(m)) {
    console.log("[DB] Migration 001_initial already applied — skipping");
    return;
  }
  console.log("[DB] Running migration 001_initial..."), t.transaction(() => {
    t.exec(A), D(t) ? (console.log("[DB] sqlite-vec detected — creating vectors + chunks_fts tables"), t.exec(O)) : (console.log("[DB] sqlite-vec not detected — creating chunks_fts only"), t.exec(g)), t.prepare(
      "INSERT INTO _migrations (id) VALUES (?)"
    ).run(m);
  })(), console.log("[DB] Migration 001_initial complete");
}
function D(t) {
  try {
    return t.prepare("SELECT vec_version()").get(), !0;
  } catch {
    return !1;
  }
}
const o = class o {
  static getInstance() {
    if (o.db)
      return o.db;
    const s = c.getPath("userData"), n = a.join(s, "recall-ai.db");
    console.log("[DB] Opening database at:", n);
    const i = new S(n, {
      verbose: process.env.NODE_ENV === "development" ? console.log : void 0
    });
    return i.pragma("journal_mode = WAL"), i.pragma("foreign_keys = ON"), i.pragma("synchronous = NORMAL"), i.pragma("cache_size = -32000"), i.pragma("temp_store = MEMORY"), o.loadSqliteVec(i), o.db = i, U(i), console.log("[DB] Database ready"), i;
  }
  /**
   * Loads the sqlite-vec extension for vector similarity search.
   * If the extension binary is not found, continues gracefully
   * (vector search will be unavailable until the model is downloaded).
   */
  static loadSqliteVec(s) {
    try {
      const n = [
        a.join(c.getPath("userData"), "vec0"),
        a.join(process.resourcesPath ?? "", "vec0"),
        a.join(__dirname, "vec0"),
        // Development: look in node_modules
        a.join(process.cwd(), "node_modules", "sqlite-vec", "vec0")
      ];
      let i = !1;
      for (const E of n)
        if (r.existsSync(E) || r.existsSync(E + ".dll") || r.existsSync(E + ".so") || r.existsSync(E + ".dylib")) {
          s.loadExtension(E), i = !0, console.log("[DB] sqlite-vec loaded from:", E);
          break;
        }
      if (!i)
        try {
          s.loadExtension("vec0"), i = !0, console.log("[DB] sqlite-vec loaded by name");
        } catch {
          console.warn("[DB] sqlite-vec not found — vector search will be unavailable."), console.warn("[DB] Install sqlite-vec to enable semantic search.");
        }
      if (i) {
        const E = s.prepare("SELECT vec_version() as version").get();
        console.log("[DB] sqlite-vec version:", E.version);
      }
    } catch (n) {
      console.error("[DB] Failed to load sqlite-vec:", n);
    }
  }
  /** Close the database connection (call on app quit) */
  static close() {
    o.db && (o.db.close(), o.db = null, console.log("[DB] Database closed"));
  }
  /** Check if the database is open */
  static isOpen() {
    return o.db !== null && o.db.open;
  }
};
N(o, "db", null);
let T = o;
const L = a.dirname(u(import.meta.url));
process.env.APP_ROOT = a.join(L, "..");
const d = process.env.VITE_DEV_SERVER_URL, B = a.join(process.env.APP_ROOT, "dist-electron"), R = a.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = d ? a.join(process.env.APP_ROOT, "public") : R;
let e;
function _() {
  e = new I({
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
      preload: a.join(L, "preload.mjs"),
      contextIsolation: !0,
      nodeIntegration: !1
    }
  }), e.once("ready-to-show", () => {
    e == null || e.show();
  }), l.on("window:minimize", () => e == null ? void 0 : e.minimize()), l.on("window:maximize", () => {
    e != null && e.isMaximized() ? e.unmaximize() : e == null || e.maximize();
  }), l.on("window:close", () => e == null ? void 0 : e.close()), d ? (e.loadURL(d), e.webContents.openDevTools({ mode: "detach" })) : e.loadFile(a.join(R, "index.html"));
}
c.on("window-all-closed", () => {
  process.platform !== "darwin" && (c.quit(), e = null);
});
c.on("activate", () => {
  I.getAllWindows().length === 0 && _();
});
c.on("before-quit", () => {
  T.close();
});
c.whenReady().then(() => {
  try {
    T.getInstance();
  } catch (t) {
    console.error("[Main] Failed to initialize database:", t);
  }
  _();
});
export {
  B as MAIN_DIST,
  R as RENDERER_DIST,
  d as VITE_DEV_SERVER_URL
};
