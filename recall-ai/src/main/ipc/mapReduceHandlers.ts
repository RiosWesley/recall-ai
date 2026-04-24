import { ipcMain } from 'electron'
import { MapReduceService } from '../services/MapReduceService'

export function registerMapReduceHandlers() {
  const service = MapReduceService.getInstance()

  /** Returns the current status of the background service. */
  ipcMain.handle('mapreduce:status', async () => {
    return service.getStatus()
  })

  /** Trigger an immediate extraction pass (UI-initiated). */
  ipcMain.handle('mapreduce:run_now', async () => {
    await service.runNow()
    return service.getStatus()
  })
}
