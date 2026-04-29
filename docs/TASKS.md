# Recall.ai — Task Breakdown

> **Propósito:** Guia granular para desenvolvimento em chats isolados.
> **Regra de ouro:** Cada task = 1 chat. Copie o bloco da task como prompt inicial.
> **Última atualização:** 2026-03-28
> **Estado atual:** UI shell com 6 páginas mockadas. Zero backend/lógica funcional.

---

## Como Usar Este Documento

1. Localize a próxima task `[ ]` não concluída
2. Abra um **novo chat**
3. Copie o bloco inteiro da task (incluindo contexto e critérios)
4. Execute com o agente
5. Ao concluir, volte aqui e marque `[x]`

**Legenda:**
- `[ ]` — Pendente
- `[/]` — Em andamento
- `[x]` — Concluído
- `⛔` — Bloqueado (ver dependência)

---

## Mapa de Dependências

```
TASK 1.1 ──► TASK 1.2 ──► TASK 1.3 ──► TASK 1.4
                              │
                              ▼
TASK 2.1 ──► TASK 2.2 ──► TASK 2.3 ──► TASK 2.4 ──► TASK 2.5
                                                        │
                                                        ▼
                           TASK 3.1 ──► TASK 3.2 ──► TASK 3.3 ──► TASK 3.4
                                                                      │
                                                                      ▼
                                        TASK 4.1    TASK 4.2    TASK 4.3
                                           └──────────┴──────────┘
                                                      │
                                                      ▼
                                        TASK 5.1 ──► TASK 5.2 ──► TASK 5.3
```

---

# FASE 1 — DATABASE & PARSER

> **Meta:** Importar um .txt do WhatsApp e persistir como dados reais no SQLite.

---

## [x] TASK 1.1 — Setup better-sqlite3 + Schema SQLite

**Objetivo:** Configurar o banco de dados SQLite com better-sqlite3, sqlite-vec e FTS5 no Electron main process. Criar todo o schema, sistema de migrations e connection singleton.

**Contexto:**
- App Electron existente em `recall-ai/recall-ai/`
- Main process em `electron/main.ts` (básico, só cria window)
- Stack: Electron 30 + Vite + React 18 + TypeScript
- O banco deve ficar em `app.getPath('userData')/recall.db`

**Arquivos a criar:**
```
src/main/db/
├── database.ts          → Singleton de conexão, carrega extensions
├── migrations/
│   └── 001_initial.ts   → Schema: chats, messages, chunks, vectors, chunks_fts, query_cache, search_history
└── index.ts             → Export barrel
```

**Schema de referência** (está em `specs/TECH_SPEC.md` seções 3.1-3.2):
- Tabela `chats` — id, name, source, participant_count, message_count, timestamps, file_hash, metadata
- Tabela `messages` — id, chat_id (FK), sender, content, timestamp, type, raw
- Tabela `chunks` — id, chat_id (FK), content, display_content, start_time, end_time, message_count, token_count, participants
- Tabela virtual `vectors` — vec0(chunk_id, embedding FLOAT[384])
- Tabela virtual `chunks_fts` — fts5(content, chunk_id UNINDEXED)
- Tabela `query_cache` — id, query_text, query_embedding, result_chunks, llm_response, hit_count
- Tabela `search_history` — id, query, chat_ids, result_count, timestamps
- Índices em messages(chat_id), messages(timestamp), messages(sender), chunks(chat_id), chunks(start_time, end_time)

**Requisitos técnicos:**
- `better-sqlite3` — síncrono, usar `verbose` em dev
- `sqlite-vec` — carregar via `db.loadExtension()`, verificar se a extensão existe antes de carregar
- WAL mode habilitado para performance
- Migrations versionadas (checar tabela `_migrations`)
- DB criado no primeiro acesso, não no startup do Electron

**Critérios de aceitação:**
- [ ] `npm install better-sqlite3 @types/better-sqlite3` funciona
- [ ] `DatabaseService.getInstance()` retorna conexão singleton
- [ ] Todas as tabelas criadas corretamente (verificar via sqlite3 CLI ou test)
- [ ] sqlite-vec extension carregada com sucesso (testar `SELECT vec_version()`)
- [ ] FTS5 table criada
- [ ] WAL mode ativo
- [ ] Migration idempotente (rodar 2x não dá erro)
- [ ] Rebuild nativo funciona no Electron (`electron-rebuild`)

**Riscos:**
- `better-sqlite3` precisa ser compilado para a versão do Electron. Usar `electron-rebuild` ou `@electron/rebuild`.
- `sqlite-vec` é uma extensão nativa. Pode precisar de binary pré-compilado para cada OS.

---

## [x] TASK 1.2 — Repositories (Chat, Message, Chunk)

**Objetivo:** Criar a camada de acesso a dados (repository pattern) para chats, messages e chunks.

**Depende de:** TASK 1.1 ✅

**Contexto:**
- DatabaseService já existe em `src/main/db/database.ts`
- Schema já criado com todas as tabelas
- Cada repository é uma classe com métodos CRUD + queries específicas

**Arquivos a criar:**
```
src/main/db/repositories/
├── ChatRepository.ts
├── MessageRepository.ts
├── ChunkRepository.ts
├── VectorRepository.ts    → (placeholder, implementação real na TASK 2.3)
└── index.ts
```

**Interface de cada repository:**

`ChatRepository`:
- `create(chat: NewChat): Chat`
- `findAll(): Chat[]`
- `findById(id: string): Chat | null`
- `delete(id: string): void`
- `existsByHash(fileHash: string): boolean`
- `updateMessageCount(id: string, count: number): void`

`MessageRepository`:
- `insertBatch(messages: NewMessage[]): void` — usar transaction para performance
- `findByChatId(chatId: string, limit?: number, offset?: number): Message[]`
- `countByChatId(chatId: string): number`
- `getParticipants(chatId: string): string[]`

`ChunkRepository`:
- `insertBatch(chunks: NewChunk[]): void` — usar transaction + inserir no FTS5 também
- `findByChatId(chatId: string): Chunk[]`
- `findById(id: string): Chunk | null`
- `findByIds(ids: string[]): Chunk[]`
- `deleteByChatId(chatId: string): void`

`VectorRepository` (placeholder):
- `insert(chunkId: string, embedding: Float32Array): void`
- `search(queryEmbedding: Float32Array, topK: number): VectorResult[]`
- `deleteByChatId(chatId: string): void`

**Requisitos técnicos:**
- Todas as operações de batch devem usar `db.transaction()`
- IDs gerados com `nanoid` (já instalado)
- Tipos TypeScript para cada entidade (criar em `src/shared/types.ts`)
- Inserção no FTS5 deve acontecer junto com inserção no chunks (mesma transaction)
- Queries parametrizadas (nunca string interpolation)

**Critérios de aceitação:**
- [ ] CRUD completo de Chat funciona
- [ ] Batch insert de 10k messages em < 2s (transaction)
- [ ] Batch insert de chunks + FTS5 na mesma transaction
- [ ] `existsByHash` detecta re-importação
- [ ] `getParticipants` retorna lista única de senders
- [ ] Tipos exportados em `src/shared/types.ts`
- [ ] Testes com dados reais mockados

---

## [x] TASK 1.3 — WhatsApp Parser + Chunking Engine

**Objetivo:** Implementar o parser de arquivos exportados do WhatsApp (.txt) e o engine de chunking com estratégia `by_time_window`.

**Depende de:** TASK 1.2 ✅ (para os tipos, mas pode ser desenvolvido em paralelo)

