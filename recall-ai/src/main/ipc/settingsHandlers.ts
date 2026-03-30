import { ipcMain } from 'electron'
import { SettingsService } from '../services/SettingsService'
import type { AppSettings } from '../../shared/types'

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', async (): Promise<AppSettings> => {
    return SettingsService.getInstance().get()
  })

  ipcMain.handle('settings:update', async (_event, partial: Partial<AppSettings>): Promise<AppSettings> => {
    return SettingsService.getInstance().update(partial)
  })
}
