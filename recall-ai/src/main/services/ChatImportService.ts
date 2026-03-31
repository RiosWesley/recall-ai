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
import { VectorRepository } from '../db/repositories/VectorRepository'
import { WhatsAppParser } from '../core/parser/WhatsAppParser'
import { ChunkingEngine } from '../core/chunking/ChunkingEngine'
import { ModelManager } from './ModelManager'
import { EmbeddingService } from './EmbeddingService'
import { computeTermStats, TopicClassifier } from './import/StatsGenerator'
import { buildProfileFacts } from './import/ProfileFactsBuilder'
import { ProfileFactRepository } from '../db/repositories/ProfileFactRepository'
import { MapReduceEngine } from './import/MapReduceEngine'
import { PropositionExtractor, type Proposition } from './import/PropositionExtractor'

import type { ImportProgress, ImportResult } from '../../shared/types'
import type { NewMessage, NewParentChunk, NewChildChunk } from '../../shared/types'

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

    let chatId: string | undefined

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

      const chatName = basename(filePath).replace(/\.[^/.]+$/, '')
      chatId = nanoid()

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

      // Convert messages to NewMessage with ID
      const newMessages: NewMessage[] = parseResult.messages.map((m) => ({
        id: nanoid(),
        chat_id: chatId!,
        sender: m.sender,
        content: m.content,
        timestamp: m.timestamp,
        type: m.type,
        raw: m.raw,
      }))

      // Persist empty chat FIRST to satisfy FOREIGN KEY constraints downstream 
      // (chunkRepository, mapReduceEngine, etc)
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

      // ── Stage 2.5: Map-Reduce Profile ──────────────────────────────────────
      const mapReduceEngine = new MapReduceEngine()
      // We pass newMessages which implements Message interface fully
      await mapReduceEngine.runMapReduce(newMessages as any, chatName, chatId!, emit)

      // ── Stage 3: Chunking ─────────────────────────────────────────────────
      emit({ stage: 'chunking', percent: 50, label: 'Segmentando chunks', detail: 'Agrupando mensagens por janela de tempo...' })

      const chunkResult = this.chunker.chunk(parseResult.messages)
      
      const newParents: NewParentChunk[] = chunkResult.parents.map((c) => ({
        id: c.id,
        chat_id: chatId!,
        content: c.content,
        display_content: c.displayContent,
        start_time: c.startTime,
        end_time: c.endTime,
        message_count: c.messageCount,
        token_count: c.tokenCount,
        participants: c.participants,
      }))

      const newChildren: NewChildChunk[] = chunkResult.children.map((c) => ({
        id: nanoid(),
        parent_id: c.parentId,
        chat_id: chatId!,
        content: c.content,
        display_content: c.displayContent,
        start_time: c.startTime,
        end_time: c.endTime,
        message_count: c.messageCount,
        child_index: c.childIndex
      }))

      emit({ stage: 'chunking', percent: 65, label: 'Segmentando chunks', detail: `${newParents.length} parents e ${newChildren.length} children criados` })

      // ── Stage 3.5: Propositions ───────────────────────────────────────────
      emit({ stage: 'chunking', percent: 65, label: 'Lendo mensagens a fundo', detail: 'Iniciando extração de proposições (pode demorar)...' })
      const extractor = new PropositionExtractor()
      const rawPropositions: (Proposition & { id: string, parentChunkId: string })[] = []
      
      let propsExtracted = 0
      for (const parent of newParents) {
        const props = await extractor.extract(parent.content)
        for (const p of props) {
            rawPropositions.push({
                ...p,
                id: nanoid(),
                parentChunkId: parent.id
            })
        }
        propsExtracted++
        emit({ stage: 'chunking', percent: 65 + Math.round((propsExtracted / newParents.length) * 10), label: 'Lendo fatos isolados', detail: `Extraindo proposições do bloco ${propsExtracted}/${newParents.length}` })
      }

      // ── Stage 4: Embedding ────────────────────────────────────────────────
      // Now mapping 75 to 85% for embeddings
      emit({ stage: 'embedding', percent: 75, label: 'Preparando IA', detail: 'Verificando motor de busca semântica...' })

      const modelManager = ModelManager.getInstance()
      const isAvailable = await modelManager.isAvailable('embedding')

      if (!isAvailable) {
        emit({ stage: 'embedding', percent: 75, label: 'Baixando modelo', detail: 'Iniciando download (apenas na 1ª vez)...' })
        await modelManager.download('embedding', (progress) => {
           const mbDownloaded = (progress.downloadedBytes / 1024 / 1024).toFixed(1)
           const mbTotal = (progress.totalBytes / 1024 / 1024).toFixed(1)
           emit({ 
             stage: 'embedding', 
             percent: 75 + Math.round(progress.percent * 0.05), // from 75 to 80%
             label: 'Baixando modelo', 
             detail: `${progress.percent}% — ${mbDownloaded}MB / ${mbTotal}MB` 
           })
        })
      }

      emit({ stage: 'embedding', percent: 80, label: 'Inicializando IA', detail: 'Carregando modelo na memória...' })
      const embeddingService = EmbeddingService.getInstance()
      await embeddingService.initialize()

      const vectorsToInsert: { chunkId: string; embedding: Float32Array }[] = []
      const propVectorsToInsert: { propId: string; embedding: Float32Array }[] = []
      const BATCH_SIZE = 100
      let processed = 0

      
      for (let i = 0; i < newChildren.length; i += BATCH_SIZE) {
        const batch = newChildren.slice(i, i + BATCH_SIZE)
        const texts = batch.map(c => c.content)
        
        const embeddings = await embeddingService.embedBatch(texts)
        
        for (let j = 0; j < batch.length; j++) {
          vectorsToInsert.push({ chunkId: batch[j].id!, embedding: embeddings[j] })
        }
        
        processed += batch.length
        emit({ 
          stage: 'embedding', 
          percent: 80 + Math.round((processed / (newChildren.length + rawPropositions.length)) * 5), // maps to 80-85%
          label: 'Gerando embeddings', 
          detail: `${processed} / ${newChildren.length + rawPropositions.length} vetores` 
        })
      }

      // Prop embeddings
      for (let i = 0; i < rawPropositions.length; i += BATCH_SIZE) {
        const batch = rawPropositions.slice(i, i + BATCH_SIZE)
        const texts = batch.map(c => c.fact)
        
        const embeddings = await embeddingService.embedBatch(texts)
        
        for (let j = 0; j < batch.length; j++) {
          propVectorsToInsert.push({ propId: batch[j].id, embedding: embeddings[j] })
        }
        
        processed += batch.length
        emit({ 
          stage: 'embedding', 
          percent: 80 + Math.round((processed / (newChildren.length + rawPropositions.length)) * 5),
          label: 'Gerando embeddings de proposições', 
          detail: `${processed} / ${newChildren.length + rawPropositions.length} vetores` 
        })
      }

      // ── Stage 4.5: Profile Facts ──────────────────────────────────────────
      emit({ stage: 'embedding', percent: 85, label: 'Analisando perfil', detail: 'Calculando N-grams e identificando tópicos...' })
      
      // We already created newMessages above, so we don't need to do it here again.
      const termStats = computeTermStats(newMessages)
      
      const topicClassifier = new TopicClassifier()
      await topicClassifier.init()

      const topicCounts = new Map<string, number>()
      for (const { embedding } of vectorsToInsert) {
        const result = topicClassifier.classify(embedding)
        if (result) {
          topicCounts.set(result.topic, (topicCounts.get(result.topic) || 0) + 1)
        }
      }

      emit({ stage: 'embedding', percent: 86, label: 'Analisando perfil', detail: 'Gerando Profile Facts (memórias sintéticas)...' })
      const rawFacts = buildProfileFacts(chatName, chatId, termStats, topicCounts, newParents.length)
      
      // We also need to embed these profile facts
      const factsToInsert: any[] = []
      const factVectorsToInsert: { factId: string; embedding: Float32Array }[] = []

      for (let i = 0; i < rawFacts.length; i += BATCH_SIZE) {
        const batch = rawFacts.slice(i, i + BATCH_SIZE)
        const texts = batch.map(f => f.text)
        
        const embeddings = await embeddingService.embedBatch(texts)
        
        for (let j = 0; j < batch.length; j++) {
          const factId = nanoid()
          factsToInsert.push({ ...batch[j], id: factId })
          factVectorsToInsert.push({ factId, embedding: embeddings[j] })
        }
      }

      // ── Stage 5: Storing ──────────────────────────────────────────────────
      emit({ stage: 'storing', percent: 88, label: 'Salvando no banco', detail: 'Persistindo dados da importação...' })

      const messageRepo = new MessageRepository(db)
      messageRepo.insertBatch(newMessages)

      emit({ stage: 'storing', percent: 90, label: 'Salvando no banco', detail: 'Indexando chunks no FTS5...' })
      const chunkRepo = new ChunkRepository(db)
      chunkRepo.insertParentChildBatch(newParents, newChildren)

      emit({ stage: 'storing', percent: 95, label: 'Salvando no banco', detail: 'Inserindo vetores e fatos de perfil...' })
      const vectorRepo = new VectorRepository(db)
      vectorRepo.insertBatch(vectorsToInsert)
      vectorRepo.insertFactBatch(factVectorsToInsert)

      const profileFactRepo = new ProfileFactRepository(db)
      profileFactRepo.insertBatch(factsToInsert)

      // Inserção das proposições via sql cru por simplicidade, no futuro migrar para repository.
      const insertProp = db.prepare(`
        INSERT INTO propositions (id, chat_id, parent_chunk_id, fact, category, fact_date, actors, original_quote)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertPropFts = db.prepare(`
        INSERT INTO propositions_fts (fact, original_quote, proposition_id)
        VALUES (?, ?, ?)
      `)

      db.transaction(() => {
        for (const p of rawPropositions) {
            insertProp.run(p.id, chatId!, p.parentChunkId, p.fact, p.category, p.fact_date, JSON.stringify(p.actors), p.original_quote)
            insertPropFts.run(p.fact, p.original_quote, p.id)
        }
        
        const insertPropVec = db.prepare(`
          INSERT INTO proposition_vectors (proposition_id, embedding)
          VALUES (?, ?)
        `)
        for (const pv of propVectorsToInsert) {
           insertPropVec.run(pv.propId, pv.embedding)
        }
      })()

      emit({ stage: 'done', percent: 100, label: 'Importação concluída', detail: `${parseResult.messages.length.toLocaleString('pt-BR')} mensagens indexadas com proposições` })

      return {
        success: true,
        chatId: chatId!,
        chatName: chatName,
        messageCount: parseResult.messages.length,
        chunkCount: newParents.length,
      }
    } catch (err) {
      // Clean up partial chat record if it was inserted
      try {
          if (chatId) {
             const db = DatabaseService.getInstance()
             const chatRepo = new ChatRepository(db)
             chatRepo.delete(chatId) // Cascade deletes chunks/vectors
          }
      } catch (cleanupErr) {
          console.error('[ChatImportService] Cleanup failed:', cleanupErr)
      }

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
