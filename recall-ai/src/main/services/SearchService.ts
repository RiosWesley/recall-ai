import { DatabaseService } from '../db/database'
import { ChatRepository } from '../db/repositories/ChatRepository'
import { SessionRepository } from '../db/repositories/SessionRepository'
import type { SearchOptions, SearchResult } from '../../shared/types'

export class SearchService {
  private static instance: SearchService | null = null

  private constructor() {
    const db = DatabaseService.getInstance()
    new ChatRepository(db)
    new SessionRepository(db)
  }

  static getInstance(): SearchService {
    if (!SearchService.instance) {
      SearchService.instance = new SearchService()
    }
    return SearchService.instance
  }

  /**
   * Search endpoint. 
   * TEMPORARY FALLBACK for Phase 3: Returns empty results.
   * Full determinist FTS5 motor implementation pending Task 4.1.
   */
  async search(query: string, _options?: SearchOptions): Promise<SearchResult[]> {
    console.log(`[SearchService] Stub search called for query: "${query}". (Waiting for Task 4.1 FTS5 motor rewrite)`)
    return []
  }
}
