import { ipcMain } from 'electron'
import { SearchService } from '../services/SearchService'
import type { SearchOptions } from '../../shared/types'

export function registerSearchHandlers() {
  ipcMain.handle('search:query', async (_event, query: string, options?: SearchOptions) => {
    try {
      return await SearchService.getInstance().search(query, options)
    } catch (err: any) {
      console.error('[SearchHandlers] Error executing search:', err)
      return []
    }
  })
}
