import Database from 'better-sqlite3'
import type { VectorResult } from '../../../shared/types'

/**
 * VectorRepository handles KNN search and storage for text embeddings
 * using the sqlite-vec extension.
 */
export class VectorRepository {
  private readonly isAvailable: boolean

  constructor(private readonly db: Database.Database) {
    this.isAvailable = this.checkAvailability()
  }

  /**
   * Store a chunk's embedding vector.
   * @param chunkId - ID of the chunk being embedded
   * @param embedding - Float32Array of length 384
   */
  insert(chunkId: string, embedding: Float32Array): void {
    if (!this.isAvailable) {
      console.warn('[VectorRepository] sqlite-vec not available — skipping insert')
      return
    }

    const buffer = Buffer.from(embedding.buffer)

    this.db.prepare(`
      INSERT OR REPLACE INTO vectors (chunk_id, embedding)
      VALUES (?, ?)
    `).run(chunkId, buffer)
  }

  /**
   * Store multiple chunks' embeddings in a single transaction.
   * @param items - Array of { chunkId, embedding }
   */
  insertBatch(items: { chunkId: string; embedding: Float32Array }[]): void {
    if (!this.isAvailable) {
      console.warn('[VectorRepository] sqlite-vec not available — skipping batch insert')
      return
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO vectors (chunk_id, embedding)
      VALUES (?, ?)
    `)

    this.db.transaction((vectors: { chunkId: string; embedding: Float32Array }[]) => {
      for (const item of vectors) {
        stmt.run(item.chunkId, Buffer.from(item.embedding.buffer))
      }
    })(items)
  }

  /**
   * Store multiple facts' embeddings in a single transaction.
   * @param items - Array of { factId, embedding }
   */
  insertFactBatch(items: { factId: string; embedding: Float32Array }[]): void {
    if (!this.isAvailable) {
      console.warn('[VectorRepository] sqlite-vec not available — skipping fact batch insert')
      return
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO profile_facts_vectors (fact_id, embedding)
      VALUES (?, ?)
    `)

    this.db.transaction((vectors: { factId: string; embedding: Float32Array }[]) => {
      for (const item of vectors) {
        stmt.run(item.factId, Buffer.from(item.embedding.buffer))
      }
    })(items)
  }