**Contexto:**
- Pesquisa completa dos formatos em `research/WHATSAPP_PARSING.md`
- Suporte mínimo v1: Android BR (`DD/MM/YYYY HH:MM - Sender: Message`)
- Suporte desejado v1: Android BR + iOS EN + Android EN
- Leitura via `fs.createReadStream` (streaming, não carrega tudo na memória)

**Arquivos a criar:**
```
src/main/core/parser/
├── WhatsAppParser.ts     → Classe principal com streaming line-by-line
├── patterns.ts           → Regex patterns por formato (Android BR, iOS EN, etc)
├── formatDetector.ts     → Detecta formato lendo primeiras 20 linhas
└── types.ts              → ParsedMessage, DetectedFormat, ParseResult, ParseError

src/main/core/chunking/
├── ChunkingEngine.ts     → Orquestrador
├── strategies/
│   └── TimeWindowStrategy.ts  → Agrupa por janela de 5min
└── types.ts              → ChunkingConfig, RawChunk
```

**Formatos prioritários (regex em `research/WHATSAPP_PARSING.md`):**

| Formato | Regex |
|---------|-------|
| Android BR | `/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} - ([^:]+): (.+)$/` |
| Android EN | `/^\d{1,2}\/\d{1,2}\/\d{2,4}, \d{1,2}:\d{2} [AP]M - ([^:]+): (.+)$/` |
| iOS EN | `/^\[\d{1,2}\/\d{1,2}\/\d{2,4}, \d{1,2}:\d{2}:\d{2} [AP]M\] ([^:]+): (.+)$/` |

**Algoritmo de parsing:**
1. Ler primeiras 20 linhas para detectar formato
2. Streaming line-by-line (readline + createReadStream)
3. Se linha dá match no pattern → nova mensagem
4. Se não → continuação da mensagem anterior (multilinha)
5. Detectar tipo: `text`, `media` (<Mídia oculta>), `system` (patterns específicos)
6. Retornar `ParseResult { messages, format, errors, stats }`

**Algoritmo de chunking (TimeWindow):**
1. Iterar mensagens ordenadas por timestamp
2. Agrupar mensagens com gap ≤ 5 minutos entre elas
3. Se chunk excede 256 tokens → quebrar e começar novo
4. Gerar `content` (para embedding) e `display_content` (para UI, com nomes e timestamps)
5. Overlap de 1 mensagem entre chunks adjacentes (contexto)

**Critérios de aceitação:**
- [ ] Parseia corretamente arquivo Android BR com 100+ mensagens
- [ ] Parseia corretamente arquivo iOS EN
- [ ] Detecta automaticamente formato pelas primeiras linhas
- [ ] Mensagens multilinha concatenadas corretamente
- [ ] Mensagens de sistema detectadas (type: 'system')
- [ ] Mídia detectada (type: 'media')
- [ ] Chunking produz chunks de ≤ 256 tokens
- [ ] Chunks agrupados por janela de 5 minutos
- [ ] ParseResult inclui stats (total msgs, participants, errors)
- [ ] Não carrega arquivo inteiro na memória (streaming)
- [ ] Testes unitários com fixtures de cada formato

---

## [x] TASK 1.4 — IPC Bridge + Conectar Import UI

**Objetivo:** Refatorar o preload para contextBridge tipado, criar IPC handlers para importação e chats, e conectar a tela de Import à lógica real.

**Depende de:** TASK 1.1 ✅, TASK 1.2 ✅, TASK 1.3 ✅

**Contexto:**
- Preload atual (`electron/preload.ts`) expõe ipcRenderer genérico — inseguro e sem tipagem
- Import.tsx já tem UI de drag & drop (40KB, bem elaborada) — com mock data
- Sidebar.tsx lista chats mockados — precisa ler do DB
- Precisamos de um `ChatImportService` que orquestre: parse → chunk → store

**Arquivos a modificar:**
- `electron/preload.ts` → Refatorar para contextBridge tipado
- `src/pages/Import.tsx` → Conectar ao IPC real
- `src/components/layout/Sidebar.tsx` → Listar chats reais do DB

**Arquivos a criar:**
```
src/main/services/
├── ChatImportService.ts  → Orquestra: file → parse → chunk → save (sem embedding ainda)
└── index.ts

src/main/ipc/
├── chatHandlers.ts       → ipcMain.handle('chats:list'), etc
├── importHandlers.ts     → ipcMain.handle('import:chat'), 'import:file-dialog'
└── index.ts              → registerAllHandlers()

src/shared/
├── types.ts              → Tipos compartilhados main/renderer
└── ipc-types.ts          → Tipagem do window.api (ElectronAPI interface)

electron/preload.ts       → REWRITE: contextBridge.exposeInMainWorld('api', {...})
```

**API exposta (window.api):**
```typescript
interface ElectronAPI {
  // Import
  importChat(filePath: string): Promise<ImportResult>
  openFileDialog(): Promise<string | null>
  onImportProgress(cb: (progress: ImportProgress) => void): void

  // Chats
  getChats(): Promise<Chat[]>
  deleteChat(chatId: string): Promise<void>

  // Window
  windowMinimize(): void
  windowMaximize(): void
  windowClose(): void
}
```

**Fluxo de importação:**
1. User clica "Importar" ou faz drag & drop
2. Renderer chama `window.api.importChat(filePath)`
3. Main: `ChatImportService.import(filePath)`
   - Calcula hash do arquivo → verifica duplicata
   - Parse com `WhatsAppParser`
   - Chunk com `ChunkingEngine`
   - Salva chat, messages, chunks no DB (sem embeddings nesta task)
   - Emite progress events via `webContents.send('import:progress', data)`
4. Retorna `ImportResult` com stats
5. Sidebar atualiza automaticamente (re-fetch chats)

**Critérios de aceitação:**
- [ ] `window.api` tipado corretamente (sem ipcRenderer exposto)
- [ ] Drag & drop de .txt funciona → chat aparece na sidebar
- [ ] Botão "Importar" abre file dialog nativo → selecionar .txt → importa
- [ ] Progress bar reflete estágio real (parsing, chunking, storing)
- [ ] Re-importação do mesmo arquivo detectada (hash)
- [ ] Deletar chat funciona (remove chat, messages, chunks do DB)
- [ ] Sidebar lista chats reais com nome, message_count, last_message_at
- [ ] Zero dados mockados na Import page e Sidebar
- [ ] Build do Electron funciona (`npm run build`)

---

# FASE 2 — EMBEDDING & SEARCH

> **Meta:** Busca semântica funcional — query → chunks reais rankeados por similaridade.

---

## [x] TASK 2.1 — Model Downloader (First-Run)

**Objetivo:** Criar sistema de download automático dos modelos GGUF no primeiro uso, com progress, retry e verificação de integridade.

**Depende de:** TASK 1.1 ✅

**Contexto:**
- Modelos ficam em `app.getPath('userData')/models/`
- all-MiniLM-L6-v2.gguf (~25MB) — embedding
- gemma-3-270m-q4_k_m.gguf (~150MB) — LLM (download agora, usar na Fase 3)
- Source: HuggingFace (URLs públicas)
- Download só acontece se modelo não existe localmente ou hash não bate

**Arquivos a criar:**
```
src/main/services/
├── ModelDownloader.ts    → Download com progress, retry, hash check
└── modelRegistry.ts      → URLs, hashes, metadados dos modelos
```

**Requisitos:**
- Download com `node:https` ou `electron.net` (suporta proxy do sistema)
- Progress callback (bytes downloaded / total)
- SHA-256 hash verification após download
- Retry automático até 3x com backoff
- Download parcial: se interrompido, retomar (ou re-download)
- Verificar modelos no startup (existem + hash ok?)
- IPC handlers: `models:check`, `models:download`, `models:progress`

