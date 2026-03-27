# Recall.ai — Especificações Técnicas

> **Versão:** 2.0 (Desktop-First)
> **Última Atualização:** Março 2026

---

## 1. Stack Tecnológica Completa

### 1.1 Visão Geral

```
┌─────────────────────────────────────────────────────────────────┐
│                    STACK RECALL.AI v1.0 (DESKTOP)                │
├───────────────────┬──────────────────────────┬──────────────────┤
│  CAMADA           │  TECNOLOGIA              │  VERSÃO          │
├───────────────────┼──────────────────────────┼──────────────────┤
│  Shell            │  Electron                │  33+             │
│  Linguagem        │  TypeScript              │  5.x             │
│  Build Tool       │  electron-vite           │  Latest          │
│  Frontend         │  React                   │  19.x            │
│  UI Components    │  Shadcn UI (Radix)       │  Latest          │
│  Styling          │  Tailwind CSS            │  4.x             │
│  Estado Global    │  Zustand                 │  5.x             │
│  Async State      │  TanStack Query          │  5.x             │
│  Database         │  better-sqlite3          │  Latest          │
│  Vector Search    │  sqlite-vec              │  Latest          │
│  Full-Text Search │  SQLite FTS5             │  Built-in        │
│  ML Runtime       │  node-llama-cpp          │  Latest          │
│  Animações        │  Framer Motion           │  Latest          │
│  Routing          │  React Router            │  7.x             │
│  Auto-Update      │  electron-updater        │  Latest          │
│  Packaging        │  electron-builder        │  Latest          │
└───────────────────┴──────────────────────────┴──────────────────┘
```

### 1.2 Comparação Desktop vs Mobile (v2.0)

```
┌───────────────────┬──────────────────────────┬──────────────────┐
│  CAMADA           │  DESKTOP (v1.0)          │  MOBILE (v2.0)   │
├───────────────────┼──────────────────────────┼──────────────────┤
│  Shell            │  Electron                │  React Native    │
│  Build            │  electron-vite           │  Expo SDK 52+    │
│  Database         │  better-sqlite3          │  op-sqlite (JSI) │
│  Vector Search    │  sqlite-vec              │  Cosine manual   │
│  ML Runtime       │  node-llama-cpp          │  LiteRT / TFLite │
│  File System      │  Node.js fs (direto)     │  expo-file-system│
│  Navegação        │  React Router            │  Expo Router     │
│  UI Components    │  Shadcn UI               │  Tamagui/NativeW │
│  Animações        │  Framer Motion           │  Reanimated      │
│  Distribuição     │  electron-builder        │  App/Play Store  │
└───────────────────┴──────────────────────────┴──────────────────┘
```

---

## 2. Modelos de IA

### 2.1 Modelo de Embedding

| Propriedade | Valor |
|-------------|-------|
| **Nome** | all-MiniLM-L6-v2 |
| **Origem** | Sentence Transformers (HuggingFace) |
| **Formato** | GGUF (via node-llama-cpp) |
| **Tamanho** | ~25MB |
| **Dimensão Output** | 384 |
| **Max Sequence** | 256 tokens |
| **Download** | Automático no first-run |

**Alternativas consideradas:**
- `paraphrase-MiniLM-L3-v2` (~17MB, menor qualidade)
- `all-mpnet-base-v2` (~90MB, melhor qualidade, viável no desktop)
- `e5-small-v2` (~30MB, boa alternativa)

**Decisão:** all-MiniLM-L6-v2 oferece o melhor trade-off tamanho/qualidade e é o mesmo modelo planejado para o mobile (v2.0), garantindo compatibilidade de embeddings.

---

### 2.2 Modelo Generativo (LLM)

| Propriedade | Valor |
|-------------|-------|
| **Nome** | Gemma 3 270M |
| **Origem** | Google DeepMind |
| **Formato** | GGUF (INT4 quantizado) |
| **Parâmetros** | 270M total |
| **Arquitetura** | 170M embedding + 100M transformer |
| **Vocabulário** | 256,000 tokens |
| **Contexto** | 32K tokens |
| **Tamanho (INT4 GGUF)** | ~150MB |
| **Runtime** | node-llama-cpp |
| **Execução** | Electron Utility Process |
| **Download** | Automático no first-run |

**Performance Desktop (estimada):**

