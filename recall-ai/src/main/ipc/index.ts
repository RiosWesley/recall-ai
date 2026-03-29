/**
 * Central registration point for all IPC handlers.
 * Call once in main.ts after the BrowserWindow is created.
 */

import type { BrowserWindow } from 'electron'
import { registerChatHandlers } from './chatHandlers'
import { registerImportHandlers } from './importHandlers'

export function registerAllHandlers(win: BrowserWindow) {
  registerChatHandlers()
  registerImportHandlers(win)
}