**Critérios de aceitação:**
- [ ] Modelos baixados para diretório correto
- [ ] Progress reportado com precisão (%) para a UI
- [ ] Hash SHA-256 verificado após download
- [ ] Download corrompido detectado e re-iniciado
- [ ] Se modelo já existe e hash ok → skip download
- [ ] Funciona atrás de proxy corporativo (electron.net)
- [ ] IPC handlers registrados

---

## [x] TASK 2.2 — Embedding Service (node-llama-cpp)

**Objetivo:** Integrar node-llama-cpp para gerar embeddings com all-MiniLM-L6-v2 no main process.

**Depende de:** TASK 2.1 ✅

**Contexto:**
- Runtime: `node-llama-cpp` (wrapper de llama.cpp para Node.js)
- Modelo: all-MiniLM-L6-v2 no formato GGUF (~25MB, 384 dimensões)
- GPU auto-detection é feature nativa do node-llama-cpp
- Deve rodar no main process (embedding é rápido, não precisa de utility process)

**Arquivos a criar:**
```
src/main/services/
├── EmbeddingService.ts   → Load model, generate embeddings, batch processing
└── gpu-detection.ts      → Wrapper fino sobre node-llama-cpp gpu info
```

**Interface do EmbeddingService:**
```typescript
class EmbeddingService {
  async initialize(modelPath: string): Promise<void>
  async embed(text: string): Promise<Float32Array>       // single
  async embedBatch(texts: string[]): Promise<Float32Array[]>  // batch
  isReady(): boolean
  dispose(): void
  getInfo(): { modelName: string, dimensions: number, gpuAccelerated: boolean }
}
```

**Requisitos:**
- Lazy initialization (não carregar no startup)
- Batch processing para importação (embedar todos os chunks de uma vez)
- Normalizar embeddings (unit vectors para cosine similarity)
- Logar tempo de cada embedding para métricas
- GPU auto-detect via node-llama-cpp (sem código manual)

**Critérios de aceitação:**
- [ ] `npm install node-llama-cpp` sem erros
- [ ] Modelo all-MiniLM-L6-v2 carrega com sucesso
- [ ] `embed("texto qualquer")` retorna Float32Array de 384 dimensões
- [ ] `embedBatch` processa 100 chunks em tempo razoável
- [ ] GPU detectada automaticamente (se disponível)
- [ ] `dispose()` libera memória corretamente
- [ ] Funciona em CPU-only (fallback)

---

## [x] TASK 2.3 — VectorRepository (sqlite-vec KNN)

**Objetivo:** Implementar o VectorRepository real com busca KNN usando sqlite-vec.

**Depende de:** TASK 1.1 ✅, TASK 2.2 ✅

**Contexto:**
- Placeholder criado na TASK 1.2
- sqlite-vec já carregado no DatabaseService (TASK 1.1)
- Embeddings são Float32Array de 384 dimensões
- Busca KNN via `WHERE embedding MATCH ? ORDER BY distance LIMIT ?`

**Arquivo a modificar:**
- `src/main/db/repositories/VectorRepository.ts` → Implementação real

**Operações:**
```sql
-- Insert
INSERT INTO vectors (chunk_id, embedding) VALUES (?, ?)

-- KNN Search
SELECT chunk_id, distance
FROM vectors
WHERE embedding MATCH ?
ORDER BY distance
LIMIT ?

-- Hybrid (sqlite-vec + FTS5)
-- CTE combinando semantic score + FTS5 rank
-- α = 0.7 semântico, 0.3 keyword
```

**Requisitos:**
- Converter Float32Array → Buffer para sqlite-vec
- Converter Buffer → Float32Array no retorno
- Implementar busca híbrida (semantic + FTS5) como método separado
- Parâmetro α configurável (default 0.7)

**Critérios de aceitação:**
- [x] Insert de embedding funciona
- [x] KNN search retorna chunks ordenados por distância
- [x] Busca com 10k vetores retorna em < 30ms
- [x] Busca híbrida combina scores corretamente
- [x] Delete por chatId limpa vetores associados
- [x] Tipos corretos no retorno (chunk_id + distance)

---

## [x] TASK 2.4 — Pipeline de Importação Completo

**Objetivo:** Integrar embedding na pipeline de importação. Ao importar .txt → parse → chunk → embed → store vetores.

**Depende de:** TASK 1.4 ✅, TASK 2.2 ✅, TASK 2.3 ✅

**Contexto:**
- `ChatImportService` já faz: parse → chunk → store (sem embedding)
- Precisa adicionar: embed cada chunk → store no VectorRepository
- Progress deve refletir novo estágio: 'embedding'
- Batch embedding para performance

**Arquivos a modificar:**
- `src/main/services/ChatImportService.ts` → Adicionar estágio de embedding
- Progress stages: `'reading' | 'parsing' | 'chunking' | 'embedding' | 'storing'`

**Fluxo atualizado:**
1. Ler arquivo
2. Parse → mensagens
3. Chunk → chunks
4. **Embed → vetores** (NOVO)
5. Store tudo no DB (messages + chunks + vetores + FTS5 em uma transaction)

**Critérios de aceitação:**
- [ ] Importar .txt gera embeddings para todos os chunks
- [ ] Progress mostra estágio 'embedding' com percentual
- [ ] 10k mensagens importadas em < 15s (incluindo embedding)
- [ ] Vetores armazenados no sqlite-vec
- [ ] FTS5 populado junto com chunks
- [ ] Deletar chat remove vetores também
- [ ] First-run trigger download do modelo embedding se não existe

---

## [x] TASK 2.5 — Search UI Funcional

**Objetivo:** Conectar a página de busca ao backend. Query → embedding → KNN → exibir chunks reais.

**Depende de:** TASK 2.4 ✅

**Contexto:**
- `Search.tsx` já tem UI com input, filtros e cards de resultado — tudo mockado
- Precisa de `SearchService` no main process
- IPC handler `search:query`

**Arquivos a criar:**
```
src/main/services/SearchService.ts   → Orquestra: embed query → vector search → enrich chunks
src/main/ipc/searchHandlers.ts       → ipcMain.handle('search:query')
```

**Arquivos a modificar:**
- `src/pages/Search.tsx` → Substituir mocks por chamadas IPC reais
- `electron/preload.ts` → Adicionar `search()` na API

**Fluxo de busca:**
1. User digita query
2. Renderer: `window.api.search(query, options)`
3. Main: `SearchService.search(query, options)`
   - Embed a query com EmbeddingService
   - KNN search com VectorRepository (topK = 10)
   - Enriquecer resultados com chunk metadata (chat name, timestamps, participants)
   - (Opcional) Busca híbrida se `options.hybrid = true`
4. Retornar `SearchResult[]` para o renderer
5. Exibir cards com highlight do trecho

**API `window.api`** (adicionar):
```typescript
search(query: string, options?: SearchOptions): Promise<SearchResult[]>
```

**Critérios de aceitação:**
- [x] Digitar "receita de bolo" → retorna chunks relevantes de chats reais importados
- [x] Resultados ordenados por relevância (similaridade cosine)
- [x] Cada resultado mostra: trecho, chat de origem, data, participantes
- [x] Busca em < 100ms para datasets de 10k chunks
- [x] Busca híbrida (semântica + keyword) funciona
- [x] Filtro por chat funciona
- [x] Estado de loading durante a busca
- [x] Estado vazio ("nenhum resultado") quando sem matches
- [x] Zero dados mockados na Search page

**🏁 MILESTONE: MVP 1 — Busca Semântica Funcional**

---

# FASE 3 — LLM & RAG

> **Meta:** Perguntas em linguagem natural → respostas geradas por IA com streaming.

---

## [x] TASK 3.1 — LLM Service (Utility Process)