| Hardware | Tokens/s | Primeiro Token |
|----------|----------|----------------|
| CPU (x86_64 AVX2) | 15-25 | 300ms-1s |
| CPU (Apple Silicon) | 20-35 | 200ms-800ms |
| GPU NVIDIA (CUDA) | 30-50 | 100ms-500ms |
| GPU AMD (Vulkan) | 25-40 | 150ms-600ms |
| GPU Intel/iGPU (Vulkan) | 20-30 | 200ms-700ms |
| GPU Apple (Metal) | 30-50 | 100ms-500ms |

**Características especiais:**
- Projetado para fine-tuning em tarefas específicas
- Excelente para extração de informação
- Vocabulário grande (bom para PT-BR e gírias)
- Modelo leve — roda confortavelmente até em hardware modesto
- Mesmo modelo será usado no mobile (v2.0), garantindo paridade de comportamento

**Alternativas para upgrade futuro (desktop):**
- `Gemma 3 1B` (~700MB INT4, mais capaz, settings opcionais)
- `Phi-3.5 Mini` (~1.5GB, qualidade superior)
- `Qwen2.5-0.5B` (~400MB, boa alternativa)
- `SmolLM2-360M` (~200MB, alternativa leve)

> **Nota:** O usuário poderá trocar de modelo nas Settings sem recompilar, graças ao formato GGUF padronizado do node-llama-cpp.

---

## 3. Banco de Dados

### 3.1 Tecnologia

- **Engine:** better-sqlite3 (wrapper síncrono nativo para SQLite)
- **Vector Search:** sqlite-vec (extensão KNN com aceleração SIMD)
- **Full-Text Search:** FTS5 (built-in do SQLite)
- **Localização:** `app.getPath('userData')/recall-ai.db`

### 3.2 Schema SQLite

```sql
-- Tabela principal de chats importados
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT DEFAULT 'whatsapp',
  participant_count INTEGER,
  message_count INTEGER,
  first_message_at INTEGER,  -- Unix timestamp
  last_message_at INTEGER,
  imported_at INTEGER DEFAULT (strftime('%s', 'now')),
  file_hash TEXT,  -- Para detectar re-importação
  metadata TEXT    -- JSON com dados extras
);

-- Tabela de mensagens parseadas
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT DEFAULT 'text',  -- text, media, system
  raw TEXT,  -- texto original
  UNIQUE(chat_id, timestamp, sender, content)
);

-- Tabela de chunks (fragmentos para embedding)
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  content TEXT NOT NULL,          -- texto para embedding
  display_content TEXT NOT NULL,  -- texto para exibir
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  message_count INTEGER,
  token_count INTEGER,
  participants TEXT,  -- JSON array
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Tabela de vetores (embeddings via sqlite-vec)
CREATE VIRTUAL TABLE vectors USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding FLOAT[384]           -- dimensão do MiniLM-L6-v2
);

-- Full-Text Search para busca híbrida
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  chunk_id UNINDEXED,
  tokenize='unicode61'
);

-- Índices para performance
CREATE INDEX idx_messages_chat ON messages(chat_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_messages_sender ON messages(sender);
CREATE INDEX idx_chunks_chat ON chunks(chat_id);
CREATE INDEX idx_chunks_time ON chunks(start_time, end_time);

-- Tabela de cache de queries
CREATE TABLE query_cache (
  id TEXT PRIMARY KEY,
  query_text TEXT NOT NULL,
  query_embedding BLOB,
  result_chunks TEXT,  -- JSON array of chunk IDs
  llm_response TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  hit_count INTEGER DEFAULT 0
);

-- Tabela de histórico de buscas
CREATE TABLE search_history (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  chat_ids TEXT,       -- JSON array (filtro usado)
  result_count INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

### 3.3 Operações com sqlite-vec

```typescript
// Inserir embedding
db.prepare(`
  INSERT INTO vectors (chunk_id, embedding)
  VALUES (?, ?)
`).run(chunkId, float32ArrayToBuffer(embedding));

// Busca KNN (K-Nearest Neighbors)
const results = db.prepare(`
  SELECT chunk_id, distance
  FROM vectors
  WHERE embedding MATCH ?
  ORDER BY distance
  LIMIT ?
`).all(float32ArrayToBuffer(queryEmbedding), topK);

