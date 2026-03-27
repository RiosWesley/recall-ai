# Recall.ai — Documento de Arquitetura de Software (SDD)

> **Versão:** 3.0 (Desktop-First)
> **Status:** Em Desenvolvimento
> **Última Atualização:** Março 2026

---

## 1. Visão Geral

### 1.1 Propósito

O Recall.ai é uma aplicação **desktop** que resolve o problema da "amnésia digital" em aplicativos de mensagem. Utiliza **Retrieval-Augmented Generation (RAG)** executado inteiramente no computador do usuário, sem envio de dados para a nuvem.

A v1.0 é construída com **Electron**, aproveitando o poder de processamento de desktops para executar modelos de IA com qualidade superior ao que seria possível em dispositivos móveis.

### 1.2 Escopo

| Incluso (v1.0 Desktop) | Não Incluso (v1.0) | Planejado (v2.0 Mobile) |
|-------------------------|--------------------|-----------------------|
| Importação de chats WhatsApp (.txt/.zip) | Integração direta com APIs | App React Native |
| Busca semântica por contexto | Sincronização entre dispositivos | Versão para Android/iOS |
| Busca híbrida (semântica + keyword) | Suporte a áudio/vídeo | Modelos otimizados para mobile |
| Respostas geradas por IA local | Outros mensageiros (v1.1) | |
| Funcionamento 100% offline | | |
| Drag & drop de arquivos | | |
| Aceleração GPU (CUDA/Metal/Vulkan) | | |

### 1.3 Definições e Acrônimos

| Termo | Definição |
|-------|-----------|
| **RAG** | Retrieval-Augmented Generation — técnica que combina busca + geração |
| **Embedding** | Representação vetorial de texto (array de números) |
| **LLM** | Large Language Model — modelo de linguagem generativo |
| **Chunking** | Processo de dividir texto em fragmentos menores |
| **Quantização** | Técnica de compressão de modelos (ex: Float32 → Int4) |
| **GGUF** | GPT-Generated Unified Format — formato de modelo usado pelo llama.cpp |
| **IPC** | Inter-Process Communication — comunicação entre processos do Electron |
| **Main Process** | Processo Node.js do Electron (backend: DB, IA, filesystem) |
| **Renderer Process** | Processo Chromium do Electron (frontend: UI React) |
| **Preload** | Script ponte que expõe APIs seguras do main para o renderer |

---

## 2. Arquitetura de Alto Nível