**Objetivo:** Carregar Gemma 3 270M via node-llama-cpp em Electron Utility Process com streaming de tokens.

**Depende de:** TASK 2.1 ✅ (modelo já baixado)

**Contexto:**
- LLM deve rodar em Utility Process para não bloquear main ou renderer
- Utility Process do Electron é um processo Node.js isolado com MessagePort
- Gemma 3 270M INT4 GGUF (~150MB)
- Streaming token-by-token para UX responsiva

**Arquivos a criar:**
```
src/main/services/
├── LLMService.ts          → Gerencia utility process, proxy de chamadas
└── llm-worker.ts          → Código que roda dentro do Utility Process

```

**Interface do LLMService:**
```typescript
class LLMService {
  async initialize(): Promise<void>           // Spawna utility process + carrega modelo
  isReady(): boolean
  async generate(prompt: string, options?: GenerateOptions): Promise<string>
  async generateStream(
    prompt: string,
    onToken: (token: string) => void,
    options?: GenerateOptions
  ): Promise<string>                          // Retorna resposta completa no final
  async dispose(): Promise<void>
  getModelInfo(): ModelInfo
}
```

**Requisitos:**
- Utility Process criado via `utilityProcess.fork()`
- Comunicação via `MessagePort` (não IPC do main)
- Streaming de tokens: worker envia token-by-token, LLMService repassa via callback
- Lazy loading: não carregar LLM no startup
- Dispose: matar utility process e liberar memória
- Timeout: se geração demorar > 30s, abortar
- Configurável: temperature, maxTokens, topP, stopSequences

**Critérios de aceitação:**
- [x] Utility process spawnado corretamente
- [x] Gemma 3 270M carrega sem crash
- [x] `generate("Olá, quem é você?")` retorna resposta coerente
- [x] `generateStream` emite tokens um a um
- [x] GPU utilizada automaticamente se disponível
- [x] `dispose()` mata o process e libera memória
- [x] Não bloqueia main process durante inferência
- [x] Funciona em CPU-only

---

## [x] TASK 3.2 — RAG Service + Pipeline

**Objetivo:** Criar o orquestrador RAG que combina busca semântica + LLM para gerar respostas contextualizadas.

**Depende de:** TASK 2.5 ✅ (SearchService), TASK 3.1 ✅ (LLMService)

**Arquivos a criar:**
```
src/main/services/
├── RAGService.ts          → Orquestra: search → build prompt → LLM → response
└── promptTemplates.ts     → Templates otimizados para Gemma 270M
```

**Pipeline RAG:**
```
Pergunta → EmbeddingService.embed(pergunta)
        → SearchService.search(embedding, topK=5)
        → promptTemplates.buildRAGPrompt(pergunta, chunks)
        → LLMService.generateStream(prompt)
        → Resposta com streaming + citations
```

**Prompt template (referência em `docs/ARCHITECTURE.md` seção 3.5):**

O template deve incluir system instructions + contexto dos chunks + a pergunta do usuário. Ver seção 3.5 do ARCHITECTURE.md para o formato exato.

**IPC handlers a criar:**
- `rag:query` — Inicia pipeline RAG
- `rag:token` — Evento streaming (main → renderer)
- `rag:done` — Evento de conclusão com RAGResponse completa

**Interface RAGResponse:**
```typescript
interface RAGResponse {
  answer: string
  context: SearchResult[]       // chunks usados como fonte
  tokensUsed: number
  latency: {
    embedding: number
    search: number
    generation: number
    total: number
  }
}
```

**Critérios de aceitação:**
- [x] Pipeline completa: pergunta → busca → contexto → LLM → resposta
- [x] Chunks usados como fonte retornados (citations)
- [x] Latency metrics medidas e retornadas
- [x] Fallback: se LLM falhar, retornar chunks como resposta
- [x] Se contexto não encontrado, resposta indica isso
- [x] Prompt otimizado para Gemma 270M (conciso, direto)
- [x] IPC handlers `rag:query`, `rag:token`, `rag:done` registrados

---

## [x] TASK 3.3 — Orquestração Multi-Modelo (Dual Utility Processes)

**Objetivo:** Implementar a nova arquitetura dual-model: Worker (LFM2.5-350M, residente) para tarefas rápidas em lote e Brain (Qwen3.5-3B, sob demanda) para síntese e contexto.

**Contexto (ULTRATHINK):**
- **Arquitetura (Decoupled Intelligence):** O LFM2.5 é o estivador paralelo. Lê, extrai e anota em JSON com altíssimo throughput. O Qwen3.5-3B é quem consolida. 350M de parâmetros não comportam gramática rica e raciocínio multi-step; precisamos separar o motor de parsing do motor de síntese.
- **Eficiência de VRAM (Target < 3GB):** Reter o Worker permanentemente não custa nada (~200MB de RAM), mas mantém latência zero nas queries atômicas contínuas. Carregar o Brain de forma diferida (apenas no primeiro chat de cada sessão do usuário) poupa ~2GB de VRAM e previne freezes totais de sistema em placas antigas.
- **Runtime Check:** Precisamos validar compatibilidade GGUF com o modelo híbrido / state-space do LFM2.5. O utilitário necessita reagir e degradar caso incompatível.

**Arquivos a criar/modificar:**
```
src/main/services/
├── ModelRegistry.ts       → Novo centralizador para downloads. Deve contemplar arquivos de 350M e 3B.
├── WorkerProcess.ts       → Utility Process dedicado ao LFM2.5-350M. Habilita batch queue.
└── BrainProcess.ts        → Utility Process dedicado ao Qwen3.5-3B. Suporta lazy-load.
```

**Requisitos:**
1. **Validação do Runtime (Dia 0):** Script atômico para validar inferência básica do LFM2.5 GGUF. Em colapso, utilizar outro LLM em torno de 0.5B a 1B como fallback automático sem refatorar a UI.
2. **Ciclo de Vida Independente:** A falha (Crash OOM) do Brain não deve corromper o processo contínuo de Ingestão provida pelo Worker.
3. **Interface de Streaming Dinâmica:** Comunicação IPC e MessagePorts dedicados para não engargar os pipes principais.

**Critérios de aceitação:**
- [ ] Instanciação simultânea de ambos os processos não conflita nos adapters de GPU.
- [ ] Carregamento limpo do Worker no Startup < 1.0s.
- [ ] Alocação lazy-loaded do Brain reporta status de carregamento e tempo corretamente pro front.
- [ ] Degradação gracefully tratada no frontend se Memória falhar.

---

## [x] TASK 3.4 — Ingestão Inteligente e Paralela (Sem Vector DB)

**Objetivo:** Refatorar o parser e sistema anterior de chunking. Usar o Worker para gerar resumos de sessão e identificar entidades formatadas (JSON) que servirão de fundação para NLP factual. Eliminar qualquer persistência de modelo de embeddings/sqlite-vec.

**Contexto (ULTRATHINK):**
- Por anos a comunidade apostou em Embeddings gigantescos mas desprezado que texto coloquial BR-PT (gírias) falha em simetria semântica. 
- Em vez de gerar vetores burros de blocos arbitrários, vamos focar em Topologia Temporal e Extração Estruturada ("Quem fez o que com quem em qual momento?").

