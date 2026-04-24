/**
 * MapReduceService — Background service for Phase 7 knowledge extraction.
 *
 * Flow:
 *  1. Find all person_mentions rows that have not been processed yet.
 *  2. Group them by person_id.
 *  3. For each person, collect the session summaries/contexts from those mentions.
 *  4. Send a structured prompt to WorkerProcess (LFM2.5-350M) requesting JSON
 *     { tags: string[], memories: string[] }.
 *  5. Persist tags via PersonRepository.insertTags() and memories via insertMemory().
 *  6. Mark those mentions as processed = 1.
 *  7. Repeat at a configurable interval (default: 60s idle timer).
 */

import Database from 'better-sqlite3'
import { DatabaseService } from '../db/database'
import { PersonRepository } from '../db/repositories/PersonRepository'
import { WorkerProcess } from './WorkerProcess'


interface UnprocessedMention {
  session_id: string
  person_id: string
  context: string | null
  summary: string | null
}

interface MapReduceResult {
  tags: string[]
  memories: string[]
}

export interface MapReduceStatus {
  isRunning: boolean
  lastRun: number | null
  peopleProcessed: number
  totalTagsInserted: number
  totalMemoriesInserted: number
  error: string | null
}

export class MapReduceService {
  private static instance: MapReduceService | null = null

  private timer: ReturnType<typeof setTimeout> | null = null
  private isRunning = false
  private lastRun: number | null = null
  private peopleProcessed = 0
  private totalTagsInserted = 0
  private totalMemoriesInserted = 0
  private lastError: string | null = null

  private readonly intervalMs: number

  private constructor(intervalMs = 60_000) {
    this.intervalMs = intervalMs
  }

  static getInstance(intervalMs = 60_000): MapReduceService {
    if (!MapReduceService.instance) {
      MapReduceService.instance = new MapReduceService(intervalMs)
    }
    return MapReduceService.instance
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Start the periodic background loop. Safe to call multiple times. */
  start(): void {
    if (this.timer) return
    console.log('[MapReduceService] Starting periodic loop (interval:', this.intervalMs, 'ms)')
    this.scheduleNext()
  }

  /** Stop the periodic loop. */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    console.log('[MapReduceService] Stopped.')
  }

  /** Run a single pass immediately, regardless of the timer state. */
  async runNow(): Promise<void> {
    if (this.isRunning) {
      console.log('[MapReduceService] Already running — skipping runNow().')
      return
    }
    await this.runPass()
  }

