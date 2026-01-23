# Recall.ai — Especificações Técnicas

> **Versão:** 1.0
> **Última Atualização:** Janeiro 2026

---

## 1. Stack Tecnológica Completa

### 1.1 Visão Geral

```
┌─────────────────────────────────────────────────────────────────┐
│                        STACK RECALL.AI                          │
├─────────────────────────────────────────────────────────────────┤
│  CAMADA           │  TECNOLOGIA              │  VERSÃO          │
├───────────────────┼──────────────────────────┼──────────────────┤
│  Framework        │  React Native (Expo)     │  SDK 52+         │
│  Linguagem        │  TypeScript              │  5.x             │
│  Runtime          │  Hermes                  │  Latest          │
│  Estado Global    │  Zustand                 │  4.x             │
│  Async State      │  TanStack Query          │  5.x             │
│  Database         │  op-sqlite               │  Latest          │
│  ML Runtime       │  Google LiteRT           │  Latest          │
│  ML Bridge        │  react-native-fast-tflite│  Latest          │
│  Navegação        │  Expo Router             │  3.x             │
│  UI Components    │  Tamagui ou NativeWind   │  Latest          │
│  Animações        │  Reanimated              │  3.x             │
│  File System      │  expo-file-system        │  Latest          │
│  Document Picker  │  expo-document-picker    │  Latest          │
└───────────────────┴──────────────────────────┴──────────────────┘
```

---

## 2. Modelos de IA

### 2.1 Modelo de Embedding

| Propriedade | Valor |
|-------------|-------|
| **Nome** | all-MiniLM-L6-v2 |
| **Origem** | Sentence Transformers (HuggingFace) |
| **Formato** | TFLite (quantizado) |
| **Tamanho** | ~25MB |
| **Dimensão Output** | 384 |
| **Max Sequence** | 256 tokens |
| **Quantização** | INT8 ou Float16 |

**Alternativas consideradas:**
- `paraphrase-MiniLM-L3-v2` (~17MB, menor qualidade)
- `all-mpnet-base-v2` (~90MB, melhor qualidade, muito grande)
- `e5-small-v2` (~30MB, boa alternativa)

**Decisão:** all-MiniLM-L6-v2 oferece o melhor trade-off tamanho/qualidade.

---

### 2.2 Modelo Generativo (LLM)

| Propriedade | Valor |
|-------------|-------|
| **Nome** | Gemma 3 270M |
| **Origem** | Google DeepMind |
| **Lançamento** | Setembro 2025 |
| **Parâmetros** | 270M total |
| **Arquitetura** | 170M embedding + 100M transformer |
| **Vocabulário** | 256,000 tokens |
| **Contexto** | 32K tokens |
| **Quantização** | INT4 (QAT - Quantization Aware Training) |
| **Tamanho (INT4)** | ~150MB |

**Características especiais:**
- Projetado para fine-tuning em tarefas específicas
- Excelente para extração de informação
- Vocabulário grande (bom para PT-BR e gírias)
- Baixo consumo de bateria (0.75% por 25 conversas no Pixel 9)

**Alternativas consideradas:**
- `Gemma 3 1B` (~600MB INT4, mais capaz, mais pesado)
- `Phi-3.5 Mini` (~1.5GB, muito pesado)
- `Qwen2.5-0.5B` (~400MB, boa alternativa)
- `SmolLM2-360M` (~200MB, alternativa leve)

---

## 3. Banco de Dados

### 3.1 Schema SQLite

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

-- Tabela de vetores (embeddings)
CREATE TABLE vectors (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,  -- Float32Array serializado
  dimension INTEGER DEFAULT 384,
  model_version TEXT DEFAULT 'minilm-l6-v2'
);