**Requisitos:**
1. **Quebra Temporal (Sessões):** Substituir janela de tempo rígida de tokens por Gap Cronológico (> 2 horas inativos = Nova Sessão).
2. **Worker Batch Pipeline:** Implementar API queue de lotes (6-8 sessões por batch) para extração massivamente paralela.
3. **Extração JSON (Strict Mode):** O prompt enviado para o LFM2.5-350M exigirá obrigatoriamente Formato JSON validado regex. Coletar: `summary` genérico da sessão e `entities` detalhadas (entidade, nome normalizado, tipo, intenção/ação do usuário).
4. **Agregação Pós-Ingestão (Levenshtein LLM):** No término da timeline, agrupar variações e utilizar o Worker para normalização linguística rápida final das tags cadastradas ("LoL" e "League" -> "league of legends").
5. **Drop do VecDB:** Remover as chamadas do sqlite-vec do schema e dos DAOs originais. Simplificar o SQLite com foco em FTS5 agressivo nas colunas textuais.

**Critérios de aceitação:**
- [ ] Agrupamento por sessões obedece à lógica natural da inatividade de envio.
- [ ] Pipeline extrai resumos coesos em JSON consistente (100% de parse sem crash).
- [ ] Concorrência via batch processing gera velocidade máxima; logs exibem sessões/sec em avanço na GUI.
- [ ] Tabelas atualizadas preenchendo as colunas formatadas adequadamente.

---

# FASE 4 — MOTOR DE BUSCA DETERMINÍSTICO E SÍNTESE DO BRAIN

> **Meta:** Otimizar a pipeline RAG, abandonando Loops Cognitivos / LLM Agents e substituindo por um Pipeline Determinístico (Query Extractor FTS5 + Brain Synthesis).

---

## [x] TASK 4.1 — Routing Algorítmico do Motor de Busca (Sem LLM)

**Objetivo:** Definir as lógicas de retrieval FTS5 nativo. Criar caminhos de pesquisa independentes orientados à intenção de usuário, substituindo o KNN Híbrido obsoleto.

**Contexto (ULTRATHINK):**
- Minimizar "Ruído Cinza" na query factual. Um input buscando "refeição hamburguer" não precisa bater KNN, necessita apenas Expandir o contexto se encontrou um hit factual no SQLite em FTS5. Isso mantém o contexto para a Brain limpo e exato.

**Requisitos:**
1. **Classificador Cognitivo (Worker Call):** Um prompt atômico pedindo ao 350M a classificação da pergunta: `factual | aggregation | narrative`, extraindo também Keywords nativas e o Tense (Tempo do evento).
2. **Pipeline Tripla de Busca (Algorítmica, 0 LLM):**
   - *Factual*: FTS5 clássico expandido via "*Sliding Window*". Se acha hit, engolir as +/- 15 mensagens subsequentes para injetar o fluxo local da conversa. Top 5 Janelas.
   - *Aggregations*: Queries puras na tabela de Entities via `COUNT` / `GROUP BY`.
   - *Narrative*: Retornar `summaries` de sessões completas, filtradas pelos limites de data isolados pelo Classificador.
3. **Context Bridging:** Montar pacote imutável e estruturado consolidado das buscas listadas para injeção final.

**Critérios de aceitação:**
- [ ] Worker extrai Data, Intenção temporal e Keywords coesas.
- [ ] Resposta dos algoritmos FTS/SQL deve levar < 25ms.
- [ ] Context Bridging produz documento legível sem hallucination e com rastreabilidade forte do registro ID do DB.

---

## [x] TASK 4.2 — Brain Synthesis & Refinamento Opcional

**Objetivo:** Sintetizar e formatar o Pacote Contextual via Qwen3.5-3B. Processar expansão lexical em caso de falha inicial da pesquisa originária.

**Contexto (ULTRATHINK):**
- A Brain receberá uma "Receita Exata" nas instruções: 'Basear-se EXATAMENTE nas datas x e y providenciadas no prompt'. Isso suprime alucinação do LLM.
- Não usar loops gigantescos "Think -> Do -> Think". Se FTS falhou, a LLM recua, o Worker gera variações (ex: "cs, csgo, conter strike") e o sistema faz UM (1) novo FTS retry. Se esgotou, declara "dados inexistentes" e preserva UX e GPU.

**Requisitos:**
1. **Brain Injection:** Despachar o pacote validado ao Qwen3.5-3B configurado para baixa `temperature`.
2. **Token Streaming SSE:** Encaminhar imediatamente cada Output Character para renderização na Web, criando Percepção de Altíssima Velocidade.
3. **Fallback Worker (Gíria BR Expansion):** Em casos onde Brain falhou na agregação por keyword errada, demandar uma expansão FTS rápida (via 350M Worker) usando dialeto de chat pt-BR moderno. Reenviar FTS.

**Critérios de aceitação:**
- [ ] Prompt de Síntese retorna texto excelente, focado e que menciona datas originárias.
- [ ] Refinamento lexical de fato tenta até 2 loops limitados antes de abortar de forma elegante.

---

# FASE 5 — INTERFACE REATIVA (TRUST BY DESIGN)

> **Meta:** Fechamento e Polimento voltados a Transparência e Percepção Operacional. Sem UI complexa de roteamento, porém com imersão alta na janela Citações visuais.

---

## [x] TASK 5.1 — Chat Interativo e Expanded Citations 

**Objetivo:** Renovar o layout Frontend (App.tsx / Chat.tsx) focando em Transparência Operacional — Evidenciar como a Engine buscou.

**Contexto (ULTRATHINK):**
- Um AI "Caixa Preta" assusta. Mostar diretamente do log importado o pedaço "sujo" que o AI consumiu faz o Cérebro do Usuário perdoar erros e confiar no acerto. O componente de citações é o Core Value Pŕoposition do front.

**Requisitos:**
1. **Accordion de Transparência:** No painel da Chat Response, listar as Fontes Originais via componente dropdown animado via Framer Motion. Usuário visualiza o *Sliding Window* bruto recuperado do DB em tempo real.
2. **Loading States Aprimorados:** Mensagem no frontend explicitando as etapas do fluxo determinístico: "Modelos Hibernando...", "Ligando Qwen...", "Gerando Síntese", "Aguardando GPU...".
3. **Injeção de Metadados UI:** Aplicar filtros por Sidebar e barra temporal no container principal.

**Critérios de aceitação:**
- [ ] Usuário capaz de checar exatamente qual arquivo/linha gerou a síntese no accordeon.
- [ ] Fluxo de texto por SSE do LLM roda limpo.
- [ ] Erros de GPU (Crash RAM) disparam um Modal ou Toast visual.

---

## [x] TASK 5.2 — Dashboard Import Pipeline (Batch GUI)

**Objetivo:** Remodelar a Sidebar e o Upload Handler lidando com o Worker Extract.

**Requisitos:**
1. Tratar barra de upload detalhando: Passo FTS Indexing > Passo Batch Summarries > Passo Entity Resolving.
2. Permitir que o Chat seja explorado mesmo que as entidades finais (Passo 5) não tenham terminado de rodar.

**Critérios de aceitação:**
- [x] Resposta visual ágil as tarefas parciais salvas pelas transações do DB.

---

## [ ] TASK 5.3 — Packaging Final (Tauri / Build Flags)

**Objetivo:** Fechar dependências e rodar pipelines de empacotamento com atenção na separação de Utility Processes.

**Requisitos:**
1. Tratamento robusto para os binários associados do `node-llama-cpp`. 
2. Retirar resquícios do `sqlite-vec` nos package configuration.
3. Teste em máquina clean (Onde Models Download e Caches são ativados no Boot1).

**Critérios de aceitação:**
- [ ] App Installer gera Binário completo com os Utility Modules íntegros.

---

# FASE 6 — IDENTIDADE E MAPA DE RELAÇÕES (PEOPLE & MENTIONS)

> **Meta:** Otimizar a ingestão via Worker e construir de forma reativa a rede social do usuário identificando terceiros mencionados nas conversas.

---

## [x] TASK 6.1 — Otimização da Ingestão de Memórias