// Busca híbrida: sqlite-vec + FTS5
const hybridResults = db.prepare(`
  WITH semantic AS (
    SELECT chunk_id, distance as sem_score
    FROM vectors
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  ),
  keyword AS (
    SELECT chunk_id, rank as fts_score
    FROM chunks_fts
    WHERE content MATCH ?
    LIMIT ?
  )
  SELECT
    COALESCE(s.chunk_id, k.chunk_id) as chunk_id,
    s.sem_score,
    k.fts_score,
    (0.7 * COALESCE(s.sem_score, 1.0) + 0.3 * COALESCE(k.fts_score, 0)) as combined
  FROM semantic s
  FULL OUTER JOIN keyword k ON s.chunk_id = k.chunk_id
  ORDER BY combined
  LIMIT ?
`).all(queryEmbedding, topK, queryText, topK, topK);
```

---

## 4. APIs e Interfaces

### 4.1 IPC Bridge (contextBridge)

```typescript
// preload/index.ts — expõe APIs seguras para o renderer
contextBridge.exposeInMainWorld('api', {
  // Import
  importChat: (filePath: string) => ipcRenderer.invoke('import:chat', filePath),
  onImportProgress: (cb: (progress: ImportProgress) => void) =>
    ipcRenderer.on('import:progress', (_, data) => cb(data)),

  // Search
  search: (query: string, options?: SearchOptions) =>
    ipcRenderer.invoke('search:query', query, options),

  // RAG
  askRAG: (question: string, options?: RAGOptions) =>
    ipcRenderer.invoke('rag:query', question, options),
  onRAGToken: (cb: (token: string) => void) =>
    ipcRenderer.on('rag:token', (_, token) => cb(token)),
  onRAGDone: (cb: (response: RAGResponse) => void) =>
    ipcRenderer.on('rag:done', (_, response) => cb(response)),

  // Chats
  getChats: () => ipcRenderer.invoke('chats:list'),
  deleteChat: (chatId: string) => ipcRenderer.invoke('chats:delete', chatId),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: Partial<UserSettings>) =>
    ipcRenderer.invoke('settings:update', settings),

  // System
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
});
```

### 4.2 Core Services (Main Process)

```typescript
// ==========================================
// ChatImportService
// ==========================================
interface ChatImportService {
  importFromFile(filePath: string): Promise<ImportResult>;
  importFromZip(zipPath: string): Promise<ImportResult>;
  isDuplicate(fileHash: string): Promise<boolean>;
  getProgress(): ImportProgress;
  cancel(): void;
}

interface ImportResult {
  success: boolean;
  chatId: string;
  messageCount: number;
  chunkCount: number;
  timeElapsed: number;
  errors?: string[];
}

interface ImportProgress {
  stage: 'reading' | 'parsing' | 'chunking' | 'embedding' | 'storing';
  current: number;
  total: number;
  percentage: number;
}

// ==========================================
// SearchService
// ==========================================
interface SearchService {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  hybridSearch(query: string, options?: HybridSearchOptions): Promise<SearchResult[]>;
}

interface SearchOptions {
  chatIds?: string[];
  topK?: number;
  minScore?: number;
  dateRange?: DateRange;
  sender?: string;
}

interface SearchResult {
  chunkId: string;
  chatId: string;
  content: string;
  displayContent: string;
  similarity: number;
  timestamp: Date;
  participants: string[];
}

// ==========================================
// LLMService (Utility Process)
// ==========================================
interface LLMService {
  initialize(): Promise<void>;
  isReady(): boolean;
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  generateStream(
    prompt: string,
    onToken: (token: string) => void,
    options?: GenerateOptions
  ): Promise<void>;
  dispose(): void;
  getModelInfo(): ModelInfo;
}

interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
}

interface ModelInfo {
  name: string;
  size: number;
  quantization: string;
  gpuAccelerated: boolean;
  gpuBackend?: 'cuda' | 'metal' | 'vulkan' | 'cpu';
}

// ==========================================
// RAGService (Orquestrador)
// ==========================================
interface RAGService {
  query(question: string, options?: RAGOptions): Promise<RAGResponse>;
  queryStream(
    question: string,
    onToken: (token: string) => void,
    options?: RAGOptions
  ): Promise<RAGResponse>;
}

interface RAGOptions {
  chatIds?: string[];
  topK?: number;
  includeContext?: boolean;
  hybridSearch?: boolean;
}