### 2.1 Diagrama do Sistema

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   RECALL.AI v1.0 — DESKTOP ARCHITECTURE                  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  MAIN PROCESS (Node.js)                                                  │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │  File Importer    │  │  better-sqlite3  │  │  node-llama-cpp       │  │
│  │                   │  │  + sqlite-vec    │  │  (Utility Process)    │  │
│  │  • Drag & drop    │  │  + FTS5          │  │                       │  │
│  │  • .txt parsing   │  │                  │  │  ┌─────────────────┐  │  │
│  │  • .zip extract   │  │  ┌────────────┐  │  │  │ EMBEDDING MODEL │  │  │
│  │  • Auto-detect    │  │  │ messages   │  │  │  │ MiniLM-L6 GGUF │  │  │
│  │    format         │  │  │ chunks     │  │  │  │ ~25MB           │  │  │
│  └────────┬─────────┘  │  │ vectors    │  │  │  └─────────────────┘  │  │
│           │            │  │ metadata   │  │  │                       │  │
│           │            │  │ query_cache│  │  │  ┌─────────────────┐  │  │
│           │            │  └────────────┘  │  │  │ LLM MODEL       │  │  │
│           │            └────────┬─────────┘  │  │ Gemma 3 270M    │  │  │
│           │                     │            │  │ INT4 GGUF ~150MB│  │  │
│           │                     │            │  └─────────────────┘  │  │
│           └─────────────────────┼────────────┤                       │  │
│                                 │            │  • GPU auto-detect    │  │
│                                 │            │  • CUDA / Metal       │  │
│     ┌──────────────┐            │            │  • Vulkan / CPU SIMD  │  │
│     │ IPC Handlers │◄───────────┘            └───────────────────────┘  │
│     │ (ipcMain)    │                                                    │
│     └──────┬───────┘                                                    │
│            │                                                            │
├────────────┼────────────────────────────────────────────────────────────┤
│  PRELOAD   │  contextBridge.exposeInMainWorld('api', { ... })           │
├────────────┼────────────────────────────────────────────────────────────┤
│            │                                                            │
│  RENDERER PROCESS (Chromium + React)                                    │
│            ▼                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────────┐│
│  │  Sidebar      │  │  Search View │  │  RAG Conversation View         ││
│  │               │  │              │  │                                ││
│  │  • Chat list  │  │  • Semantic  │  │  ┌──────────────────────────┐  ││
│  │  • Import btn │  │  • Hybrid    │  │  │  Streaming AI Response   │  ││
│  │  • Query hist │  │  • Filters   │  │  │  • Token-by-token        │  ││
│  │               │  │  • Results   │  │  │  • Source chunks shown   │  ││
│  └──────────────┘  └──────────────┘  │  │  • Latency metrics       │  ││
│                                       │  └──────────────────────────┘  ││
│  UI: Shadcn UI + Tailwind CSS         └────────────────────────────────┘│
│  State: Zustand + TanStack Query                                        │
│  Animations: Framer Motion                                              │
└─────────────────────────────────────────────────────────────────────────┘

                     EXECUÇÃO POR CAMADA DE HARDWARE
┌─────────────────────────────────────────────────────────────────────────┐
│  Prioridade: GPU (CUDA/Metal/Vulkan) → CPU (SIMD otimizado)            │
│  node-llama-cpp detecta automaticamente o melhor backend disponível    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Fluxo de Dados Principal

```
INGESTÃO (uma vez por chat):
──────────────────────────────────────────────────────────────────────────
arquivo.txt ──► Parser ──► Chunks ──► Embedding Model ──► Vetores ──► SQLite
   (drag&drop)    (Node.js fs)  (time_window)  (MiniLM GGUF)    (sqlite-vec)

Latência desktop: ~5s para 10k mensagens (vs ~30s mobile)


CONSULTA (cada pergunta):
──────────────────────────────────────────────────────────────────────────
Pergunta ──► Embedding ──► Busca Vetorial ──► Top-K Chunks ──► LLM ──► Resposta
                │              │                   │              │
             ~20ms          ~10ms              ~50ms       ~2-5s (streaming)
                                                    │
                                              FTS5 Hybrid ──► Re-rank
                                                 ~5ms
```

### 2.3 Comunicação IPC

```
RENDERER (React)                    MAIN (Node.js)
─────────────────                   ─────────────────
                    contextBridge
window.api.importChat(path)  ──────►  ipcMain.handle('import:chat')
                                              │
window.api.search(query)     ──────►  ipcMain.handle('search:query')
                                              │
window.api.askRAG(question)  ──────►  ipcMain.handle('rag:query')
                              ◄──────  ipcMain.emit('rag:token')  (streaming)
                              ◄──────  ipcMain.emit('rag:done')
                                              │
window.api.onProgress(cb)    ◄──────  ipcMain.emit('import:progress')
```

---

## 3. Componentes Detalhados

### 3.1 Parser de Chat

**Responsabilidade:** Converter arquivo .txt exportado do WhatsApp em estrutura de dados normalizada.

**Diferença Desktop vs Mobile:** No desktop, a leitura é feita via `Node.js fs` com acesso direto ao filesystem. Suporta drag & drop e seleção de arquivos via diálogo nativo do Electron.

**Desafios:**
- Formatos diferentes entre Android/iOS
- Variação por idioma (formato de data)
- Mensagens multilinha
- Mensagens de sistema (entrada/saída de grupos)

