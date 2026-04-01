import { getLlama, type Llama, type LlamaModel, type LlamaContext, LlamaChatSession } from 'node-llama-cpp';
import { performance } from 'node:perf_hooks';

let llama: Llama | null = null;
let model: LlamaModel | null = null;
let context: LlamaContext | null = null;
let activeSequence: any | null = null;

const getParentPort = () => (process as any).parentPort;

getParentPort().on('message', async (event: any) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  const { type, id, payload } = data;

  try {
    switch (type) {
      case 'init':
        await handleInit(id, payload);
        break;
      case 'generate':
        await handleGenerate(id, payload);
        break;
      case 'dispose':
        handleDispose();
        break;
      default:
        console.warn(`[Brain Worker] Unknown message type: ${type}`);
    }
  } catch (error: any) {
    getParentPort().postMessage({
      type: 'error',
      id,
      error: error.message || String(error)
    });
  }
});

async function handleInit(id: string, payload: { modelPath: string }) {
  const { modelPath } = payload;
  console.log(`[Brain Worker] Initializing with model: ${modelPath}`);

  if (!llama) {
    llama = await getLlama();
  }
  if (model) {
    await model.dispose();
  }

  model = await llama.loadModel({
    modelPath,
    gpuLayers: 'max'
  });

  if (context) {
    await context.dispose();
  }

  context = await model.createContext({
    contextSize: 8192 
  });

  activeSequence = context.getSequence();

  getParentPort().postMessage({ type: 'init-ready', id });
}

async function handleGenerate(id: string, payload: { prompt: string, options?: any }) {
  if (!llama || !model || !context || !activeSequence) {
    throw new Error('Brain Worker is not initialized. Send "init" first.');
  }

  const { prompt, options = {} } = payload;
  const start = performance.now();

  console.log('[Brain Worker] Clearing sequence history for stateless evaluation');
  activeSequence.clearHistory();

  const session = new LlamaChatSession({
    contextSequence: activeSequence,
    systemPrompt: options.systemPrompt
  });

  try {
    const response = await session.prompt(prompt, {
      temperature: options.temperature ?? 0.7,
      topP: options.topP ?? 0.9,
      maxTokens: options.maxTokens ?? 1024,
      onTextChunk(text: string) {
        getParentPort().postMessage({
          type: 'token',
          id,
          token: text
        });
      }
    });

    const end = performance.now();

    getParentPort().postMessage({
      type: 'done',
      id,
      text: response,
      stats: {
        generationTime: Math.round(end - start)
      }
    });
  } finally {
  }
}

function handleDispose() {
  console.log('[Brain Worker] Disposing resources...');
  if (context) context.dispose();
  if (model) model.dispose();
  
  context = null;
  model = null;
  llama = null;
  
  process.exit(0);
}
