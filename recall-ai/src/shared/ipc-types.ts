/**
 * IPC API types shared between main process and renderer.
 * The renderer accesses these via `window.api`.
 */

import type { Chat, ImportResult, ImportProgress, ModelStatus, ModelDownloadProgress, ModelKey } from './types'

export interface ElectronAPI {
  // ── Import ──────────────────────────────────────────────────────────────────
  /** Imports a WhatsApp .txt file from the given absolute path. */
  importChat(filePath: string): Promise<ImportResult>

  /** Opens a native file dialog and returns the selected file path, or null. */
  openFileDialog(): Promise<string | null>

  /**
   * Subscribe to import progress events.
   * Returns an unsubscribe function.
   */
  onImportProgress(cb: (progress: ImportProgress) => void): () => void

  // ── Chats ───────────────────────────────────────────────────────────────────
  /** Returns all imported chats, ordered by last_message_at desc. */
  getChats(): Promise<Chat[]>

  /** Deletes a chat and all its messages, chunks, and vectors. */
  deleteChat(chatId: string): Promise<void>

  // ── Models ──────────────────────────────────────────────────────────────────
  /** Returns the availability status of all registered AI models. */
  checkModels(): Promise<ModelStatus[]>

  /**
   * Downloads a model by key.
   * Listen to onModelProgress for real-time progress updates.
   * Resolves with the absolute path to the downloaded model file.
   */
  downloadModel(key: ModelKey): Promise<string>

  /**
   * Subscribe to model download progress events.
   * Returns an unsubscribe function to clean up the listener.
   */
  onModelProgress(cb: (progress: ModelDownloadProgress) => void): () => void

  // ── Window controls ─────────────────────────────────────────────────────────
  windowMinimize(): void
  windowMaximize(): void
  windowClose(): void
}

// Augment the global Window interface so TypeScript knows about window.api
declare global {
  interface Window {
    api: ElectronAPI
  }
}
