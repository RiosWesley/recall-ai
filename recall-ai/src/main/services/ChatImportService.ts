/**
 * ChatImportService — Orchestrates the full import pipeline:
 *   file → hash check → parse → chunk → save (chat + messages + chunks)
 *
 * Emits progress events via `webContents.send('import:progress', ...)` so
 * the renderer can reflect real stage transitions.
 *
 * Note: Embedding is NOT performed here (deferred to TASK 2.4).
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import type { WebContents } from 'electron'
import { nanoid } from 'nanoid'

import { DatabaseService } from '../db/database'
import { ChatRepository } from '../db/repositories/ChatRepository'
import { MessageRepository } from '../db/repositories/MessageRepository'
import { ChunkRepository } from '../db/repositories/ChunkRepository'
import { WhatsAppParser } from '../core/parser/WhatsAppParser'
import { ChunkingEngine } from '../core/chunking/ChunkingEngine'

import type { ImportProgress, ImportResult } from '../../shared/types'
import type { NewMessage, NewChunk } from '../../shared/types'

export class ChatImportService {
  private readonly parser = new WhatsAppParser()
  private readonly chunker = new ChunkingEngine()

  /**
   * Import a WhatsApp export .txt file.
   * @param filePath  Absolute path to the .txt file
   * @param sender    WebContents of the renderer window (for progress events)
   */
  async import(filePath: string, sender?: WebContents): Promise<ImportResult> {
    const emit = (progress: ImportProgress) => {
      sender?.send('import:progress', progress)
    }

    try {
      // ── Stage 1: Reading / hash ────────────────────────────────────────────
      emit({ stage: 'reading', percent: 5, label: 'Lendo arquivo', detail: 'Calculando hash do arquivo...' })

      const fileHash = await computeFileHash(filePath)
      const db = DatabaseService.getInstance()
      const chatRepo = new ChatRepository(db)

      const isDuplicate = chatRepo.existsByHash(fileHash)
      if (isDuplicate) {
        return {
          success: false,
          duplicate: true,
          error: 'Este arquivo já foi importado anteriormente.',
        }
      }

      // ── Stage 2: Parsing ──────────────────────────────────────────────────
      emit({ stage: 'parsing', percent: 20, label: 'Parseando mensagens', detail: 'Extraindo mensagens do formato WhatsApp...' })

      const parseResult = await this.parser.parse(filePath)

      if (parseResult.messages.length === 0) {
        return {
          success: false,
          error: 'Nenhuma mensagem encontrada no arquivo. Verifique se o formato é suportado.',
        }
      }

      emit({ stage: 'parsing', percent: 40, label: 'Parseando mensagens', detail: `${parseResult.messages.length.toLocaleString('pt-BR')} mensagens encontradas` })

      // ── Stage 3: Chunking ─────────────────────────────────────────────────
      emit({ stage: 'chunking', percent: 50, label: 'Segmentando chunks', detail: 'Agrupando mensagens por janela de tempo...' })

      const rawChunks = this.chunker.chunk(parseResult.messages)

      emit({ stage: 'chunking', percent: 65, label: 'Segmentando chunks', detail: `${rawChunks.length} chunks criados` })

      // ── Stage 4: Storing ──────────────────────────────────────────────────
      emit({ stage: 'storing', percent: 75, label: 'Salvando no banco', detail: 'Persistindo chat, mensagens e chunks...' })

      // Derive chat name from filename (strip extension)
      const chatName = basename(filePath).replace(/\.[^/.]+$/, '')

      // Create chat record
      const chatId = nanoid()
      const chat = chatRepo.create({
        id: chatId,
        name: chatName,
        source: 'whatsapp',
        file_hash: fileHash,
        participant_count: parseResult.stats.participants.length,
        message_count: parseResult.messages.length,
        first_message_at: parseResult.stats.firstTimestamp ?? undefined,
        last_message_at: parseResult.stats.lastTimestamp ?? undefined,
      })

      // Batch-insert messages
      const messageRepo = new MessageRepository(db)
      const newMessages: NewMessage[] = parseResult.messages.map((m) => ({
        id: nanoid(),
        chat_id: chatId,
        sender: m.sender,
        content: m.content,
        timestamp: m.timestamp,
        type: m.type,
        raw: m.raw,
      }))
      messageRepo.insertBatch(newMessages)

      emit({ stage: 'storing', percent: 88, label: 'Salvando no banco', detail: 'Indexando chunks no FTS5...' })

      // Batch-insert chunks (also inserts into FTS5 in the same transaction)
      const chunkRepo = new ChunkRepository(db)
      const newChunks: NewChunk[] = rawChunks.map((c) => ({
        id: nanoid(),
        chat_id: chatId,
        content: c.content,
        display_content: c.displayContent,
        start_time: c.startTime,
        end_time: c.endTime,
        message_count: c.messageCount,
        token_count: c.tokenCount,
        participants: c.participants,
      }))
      chunkRepo.insertBatch(newChunks)

      emit({ stage: 'done', percent: 100, label: 'Importação concluída', detail: `${parseResult.messages.length.toLocaleString('pt-BR')} mensagens indexadas` })

      return {
        success: true,
        chatId: chat.id,
        chatName: chat.name,
        messageCount: parseResult.messages.length,
        chunkCount: rawChunks.length,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[ChatImportService] Import failed:', message)
      emit({ stage: 'error', percent: 0, label: 'Erro na importação', detail: message })
      return { success: false, error: message }
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
