/**
 * IPC Handlers for model management.
 *
 * Channels:
 *   models:check     → Returns ModelStatus[] for all registered models
 *   models:download  → Downloads a specific model; emits models:progress events
 *   models:cancel    → (future) Cancel an in-progress download
 *
 * Progress events are pushed to the renderer via:
 *   models:progress  → ModelDownloadProgress (events, not request-response)
 */

import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { ModelManager } from '../services/ModelManager'
import type { ModelKey, ModelDownloadProgress } from '../../shared/types'

export function registerModelHandlers(win: BrowserWindow): void {
  const manager = ModelManager.getInstance()

  /**
   * models:check — Returns current availability status for all models.
   * Called on app startup and whenever the UI needs a fresh status.
   */
  ipcMain.handle('models:check', async (): Promise<Awaited<ReturnType<ModelManager['checkAll']>>> => {
    return manager.checkAll()
  })

  /**
   * models:download — Initiates download of a specific model.
   *
   * Progress events are streamed to the renderer via win.webContents.send('models:progress', ...).
   * The handler resolves when the download is complete, or rejects on error.
   *
   * The renderer should listen for 'models:progress' events separately
   * to update the UI during the download without blocking on the invoke call.
   */
  ipcMain.handle('models:download', async (_, key: ModelKey): Promise<string> => {
    return manager.download(key, (progress: ModelDownloadProgress) => {
      // Guard against destroyed window (e.g. user closed the app mid-download)
      if (!win.isDestroyed()) {
        win.webContents.send('models:progress', progress)
      }
    })
  })
}
