import { DatabaseService } from '../db/database'
import { ChatRepository } from '../db/repositories/ChatRepository'
import { SessionRepository } from '../db/repositories/SessionRepository'
import { MessageRepository } from '../db/repositories/MessageRepository'
import { WorkerProcess } from './WorkerProcess'
import type { SearchOptions, SearchResult } from '../../shared/types'
import { nanoid } from 'nanoid'

export class SearchService {
  private static instance: SearchService | null = null

  private chatRepo: ChatRepository;
  private sessionRepo: SessionRepository;
  private messageRepo: MessageRepository;

  private constructor() {
    const db = DatabaseService.getInstance()
    this.chatRepo = new ChatRepository(db)
    this.sessionRepo = new SessionRepository(db)
    this.messageRepo = new MessageRepository(db)
  }

  static getInstance(): SearchService {
    if (!SearchService.instance) {
      SearchService.instance = new SearchService()
    }
    return SearchService.instance
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    console.log(`[SearchService] Resolving deterministic search for: "${query}"`);
    
    // 1. Classification
    const worker = WorkerProcess.getInstance();
    const classification = await worker.classifyQuery(query);
    
    console.log(`[SearchService] Intent: ${classification.intent} | Keywords: ${classification.keywords.join(', ')}`);

    const intent = classification.intent;
    const keywords = (classification.keywords && classification.keywords.length > 0) ? classification.keywords : [query];
    
    const dbOptions: { dateFrom?: number, dateTo?: number } = {
      dateFrom: options?.dateFrom,
      dateTo: options?.dateTo
    };

    const results: SearchResult[] = [];

    // 2. Routing
    if (intent === 'aggregation') {
      const aggs = this.sessionRepo.searchAggregation(keywords, 20, dbOptions);
      if (aggs.length > 0) {
        let content = "Aggregation Results:\n";
        for (const a of aggs) {
           content += `- Entity: ${a.name} (${a.type}) | Count: ${a.count}\n`
        }
        results.push({
          id: nanoid(),
          chatId: '',
          chatName: 'Global Aggregations',
          score: 1.0,
          content: content,
          date: new Date().toISOString(),
          sender: 'System',
          intent: 'aggregation',
          metadata: { items: aggs }
        })
      }
    } else if (intent === 'narrative') {
      const sessions = this.sessionRepo.searchNarrative(keywords, 5, dbOptions);
      for (const s of sessions) {
        const chat = this.chatRepo.findById(s.chat_id)
        results.push({
          id: s.id,
          chatId: s.chat_id,
          chatName: chat?.name || 'Unknown Chat',
          score: 0.9,
          content: `SESSION SUMMARY\n${s.summary}`,
          date: new Date(s.start_time * 1000).toISOString(),
          sender: 'System',
          intent: 'narrative'
        });
      }
    } else {
      // Intent === 'factual' or 'unknown' fallback
      const windows = this.messageRepo.searchFactual(keywords, 15, 5);
      
      for (const window of windows) {
         if (window.length === 0) continue;
         const chat = this.chatRepo.findById(window[0].chat_id);
         let contentBlock = '';
         for (const msg of window) {
           const date = new Date(msg.timestamp * 1000);
           const tStr = date.toISOString().split('T')[1].slice(0, 5);
           contentBlock += `[${tStr}] ${msg.sender}: ${msg.content}\n`;
         }

         results.push({
           id: nanoid(),
           chatId: window[0].chat_id,
           chatName: chat?.name || 'Unknown Chat',
           score: 1.0,
           content: contentBlock.trim(),
           date: new Date(window[0].timestamp * 1000).toISOString(),
           sender: window[0].sender,
           intent: 'factual'
         })
      }
    }

    return results;
  }
}
