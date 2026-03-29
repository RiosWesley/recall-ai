/**
 * ModelManager — Manages AI model lifecycle for Recall.ai.
 *
 * Thin wrapper over node-llama-cpp's built-in download infrastructure:
 *   - createModelDownloader  (parallel download via ipull, progress events)
 *   - resolveModelFile       (cache-aware resolution — skips download if file exists + valid)
 *
 * Responsibilities:
 *   1. Check model availability (no network — purely local file check)
 *   2. Download models with real-time progress callbacks
 *   3. Resolve model file paths for consumption by EmbeddingService / LLMService
 *
 * NOT responsible for: loading models, inference, context management.
 * That is the domain of EmbeddingService (TASK 2.2) and LLMService (TASK 3.1).
 *
 * API note (from actual .d.ts):
 *   resolveModelFile(uriOrPath, optionsOrDirectory?: ResolveModelFileOptions | string)
 *   createModelDownloader({ modelUri, dirPath, showCliProgress, onProgress, ... })
 *   onProgress receives: { totalSize: number, downloadedSize: number }
 */

import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import { createModelDownloader, resolveModelFile } from 'node-llama-cpp'
import {
  MODEL_REGISTRY,
  MODEL_DOWNLOAD_ORDER,
  type ModelKey,
} from './modelRegistry'
import type { ModelStatus, ModelDownloadProgress } from '../../shared/types'

export class ModelManager {
  private static instance: ModelManager | null = null

  /** Absolute path to the models directory in Electron's userData */
  readonly modelsDir: string

  private constructor() {
    this.modelsDir = path.join(app.getPath('userData'), 'models')
    // Ensure directory exists on first access
    fs.mkdirSync(this.modelsDir, { recursive: true })
  }

  static getInstance(): ModelManager {
    if (!ModelManager.instance) {
      ModelManager.instance = new ModelManager()
    }
    return ModelManager.instance
  }

  /**
   * Checks whether a model file is present locally without triggering a download.
   *
   * resolveModelFile with `download: false` returns the expected local path
   * without checking the network. We then verify the file actually exists on disk.
   */
  async isAvailable(key: ModelKey): Promise<boolean> {
    try {
      const modelPath = await resolveModelFile(MODEL_REGISTRY[key].uri, {
        directory: this.modelsDir,
        download: false,  // never trigger a download in a presence check
        cli: false,
      })
      return fs.existsSync(modelPath)
    } catch {
      return false
    }
  }

  /**
   * Returns the status of all registered models.
   * Runs availability checks in parallel for speed.
   */
  async checkAll(): Promise<ModelStatus[]> {
    const statuses = await Promise.all(
      MODEL_DOWNLOAD_ORDER.map(async (key): Promise<ModelStatus> => {
        const entry = MODEL_REGISTRY[key]
        const available = await this.isAvailable(key)
        let filePath: string | undefined

        if (available) {
          try {
            filePath = await resolveModelFile(entry.uri, {
              directory: this.modelsDir,
              download: false,
              cli: false,
            })
          } catch {
            // Non-fatal — file may have been deleted between the two calls
          }
        }

        return {
          key,
          name: entry.name,
          quantization: entry.quantization,
          sizeEstimate: entry.sizeEstimate,
          purpose: entry.purpose,
          available,
          filePath,
        }
      })
    )
    return statuses
  }

  /**
   * Downloads a model with real-time progress reporting via the supplied callback.
   *
   * Uses node-llama-cpp's createModelDownloader which:
   *  - Downloads via ipull (parallel connections, fast)
   *  - Handles multi-part GGUF files automatically
   *  - Resumes interrupted downloads
   *  - Skips download if file already exists and size matches (skipExisting: true by default)
   *
   * @param key        - Which model to download
   * @param onProgress - Optional callback called with progress on each chunk
   * @returns          - Absolute path to the downloaded model entrypoint file
   */
  async download(
    key: ModelKey,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<string> {
    const entry = MODEL_REGISTRY[key]

    console.log(`[ModelManager] Starting download: ${entry.name} (${entry.uri})`)

    const downloader = await createModelDownloader({
      modelUri: entry.uri,
      dirPath: this.modelsDir,
      showCliProgress: false,
      onProgress: ({ totalSize, downloadedSize }) => {
        if (onProgress) {
          const total = totalSize ?? entry.sizeEstimate
          onProgress({
            key,
            name: entry.name,
            downloadedBytes: downloadedSize,
            totalBytes: total,
            percent: total > 0 ? Math.round((downloadedSize / total) * 100) : 0,
            speed: 0, // ipull doesn't expose instantaneous speed in onProgress
          })
        }
      },
    })

    const modelPath = await downloader.download()
    console.log(`[ModelManager] Download complete: ${entry.name} → ${modelPath}`)
    return modelPath
  }

  /**
   * Resolves the absolute file path for a model.
   *
   * If the model is not found locally, this will trigger an automatic download
   * (silent — no progress callback). Prefer `download()` when you need UI feedback.
   *
   * Intended for use inside services (EmbeddingService, LLMService) to get
   * the model path lazily at initialization time.
   */
  async resolve(key: ModelKey): Promise<string> {
    const entry = MODEL_REGISTRY[key]
    return resolveModelFile(entry.uri, {
      directory: this.modelsDir,
      download: 'auto',
      cli: false,
    })
  }
}
