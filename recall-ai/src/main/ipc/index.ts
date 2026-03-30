/**
 * Central registration point for all IPC handlers.
 * Call once in main.ts after the BrowserWindow is created.
 */

import type { BrowserWindow } from 'electron'
import { registerChatHandlers } from './chatHandlers'
import { registerImportHandlers } from './importHandlers'
import { registerModelHandlers } from './modelHandlers'
import { registerSearchHandlers } from './searchHandlers'
import { registerRagHandlers } from './ragHandlers'
import { registerSettingsHandlers } from './settingsHandlers'

export function registerAllHandlers(win: BrowserWindow) {
  registerChatHandlers()
  registerImportHandlers(win)
  registerModelHandlers(win)
  registerSearchHandlers()
  registerRagHandlers(win)
  registerSettingsHandlers()
}
