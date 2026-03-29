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
   * Perform a KNN search for the closest chunks to a query embedding.
   * @param queryEmbedding - Float32Array of length 384
   * @param topK - Number of results to return
   * @param chatId - Optional chat ID to filter results by
   */
  search(queryEmbedding: Float32Array, topK = 10, chatId?: string): VectorResult[] {
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

    if (chatId) {
      sql += ` JOIN chunks c ON c.id = v.chunk_id
      WHERE v.embedding MATCH ? AND c.chat_id = ? `
      params.push(chatId)
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
    chatId?: string
  ): VectorResult[] {
    if (!this.isAvailable) {
      // Fallback to FTS5 only
      return this.ftsOnly(queryText, topK, chatId)
    }

    const buffer = Buffer.from(queryEmbedding.buffer)
    const beta = 1 - alpha
    // We fetch a bit more than topK internally to improve RRF overlap quality
    const fetchCount = topK * 5

    const semTable = chatId ? 'vectors v JOIN chunks c ON c.id = v.chunk_id' : 'vectors v'
    const semWhere = chatId ? 'v.embedding MATCH ? AND c.chat_id = ?' : 'v.embedding MATCH ?'
    
    const kwTable = chatId ? 'chunks_fts f JOIN chunks c ON c.id = f.chunk_id' : 'chunks_fts f'
    const kwWhere = chatId ? 'f.content MATCH ? AND c.chat_id = ?' : 'f.content MATCH ?'

    const sql = `
      WITH semantic AS (
        SELECT v.chunk_id, v.distance as sem_dist,
               row_number() OVER (ORDER BY v.distance ASC) as sem_rank
        FROM ${semTable}
        WHERE ${semWhere}
        LIMIT ?
      ),
      keyword AS (
        SELECT f.chunk_id, f.rank as kw_score,
               row_number() OVER (ORDER BY f.rank ASC) as kw_rank
        FROM ${kwTable}
        WHERE ${kwWhere}
        LIMIT ?
      ),
      combined AS (
        SELECT
          COALESCE(s.chunk_id, k.chunk_id) AS chunk_id,
          (? * COALESCE(1.0 / (60.0 + s.sem_rank), 0.0))
          + (? * COALESCE(1.0 / (60.0 + k.kw_rank), 0.0)) AS score
        FROM semantic s
        FULL OUTER JOIN keyword k ON s.chunk_id = k.chunk_id
      )
      SELECT chunk_id, (1.0 - score) AS distance
      FROM combined
      ORDER BY score DESC
      LIMIT ?
    `

    const params: any[] = []
    
    // Semantic params
    params.push(buffer)
    if (chatId) params.push(chatId)
    params.push(fetchCount)
    
    // Keyword params
    params.push(queryText)
    if (chatId) params.push(chatId)
    params.push(fetchCount)
    
    // RRF params
    params.push(alpha)
    params.push(beta)
    params.push(topK)

    const rows = this.db.prepare(sql).all(...params) as VectorResult[]

    return rows
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

      return tableExists !== undefined
    } catch {
      return false
    }
  }

  /** Pure FTS5 fallback when sqlite-vec is unavailable. */
  private ftsOnly(queryText: string, topK: number, chatId?: string): VectorResult[] {
    try {
      let sql = 'SELECT f.chunk_id, f.rank as distance FROM chunks_fts f'
      const params: any[] = []

      if (chatId) {
        sql += ' JOIN chunks c ON c.id = f.chunk_id WHERE f.content MATCH ? AND c.chat_id = ?'
        params.push(queryText, chatId)
      } else {
        sql += ' WHERE f.content MATCH ?'
        params.push(queryText)
      }

      sql += ' ORDER BY f.rank LIMIT ?'
      params.push(topK)

      const rows = this.db.prepare(sql).all(...params) as VectorResult[]

      return rows
    } catch {
      return []
    }
  }
}