interface RAGResponse {
  answer: string;
  context?: SearchResult[];
  tokensUsed: number;
  latency: {
    embedding: number;
    search: number;
    generation: number;
    total: number;
  };
}
```

---

## 5. Estrutura de Pastas do Projeto

```
recall-ai/
├── src/
│   ├── main/                          # Electron Main Process
│   │   ├── index.ts                   # Entry point
│   │   ├── ipc/                       # IPC handlers
│   │   │   ├── chatHandlers.ts
│   │   │   ├── searchHandlers.ts
│   │   │   ├── importHandlers.ts
│   │   │   └── llmHandlers.ts
│   │   ├── services/                  # Backend services
│   │   │   ├── ChatImportService.ts
│   │   │   ├── SearchService.ts
│   │   │   ├── LLMService.ts
│   │   │   ├── RAGService.ts
│   │   │   └── EmbeddingService.ts
│   │   ├── core/                      # Core logic (portable → mobile later)
│   │   │   ├── parser/
│   │   │   │   ├── WhatsAppParser.ts
│   │   │   │   ├── patterns.ts
│   │   │   │   └── types.ts
│   │   │   ├── chunking/
│   │   │   │   ├── ChunkingStrategy.ts
│   │   │   │   └── strategies/
│   │   │   │       ├── TimeWindowStrategy.ts
│   │   │   │       └── MessageStrategy.ts
│   │   │   └── vector/
│   │   │       └── VectorSearch.ts
│   │   ├── db/                        # Database layer
│   │   │   ├── database.ts            # better-sqlite3 connection
│   │   │   ├── migrations/
│   │   │   └── repositories/
│   │   │       ├── ChatRepository.ts
│   │   │       ├── MessageRepository.ts
│   │   │       ├── ChunkRepository.ts
│   │   │       └── VectorRepository.ts
│   │   └── utils/
│   │       ├── deviceDetection.ts
│   │       ├── hash.ts
│   │       ├── modelDownloader.ts
│   │       └── tokenizer.ts
│   │
│   ├── preload/                       # Electron Preload
│   │   └── index.ts                   # contextBridge API
│   │
│   ├── renderer/                      # React Frontend
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.html
│   │   ├── pages/
│   │   │   ├── Home.tsx
│   │   │   ├── Search.tsx
│   │   │   ├── Chat.tsx
│   │   │   ├── Import.tsx
│   │   │   └── Settings.tsx
│   │   ├── components/
│   │   │   ├── ui/                    # Shadcn UI components
│   │   │   │   ├── button.tsx
│   │   │   │   ├── input.tsx
│   │   │   │   ├── dialog.tsx
│   │   │   │   ├── card.tsx
│   │   │   │   └── ...
│   │   │   ├── chat/
│   │   │   │   ├── ChatBubble.tsx
│   │   │   │   ├── ChatInput.tsx
│   │   │   │   └── StreamingText.tsx
│   │   │   ├── import/
│   │   │   │   ├── DropZone.tsx
│   │   │   │   └── ProgressBar.tsx
│   │   │   ├── search/
│   │   │   │   ├── SearchBar.tsx
│   │   │   │   └── ResultCard.tsx
│   │   │   └── layout/
│   │   │       ├── Sidebar.tsx
│   │   │       ├── TitleBar.tsx
│   │   │       └── StatusBar.tsx
│   │   ├── hooks/
│   │   │   ├── useRAG.ts
│   │   │   ├── useImport.ts
│   │   │   ├── useSearch.ts
│   │   │   └── useIPC.ts
│   │   ├── store/
│   │   │   ├── useAppStore.ts
│   │   │   ├── useChatStore.ts
│   │   │   └── useSearchStore.ts
│   │   ├── styles/
│   │   │   └── globals.css
│   │   └── types/
│   │       ├── chat.ts
│   │       ├── search.ts
│   │       ├── ai.ts
│   │       └── ipc.ts
│   │
│   └── shared/                        # Shared types (desktop + future mobile)
│       ├── constants.ts
│       └── types.ts
│
├── models/                            # AI Models (gitignored, downloaded on first-run)
│   ├── .gitkeep
│   └── README.md                      # Download instructions
│
├── docs/
│   ├── ARCHITECTURE.md
│   └── ROADMAP.md
├── specs/
│   ├── TECH_SPEC.md
│   └── SYSTEM_REQUIREMENTS.md
├── research/
│   ├── WHATSAPP_PARSING.md
│   └── MODEL_BENCHMARKS.md
│
├── electron.vite.config.ts
├── electron-builder.yml
├── tailwind.config.ts
├── components.json                    # Shadcn UI config
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
└── README.md
```

---

## 6. Métricas e Observabilidade

### 6.1 Métricas a Coletar (Local)

```typescript
interface AppMetrics {
  // Performance
  embeddingLatency: number[];
  searchLatency: number[];
  llmFirstToken: number[];
  llmTokensPerSecond: number[];

