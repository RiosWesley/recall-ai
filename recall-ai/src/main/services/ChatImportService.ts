/**
 * ChatImportService — Orchestrates the full import pipeline:
 *   file → hash check → parse → session grouping → NLP extraction (Worker) → save
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import type { WebContents } from 'electron'
import { nanoid } from 'nanoid'

import { DatabaseService } from '../db/database'
import { ChatRepository } from '../db/repositories/ChatRepository'
import { MessageRepository } from '../db/repositories/MessageRepository'
import { SessionRepository } from '../db/repositories/SessionRepository'
import { PersonRepository } from '../db/repositories/PersonRepository'

import { WhatsAppParser } from '../core/parser/WhatsAppParser'
import { SessionEngine } from '../core/chunking/SessionEngine'
import { WorkerProcess } from './WorkerProcess'
import { PendingMentionsManager } from './PendingMentionsManager'

import type { ImportProgress, ImportResult } from '../../shared/types'
import type { NewMessage, NewSession, NewEntity } from '../../shared/types'

// Removed ExtractedJSON since it is no longer used

export class ChatImportService {
  private readonly parser = new WhatsAppParser()
  private readonly sessionEngine = new SessionEngine(7200) // > 2h gap

  async import(filePath: string, sender?: WebContents): Promise<ImportResult> {
    const emit = (progress: ImportProgress) => {
      sender?.send('import:progress', progress)
    }

    let chatId: string | undefined

    try {
      emit({ stage: 'reading', percent: 5, label: 'Lendo arquivo', detail: 'Calculando hash...' })

      const fileHash = await computeFileHash(filePath)
      const db = DatabaseService.getInstance()
      const chatRepo = new ChatRepository(db)

      if (chatRepo.existsByHash(fileHash)) {
        return { success: false, duplicate: true, error: 'Arquivo já importado.' }
      }

      const chatName = basename(filePath).replace(/\.[^/.]+$/, '')
      chatId = nanoid()

      emit({ stage: 'parsing', percent: 15, label: 'Parseando mensagens', detail: 'Lendo chat base...' })
      const parseResult = await this.parser.parse(filePath)

      if (parseResult.messages.length === 0) {
        return { success: false, error: 'Nenhuma mensagem encontrada.' }
      }

      const newMessages: NewMessage[] = parseResult.messages.map((m) => ({
        id: nanoid(),
        chat_id: chatId!,
        sender: m.sender,
        content: m.content,
        timestamp: m.timestamp,
        type: m.type,
        raw: m.raw,
      }))

      chatRepo.create({
        id: chatId!,
        name: chatName,
        source: 'whatsapp',
        file_hash: fileHash,
        participant_count: parseResult.stats.participants.length,
        message_count: parseResult.messages.length,
        first_message_at: parseResult.stats.firstTimestamp ?? undefined,
        last_message_at: parseResult.stats.lastTimestamp ?? undefined,
      })

      emit({ stage: 'fts_indexing', percent: 25, label: 'Agrupando Sessões', detail: 'Topologia Cronológica...' })
      
      const personRepo = new PersonRepository(db)
      const senderCounts: Record<string, number> = {}
      for (const m of parseResult.messages) {
        if (!senderCounts[m.sender]) senderCounts[m.sender] = 0
        senderCounts[m.sender]++
      }

      for (const participant of parseResult.stats.participants) {
        if (participant.toLowerCase() === 'system') continue
        
        const count = senderCounts[participant] || 0
        const matches = personRepo.findProbableMatch(participant)
        const exactMatch = matches.find(m => m.name.toLowerCase() === participant.toLowerCase())
        
        if (exactMatch) {
          db.prepare('UPDATE people SET message_count = message_count + ? WHERE id = ?').run(count, exactMatch.id)
        } else {
          const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899']
          const color = colors[Math.floor(Math.random() * colors.length)]
          const personId = personRepo.createPersonWithAlias(participant, participant, color)
          db.prepare('UPDATE people SET message_count = ? WHERE id = ?').run(count, personId)
        }
      }

      const rawSessions = this.sessionEngine.group(parseResult.messages)

      const newSessions: NewSession[] = []
      
      for (const rawSess of rawSessions) {
        newSessions.push({
          id: nanoid(),
          chat_id: chatId!,
          start_time: rawSess.start_time,
          end_time: rawSess.end_time,
          message_count: rawSess.message_count,
          summary: "Processando IA em background..." // Temporary summary
        })
      }

      // Final Phase: Store everything via Repositories immediately so indexing is fast
      emit({ stage: 'fts_indexing', percent: 40, label: 'Salvando no banco', detail: 'Persistindo histórico nativo e Indexando FTS5...' })
      const messageRepo = new MessageRepository(db)
      messageRepo.insertBatch(newMessages)
      
      const sessionRepo = new SessionRepository(db)
      sessionRepo.insertBatch(newSessions, []) // no entities yet
      
      // Dispatch Background Job for NLP Extraction
      this.runBackgroundNLP(chatId!, rawSessions, newSessions, sender).catch((err) => {
        console.error('[Background NLP Error]', err)
        // Emitting error might be disruptive if the user already proceeded, but we might want to log it
      })

      return {
        success: true,
        chatId: chatId!,
        chatName: chatName,
        messageCount: parseResult.messages.length,
        chunkCount: newSessions.length, // total sessions
      }
    } catch (err) {
      if (chatId) {
         try {
           const db = DatabaseService.getInstance()
           new ChatRepository(db).delete(chatId) 
         } catch (e) { }
      }

      const message = err instanceof Error ? err.message : String(err)
      console.error('[ChatImportService] Import failed:', message)
      emit({ stage: 'error', percent: 0, label: 'Erro na importação', detail: message })
      return { success: false, error: message }
    }
  }

  /**
   * Background process to extract summaries and entities via Worker.
   * 
   * Optimization notes (2026-04):
   * - Sessions processed individually (not concatenated into mega-prompts)
   *   because small LLMs produce more reliable JSON with shorter prompts
   * - Trivial sessions (< 3 messages, all system/media) are skipped entirely
   * - Per-session timeout prevents a single bad session from stalling the pipeline
   * - DB writes batched into a single transaction per flush cycle
   */
  private async runBackgroundNLP(
    chatId: string,
    rawSessions: ReturnType<SessionEngine['group']>, 
    dbSessions: NewSession[],
    sender?: WebContents
  ) {
    const emit = (progress: ImportProgress) => {
      sender?.send('import:progress', progress)
    }

    try {
      const totalSessions = rawSessions.length
      emit({ stage: 'nlp_summaries', percent: 20, label: 'Extração NLP Iniciada', detail: `Processando ${totalSessions} sessões...`, chatId } as any)

      const worker = WorkerProcess.getInstance()
      await worker.initialize()

      const db = DatabaseService.getInstance()
      const sessionRepo = new SessionRepository(db)
      const personRepo = new PersonRepository(db)
      const inbox = PendingMentionsManager.getInstance()

      let processed = 0
      const timings: number[] = []

      // Accumulate all DB mutations for batch commit
      const pendingUpdates: Array<{
        sessionId: string
        summary: string
        entities: NewEntity[]
      }> = []
      const pendingMentionLinks: Array<{ sessionId: string; personId: string; context: string | null }> = []
      const pendingInboxMentions: Array<{ sessionId: string; name: string; context: string | null }> = []

      for (let i = 0; i < totalSessions; i++) {
        const rawSess = rawSessions[i]!
        const dbSess = dbSessions[i]!
        const sessionStart = Date.now()

        // ── Skip trivial sessions ──────────────────────────────────────
        const textMessages = rawSess.messages.filter(m => m.type === 'text')
        if (textMessages.length < 3) {
          const summary = textMessages.length === 0
            ? 'Sessão sem mensagens de texto.'
            : `Sessão breve com ${rawSess.message_count} mensagens.`
          pendingUpdates.push({ sessionId: dbSess.id!, summary, entities: [] })
          processed++
          continue
        }

        // ── Build session text ─────────────────────────────────────────
        const sessionText = rawSess.messages
          .map(m => `[${new Date(m.timestamp * 1000).toISOString()}] ${m.sender}: ${m.content}`)
          .join('\n')

        // ── Extract with per-session timeout ───────────────────────────
        let result: import('../../shared/types').SessionExtractionResult
        try {
          result = await Promise.race([
            worker.extractSessionEntities(sessionText),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Session extraction timeout (15s)')), 15_000)
            )
          ])
        } catch (e: any) {
          console.warn(`[ChatImportService] Session ${i}/${totalSessions} failed: ${e.message}`)
          result = { summary: 'Sessão extraída via fallback de timeout', mentioned_entities: [] }
        }

        const summary = result.summary || 'Sessão concluída (sem detalhes extraídos)'
        const extractedEntities = Array.isArray(result.mentioned_entities) ? result.mentioned_entities : []

        // ── Prepare entities and mentions ──────────────────────────────
        const newEntities: NewEntity[] = []
        for (const ent of extractedEntities) {
          if (!ent.name) continue

          newEntities.push({
            id: nanoid(),
            session_id: dbSess.id!,
            name: ent.name,
            normalized_name: ent.name.toLowerCase().trim(),
            type: ent.type || 'unknown',
            action: ent.context || 'mentioned'
          })

          // Phase 6 Identity Graph mapping
          if (!ent.is_participant && ent.type === 'person') {
            const matches = personRepo.findProbableMatch(ent.name)
            const exactMatch = matches.find(m => m.name.toLowerCase() === ent.name.toLowerCase())
            if (exactMatch) {
              pendingMentionLinks.push({ sessionId: dbSess.id!, personId: exactMatch.id, context: ent.context })
            } else {
              pendingInboxMentions.push({ sessionId: dbSess.id!, name: ent.name, context: ent.context })
            }
          }
        }

        pendingUpdates.push({ sessionId: dbSess.id!, summary, entities: newEntities })

        const elapsed = Date.now() - sessionStart
        timings.push(elapsed)
        processed++

        // ── Flush to DB every 8 sessions (amortize transaction overhead) ──
        if (pendingUpdates.length >= 8) {
          this.flushPendingUpdates(db, sessionRepo, personRepo, inbox, sender, pendingUpdates, pendingMentionLinks, pendingInboxMentions)
          pendingUpdates.length = 0
          pendingMentionLinks.length = 0
          pendingInboxMentions.length = 0
        }

        // ── Progress update ────────────────────────────────────────────
        const avgMs = timings.reduce((a, b) => a + b, 0) / timings.length
        const isEntitiesPhase = processed > totalSessions * 0.7
        emit({ 
          stage: isEntitiesPhase ? 'nlp_entities' : 'nlp_summaries', 
          percent: 20 + Math.round((processed / totalSessions) * 80), 
          label: isEntitiesPhase ? 'Resolvendo Entidades' : 'Processando Sessões', 
          detail: `${processed}/${totalSessions} sessões (${Math.round(avgMs)}ms/sessão)`,
          chatId
        } as any)
      }

      // ── Final flush ──────────────────────────────────────────────────
      if (pendingUpdates.length > 0) {
        this.flushPendingUpdates(db, sessionRepo, personRepo, inbox, sender, pendingUpdates, pendingMentionLinks, pendingInboxMentions)
      }

      const totalAvg = timings.length > 0 ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) : 0
      console.log(`[ChatImportService] NLP complete: ${totalSessions} sessions, avg ${totalAvg}ms/session, ${timings.length} LLM calls`)

      emit({ stage: 'done', percent: 100, label: 'Concluído', detail: `Entidades Indexadas (${totalAvg}ms/sessão).`, chatId } as any)
    } catch(err) {
      console.error('[Background NLP Exception]', err)
    }
  }

  /**
   * Flush accumulated session updates to DB in a single transaction.
   */
  private flushPendingUpdates(
    db: ReturnType<typeof DatabaseService.getInstance>,
    sessionRepo: SessionRepository,
    personRepo: PersonRepository,
    inbox: PendingMentionsManager,
    sender: WebContents | undefined,
    updates: Array<{ sessionId: string; summary: string; entities: NewEntity[] }>,
    mentionLinks: Array<{ sessionId: string; personId: string; context: string | null }>,
    inboxMentions: Array<{ sessionId: string; name: string; context: string | null }>
  ) {
    // Wrap all writes in a single transaction
    db.transaction(() => {
      for (const upd of updates) {
        sessionRepo.updateSessionNLP(upd.sessionId, upd.summary, upd.entities)
      }
      for (const link of mentionLinks) {
        personRepo.linkMention(link.sessionId, link.personId, link.context)
      }
    })()

    // Inbox mentions are sent via IPC (outside transaction)
    for (const m of inboxMentions) {
      const pending = inbox.addMention(m.sessionId, m.name, m.context)
      sender?.send('ingest:mention_detected', pending)
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}
