import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { AppSettings } from '../../shared/types'

const DEFAULT_SETTINGS: AppSettings = {
  gpu: 'auto',
  temperature: 0.3,
  systemPrompt: 'Você é um assistente encarregado de ler históricos de chat. Responda apenas com o que estiver no contexto.',
  topK: 15,
  history: true,
  analytics: false,
  customBrainPath: null,
  customWorkerPath: null
}

export class SettingsService {
  private static instance: SettingsService
  private settingsPath: string
  private currentSettings: AppSettings

  private constructor() {
    const userData = app.getPath('userData')
    this.settingsPath = path.join(userData, 'settings.json')
    this.currentSettings = { ...DEFAULT_SETTINGS }
    this.load()
  }

  public static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService()
    }
    return SettingsService.instance
  }

  public get(): AppSettings {
    return { ...this.currentSettings }
  }

  public update(partial: Partial<AppSettings>): AppSettings {
    const hasGpuChanged = partial.gpu !== undefined && partial.gpu !== this.currentSettings.gpu
    const hasBrainChanged = 'customBrainPath' in partial && partial.customBrainPath !== this.currentSettings.customBrainPath
    const hasWorkerChanged = 'customWorkerPath' in partial && partial.customWorkerPath !== this.currentSettings.customWorkerPath

    this.currentSettings = {
      ...this.currentSettings,
      ...partial
    }
    this.save()

    // Resets LLM/Embedding runtime models if GPU backend or Paths changed to force re-initialization
    if (hasGpuChanged || hasBrainChanged || hasWorkerChanged) {
      setTimeout(async () => {
        console.log('[SettingsService] Critical backend setting changed. Disposing active models for cold-restart.')
        // Lazy import avoids circular dependency loops in ESM
        const { WorkerProcess } = await import('./WorkerProcess')
        const { BrainProcess } = await import('./BrainProcess')
        
        try { WorkerProcess.getInstance().dispose() } catch(e){}
        try { BrainProcess.getInstance().dispose() } catch(e){}
      }, 0)
    }

    return this.get()
  }

  private load() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf-8')
        const parsed = JSON.parse(data)
        this.currentSettings = {
          ...DEFAULT_SETTINGS,
          ...parsed
        }
      } else {
        this.save()
      }
    } catch (error) {
      console.error('[SettingsService] Failed to load settings:', error)
      this.currentSettings = { ...DEFAULT_SETTINGS }
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.currentSettings, null, 2))
    } catch (error) {
      console.error('[SettingsService] Failed to save settings:', error)
    }
  }
}
