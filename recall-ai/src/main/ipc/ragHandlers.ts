import { ipcMain, type BrowserWindow } from 'electron'
import { RAGService } from '../services/RAGService'
import type { RAGOptions } from '../../shared/types'

export function registerRagHandlers(win: BrowserWindow) {
  ipcMain.handle('rag:query', async (_event, question: string, options?: RAGOptions) => {
    try {
      const ragService = RAGService.getInstance()
      
      const response = await ragService.generateStream(
        question,
        (token) => {
          win.webContents.send('rag:token', token)
        },
        options
      )

      win.webContents.send('rag:done', response)
    } catch (error) {
      console.error('[IPC rag:query] Error:', error)
      throw error
    }
  })

  ipcMain.handle('rag:status', async () => {
    const { BrainProcess } = await import('../services/BrainProcess')
    const { WorkerProcess } = await import('../services/WorkerProcess')
    
    return {
      brain: {
        ready: BrainProcess.getInstance().isReady()
      },
      worker: {
        ready: WorkerProcess.getInstance().isReady(),
        fallback: WorkerProcess.getInstance().getFallbackStatus()
      }
    }
  })
}