**Input:**
```
01/05/2024 14:30 - João Silva: Oi, tudo bem?
01/05/2024 14:31 - Maria: Tudo ótimo! E você?
01/05/2024 14:32 - João Silva: Lembra daquela receita
de bolo que você fez?
Quero tentar fazer aqui
```

**Output:**
```typescript
interface ParsedMessage {
  id: string;
  timestamp: Date;
  sender: string;
  content: string;
  type: 'text' | 'media' | 'system';
  raw: string;
}
```

---

### 3.2 Chunking Strategy

**Responsabilidade:** Dividir mensagens em fragmentos otimizados para embedding e recuperação.

| Estratégia | Descrição | Uso Ideal |
|------------|-----------|-----------|
| `by_message` | Cada mensagem = 1 chunk | Conversas curtas |
| `by_time_window` | Agrupa por janela de tempo (5min) | Conversas longas |
| `by_conversation_turn` | Agrupa por troca de turno | Diálogos densos |
| `sliding_window` | Janela deslizante com overlap | Máxima cobertura |

**Configuração Padrão:**
```typescript
const DEFAULT_CHUNKING_CONFIG = {
  strategy: 'by_time_window',
  windowMinutes: 5,
  maxTokensPerChunk: 256,
  overlapTokens: 32,
  includeMetadata: true,
};
```

---

### 3.3 Embedding Engine (Retriever)

**Modelo:** `all-MiniLM-L6-v2` (formato GGUF via node-llama-cpp)

| Especificação | Valor |
|---------------|-------|
| Tamanho | ~25MB |
| Dimensão do vetor | 384 |
| Max tokens input | 256 |
| Latência média (CPU) | 15-30ms |
| Latência média (GPU) | 5-15ms |
| Runtime | node-llama-cpp |

---

### 3.4 Vector Search

**Algoritmo:** KNN via extensão `sqlite-vec` com aceleração SIMD.

**Por que sqlite-vec?**
- Busca KNN nativa no SQLite (sem overhead de lib externa)
- Aceleração SIMD automática
- Suporta múltiplas métricas de distância (cosine, L2, inner product)
- Sem necessidade de indexação prévia para datasets < 100k vetores
- Integração nativa com better-sqlite3

**Busca Híbrida:**
Para máxima relevância, combinamos sqlite-vec (semântica) + FTS5 (keyword):
```
Score Final = α × Score_Semântico + (1-α) × Score_FTS5
α = 0.7 (padrão, configurável pelo usuário)
```

---

### 3.5 Generator (LLM)

**Modelo:** Gemma 3 270M (INT4 Quantizado, formato GGUF)

| Especificação | Valor |
|---------------|-------|
| Parâmetros | 270M (170M embed + 100M transformer) |
| Tamanho (INT4 GGUF) | ~150MB |
| Vocabulário | 256K tokens |
| Contexto máximo | 32K tokens |
| Latência primeiro token (CPU) | 300ms-1.5s |
| Latência primeiro token (GPU) | 100ms-500ms |
| Tokens/segundo (CPU) | 10-25 |
| Tokens/segundo (GPU) | 25-50 |
| Runtime | node-llama-cpp (Utility Process) |

**Execução em Utility Process:**
O LLM roda em um Utility Process isolado do Electron para não bloquear a UI nem o Main Process. A comunicação é feita via MessagePort.

**Prompt Template:**
```
<|system|>
Você é um assistente que responde perguntas sobre conversas de chat.
Baseie suas respostas APENAS no contexto fornecido.
Se a informação não estiver no contexto, diga "Não encontrei essa informação."
Seja conciso e direto.
<|end|>
<|context|>
{chunks recuperados}
<|end|>
```

---

### 3.6 People Graph Engine

**Responsabilidade:** Identificar, relacionar e persistir as pessoas presentes nas conversas importadas, construindo um grafo de memória relacional.

> **Status (v1.0):** A identificação de pessoas usa os **senders** extraídos diretamente pelo Parser (sem NER por LLM). O grafo completo com NER e extração de contexto por IA é planejado para v1.3.

