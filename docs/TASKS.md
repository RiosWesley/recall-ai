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

## [ ] TASK 4.2 — Brain Synthesis & Refinamento Opcional

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

## [ ] TASK 5.1 — Chat Interativo e Expanded Citations 

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

## [ ] TASK 5.2 — Dashboard Import Pipeline (Batch GUI)

**Objetivo:** Remodelar a Sidebar e o Upload Handler lidando com o Worker Extract.

**Requisitos:**
1. Tratar barra de upload detalhando: Passo FTS Indexing > Passo Batch Summarries > Passo Entity Resolving.
2. Permitir que o Chat seja explorado mesmo que as entidades finais (Passo 5) não tenham terminado de rodar.

**Critérios de aceitação:**
- [ ] Resposta visual ágil as tarefas parciais salvas pelas transações do DB.

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

# Progresso Global

| Fase | Tasks | Concluídas | Status |
|------|-------|-----------|--------|
| **Fase 1** — Database & Parser | 4 | 4 | ✅ Concluída |
| **Fase 2** — Model Download Services | 5 | 5 | ✅ Concluída |
| **Fase 3** — Dual-Model Architecture | 4 | 2 | 🟡 Em andamento (Worker Pending) |
| **Fase 4** — Deterministic Pipeline | 2 | 1 | 🟡 Em andamento |
| **Fase 5** — Interactive Interface & QA | 3 | 0 | ⬜ Não iniciada |
| **TOTAL** | **18** | **12** | **66%** |

**Milestones:**
- [x] **MVP 1** — Pipeline de Storage Básico Funcional
- [ ] **MVP 2** (após TASK 4.2) — Orquestração de Síntese sem Vector DB
- [ ] **v1.0** (após TASK 5.3) — UI Reativa com Transparência de Hit