-- Índices para performance
CREATE INDEX idx_messages_chat ON messages(chat_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_messages_sender ON messages(sender);
CREATE INDEX idx_chunks_chat ON chunks(chat_id);
CREATE INDEX idx_chunks_time ON chunks(start_time, end_time);
CREATE INDEX idx_vectors_chunk ON vectors(chunk_id);

-- Tabela de cache de queries (opcional)
CREATE TABLE query_cache (
  id TEXT PRIMARY KEY,
  query_text TEXT NOT NULL,
  query_embedding BLOB,
  result_chunks TEXT,  -- JSON array of chunk IDs
  llm_response TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  hit_count INTEGER DEFAULT 0
);
```

### 3.2 Serialização de Vetores

```typescript
// Converter Float32Array para BLOB (armazenamento)
function serializeVector(vec: Float32Array): ArrayBuffer {
  return vec.buffer;
}

// Converter BLOB para Float32Array (leitura)
function deserializeVector(blob: ArrayBuffer): Float32Array {
  return new Float32Array(blob);
}

// Armazenamento otimizado em lote
async function storeVectors(
  db: Database,
  vectors: Array<{ chunkId: string; embedding: Float32Array }>
): Promise<void> {
  const stmt = db.prepare(
    'INSERT INTO vectors (id, chunk_id, embedding) VALUES (?, ?, ?)'
  );

  db.transaction(() => {
    for (const { chunkId, embedding } of vectors) {
      stmt.run(generateId(), chunkId, serializeVector(embedding));
    }
  })();
}
```

---

## 4. APIs e Interfaces

### 4.1 Core Services

```typescript
// ==========================================
// ChatImportService
// ==========================================
interface ChatImportService {
  // Importa arquivo .txt do WhatsApp
  importFromFile(uri: string): Promise<ImportResult>;

  // Verifica se chat já foi importado (por hash)
  isDuplicate(fileHash: string): Promise<boolean>;

  // Retorna progresso da importação
  getProgress(): ImportProgress;

  // Cancela importação em andamento
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
  // Busca semântica por query
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  // Busca híbrida (semântica + keyword)
  hybridSearch(query: string, options?: HybridSearchOptions): Promise<SearchResult[]>;
}

interface SearchOptions {
  chatIds?: string[];      // Filtrar por chats específicos
  topK?: number;           // Número de resultados (default: 5)
  minScore?: number;       // Score mínimo (default: 0.5)
  dateRange?: DateRange;   // Filtrar por período
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
// LLMService
// ==========================================
interface LLMService {
  // Inicializa o modelo (cold start)
  initialize(): Promise<void>;

  // Verifica se modelo está pronto
  isReady(): boolean;

  // Gera resposta baseada em contexto
  generate(prompt: string, options?: GenerateOptions): Promise<string>;

  // Gera resposta com streaming
  generateStream(
    prompt: string,
    onToken: (token: string) => void,
    options?: GenerateOptions
  ): Promise<void>;

  // Libera recursos do modelo
  dispose(): void;
}

interface GenerateOptions {
  maxTokens?: number;      // Max tokens na resposta (default: 256)
  temperature?: number;    // Criatividade (default: 0.3)
  topP?: number;           // Nucleus sampling (default: 0.9)
  stopSequences?: string[];
}

// ==========================================
// RAGService (Orquestrador)
// ==========================================
interface RAGService {
  // Fluxo completo: query -> busca -> LLM -> resposta
  query(question: string, options?: RAGOptions): Promise<RAGResponse>;

  // Fluxo com streaming
  queryStream(
    question: string,
    onToken: (token: string) => void,
    options?: RAGOptions
  ): Promise<RAGResponse>;
}

interface RAGOptions {
  chatIds?: string[];
  topK?: number;
  includeContext?: boolean;  // Retornar chunks usados
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
├── app/                          # Expo Router (telas)
│   ├── (tabs)/
│   │   ├── index.tsx             # Home / Lista de chats
│   │   ├── search.tsx            # Tela de busca principal
│   │   └── settings.tsx          # Configurações
│   ├── chat/
│   │   └── [id].tsx              # Detalhes do chat
│   ├── import.tsx                # Fluxo de importação
│   └── _layout.tsx               # Layout principal
│
├── src/
│   ├── components/               # Componentes React
│   │   ├── chat/
│   │   │   ├── ChatBubble.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   └── StreamingText.tsx
│   │   ├── import/
│   │   │   ├── FileSelector.tsx
│   │   │   └── ProgressBar.tsx
│   │   └── common/
│   │       ├── Button.tsx
│   │       └── Card.tsx
│   │
│   ├── services/                 # Lógica de negócio
│   │   ├── ChatImportService.ts
│   │   ├── SearchService.ts
│   │   ├── LLMService.ts
│   │   ├── RAGService.ts
│   │   └── EmbeddingService.ts
│   │
│   ├── core/                     # Core logic
│   │   ├── parser/
│   │   │   ├── WhatsAppParser.ts
│   │   │   ├── patterns.ts       # Regex patterns
│   │   │   └── types.ts
│   │   ├── chunking/
│   │   │   ├── ChunkingStrategy.ts
│   │   │   └── strategies/
│   │   │       ├── TimeWindowStrategy.ts
│   │   │       └── MessageStrategy.ts
│   │   └── vector/
│   │       ├── VectorSearch.ts
│   │       └── CosineSimilarity.ts
│   │
│   ├── db/                       # Database layer
│   │   ├── database.ts           # Conexão op-sqlite
│   │   ├── migrations/           # Migrações de schema
│   │   └── repositories/
│   │       ├── ChatRepository.ts
│   │       ├── MessageRepository.ts
│   │       ├── ChunkRepository.ts
│   │       └── VectorRepository.ts
│   │
│   ├── store/                    # Estado global (Zustand)
│   │   ├── useAppStore.ts
│   │   ├── useChatStore.ts
│   │   └── useSearchStore.ts
│   │
│   ├── hooks/                    # React hooks customizados
│   │   ├── useRAG.ts
│   │   ├── useImport.ts
│   │   └── useSearch.ts
│   │
│   ├── utils/                    # Utilitários
│   │   ├── hash.ts
│   │   ├── tokenizer.ts
│   │   └── formatters.ts
│   │
│   └── types/                    # TypeScript types
│       ├── chat.ts
│       ├── search.ts
│       └── ai.ts
│
├── assets/
│   ├── models/                   # Modelos de IA
│   │   ├── all-MiniLM-L6-v2.tflite
│   │   ├── gemma-270m-int4.bin
│   │   └── tokenizers/
│   └── fonts/
│
├── docs/                         # Documentação
├── specs/                        # Especificações
├── research/                     # Pesquisas e análises
│
├── app.json                      # Config Expo
├── package.json
├── tsconfig.json
└── README.md
```

---

## 6. Métricas e Observabilidade

### 6.1 Métricas a Coletar (Local)

```typescript
interface AppMetrics {
  // Performance
  embeddingLatency: number[];      // ms por embedding
  searchLatency: number[];         // ms por busca
  llmFirstToken: number[];         // ms até primeiro token
  llmTokensPerSecond: number[];    // tokens/s

  // Uso
  totalQueries: number;
  totalImports: number;
  totalChunks: number;
  totalMessages: number;

  // Qualidade (se implementar feedback)
  thumbsUp: number;
  thumbsDown: number;

  // Device
  deviceModel: string;
  osVersion: string;
  appVersion: string;
  availableMemory: number;
}
```

### 6.2 Logs Estruturados

```typescript
// Todos os logs são locais, nunca enviados
interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: 'import' | 'search' | 'llm' | 'db' | 'ui';
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
  llmTemperature: number;        // 0.1 - 1.0
  maxResponseTokens: number;     // 128 - 512
  topKResults: number;           // 3 - 10

  // Performance
  enableGpuAcceleration: boolean;
  batchSizeEmbedding: number;    // 4 - 16

  // Privacidade
  enableAnalytics: boolean;      // Métricas locais
  enableCrashReports: boolean;   // Sempre local

  // Armazenamento
  maxCacheSize: number;          // MB
  autoDeleteOldChats: boolean;
  retentionDays: number;
}
```

---

## 8. Dependências NPM

```json
{
  "dependencies": {
    "expo": "~52.0.0",
    "expo-router": "~3.0.0",
    "expo-file-system": "~17.0.0",
    "expo-document-picker": "~12.0.0",
    "react": "18.3.1",
    "react-native": "0.76.0",
    "react-native-reanimated": "~3.16.0",
    "@op-engineering/op-sqlite": "^latest",
    "react-native-fast-tflite": "^latest",
    "zustand": "^4.5.0",
    "@tanstack/react-query": "^5.0.0",
    "nanoid": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "~18.3.0",
    "typescript": "~5.6.0",
    "jest": "^29.0.0",
    "@testing-library/react-native": "^12.0.0"
  }
}
```

---

## 9. Requisitos de Build

### iOS
- Xcode 15+
- iOS 15.0+ (deployment target)
- CocoaPods

### Android
- Android Studio Hedgehog+
- Android SDK 24+ (minSdk)
- Android SDK 34 (targetSdk)
- NDK para compilar módulos nativos
