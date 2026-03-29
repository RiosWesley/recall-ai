/**
 * Chat IPC handlers.
 *   chats:list   — returns all chats ordered by last_message_at desc
 *   chats:delete — removes chat + cascades to messages & chunks
 */

import { ipcMain } from 'electron'
import { DatabaseService } from '../db/database'
import { ChatRepository } from '../db/repositories/ChatRepository'
import { MessageRepository } from '../db/repositories/MessageRepository'
import { ChunkRepository } from '../db/repositories/ChunkRepository'
import { VectorRepository } from '../db/repositories/VectorRepository'
import type { Chat } from '../../shared/types'

export function registerChatHandlers() {
  ipcMain.handle('chats:list', async (): Promise<Chat[]> => {
    const db = DatabaseService.getInstance()
    const repo = new ChatRepository(db)
    return repo.findAll()
  })

  ipcMain.handle('chats:delete', async (_event, chatId: string): Promise<void> => {
    const db = DatabaseService.getInstance()

    // Delete in dependency order inside a transaction
    const deleteOp = db.transaction(() => {
      const msgRepo = new MessageRepository(db)
      const chunkRepo = new ChunkRepository(db)
      const chatRepo = new ChatRepository(db)
      const vectorRepo = new VectorRepository(db)

      vectorRepo.deleteByChatId(chatId)
      chunkRepo.deleteByChatId(chatId)
      msgRepo.deleteByChatId(chatId)   // MessageRepository needs deleteByChatId — see below
      chatRepo.delete(chatId)
    })

    deleteOp()
  })
}
