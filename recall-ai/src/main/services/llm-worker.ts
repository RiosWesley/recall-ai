import { getLlama, type Llama, type LlamaModel, type LlamaContext, LlamaChatSession } from 'node-llama-cpp';
import { performance } from 'node:perf_hooks';

let llama: Llama | null = null;
let model: LlamaModel | null = null;
let context: LlamaContext | null = null;
let activeSequence: any | null = null;

// Helper function para obter o parentPort independentemente dos tipos estritos
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
        console.warn(`[LLM Worker] Unknown message type: ${type}`);
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
  console.log(`[LLM Worker] Initializing with model: ${modelPath}`);

  if (!llama) {
    // Inicialização principal da engine (usa GPU automaticamante se disponível)
    llama = await getLlama();
  }

  if (model) {
    await model.dispose();
  }

  model = await llama.loadModel({
    modelPath,
    // Permite alocar o máximo possível na GPU
    gpuLayers: 'max'
  });

  if (context) {
    await context.dispose();
  }

  context = await model.createContext({
    // Espaço de contexto do RAG + MapReduce
    contextSize: 8192 
  });

  activeSequence = context.getSequence();

  getParentPort().postMessage({ type: 'init-ready', id });
}

async function handleGenerate(id: string, payload: { prompt: string, options?: any }) {
  if (!llama || !model || !context || !activeSequence) {
    throw new Error('LLM Worker is not initialized. Send "init" first.');
  }

  const { prompt, options = {} } = payload;
  const start = performance.now();

  console.log('[LLM Worker] Clearing sequence history for stateless evaluation');
  activeSequence.clearHistory();

  // Uma nova sessão isola os contextos da query, e a flag systemPrompt gerencia 
  // o wrapper nativo do chat de cada modelo GGUF usando Jinja templating.
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
    // Nós não chamamos mais sequence.dispose(), mantemos a mesma viva 
    // e limpamos a história explicitamente se clearCache = true
  }
}

function handleDispose() {
  console.log('[LLM Worker] Disposing resources...');
  if (context) context.dispose();
  if (model) model.dispose();
  
  context = null;
  model = null;
  llama = null;
  
  // Encerra processo da V8 de forma limpa
  process.exit(0);
}