#### Entidades do Grafo

```typescript
interface Person {
  id: string;              // UUID gerado na importação
  name: string;            // Nome canônico (ex: "Maria Silva")
  aliases: string[];       // Variações detectadas (ex: ["Maria", "Mah"])
  photoPath: string | null; // Path local para foto anexada pelo usuário
  bio: string | null;      // Nota manual do usuário
  tags: string[];          // Labels manuais (ex: ["família", "trabalho"])
  messageCount: number;    // Total de mensagens nos chats importados
  firstSeen: Date;         // Data da primeira mensagem registrada
  lastSeen: Date;          // Data da mensagem mais recente
  chats: string[];         // IDs dos chats onde aparece
}

interface PersonRelation {
  id: string;
  personAId: string;       // Origem da aresta
  personBId: string;       // Destino da aresta (grafo não-direcional)
  chatId: string;          // Chat onde interagem juntos
  coOccurrenceCount: number; // Quantas vezes interagem no mesmo contexto
  strength: number;        // 0.0 – 1.0 (normalizado)
}

interface KeyMemory {
  id: string;
  personId: string;        // Pessoa associada
  chunkId: string;         // Chunk original da memória
  content: string;         // Trecho da conversa
  relevanceScore: number;  // Score de relevância semântica
  timestamp: Date;
}
```

#### Schema SQLite

```sql
CREATE TABLE persons (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  aliases     TEXT NOT NULL DEFAULT '[]',  -- JSON array
  photo_path  TEXT,
  bio         TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',  -- JSON array
  msg_count   INTEGER DEFAULT 0,
  first_seen  INTEGER,  -- Unix timestamp
  last_seen   INTEGER,
  chats       TEXT NOT NULL DEFAULT '[]'   -- JSON array of chat IDs
);

CREATE TABLE person_relations (
  id                  TEXT PRIMARY KEY,
  person_a_id         TEXT NOT NULL REFERENCES persons(id),
  person_b_id         TEXT NOT NULL REFERENCES persons(id),
  chat_id             TEXT,
  co_occurrence_count INTEGER DEFAULT 1,
  strength            REAL DEFAULT 0.5
);

CREATE TABLE key_memories (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES persons(id),
  chunk_id        TEXT NOT NULL REFERENCES chunks(id),
  content         TEXT NOT NULL,
  relevance_score REAL,
  timestamp       INTEGER
);
```

#### Pipeline de Extração (v1.0 — Sender-based)

```
ParsedMessages ──► ExtractSenders ──► DeduplicatePersons ──► BuildRelations ──► SQLite

1. Extrai todos os `sender` únicos dos ParsedMessages
2. Normaliza nomes (trim, capitalização)
3. Detecta aliases por similaridade de string (Levenshtein ≤ 2)
4. Cria relações entre pessoas que aparecem no mesmo chat
5. Calcula co_occurrence_count por janela de tempo (mesmo chunking window)
6. Persiste entidades no banco
```

#### Pipeline de Extração (v1.3 — NER via LLM)

```
Chunks ──► LLM NER Prompt ──► ParsedEntities ──► MergeWithSenders ──► EnrichedPersons

Prompt template:
"Identifique TODAS as pessoas mencionadas neste trecho de conversa.
Retorne JSON: [{name, role, context}]. Apenas pessoas reais mencionadas."
```

#### IPC: People Graph

```typescript
// Renderer → Main
window.api.getPersons()                    // Lista todas as pessoas
window.api.getPerson(personId)             // Detalhe de uma pessoa
window.api.getPersonRelations()            // Todas as relações (para o grafo)
window.api.getKeyMemories(personId)        // Memórias-chave de uma pessoa
window.api.updatePersonPhoto(personId, filePath) // Anexar foto
window.api.updatePersonBio(personId, bio)  // Editar bio
window.api.updatePersonTags(personId, tags) // Editar tags
```