**Objetivo:** Refinar o chunking adaptativo e o prompt do LFM2.5 para incluir de forma estrita "Menções a Terceiros" em JSON.
**Documentação completa:** `docs/task-docs/01-ingestion-optimization.md`
**Critérios de aceitação:**
- [x] Agrupamento adaptativo implementado sem diluir atenção do LLM.
- [x] Prompt retorna entidades mencionadas (`mentioned_entities`) com `name` e `context`.
- [x] Fallbacks e métricas de desempenho em logs.

---

## [x] TASK 6.2 — Criação do Schema de Pessoas

**Objetivo:** Adicionar tabelas SQLite (`people`, `person_aliases`, `person_relations`, `person_mentions`) para suporte ao mapeamento.
**Documentação completa:** `docs/task-docs/02-people-schema.md`
**Critérios de aceitação:**
- [x] Tabelas `people`, `person_aliases`, etc, criadas via migration.
- [x] Repositórios atualizados para lidar com as amarrações do grafo.

---

## [x] TASK 6.3 — Lógica de Desambiguação de Menções

**Objetivo:** Implementar o fluxo assíncrono (Inbox) que identifica uma menção e permite ao usuário confirmar se é uma pessoa já existente ou criar uma nova.
**Documentação completa:** `docs/task-docs/03-interactive-disambiguation.md`
**Critérios de aceitação:**
- [x] FTS5 Match parcial pausa a entidade não resolvida.
- [x] Fluxo IPC envia menção à "Caixa de Entrada".
- [x] Ação do usuário é commitada no banco definitivo.

---

## [x] TASK 6.4 — Integração Frontend (People.tsx)

**Objetivo:** Interligar o Mock de `People.tsx` ao Banco e implementar o Inbox de Menções (Modal UI).
**Documentação completa:** `docs/task-docs/04-people-ui-integration.md`
**Critérios de aceitação:**
- [x] Lista de pessoas real aparece no grafo de `People.tsx`.
- [x] Modal de "Resolução de Menção" construído no Frontend e ligado aos eventos IPC.

---

## [ ] TASK 6.5 — Contexto Expandido na Resolução de Menções

**Objetivo:** Permitir que o usuário visualize as mensagens vizinhas ao clicar no contexto de uma menção pendente, facilitando a identificação da pessoa.

