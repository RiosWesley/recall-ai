import { ipcRenderer, contextBridge } from 'electron'
import type { ImportProgress, ImportResult, Chat } from '../src/shared/types'

/**
 * Expose a typed, minimal API to the renderer process via contextBridge.
 * The renderer accesses this as `window.api`.
 *
 * Security: ipcRenderer is NOT exposed directly. Only explicitly named
 * channels are allowed through, preventing renderer from invoking arbitrary
 * IPC channels.
 */
contextBridge.exposeInMainWorld('api', {
  // ── Import ──────────────────────────────────────────────────────────────────
  importChat(filePath: string): Promise<ImportResult> {
    return ipcRenderer.invoke('import:chat', filePath)
  },

  openFileDialog(): Promise<string | null> {
    return ipcRenderer.invoke('import:file-dialog')
  },

  onImportProgress(cb: (progress: ImportProgress) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, progress: ImportProgress) => cb(progress)
    ipcRenderer.on('import:progress', listener)
    // Return unsubscribe function
    return () => ipcRenderer.off('import:progress', listener)
  },

  // ── Chats ───────────────────────────────────────────────────────────────────
  getChats(): Promise<Chat[]> {
    return ipcRenderer.invoke('chats:list')
  },

  deleteChat(chatId: string): Promise<void> {
    return ipcRenderer.invoke('chats:delete', chatId)
  },

  // ── Window controls ─────────────────────────────────────────────────────────
  windowMinimize(): void {
    ipcRenderer.send('window:minimize')
  },

  windowMaximize(): void {
    ipcRenderer.send('window:maximize')
  },

  windowClose(): void {
    ipcRenderer.send('window:close')
  },
})