  /**
   * Perform a KNN search for the closest chunks to a query embedding.
   * @param queryEmbedding - Float32Array of length 384
   * @param topK - Number of results to return
   * @param dateFrom - Optional start timestamp filter
   * @param dateTo - Optional end timestamp filter
   */
  search(queryEmbedding: Float32Array, topK = 10, chatId?: string, dateFrom?: number, dateTo?: number): VectorResult[] {
    if (!this.isAvailable) {
      console.warn('[VectorRepository] sqlite-vec not available — returning empty results')
      return []
    }

    const buffer = Buffer.from(queryEmbedding.buffer)

    let sql = `
      SELECT v.chunk_id, v.distance
      FROM vectors v
    `
    const params: any[] = [buffer]

    if (chatId || dateFrom !== undefined || dateTo !== undefined) {
      sql += ` JOIN chunks c ON c.id = v.chunk_id
      WHERE v.embedding MATCH ? `
      
      if (chatId) {
          sql += ` AND c.chat_id = ? `
          params.push(chatId)
      }
      if (dateFrom != null) {
          sql += ` AND c.start_time >= ? `
          params.push(dateFrom)
      }
      if (dateTo != null) {
          sql += ` AND c.end_time <= ? `
          params.push(dateTo)
      }
    } else {
      sql += ` WHERE v.embedding MATCH ? `
    }

    sql += ` ORDER BY v.distance ASC LIMIT ? `
    params.push(topK)

    const rows = this.db.prepare(sql).all(...params) as VectorResult[]

    return rows
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
  hybridSearch(
    queryEmbedding: Float32Array,
    queryText: string,
    topK = 10,
    alpha = 0.7,
    chatId?: string,
    dateFrom?: number,
    dateTo?: number
  ): VectorResult[] {
    return this._hybridSearchCore(
      'child_chunks', 
      'chunk_id', 
      'child_vectors', 
      'child_chunks_fts', 
      queryEmbedding, 
      queryText, 
      topK, 
      alpha, 
      chatId, 
      'chat_id',
      'content',
      dateFrom,
      dateTo
    )
  }

  hybridSearchPropositions(
    queryEmbedding: Float32Array,
    queryText: string,
    topK = 10,
    alpha = 0.7,
    chatId?: string,
    dateFrom?: number,
    dateTo?: number
  ): VectorResult[] {
    return this._hybridSearchCore(
      'propositions', 
      'proposition_id', 
      'proposition_vectors', 
      'propositions_fts', 
      queryEmbedding, 
      queryText, 
      topK, 
      alpha, 
      chatId, 
      'chat_id',
      'fact',
      dateFrom,
      dateTo
    )
  }

  /**
   * Hybrid search optimized for Profile Facts.
   */
  hybridSearchFacts(
    queryEmbedding: Float32Array,
    queryText: string,
    topK = 10,
    alpha = 0.7,
    chatId?: string
  ): VectorResult[] {
    return this._hybridSearchCore(
      'profile_facts', 
      'fact_id', 
      'profile_facts_vectors', 
      'profile_facts_fts', 
      queryEmbedding, 
      queryText, 
      topK, 
      alpha, 
      chatId, 
      'contact_id',
      'text'
    )
  }

  private _hybridSearchCore(
    baseTable: string,
    idColumn: string,
    vecTable: string,
    ftsTable: string,
    queryEmbedding: Float32Array,
    queryText: string,
    topK: number,
    alpha: number,
    chatId?: string,
    chatIdColumn = 'chat_id',
    ftsContentColumn = 'content',
    dateFrom?: number,
    dateTo?: number
  ): VectorResult[] {
    if (!this.isAvailable) {
      // Fallback to FTS5 only
      return this.ftsOnly(queryText, topK, chatId, ftsTable, baseTable, idColumn, chatIdColumn)
    }

    const buffer = Buffer.from(queryEmbedding.buffer)
    const beta = 1 - alpha
    const fetchCount = topK * 5

    const hasTimeRangeCols = (baseTable === 'chunks' || baseTable === 'child_chunks')

    const hasDateFilters = hasTimeRangeCols && (dateFrom != null || dateTo != null)
    const joinBase = chatId || hasDateFilters

    const semTable = joinBase ? `${vecTable} v JOIN ${baseTable} c ON c.id = v.${idColumn}` : `${vecTable} v`
    
    let semWhere = `v.embedding MATCH ? AND v.k = ?`
    if (chatId) semWhere += ` AND c.${chatIdColumn} = ?`
    if (hasTimeRangeCols && dateFrom != null) semWhere += ` AND c.start_time >= ?`
    if (hasTimeRangeCols && dateTo != null) semWhere += ` AND c.end_time <= ?`

    const kwTable = joinBase ? `${ftsTable} f JOIN ${baseTable} c ON c.id = f.${idColumn}` : `${ftsTable} f`
    let kwWhere = `f.${ftsContentColumn} MATCH ?`
    if (chatId) kwWhere += ` AND c.${chatIdColumn} = ?`
    if (hasTimeRangeCols && dateFrom != null) kwWhere += ` AND c.start_time >= ?`
    if (hasTimeRangeCols && dateTo != null) kwWhere += ` AND c.end_time <= ?`

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
    `

    const params: any[] = []
    params.push(buffer, fetchCount)
    if (chatId) params.push(chatId)
    if (hasTimeRangeCols && dateFrom != null) params.push(dateFrom)
    if (hasTimeRangeCols && dateTo != null) params.push(dateTo)
    
    params.push(queryText)
    
    if (chatId) params.push(chatId)
    if (hasTimeRangeCols && dateFrom != null) params.push(dateFrom)
    if (hasTimeRangeCols && dateTo != null) params.push(dateTo)
    
    params.push(fetchCount, alpha, beta, topK)

    return this.db.prepare(sql).all(...params) as VectorResult[]
  }

  /**
   * Delete all vectors for a given chat's chunks.
   */
  deleteByChatId(chatId: string): void {
    if (!this.isAvailable) return

    // Get chunk IDs for this chat, then delete their vectors
    const chunkIds = this.db.prepare(
      'SELECT id FROM chunks WHERE chat_id = ?'
    ).all(chatId) as { id: string }[]

    if (chunkIds.length === 0) return

    const deleteStmt = this.db.prepare('DELETE FROM vectors WHERE chunk_id = ?')

    const runAll = this.db.transaction(() => {
      for (const { id } of chunkIds) {
        deleteStmt.run(id)
      }
    })

    runAll()
  }

  /** Returns true if the sqlite-vec extension is loaded and the vectors table exists. */
  private checkAvailability(): boolean {
    try {
      this.db.prepare("SELECT vec_version()").get()

      const tableExists = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='vectors'
      `).get()

      if (!tableExists) {
        console.log('[VectorRepository] Self-healing: creating missing vectors table')
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
            chunk_id TEXT PRIMARY KEY,
            embedding FLOAT[768]
          );
        `)
      }

      return true
    } catch {
      return false
    }
  }

  /** Pure FTS5 fallback when sqlite-vec is unavailable. */
  private ftsOnly(
    queryText: string, 
    topK: number, 
    chatId?: string,
    ftsTable = 'chunks_fts',
    baseTable = 'chunks',
    idColumn = 'chunk_id',
    chatIdColumn = 'chat_id'
  ): VectorResult[] {
    try {
      let sql = `SELECT f.${idColumn} as chunk_id, f.rank as distance FROM ${ftsTable} f`
      const params: any[] = []

      // Support old 'content' vs new 'text' col
      const contentCol = ftsTable === 'chunks_fts' ? 'content' : 'text'

      if (chatId) {
        sql += ` JOIN ${baseTable} c ON c.id = f.${idColumn} WHERE f.${contentCol} MATCH ? AND c.${chatIdColumn} = ?`
        params.push(queryText, chatId)
      } else {
        sql += ` WHERE f.${contentCol} MATCH ?`
        params.push(queryText)
      }

      sql += ` ORDER BY f.rank LIMIT ?`
      params.push(topK)

      return this.db.prepare(sql).all(...params) as VectorResult[]
    } catch (err) {
      console.warn('[VectorRepository] ftsOnly failed:', err)
      return []
    }
  }
}
