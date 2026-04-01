import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { ModelManager } from './ModelManager';
import { MODEL_REGISTRY } from './modelRegistry';

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

export class BrainProcess {
  private static instance: BrainProcess | null = null;
  
  private worker: UtilityProcess | null = null;
  private pendingRequests: Map<string, { resolve: Function, reject: Function, onToken?: Function }> = new Map();
  private initializationPromise: Promise<void> | null = null;
  private ready = false;

  private constructor() {}

  static getInstance(): BrainProcess {
    if (!BrainProcess.instance) {
      BrainProcess.instance = new BrainProcess();
    }
    return BrainProcess.instance;
  }

  async initialize(): Promise<void> {
    if (this.ready) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = new Promise(async (resolve, reject) => {
      try {
        console.log('[BrainProcess] Resolving Brain model path...');
        const modelPath = await ModelManager.getInstance().resolve('brain');

        console.log('[BrainProcess] Forking Utility Process...');
        
        const workerPath = path.join(_dirname, 'brain-worker.js');
        
        this.worker = utilityProcess.fork(workerPath, [], {
          stdio: 'inherit'
        });

        this.worker.on('message', (msg: any) => this.handleWorkerMessage(msg));
        
        this.worker.on('exit', (code) => {
          console.warn(`[BrainProcess] Utility process exited with code ${code}`);
          this.ready = false;
          this.worker = null;
          this.rejectAllPending(new Error(`Brain Worker exited unexpectedly with code ${code}`));
        });

        const id = nanoid();
        
        this.pendingRequests.set(id, {
          resolve: () => {
            console.log('[BrainProcess] Utility Process initialized successfully.');
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
        console.error('[BrainProcess] Failed to initialize:', err);
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
      modelName: MODEL_REGISTRY.brain.name,
      parameters: '4B'
    };
  }

  async dispose(): Promise<void> {
    if (!this.worker) return;

    console.log('[BrainProcess] Disposing worker...');
    this.worker.postMessage({ type: 'dispose' });
    
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
    this.rejectAllPending(new Error('BrainProcess is disposing or shutting down'));
    this.initializationPromise = null;
  }

  private handleWorkerMessage(msg: any) {
    const { type, id, error, token, text } = msg;

    if (!id || !this.pendingRequests.has(id)) {
      if (type === 'error') {
        console.error(`[BrainWorker Global Error]`, error);
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
        console.warn(`[BrainWorker] Unrecognized message type '${type}'`);
    }
  }

  private rejectAllPending(error: Error) {
    for (const [id, req] of this.pendingRequests.entries()) {
      req.reject(error);
      this.pendingRequests.delete(id);
    }
  }
}
