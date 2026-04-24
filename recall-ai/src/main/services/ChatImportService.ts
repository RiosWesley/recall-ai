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
   * Background process to extract summaries and entities via Worker
   */
  private async runBackgroundNLP(
    chatId: string,
    rawSessions: ReturnType<SessionEngine['group']>, 
    dbSessions: NewSession[],
    sender?: WebContents
  ) {
    const emit = (progress: ImportProgress) => {
      // IPC to everyone, or standard IPC reply (we are using the global event name `import:progress`)
      sender?.send('import:progress', progress)
    }

    try {
      emit({ stage: 'nlp_summaries', percent: 20, label: 'Extração NLP Iniciada', detail: `Processando ${rawSessions.length} sessões...`, chatId } as any)

      // Spin up the worker
      const worker = WorkerProcess.getInstance()
      await worker.initialize()

      const db = DatabaseService.getInstance()
      const sessionRepo = new SessionRepository(db)

      let processed = 0
      const BATCH_SIZE = 4

      for (let i = 0; i < rawSessions.length; i += BATCH_SIZE) {
        const batchRaw = rawSessions.slice(i, i + BATCH_SIZE)
        const batchDb = dbSessions.slice(i, i + BATCH_SIZE)
        
        const sessionsText = batchRaw.map(rawSess => 
          rawSess.messages.map(m => `[${new Date(m.timestamp * 1000).toISOString()}] ${m.sender}: ${m.content}`).join('\n')
        )
        
        let batchResults: import('../../shared/types').SessionExtractionResult[] = []
        try {
          batchResults = await worker.extractBatchSessionEntities(sessionsText)
        } catch (e: any) {
          console.warn('[ChatImportService Worker] Batch extraction failed:', e.message)
          batchResults = sessionsText.map(() => ({ summary: "Sessão extraída via fallback de erro", mentioned_entities: [] }))
        }

        for (let j = 0; j < batchRaw.length; j++) {
          const dbSess = batchDb[j]
          const result = batchResults[j] || { summary: "Sessão concluída (sem detalhes extraídos)", mentioned_entities: [] }
          
          let summary = result.summary || "Sessão concluída (sem detalhes extraídos)"
          let extractedEntities = Array.isArray(result.mentioned_entities) ? result.mentioned_entities : []

          const newEntities: NewEntity[] = []
          const personRepo = new PersonRepository(db)
          const inbox = PendingMentionsManager.getInstance()

          for (const ent of extractedEntities) {
            if (!ent.name) continue
            
            // Map to legacy 'entities' table for general Search Index
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
              // Auto-resolve if exactly 1 perfect match is found
              const exactMatch = matches.find(m => m.name.toLowerCase() === ent.name.toLowerCase())
              if (exactMatch) {
                personRepo.linkMention(dbSess.id!, exactMatch.id, ent.context)
              } else {
                // Ambiguous or New -> send to Inbox
                const pending = inbox.addMention(dbSess.id!, ent.name, ent.context)
                sender?.send('ingest:mention_detected', pending)
              }
            }
          }

          // Update this session in Database
          sessionRepo.updateSessionNLP(dbSess.id!, summary, newEntities)
        }

        processed += batchRaw.length
        const isEntitiesPhase = processed > rawSessions.length * 0.7

        emit({ 
          stage: isEntitiesPhase ? 'nlp_entities' : 'nlp_summaries', 
          percent: 20 + Math.round((processed / rawSessions.length) * 80), 
          label: isEntitiesPhase ? 'Resolvendo Entidades' : 'Processando Resumos (Batch)', 
          detail: `${processed} / ${rawSessions.length} sessões analisadas...`,
          chatId // Note: sending chatId along to identify bg process per chat
        } as any) // Type assertion to bypass strict interface since we added chatId in payload dynamically
      }

      emit({ stage: 'done', percent: 100, label: 'Concluído', detail: `Entidades Indexadas para o chat.`, chatId } as any)
    } catch(err) {
      console.error('[Background NLP Exception]', err)
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
