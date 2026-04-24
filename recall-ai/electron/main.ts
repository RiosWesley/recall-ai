import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { DatabaseService } from '../src/main/db/database'
import { registerAllHandlers } from '../src/main/ipc/index'
import { MapReduceService } from '../src/main/services/MapReduceService'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,         // Custom titlebar
    titleBarStyle: 'hidden',
    backgroundColor: '#080b0d',
    show: false,          // Prevent white flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Show only when ready — prevents flash of unstyled content
  win.once('ready-to-show', () => {
    win?.show()
  })

  // Window control IPC (one-way, no reply needed)
  ipcMain.on('window:minimize', () => win?.minimize())
  ipcMain.on('window:maximize', () => {
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.on('window:close', () => win?.close())

  // Register all two-way IPC handlers (import, chats, etc.)
  registerAllHandlers(win)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open DevTools in development
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', () => {
  MapReduceService.getInstance().stop()
  DatabaseService.close()
})

app.whenReady().then(() => {
  // Initialize database on first access (lazy — creates file only when needed)
  try {
    DatabaseService.getInstance()
    // Start the background Map-Reduce loop (runs every 60s when the Worker is ready)
    MapReduceService.getInstance().start()
  } catch (err) {
    console.error('[Main] Failed to initialize database:', err)
  }
  createWindow()
})
