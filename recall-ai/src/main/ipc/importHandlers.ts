/**
 * Import IPC handlers.
 *   import:chat        — runs the full import pipeline
 *   import:file-dialog — opens a native file picker
 */

import { ipcMain, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { ChatImportService } from '../services/ChatImportService'
import type { ImportResult } from '../../shared/types'

const importService = new ChatImportService()

export function registerImportHandlers(win: BrowserWindow) {
  ipcMain.handle('import:chat', async (_event, filePath: string): Promise<ImportResult> => {
    return importService.import(filePath, win.webContents)
  })

  ipcMain.handle('import:file-dialog', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Selecionar export do WhatsApp',
      filters: [
        { name: 'WhatsApp Export', extensions: ['txt', 'zip'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
