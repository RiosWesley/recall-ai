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

export class WorkerProcess {
  private static instance: WorkerProcess | null = null;
  
  private worker: UtilityProcess | null = null;
  private pendingRequests: Map<string, { resolve: Function, reject: Function, onToken?: (t: string) => void }> = new Map();
  private initializationPromise: Promise<void> | null = null;
  private ready = false;
  
  // Basic Batch Queue (Will be expanded in 3.4)
  private batchQueue: Array<{ prompt: string, options?: GenerateOptions, resolve: Function, reject: Function, onToken?: (t: string) => void }> = [];
  private processingQueue = false;

  private currentModelKey: 'worker' | 'worker_fallback' = 'worker';

  private constructor() {}

  static getInstance(): WorkerProcess {
    if (!WorkerProcess.instance) {
      WorkerProcess.instance = new WorkerProcess();
    }
    return WorkerProcess.instance;
  }

  async initialize(): Promise<void> {
    if (this.ready) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = new Promise(async (resolve, reject) => {
      try {
        await this.startWorker('worker');
        this.ready = true;
        resolve();
      } catch (err: any) {
        console.warn(`[WorkerProcess] Primary worker failed. Triggering fallback... Error:`, err);
        try {
          // Fallback
          await this.startWorker('worker_fallback');
          this.currentModelKey = 'worker_fallback';
          console.log('[WorkerProcess] Fallback to ' + MODEL_REGISTRY.worker_fallback.name + ' succeeded.');
          this.ready = true;
          resolve();
        } catch (fbErr) {
          console.error('[WorkerProcess] Fallback also failed:', fbErr);
          this.initializationPromise = null;
          reject(fbErr);
        }
      }
    });

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private startWorker(modelKey: 'worker' | 'worker_fallback'): Promise<void> {
    return new Promise(async (resolve, reject) => {
      console.log(`[WorkerProcess] Resolving model path for: ${modelKey}...`);
      const modelPath = await ModelManager.getInstance().resolve(modelKey);

      console.log(`[WorkerProcess] Forking Utility Process for ${modelKey}...`);
      const workerPath = path.join(_dirname, 'worker-worker.js');
      
      this.worker = utilityProcess.fork(workerPath, [], {
        stdio: 'inherit'
      });

      this.worker.on('message', (msg: any) => this.handleWorkerMessage(msg));
      
      this.worker.on('exit', (code) => {
        console.warn(`[WorkerProcess] Utility process exited with code ${code}`);
        this.ready = false;
        this.worker = null;
        this.rejectAllPending(new Error(`Worker exited unexpectedly with code ${code}`));
      });

      const id = nanoid();
      
      this.pendingRequests.set(id, {
        resolve: async () => {
          console.log(`[WorkerProcess] Initialized successfully. Running Day-0 test...`);
          try {
            // Day-0 Test
            await this.internalGenerate('test', { maxTokens: 5 });
            resolve();
          } catch (e) {
            this.dispose();
            reject(e);
          }
        },
        reject
      });

      this.worker.postMessage({
        type: 'init',
        id,
        payload: { modelPath }
      });
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  getFallbackStatus(): boolean {
    return this.currentModelKey === 'worker_fallback';
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    return this.generateStream(prompt, () => {}, options);
  }

  // Queue wrapper
  async generateStream(
    prompt: string,
    onToken: (token: string) => void,
    options?: GenerateOptions
  ): Promise<string> {
    if (!this.ready || !this.worker) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      this.batchQueue.push({ prompt, options, resolve, reject, onToken });
      this.processNextInQueue();
    });
  }

  private async processNextInQueue() {
    if (this.processingQueue || this.batchQueue.length === 0) return;
    this.processingQueue = true;

    const task = this.batchQueue.shift()!;
    try {
      const res = await this.internalGenerateStream(task.prompt, task.onToken || (() => {}), task.options);
      task.resolve(res);
    } catch (e) {
      task.reject(e);
    } finally {
      this.processingQueue = false;
      this.processNextInQueue();
    }
  }

  private async internalGenerate(prompt: string, options?: GenerateOptions): Promise<string> {
    return this.internalGenerateStream(prompt, () => {}, options);
  }

  private async internalGenerateStream(
    prompt: string,
    onToken: (token: string) => void,
    options?: GenerateOptions
  ): Promise<string> {
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
      modelName: MODEL_REGISTRY[this.currentModelKey].name,
      parameters: this.currentModelKey === 'worker' ? '350M' : '270M'
    };
  }

  async dispose(): Promise<void> {
    if (!this.worker) return;

    console.log('[WorkerProcess] Disposing worker...');
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
    this.rejectAllPending(new Error('WorkerProcess is disposing or shutting down'));
    this.initializationPromise = null;
  }

  private handleWorkerMessage(msg: any) {
    const { type, id, error, token, text } = msg;

    if (!id || !this.pendingRequests.has(id)) {
      if (type === 'error') {
        console.error(`[Worker Global Error]`, error);
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
        console.warn(`[WorkerProcess] Unrecognized message type '${type}'`);
    }
  }

  private rejectAllPending(error: Error) {
    for (const [id, req] of this.pendingRequests.entries()) {
      req.reject(error);
      this.pendingRequests.delete(id);
    }
  }
}