  // Uso
  totalQueries: number;
  totalImports: number;
  totalChunks: number;
  totalMessages: number;

  // Qualidade (feedback)
  thumbsUp: number;
  thumbsDown: number;

  // System
  platform: 'win32' | 'darwin' | 'linux';
  arch: 'x64' | 'arm64';
  gpuBackend: 'cuda' | 'metal' | 'vulkan' | 'cpu';
  gpuName: string;
  totalRAM: number;
  appVersion: string;
}
```

### 6.2 Logs Estruturados

```typescript
// Todos os logs são locais, nunca enviados
interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: 'import' | 'search' | 'llm' | 'db' | 'ui' | 'ipc';
  message: string;
  data?: Record<string, unknown>;
}
```

---

## 7. Configurações do Usuário

```typescript
interface UserSettings {
  // Aparência
  theme: 'light' | 'dark' | 'system';
  fontSize: 'small' | 'medium' | 'large';

  // IA
  llmTemperature: number;
  maxResponseTokens: number;
  topKResults: number;
  modelPath?: string;            // Caminho para modelo customizado

  // Performance
  gpuBackend: 'auto' | 'cuda' | 'metal' | 'vulkan' | 'cpu';
  batchSizeEmbedding: number;

  // Busca
  hybridSearchAlpha: number;     // 0.0-1.0 (peso semântico vs keyword)
  enableSearchHistory: boolean;

  // Privacidade
  enableAnalytics: boolean;      // Métricas locais apenas
  enableCrashReports: boolean;

  // Armazenamento
  maxCacheSize: number;          // MB
  autoDeleteOldChats: boolean;
  retentionDays: number;
  modelsDirectory: string;       // Caminho dos modelos GGUF
}
```

---

## 8. Dependências NPM

```json
{
  "dependencies": {
    "electron": "^33.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "better-sqlite3": "^latest",
    "node-llama-cpp": "^latest",
    "zustand": "^5.0.0",
    "@tanstack/react-query": "^5.0.0",
    "framer-motion": "^latest",
    "nanoid": "^5.0.0",
    "electron-updater": "^latest"
  },
  "devDependencies": {
    "electron-vite": "^latest",
    "electron-builder": "^latest",
    "@types/react": "^19.0.0",
    "@types/better-sqlite3": "^latest",
    "typescript": "~5.7.0",
    "tailwindcss": "^4.0.0",
    "@radix-ui/react-dialog": "^latest",
    "@radix-ui/react-dropdown-menu": "^latest",
    "@radix-ui/react-select": "^latest",
    "@radix-ui/react-tooltip": "^latest",
    "class-variance-authority": "^latest",
    "clsx": "^latest",
    "tailwind-merge": "^latest",
    "lucide-react": "^latest",
    "vitest": "^latest",
    "@playwright/test": "^latest"
  }
}
```

---

## 9. Requisitos de Build

### Windows
- Node.js 20+
- Visual Studio Build Tools (para compilar better-sqlite3)
- CUDA Toolkit (opcional, para aceleração NVIDIA)

### macOS
- Node.js 20+
- Xcode Command Line Tools
- Metal suportado nativamente (Apple Silicon e Intel com dGPU)

### Linux
- Node.js 20+
- build-essential, python3 (para compilar módulos nativos)
- CUDA Toolkit ou Vulkan SDK (opcional)

### Download de Modelos (First-Run)

Os modelos de IA são baixados automaticamente na primeira execução:

| Modelo | Tamanho | URL |
|--------|---------|-----|
| all-MiniLM-L6-v2.gguf | ~25MB | HuggingFace |
| gemma-3-270m-int4.gguf | ~150MB | HuggingFace |

**Total do download inicial:** ~175MB

Após o download, o app funciona 100% offline.
