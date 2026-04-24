import { ipcRenderer, contextBridge } from 'electron'
import type { ImportProgress, ImportResult, Chat, ModelStatus, ModelDownloadProgress, ModelKey, SearchOptions, SearchResult } from '../src/shared/types'

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

  // ── Models ──────────────────────────────────────────────────────────────────
  checkModels(): Promise<ModelStatus[]> {
    return ipcRenderer.invoke('models:check')
  },

  downloadModel(key: ModelKey): Promise<string> {
    return ipcRenderer.invoke('models:download', key)
  },

  onModelProgress(cb: (progress: ModelDownloadProgress) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, progress: ModelDownloadProgress) => cb(progress)
    ipcRenderer.on('models:progress', listener)
    return () => ipcRenderer.off('models:progress', listener)
  },

  selectModelFile(): Promise<string | null> {
    return ipcRenderer.invoke('models:select-file')
  },

  // ── Search ──────────────────────────────────────────────────────────────────
  search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return ipcRenderer.invoke('search:query', query, options)
  },

  // ── RAG ─────────────────────────────────────────────────────────────────────
  askRAG(question: string, options?: import('../src/shared/types').RAGOptions): Promise<void> {
    return ipcRenderer.invoke('rag:query', question, options)
  },

  onRAGToken(cb: (token: string) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, token: string) => cb(token)
    ipcRenderer.on('rag:token', listener)
    return () => ipcRenderer.off('rag:token', listener)
  },

  onRAGStep(cb: (step: import('../src/shared/types').RAGStep) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, step: import('../src/shared/types').RAGStep) => cb(step)
    ipcRenderer.on('rag:step', listener)
    return () => ipcRenderer.off('rag:step', listener)
  },

  onRAGDone(cb: (response: import('../src/shared/types').RAGResponse) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, response: import('../src/shared/types').RAGResponse) => cb(response)
    ipcRenderer.on('rag:done', listener)
    return () => ipcRenderer.off('rag:done', listener)
  },

  // ── Settings ────────────────────────────────────────────────────────────────
  getSettings(): Promise<import('../src/shared/types').AppSettings> {
    return ipcRenderer.invoke('settings:get')
  },

  updateSettings(partial: Partial<import('../src/shared/types').AppSettings>): Promise<import('../src/shared/types').AppSettings> {
    return ipcRenderer.invoke('settings:update', partial)
  },

  // ── People & Mentions ───────────────────────────────────────────────────────
  getPendingMentions(): Promise<import('../src/shared/types').PendingMention[]> {
    return ipcRenderer.invoke('mentions:get_pending')
  },

  getPeople(): Promise<import('../src/shared/types').Person[]> {
    return ipcRenderer.invoke('mentions:get_people')
  },

  getRelations(): Promise<import('../src/shared/types').PersonRelation[]> {
    return ipcRenderer.invoke('mentions:get_relations')
  },

  resolveMention(mentionId: string, action: import('../src/shared/types').MentionResolutionAction, personId?: string): Promise<void> {
    return ipcRenderer.invoke('mentions:resolve', mentionId, action, personId)
  },

  onMentionDetected(cb: (mention: import('../src/shared/types').PendingMention) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, mention: import('../src/shared/types').PendingMention) => cb(mention)
    ipcRenderer.on('ingest:mention_detected', listener)
    return () => ipcRenderer.off('ingest:mention_detected', listener)
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