**Requisitos:**
1. **IPC Handler:** Criar `people:get_mention_context` que recebe \`sessionId\` e \`contextSnippet\`.
   - Busca as mensagens da sessão no banco de dados.
   - Localiza a mensagem que melhor combina com o snippet.
   - Retorna um bloco de mensagens (4 anteriores + a mensagem foco + 4 posteriores).
2. **UI (MentionInbox.tsx):** 
   - Tornar o bloco de contexto clicável (hover effect + cursor pointer).
   - Exibir um Popover ou Modal com o fluxo de mensagens formatado.
3. **UX:** Garantir que o usuário consiga ler o fluxo de conversa para decidir entre Novo/Vincular/Ignorar.

**Critérios de aceitação:**
- [ ] Clicar no contexto abre visualização expandida.
- [ ] Visualização mostra cronologia (mensagens vizinhas).
- [ ] Identificação de quem é quem fica clara pela troca de mensagens.


---

# Progresso Global

| Fase | Tasks | Concluídas | Status |
|------|-------|-----------|--------|
| **Fase 1** — Database & Parser | 4 | 4 | ✅ Concluída |
| **Fase 2** — Model Download Services | 5 | 5 | ✅ Concluída |
| **Fase 3** — Dual-Model Architecture | 4 | 2 | 🟡 Em andamento (Worker Pending) |
| **Fase 4** — Deterministic Pipeline | 2 | 1 | 🟡 Em andamento |
| **Fase 5** — Interactive Interface & QA | 3 | 0 | ⬜ Não iniciada |
| **Fase 6** — Identity Graph & Mentions | 4 | 4 | ✅ Concluída |
| **Fase 7** — Map-Reduce Engine | 4 | 4 | ✅ Concluída |
| **Fase 8** — Smart Features | 2 | 0 | ⬜ Não iniciada |
| **Fase 9** — Multi-App & Multimodal | 2 | 0 | ⬜ Não iniciada |
| **Fase 10** — Polish & Persistência | 4 | 0 | ⬜ Não iniciada |
| **Fase 11** — Distribuição & Auto-Update | 3 | 0 | ⬜ Não iniciada |
| **Fase 12** — Mobile v2.0 (React Native) | 5 | 0 | ⬜ Não iniciada |
| **TOTAL** | **42** | **18** | **43%** |

**Milestones:**
- [x] **MVP 1** — Pipeline de Storage Básico Funcional
- [ ] **MVP 2** (após TASK 4.2) — Orquestração de Síntese sem Vector DB
- [ ] **v1.0** (após TASK 11.3) — App distribuível, cross-platform, com auto-update
- [ ] **v1.1** (após TASK 8.1 + 8.2) — Smart Features (Timeline + Resumos)
- [ ] **v2.0** (após TASK 12.5) — Mobile React Native (Android + iOS)

---

# FASE 7 — MAP-REDUCE ENGINE (INTELIGÊNCIA DOS PERFIS)

> **Meta:** Otimizar a inteligência das pessoas cadastradas, extraindo tags e memórias biográficas de forma autônoma e em background através do LLM.

---

## [x] TASK 7.1 — Schema de Conhecimento Individual (Tags & Memories)

**Objetivo:** Preparar o SQLite para armazenar as entidades sintéticas extraídas das pessoas.
**Documentação completa:** `docs/task-docs/05-phase7-mapreduce.md`
**Critérios de aceitação:**
- [x] Migration `009_person_knowledge_schema.ts` criada (tabelas `person_tags` e `person_key_memories`).
- [x] Tipos atualizados em `shared/types.ts`.
- [x] DAO atualizado no `PersonRepository` com métodos para inserir tags e memórias.

---

## [x] TASK 7.2 — Map-Reduce Background Service

**Objetivo:** Criar o orquestrador que extrai os dados em background de forma passiva.
**Critérios de aceitação:**
- [ ] `MapReduceService.ts` criado com rotina periódica.
- [ ] Busca por menções não-processadas.
- [ ] Mega-prompt montado e enviado ao BrainProcess (Qwen3B) ou WorkerProcess (LFM2.5).
- [ ] JSON resultante validado em strict mode, contendo `tags` e `memories`.

---

## [x] TASK 7.3 — Consolidação Incremental no Banco

**Objetivo:** Persistir os achados da IA na biografia da pessoa.
**Critérios de aceitação:**
- [ ] Salvar novas tags em `person_tags` via `INSERT OR IGNORE`.
- [ ] Adicionar memórias em `person_key_memories`.
- [ ] Marcar menções usadas com `processed = 1` para não gastar GPU desnecessária no futuro.

---

## [x] TASK 7.4 — Integração Definitiva na UI (People.tsx)

**Objetivo:** Conectar a inteligência do Backend à UI do Frontend de Pessoas.
**Critérios de aceitação:**
- [ ] `getPeople` modificado para trazer as subqueries de tags e memórias preenchidas.
- [ ] Mocks vazios removidos do `People.tsx`.
- [ ] Painel lateral renderizando corretamente todos os dados inteligentes que a IA absorveu.

---

# FASE 8 — SMART FEATURES

> **Meta:** Processamento avançado do LLM no conteúdo das conversas. Extração automatizada de entidades para além de pessoas.

---

## [ ] TASK 8.1 — Timeline e Agendamentos

**Objetivo:** Identificar datas e agendamentos mencionados, listando em uma timeline consolidada.
**Critérios de aceitação:**
- [ ] O modelo Worker extrai eventos temporais (ex: "Viagem amanhã", "Médico dia 15").
- [ ] UI de Agenda exibe os eventos cronologicamente.

---

## [ ] TASK 8.2 — Resumos Automáticos de Sessão na UI

**Objetivo:** Exibir os resumos JSON extraídos da ingestão inteligente diretamente na lista de sessões do Chat.
**Critérios de aceitação:**
- [ ] A Sidebar de Chats mostra pequenos resumos dinâmicos ao invés de apenas a "última mensagem".

---

# FASE 9 — MULTI-APP & MULTIMODAL

> **Meta:** Expansão para outras plataformas (Telegram, Instagram) e Busca Visual.

---

## [ ] TASK 9.1 — Parsers Adicionais (Telegram e Instagram)

**Objetivo:** Adaptar o `ChatImportService` para ingerir JSONs de exportação de outras redes.
**Critérios de aceitação:**
- [ ] Ingestão de chat exportado do Telegram funciona e agrupa no Grafo.
- [ ] Ingestão de export do Instagram DMs funciona.

---

## [ ] TASK 9.2 — Busca de Imagem (CLIP)

**Objetivo:** Empregar o modelo CLIP via node-llama-cpp para gerar embeddings de imagens locais recebidas em conversas, permitindo buscas visuais.
**Critérios de aceitação:**
- [ ] Extrair media references do parser de chat e embedar a imagem local via CLIP.
- [ ] Input de busca no Frontend consegue cruzar texto ("foto da praia") com o embedding da imagem e exibí-la.

---

# FASE 10 — POLISH & PERSISTÊNCIA (UX DE QUALIDADE DE PRODUÇÃO)

> **Meta:** Fechar os gaps de UX e persistência identificados no gap analysis: edição real de perfis de pessoas, cache de queries, onboarding de primeiro acesso e atalhos de teclado.
> **Fonte:** `ARCHITECTURE.md §3.6`, `TECH_SPEC §3.2`, `ROADMAP Semana 8 & 10`.

---

## [ ] TASK 10.1 — Edição Persistente de Perfil de Pessoa

**Objetivo:** Ligar os botões de bio, tags e foto que já existem no `People.tsx` ao banco de dados via novos IPC handlers. Atualmente, as edições são apenas visuais e se perdem ao recarregar.

**Contexto:**
- `ARCHITECTURE.md §3.6` especifica os IPCs `updatePersonBio`, `updatePersonTags`, `updatePersonPhoto` mas eles nunca foram implementados.
- O `PersonPanel` em `People.tsx` já tem o campo de textarea para bio e input para nova tag, mas não persiste nada.

**Arquivos a criar/modificar:**
- `src/main/ipc/peopleHandlers.ts` → Adicionar handlers `people:update_bio`, `people:update_tags`, `people:update_photo`
- `src/main/db/repositories/PersonRepository.ts` → Adicionar `updateBio(personId, bio)`, `addTag(personId, tag)`, `removeTag(personId, tagId)`
- `electron/preload.ts` → Expor os 3 novos métodos
- `src/shared/ipc-types.ts` → Atualizar `ElectronAPI`
- `src/pages/People.tsx` → Conectar os botões aos novos métodos do `window.api`

**Critérios de aceitação:**
- [ ] Editar bio de uma pessoa e recarregar o app mantém o texto.
- [ ] Adicionar tag manualmente via input persiste na tabela `person_tags`.
- [ ] Upload de foto (path local via diálogo Electron) persiste no campo `photo_path` da tabela `people`.
- [ ] Remover tag funciona (DELETE no DB).

---

## [ ] TASK 10.2 — Cache de Queries & MemoryManager

**Objetivo:** Implementar o `QueryCacheService` que usa a tabela `query_cache` já existente no schema para evitar re-embedding de queries repetidas. Adicionar `MemoryManager` com idle timer para liberar o LLM em CPUs fracas.

**Contexto:**
- `TECH_SPEC §3.2` — tabela `query_cache` já definida mas sem serviço.
- `SYSTEM_REQUIREMENTS §6.2` — `MemoryManager` com `startIdleTimer()` e `checkMemoryPressure()` especificado mas não implementado.

**Arquivos a criar:**
```
src/main/services/
├── QueryCacheService.ts   → Lookup/store de queries em query_cache
└── MemoryManager.ts       → Idle timer (5min) + monitoramento de pressão de memória
```

**Critérios de aceitação:**
- [ ] Query repetida (`search:query`) retorna resultado do cache sem invocar o EmbeddingService.
- [ ] `hit_count` da tabela `query_cache` incrementa a cada cache hit.
- [ ] MemoryManager descarrega o BrainProcess após 5min de inatividade em Tier 3 (CPU-only).
- [ ] Logs indicam quando memória livre cai abaixo de 500MB.

---

## [ ] TASK 10.3 — Onboarding & First-Run UX

**Objetivo:** Criar a tela de boas-vindas com download de modelos integrado e exibição do tier de hardware detectado. Cobrir o fluxo completo do primeiro acesso.

**Contexto:**
- `ROADMAP Semanas 7 & 10` — onboarding wizard + benchmark de hardware.
- `SYSTEM_REQUIREMENTS §4` — detecção de tier e `SystemCapabilities`.
- Atualmente o app abre direto no Home sem orientar o usuário sobre modelos ou hardware.

**Requisitos:**
1. Detectar se é primeiro acesso (`firstRun` flag em settings).
2. Exibir tela de onboarding com: boas-vindas, hardware detectado (Tier 1/2/3 + GPU name), e botão de download dos modelos.
3. Progress bar durante o download (já existe `onModelProgress`).
4. Após download concluído, redirecionar para o Import.
5. Exibir o hardware detectado permanentemente na `Settings.tsx`.

**Arquivos a criar/modificar:**
- `src/pages/Onboarding.tsx` → Tela nova de primeiro acesso
- `src/main/services/SystemDetectionService.ts` → Retorna `SystemCapabilities` (tier, GPU, RAM, AVX2)
- `src/main/ipc/settingsHandlers.ts` → Adicionar `system:info` handler
- `src/App.tsx` → Redirecionar para Onboarding se `firstRun = true`

**Critérios de aceitação:**
- [ ] Primeiro acesso mostra tela de onboarding.
- [ ] Hardware detectado (GPU/CPU/RAM/Tier) exibido na UI.
- [ ] Download de modelos ocorre com progress bar real na tela de onboarding.
- [ ] Após download, `firstRun` é marcado como `false` e não reaparece.
- [ ] Settings.tsx mostra informações de hardware e tier.

---

## [ ] TASK 10.4 — Keyboard Shortcuts & Tray Icon

**Objetivo:** Implementar atalhos de teclado para navegação rápida e um tray icon com atalho global para abrir o quick search sem focar a janela.

**Contexto:**
- `ROADMAP Semana 8` — `Ctrl+K` search, `Esc` fechar.
- `ROADMAP Semana 10` — Tray icon + quick search com atalho global.

**Requisitos:**
1. **Keyboard shortcuts (renderer):**
   - `Ctrl+K` → abre Search, foca o input
   - `Ctrl+,` → abre Settings
   - `Esc` → fecha painéis laterais / cancela ação corrente
2. **Tray icon (main process):**
   - Ícone no system tray ao minimizar
   - Atalho global `Ctrl+Shift+R` → mostra/foca a janela
   - Menu de contexto: "Abrir", "Quick Search", "Quit"

**Critérios de aceitação:**
- [ ] `Ctrl+K` foca o input de busca de qualquer página.
- [ ] `Esc` fecha o painel de detalhes de pessoa.
- [ ] Tray icon visível ao minimizar no Windows e macOS.
- [ ] Atalho global funciona mesmo com o app minimizado.

---

# FASE 11 — DISTRIBUIÇÃO & AUTO-UPDATE

> **Meta:** Preparar o app para distribuição pública com installers para as 3 plataformas, assinatura de código e sistema de atualização automática.
> **Fonte:** `ROADMAP Semana 11`, `SYSTEM_REQUIREMENTS §9`.

---

## [ ] TASK 11.1 — Packaging Completo (Win / Mac / Linux)

**Objetivo:** Configurar o `electron-builder` para gerar installers de produção para Windows, macOS e Linux com code signing e assets finais.

**Contexto:**
- A TASK 5.3 existente tinha critérios rasos. Esta task substitui e expande com critérios reais de produção.
- `SYSTEM_REQUIREMENTS §9` especifica formatos e tamanhos estimados.

**Requisitos:**
1. **Windows:** `.exe` via NSIS installer (~100MB sem modelos)
2. **macOS:** `.dmg` universal (Intel + Apple Silicon)
3. **Linux:** `.AppImage` + `.deb`
4. **Code signing:** Certificado para Windows (Authenticode) e macOS (notarização Apple)
5. **Assets:** Ícone em todas as resoluções (ico, icns, png), splash screen
6. **Modelos excluídos** do installer — download no first-run

**Critérios de aceitação:**
- [ ] `npm run build` gera installers para a plataforma host.
- [ ] Installer Windows instala, cria atalho e desinstala limpo.
- [ ] App macOS passa na notarização Apple (sem warnings de Gatekeeper).
- [ ] AppImage Linux abre sem dependências extras.
- [ ] Tamanho do installer < 150MB.
- [ ] Ícone aparece corretamente no sistema de cada plataforma.

---

## [ ] TASK 11.2 — Auto-Updater (electron-updater + GitHub Releases)

**Objetivo:** Configurar `electron-updater` para checar atualizações automaticamente a cada 24h e permitir atualização in-app sem reinstalação manual.

**Contexto:**
- `SYSTEM_REQUIREMENTS §9` — mecanismo: `electron-updater`, canal: GitHub Releases, verificação: assinatura digital.

**Requisitos:**
1. Checar por updates no startup e a cada 24h.
2. Notificar o usuário quando update disponível (toast não-intrusivo).
3. Download do update em background.
4. Instalar ao reiniciar ("Reiniciar para atualizar" button).
5. Verificação de assinatura do update antes de instalar.

**Critérios de aceitação:**
- [ ] `autoUpdater.checkForUpdatesAndNotify()` configurado no main.ts.
- [ ] UI mostra toast quando update disponível.
- [ ] Update baixado em background sem travar a UI.
- [ ] Restart instala o update corretamente.
- [ ] Build pipeline do GitHub Actions gera releases assinados.

---

## [ ] TASK 11.3 — Cross-Platform QA (Matriz de Compatibilidade)

**Objetivo:** Validar o app nas combinações de hardware/OS definidas na matriz do `SYSTEM_REQUIREMENTS §7.1` antes do release v1.0.

**Matriz de testes (conforme SYSTEM_REQUIREMENTS):**

| Tier | Sistema | Hardware |
|------|---------|----------|
| Tier 1 | Windows 11 | RTX 3060/4060 |
| Tier 1 | macOS | MacBook Pro M1 Pro+ |
| Tier 2 | Windows 10/11 | Intel Iris Xe |
| Tier 2 | macOS | MacBook Air M1 base (8GB) |
| Tier 3 | Windows 10 | CPU-only (Intel i5 8ª gen) |
| Tier 3 | Ubuntu 22.04 | CPU-only |

**Checklist por sistema:**
- [ ] App inicia sem crash
- [ ] Hardware detectado e Tier atribuído corretamente
- [ ] Download de modelos (first-run) funciona
- [ ] Importação de chat funciona
- [ ] LLM gera resposta sem freeze
- [ ] Streaming de tokens fluido na UI
- [ ] Memória dentro do budget (~600MB)
- [ ] Auto-updater funciona
- [ ] Installer instala e desinstala limpo

**Critérios de aceitação:**
- [ ] Zero crashes em uso normal nos 6 cenários acima.
- [ ] Performance aceitável em Tier 3 CPU-only (> 8 tokens/s).
- [ ] Bugs encontrados documentados e corrigidos antes do release.

---

# FASE 12 — MOBILE v2.0 (REACT NATIVE)

> **Meta:** Port do Recall.ai para Android e iOS usando React Native + Expo, com IA on-device via LiteRT.
> **Pré-requisito:** v1.0 desktop estável e validada com usuários reais.
> **Estimativa:** 8-10 semanas.
> **Fonte:** `ROADMAP Fase 5`.

---

## [ ] TASK 12.1 — Setup React Native + Expo

**Objetivo:** Criar o projeto mobile com Expo SDK 52+, reutilizando os tipos compartilhados do desktop.

**Requisitos:**
1. `npx create-expo-app recall-ai-mobile --template` com TypeScript.
2. Portar `src/shared/types.ts` e constantes para o projeto mobile.
3. Configurar Expo Router para navegação.
4. Setup de design system mobile (Tamagui ou NativeWind).

**Critérios de aceitação:**
- [ ] App mobile roda em simulador iOS e emulador Android.
- [ ] Tipos compartilhados importados sem modificação.
- [ ] Navegação entre telas básicas funciona.

---

## [ ] TASK 12.2 — Port Database Layer (op-sqlite)

**Objetivo:** Substituir `better-sqlite3` por `op-sqlite` (JSI) no contexto mobile, adaptando as migrations e repositories.

**Critérios de aceitação:**
- [ ] Schema SQLite criado via `op-sqlite` no dispositivo.
- [ ] ChatRepository, MessageRepository e SessionRepository funcionam no mobile.
- [ ] FTS5 funcional para busca textual.

---

## [ ] TASK 12.3 — Port ML Runtime (LiteRT / TFLite)

**Objetivo:** Substituir `node-llama-cpp` por `LiteRT` (ex-TensorFlow Lite) para inferência on-device no mobile.

**Contexto:**
- `ROADMAP §Fase 5` — manter Gemma 3 270M, adaptar runtime.
- Tier 4 (dispositivos muito fracos) → search-only sem LLM.

**Critérios de aceitação:**
- [ ] Embedding via LiteRT funciona em Android e iOS.
- [ ] LLM Gemma 270M gera resposta on-device (Tier 1-3 mobile).
- [ ] Fallback para search-only em Tier 4 (< 3GB RAM).

---

## [ ] TASK 12.4 — UI Mobile (Touch-First)

**Objetivo:** Adaptar as páginas principais (Import, Search, Chat, People) para UX mobile com gestos, touch targets adequados e layouts responsivos.

**Critérios de aceitação:**
- [ ] Import funciona via expo-file-system (share intent do WhatsApp).
- [ ] Search com resultados fluidos (FlatList virtualizada).
- [ ] Chat RAG com streaming funcional.
- [ ] People graph interativo via touch (pan + zoom no grafo SVG).

---

## [ ] TASK 12.5 — Publicação nas Stores

**Objetivo:** Preparar e submeter o app para Google Play Store e Apple App Store.

**Requisitos:**
1. Build de produção via EAS Build (Expo Application Services).
2. Assets da store: ícone, screenshots, descrição PT-BR e EN.
3. Privacy policy (processamento 100% local — sem coleta de dados).
4. Revisão de conformidade (LGPD / GDPR).

**Critérios de aceitação:**
- [ ] App aprovado na Play Store (Android 10+).
- [ ] App aprovado na App Store (iOS 15+).
- [ ] Versão de produção disponível para download público.