  getStatus(): MapReduceStatus {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      peopleProcessed: this.peopleProcessed,
      totalTagsInserted: this.totalTagsInserted,
      totalMemoriesInserted: this.totalMemoriesInserted,
      error: this.lastError,
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private scheduleNext(): void {
    this.timer = setTimeout(async () => {
      await this.runPass()
      this.scheduleNext()
    }, this.intervalMs)
  }

  private async runPass(): Promise<void> {
    this.isRunning = true
    this.lastError = null

    try {
      const db = DatabaseService.getInstance()
      const repo = new PersonRepository(db)

      // 1. Fetch all unprocessed mentions with their session summaries
      const mentions = db.prepare(`
        SELECT
          pm.session_id,
          pm.person_id,
          pm.context,
          s.summary
        FROM person_mentions pm
        LEFT JOIN sessions s ON s.id = pm.session_id
        WHERE pm.processed = 0
        ORDER BY pm.person_id
      `).all() as UnprocessedMention[]

      if (mentions.length === 0) {
        console.log('[MapReduceService] No unprocessed mentions — pass skipped.')
        this.lastRun = Date.now()
        return
      }

      console.log(`[MapReduceService] Found ${mentions.length} unprocessed mentions across ${new Set(mentions.map(m => m.person_id)).size} people.`)

      // 2. Group by person_id
      const byPerson = new Map<string, UnprocessedMention[]>()
      for (const m of mentions) {
        if (!byPerson.has(m.person_id)) byPerson.set(m.person_id, [])
        byPerson.get(m.person_id)!.push(m)
      }

      const worker = WorkerProcess.getInstance()
      if (!worker.isReady()) {
        console.log('[MapReduceService] WorkerProcess not ready — skipping pass.')
        this.lastRun = Date.now()
        return
      }

      // 3. Process each person
      for (const [personId, personMentions] of byPerson.entries()) {
        await this.processPerson(personId, personMentions, repo, db)
      }

      this.lastRun = Date.now()
    } catch (err: any) {
      this.lastError = err?.message ?? String(err)
      console.error('[MapReduceService] Pass failed:', this.lastError)
    } finally {
      this.isRunning = false
    }
  }

  private async processPerson(
    personId: string,
    mentions: UnprocessedMention[],
    repo: PersonRepository,
    db: Database.Database
  ): Promise<void> {
    // Build the context block from session summaries + inline contexts
    const contextLines: string[] = []
    const sessionIds: string[] = []

    for (const m of mentions) {
      sessionIds.push(m.session_id)
      if (m.summary) {
        contextLines.push(`- Sessão: "${m.summary}"`)
      }
      if (m.context) {
        contextLines.push(`  Contexto da menção: "${m.context}"`)
      }
    }

    if (contextLines.length === 0) {
      // No useful context — just mark as processed
      this.markProcessed(db, sessionIds, personId)
      return
    }

    const contextBlock = contextLines.join('\n')

    const prompt = `You are a strict JSON extraction tool analyzing chat context about a specific person.
Output ONLY raw JSON — no markdown, no explanations.

Given the following conversation snippets that mention this person, extract:
1. "tags": A list of 3-8 short labels (lowercase, PT-BR or EN) describing this person's interests, personality, or recurring themes. Examples: "gamer", "trabalho remoto", "pai", "league of legends", "viajante".
2. "memories": A list of 1-5 brief factual biographical sentences about this person. Examples: "Viajou para Portugal em jan/2024", "Trabalha com programação", "Tem um filho chamado Pedro".

Be concise. Only include things explicitly mentioned. Do NOT invent or infer.

Schema:
{"tags": ["str", ...], "memories": ["str", ...]}

Context:
${contextBlock}
`

    const options = {
      temperature: 0.15,
      maxTokens: 300,
      systemPrompt: 'You are a headless JSON API. Respond ONLY with valid JSON matching the exact schema.',
    }

    let result: MapReduceResult

    try {
      result = await WorkerProcess.getInstance().generateJson<MapReduceResult>(prompt, options, 3)

      // Safety checks
      if (!Array.isArray(result.tags)) result.tags = []
      if (!Array.isArray(result.memories)) result.memories = []
    } catch (err: any) {
      console.warn(`[MapReduceService] LLM extraction failed for person ${personId}:`, err.message)
      // Mark as processed anyway to avoid infinite retry on bad context
      this.markProcessed(db, sessionIds, personId)
      return
    }

    // Persist tags (INSERT OR IGNORE deduplicates)
    if (result.tags.length > 0) {
      repo.insertTags(personId, result.tags, 'map_reduce')
      this.totalTagsInserted += result.tags.length
    }

    // Persist memories
    for (const memory of result.memories) {
      if (memory?.trim()) {
        // Associate memory with the first session as provenance
        repo.insertMemory(personId, memory.trim(), sessionIds[0] ?? null)
        this.totalMemoriesInserted++
      }
    }

    // Mark all mentions for this person as processed
    this.markProcessed(db, sessionIds, personId)
    this.peopleProcessed++

    console.log(
      `[MapReduceService] Person ${personId}: +${result.tags.length} tags, +${result.memories.length} memories.`
    )
  }

  private markProcessed(db: Database.Database, sessionIds: string[], personId: string): void {
    if (sessionIds.length === 0) return
    const placeholders = sessionIds.map(() => '?').join(', ')
    db.prepare(`
      UPDATE person_mentions
      SET processed = 1
      WHERE person_id = ?
        AND session_id IN (${placeholders})
    `).run(personId, ...sessionIds)
  }
}
