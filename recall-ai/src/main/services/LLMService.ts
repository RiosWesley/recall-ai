import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { ModelManager } from './ModelManager';
import { MODEL_REGISTRY } from './modelRegistry';
import { SettingsService } from './SettingsService';
import fs from 'node:fs';

const _dirname = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

export interface GenerateOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  systemPrompt?: string;
  clearCache?: boolean;
}

export interface ModelInfo {
  modelName: string;
  parameters: string;
}

export class LLMService {
  private static instance: LLMService | null = null;
  
  private worker: UtilityProcess | null = null;
  private pendingRequests: Map<string, { resolve: Function, reject: Function, onToken?: Function }> = new Map();
  private initializationPromise: Promise<void> | null = null;
  private ready = false;

  private constructor() {}

  static getInstance(): LLMService {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService();
    }
    return LLMService.instance;
  }

  async initialize(): Promise<void> {
    if (this.ready) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = new Promise(async (resolve, reject) => {
      try {
        console.log('[LLMService] Resolving LLM model path...');
        const customPath = SettingsService.getInstance().get().customLlmPath;
        let modelPath = customPath && fs.existsSync(customPath) 
          ? customPath 
          : await ModelManager.getInstance().resolve('llm');

        console.log('[LLMService] Forking Utility Process...');
        
        // Onde o llm-worker.js também reside, pois adicionamos no rollupOptions
        const workerPath = path.join(_dirname, 'llm-worker.js');
        
        this.worker = utilityProcess.fork(workerPath, [], {
          stdio: 'inherit' // Permite ler a stdout/stderr do child process no terminal
        });

        this.worker.on('message', (msg: any) => this.handleWorkerMessage(msg));
        
        this.worker.on('exit', (code) => {
          console.warn(`[LLMService] Utility process exited with code ${code}`);
          this.ready = false;
          this.worker = null;
          this.rejectAllPending(new Error(`LLM Worker exited unexpectedly with code ${code}`));
        });

        const id = nanoid();
        
        this.pendingRequests.set(id, {
          resolve: () => {
            console.log('[LLMService] Utility Process initialized successfully.');
            this.ready = true;
            resolve();
          },
          reject
        });

        this.worker.postMessage({
          type: 'init',
          id,
          payload: { modelPath }
        });

      } catch (err) {
        console.error('[LLMService] Failed to initialize:', err);
        this.initializationPromise = null;
        reject(err);
      }
    });

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    return this.generateStream(prompt, () => {}, options);
  }

  async generateStream(
    prompt: string,
    onToken: (token: string) => void,
    options?: GenerateOptions
  ): Promise<string> {
    if (!this.ready || !this.worker) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      const id = nanoid();
      this.pendingRequests.set(id, { resolve, reject, onToken });

      this.worker!.postMessage({
        type: 'generate',
        id,
        payload: { prompt, options }
      });
    });
  }

  getModelInfo(): ModelInfo {
    return {
      modelName: MODEL_REGISTRY.llm.name,
      parameters: '270M'
    };
  }

  async dispose(): Promise<void> {
    if (!this.worker) return;

    console.log('[LLMService] Disposing worker...');
    this.worker.postMessage({ type: 'dispose' });
    
    // Aguardar no máximo 2 segundos para graceful shutdown
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        if (this.worker) this.worker.kill();
        resolve();
      }, 2000);

      this.worker!.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.worker = null;
    this.ready = false;
    this.rejectAllPending(new Error('LLMService is disposing or shutting down'));
    this.initializationPromise = null;
  }

  private handleWorkerMessage(msg: any) {
    const { type, id, error, token, text } = msg;

    if (!id || !this.pendingRequests.has(id)) {
      if (type === 'error') {
        console.error(`[LLMWorker Global Error]`, error);
      }
      return;
    }

    const { resolve, reject, onToken } = this.pendingRequests.get(id)!;

    switch (type) {
      case 'init-ready':
        this.pendingRequests.delete(id);
        resolve();
        break;
      case 'token':
        if (onToken && token) onToken(token);
        break;
      case 'done':
        this.pendingRequests.delete(id);
        resolve(text);
        break;
      case 'error':
        this.pendingRequests.delete(id);
        reject(new Error(error));
        break;
      default:
        console.warn(`[LLMWorker] Unrecognized message type '${type}'`);
    }
  }

  private rejectAllPending(error: Error) {
    for (const [id, req] of this.pendingRequests.entries()) {
      req.reject(error);
      this.pendingRequests.delete(id);
    }
  }
}
