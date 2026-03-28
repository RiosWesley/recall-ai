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

## [ ] TASK 1.1 — Setup better-sqlite3 + Schema SQLite

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

## [ ] TASK 1.2 — Repositories (Chat, Message, Chunk)

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

## [ ] TASK 1.3 — WhatsApp Parser + Chunking Engine

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

## [ ] TASK 1.4 — IPC Bridge + Conectar Import UI

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

## [ ] TASK 2.1 — Model Downloader (First-Run)

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

## [ ] TASK 2.2 — Embedding Service (node-llama-cpp)

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

## [ ] TASK 2.3 — VectorRepository (sqlite-vec KNN)

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
- [ ] Insert de embedding funciona
- [ ] KNN search retorna chunks ordenados por distância
- [ ] Busca com 10k vetores retorna em < 30ms
- [ ] Busca híbrida combina scores corretamente
- [ ] Delete por chatId limpa vetores associados
- [ ] Tipos corretos no retorno (chunk_id + distance)

---

## [ ] TASK 2.4 — Pipeline de Importação Completo

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

## [ ] TASK 2.5 — Search UI Funcional

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
- [ ] Digitar "receita de bolo" → retorna chunks relevantes de chats reais importados
- [ ] Resultados ordenados por relevância (similaridade cosine)
- [ ] Cada resultado mostra: trecho, chat de origem, data, participantes
- [ ] Busca em < 100ms para datasets de 10k chunks
- [ ] Busca híbrida (semântica + keyword) funciona
- [ ] Filtro por chat funciona
- [ ] Estado de loading durante a busca
- [ ] Estado vazio ("nenhum resultado") quando sem matches
- [ ] Zero dados mockados na Search page

**🏁 MILESTONE: MVP 1 — Busca Semântica Funcional**

---

# FASE 3 — LLM & RAG

> **Meta:** Perguntas em linguagem natural → respostas geradas por IA com streaming.

---

## [ ] TASK 3.1 — LLM Service (Utility Process)

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
- [ ] Utility process spawnado corretamente
- [ ] Gemma 3 270M carrega sem crash
- [ ] `generate("Olá, quem é você?")` retorna resposta coerente
- [ ] `generateStream` emite tokens um a um
- [ ] GPU utilizada automaticamente se disponível
- [ ] `dispose()` mata o process e libera memória
- [ ] Não bloqueia main process durante inferência
- [ ] Funciona em CPU-only

---

## [ ] TASK 3.2 — RAG Service + Pipeline

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
- [ ] Pipeline completa: pergunta → busca → contexto → LLM → resposta
- [ ] Chunks usados como fonte retornados (citations)
- [ ] Latency metrics medidas e retornadas
- [ ] Fallback: se LLM falhar, retornar chunks como resposta
- [ ] Se contexto não encontrado, resposta indica isso
- [ ] Prompt otimizado para Gemma 270M (conciso, direto)
- [ ] IPC handlers `rag:query`, `rag:token`, `rag:done` registrados

---

## [ ] TASK 3.3 — Chat UI Funcional (RAG Streaming)

**Objetivo:** Conectar a tela de Chat ao RAG com streaming de tokens. User faz pergunta → resposta aparece token por token.

**Depende de:** TASK 3.2 ✅

**Contexto:**
- `Chat.tsx` já tem UI de chat (8.7KB) — com mock data e streaming simulado
- Precisa receber tokens reais via IPC events
- Mostrar citations (chunks fonte) abaixo da resposta

**Arquivos a modificar:**
- `src/pages/Chat.tsx` → Conectar ao IPC real
- `electron/preload.ts` → Adicionar `askRAG()`, `onRAGToken()`, `onRAGDone()`

**API `window.api`** (adicionar):
```typescript
askRAG(question: string, options?: RAGOptions): Promise<void>
onRAGToken(cb: (token: string) => void): void
onRAGDone(cb: (response: RAGResponse) => void): void
```

**Comportamento esperado:**
1. User digita pergunta e envia
2. Estado muda para "thinking" (indicador visual)
3. Tokens começam a aparecer um a um (streaming)
4. Ao finalizar: resposta completa + citations + latency info
5. Scroll automático acompanha novos tokens

**Critérios de aceitação:**
- [ ] Digitar pergunta → resposta da IA aparece com streaming
- [ ] Tokens aparecem suavemente (sem flash/flicker)
- [ ] Citations (chunks fonte) exibidos após resposta
- [ ] Indicador de "pensando" enquanto IA processa
- [ ] Latency metrics exibidas (tempo de busca + geração)
- [ ] Funciona sem LLM (fallback: mostra chunks encontrados)
- [ ] Zero dados mockados na Chat page
- [ ] Scroll acompanha tokens novos

---

## [ ] TASK 3.4 — Home Page Funcional

**Objetivo:** Conectar a Home page a dados reais — stats, memórias recentes, pessoas em destaque.

**Depende de:** TASK 1.4 ✅, TASK 2.5 ✅

**Contexto:**
- `Home.tsx` tem mock data completo (HAS_DATA toggle)
- Precisa: stats reais do DB, últimas buscas, pessoas com mais mensagens

**Arquivos a modificar:**
- `src/pages/Home.tsx` → Substituir mock data por chamadas IPC

**IPC handlers necessários:**
- `stats:get` → { totalPersons, totalChats, totalMessages, lastSearchQuery }
- `stats:recentMemories` → últimos chunks visualizados/buscados
- `stats:featuredPeople` → top 3 pessoas por message_count

**Critérios de aceitação:**
- [ ] Stats refletem dados reais do DB
- [ ] Empty state aparece quando não há chats importados
- [ ] Pessoas em destaque vêm do DB (top 3 por msgs)
- [ ] Memórias recentes vêm do search_history
- [ ] Zero dados mockados

**🏁 MILESTONE: MVP 2 — IA Desktop Funcional**

---

# FASE 4 — POLISH & FEATURES

> **Meta:** Qualidade de produção, features diferenciadores, state management.

---

## [ ] TASK 4.1 — People Graph Engine + UI

**Objetivo:** Implementar a extração de pessoas (sender-based), relações por co-occurrence, e conectar à tela People.

**Depende de:** TASK 1.4 ✅

**Contexto:**
- Schema já definido no ARCHITECTURE.md seção 3.6: `persons`, `person_relations`, `key_memories`
- v1.0 usa extração sender-based (sem NER por LLM — isso é v1.3)
- `People.tsx` já tem UI completa (30KB!) com grafo SVG e painel de perfil — tudo mockado
- Deduplicação de aliases por Levenshtein distance ≤ 2

**Arquivos a criar:**
```
src/main/services/PeopleService.ts     → Extrai, deduplica, relaciona pessoas
src/main/db/repositories/PersonRepository.ts
src/main/ipc/peopleHandlers.ts
```

**Tabelas a adicionar no schema (migration 002):**
```sql
CREATE TABLE persons (id, name, aliases, photo_path, bio, tags, msg_count, first_seen, last_seen, chats)
CREATE TABLE person_relations (id, person_a_id, person_b_id, chat_id, co_occurrence_count, strength)
CREATE TABLE key_memories (id, person_id, chunk_id, content, relevance_score, timestamp)
```

**Pipeline:**
1. Na importação de chat, extrair senders únicos
2. Normalizar nomes (trim, capitalização)
3. Deduplicar aliases (Levenshtein ≤ 2)
4. Criar relações entre pessoas do mesmo chat
5. Calcular strength por co-occurrence dentro de chunks

**IPC handlers:**
- `persons:list` → todas as pessoas
- `persons:get(id)` → detalhe com foto, bio, tags, memórias
- `persons:relations` → todas as relações (para o grafo)
- `persons:updatePhoto(id, path)` → anexar foto
- `persons:updateBio(id, bio)` → editar bio
- `persons:updateTags(id, tags)` → editar tags

**Critérios de aceitação:**
- [ ] Importar chat cria pessoas automaticamente
- [ ] Pessoas deduplicadas (variações de nome agrupadas)
- [ ] Relações calculadas por co-occurrence
- [ ] Tela People mostra grafo real com dados do DB
- [ ] Painel de perfil funciona (foto, bio, tags, memórias-chave)
- [ ] Upload de foto local via diálogo Electron
- [ ] Zero dados mockados na People page

---

## [ ] TASK 4.2 — State Management (Zustand + TanStack Query)

**Objetivo:** Implementar state management global com Zustand para estado local + TanStack Query para async/cache de dados do IPC.

**Depende de:** TASK 2.5 ✅, TASK 3.3 ✅

**Contexto:**
- Zustand e TanStack Query já instalados — não utilizados
- Estado atualmente é local com useState em cada page
- React Router instalado (v7) — não utilizado (routing é state-based)

**Arquivos a criar:**
```
src/store/
├── useAppStore.ts        → Zustand: theme, currentPage, activeChatId, sidebarState
├── useChatStore.ts       → Zustand: selectedChat, chatFilters
└── useSearchStore.ts     → Zustand: lastQuery, searchHistory local

src/hooks/
├── useChats.ts           → TanStack Query: fetch/cache chats list
├── useSearch.ts          → TanStack Query: search with cache
├── useImport.ts          → TanStack Query mutation: import chat
├── useStats.ts           → TanStack Query: home page stats
└── usePersons.ts         → TanStack Query: people data
```

**Arquivos a modificar:**
- `src/App.tsx` → Migrar de useState para Zustand + adicionar QueryClientProvider
- Todas as pages → usar hooks em vez de props drilling

**Benefícios:**
- Cache automático de queries (não re-fetch se dados frescos)
- Loading/error states consistentes
- Invalidação automática (importar chat → sidebar atualiza)
- Navegação via store (sem prop drilling de `navigate`)

**Critérios de aceitação:**
- [ ] Zustand stores criados e funcionando
- [ ] TanStack Query wrapping todas as chamadas IPC
- [ ] QueryClient configurado com staleTime razoável
- [ ] Invalidação: importar chat → sidebar refresh automático
- [ ] Loading states via `isLoading` de TanStack Query
- [ ] Error states via `isError` de TanStack Query
- [ ] `navigate` via store (sem props)
- [ ] Zero prop drilling de `navigate` entre pages

---

## [ ] TASK 4.3 — UI Polish (Framer Motion + React Router + Onboarding)

**Objetivo:** Upgrade final de UX: animações com Framer Motion, routing com React Router, keyboard shortcuts, onboarding flow.

**Depende de:** TASK 4.2 ✅

**Contexto:**
- Framer Motion instalado — não utilizado
- React Router instalado — não utilizado (routing é state-based via App.tsx)
- Keyboard shortcuts planejados: Ctrl+K (search), Ctrl+I (import)
- Onboarding: first-run wizard que guia o user pelo primeiro import

**Mudanças:**

1. **React Router:**
   - Migrar de `switch/case` em App.tsx para `<Routes>`
   - Routes: `/`, `/import`, `/search`, `/chat/:id`, `/people`, `/settings`
   - Manter layout com Sidebar + TitleBar como wrapper

2. **Framer Motion:**
   - Page transitions (`AnimatePresence` + motion variants)
   - Sidebar hover/active states
   - Search results fade-in staggered
   - Streaming text character animation
   - Stat cards entrance animation (substituir CSS keyframes)

3. **Keyboard Shortcuts:**
   - `Ctrl+K` → Focus search
   - `Ctrl+I` → Open import
   - `Ctrl+,` → Settings
   - `Escape` → Close modals/go back

4. **Onboarding Flow:**
   - Detectar first-run (nenhum chat importado + modelos não baixados)
   - Step 1: Boas-vindas + explicação
   - Step 2: Download de modelos (com progress)
   - Step 3: Importar primeiro chat
   - Step 4: Fazer primeira busca

5. **Settings Page funcional:**
   - Conectar ao IPC real
   - Tema (light/dark/system)
   - GPU backend (auto/cuda/metal/vulkan/cpu)
   - Modelo LLM path customizado
   - Limpar cache / deletar dados

**Critérios de aceitação:**
- [ ] React Router com URLs corretas
- [ ] Page transitions suaves com Framer Motion
- [ ] Keyboard shortcuts funcionando
- [ ] Onboarding flow completo para primeiro uso
- [ ] Settings funcional (tema persiste, GPU config salva)
- [ ] CSS keyframes substituídos por Framer Motion onde aplicável
- [ ] Nenhuma animação causa jank/stutter

---

# FASE 5 — SHIP

> **Meta:** App pronto para distribuição. Installers, auto-update, testes.

---

## [ ] TASK 5.1 — Testes & Quality Assurance

**Objetivo:** Garantir qualidade mínima para release: testes unitários, testes de integração, fix de bugs.

**Depende de:** Todas as tasks anteriores ✅

**Escopo de testes:**

1. **Parser** — Testes unitários com fixtures de cada formato WhatsApp
2. **Chunking** — Validar janela de tempo, limite de tokens, overlap
3. **Repositories** — CRUD com DB real (in-memory SQLite para tests)
4. **EmbeddingService** — Validar dimensões, normalização
5. **SearchService** — Validar relevância (queries de teste com resultados esperados)
6. **RAGService** — E2E: pergunta → resposta (smoke test)
7. **IPC** — Verificar que todos os handlers respondem corretamente

**Setup de testes:**
```
npm install -D vitest
```

**Critérios de aceitação:**
- [ ] Parser: 100% dos formatos testados
- [ ] Chunking: edge cases cobertos (arquivo vazio, 1 msg, 100k msgs)
- [ ] Repositories: CRUD testado
- [ ] Search: queries de relevância passam
- [ ] Zero crashes em uso normal
- [ ] Memória dentro do budget (~600MB total)

---

## [ ] TASK 5.2 — Packaging & Installers

**Objetivo:** Empacotar o app com electron-builder para distribuição: .exe (Windows), .dmg (macOS), .AppImage (Linux).

**Depende de:** TASK 5.1 ✅

**Contexto:**
- `electron-builder.json5` já existe
- `electron-builder` já instalado como devDependency
- Config precisa lidar com módulos nativos (better-sqlite3, node-llama-cpp)

**Configuração principal:**
- NSIS installer para Windows
- DMG para macOS (Universal binary se possível)
- AppImage + deb para Linux
- Excluir models/ do bundle (baixados no first-run)
- Assinatura de código (opcional, mas recomendado)

**electron-builder.json5 a ajustar:**
```json5
{
  appId: "com.recall-ai.desktop",
  productName: "Recall.ai",
  directories: { output: "release" },
  files: ["dist/**/*", "dist-electron/**/*"],
  extraResources: [
    { from: "node_modules/better-sqlite3/build", to: "native/better-sqlite3" },
    // sqlite-vec e node-llama-cpp binaries
  ],
  win: { target: "nsis", icon: "build/icon.ico" },
  mac: { target: "dmg", icon: "build/icon.icns" },
  linux: { target: ["AppImage", "deb"], icon: "build/icon.png" },
}
```

**Critérios de aceitação:**
- [ ] `npm run build` gera installer para o OS atual
- [ ] Installer funciona (install → open → app roda)
- [ ] Módulos nativos funcionam no app empacotado
- [ ] Tamanho do installer < 150MB (sem modelos)
- [ ] Ícone do app aparece corretamente
- [ ] Desinstalar remove dados (ou pergunta)

---

## [ ] TASK 5.3 — Auto-Updater + Assets Finais

**Objetivo:** Configurar auto-update via GitHub Releases e criar assets finais (ícone, splash screen).

**Depende de:** TASK 5.2 ✅

**Contexto:**
- Usar `electron-updater` (já referenciado na TECH_SPEC)
- Updates via GitHub Releases (pode ser private repo)
- Assets: ícone de app, splash screen, screenshots para store

**Configuração:**
```typescript
import { autoUpdater } from 'electron-updater'

autoUpdater.checkForUpdatesAndNotify()
autoUpdater.on('update-available', () => { /* notify UI */ })
autoUpdater.on('update-downloaded', () => { /* prompt restart */ })
```

**Assets necessários:**
- Ícone: 1024x1024 PNG → gerar .ico (Windows), .icns (macOS)
- Tray icon: 16x16 e 32x32 (mono para macOS)
- Splash screen: design minimalista com logo + loading

**Critérios de aceitação:**
- [ ] Auto-updater configurado e conectado ao GitHub Releases
- [ ] Notificação de update disponível na UI
- [ ] Download de update em background
- [ ] Prompt para restart após download
- [ ] Ícone do app em todos os formatos
- [ ] Tray icon funcional
- [ ] README final atualizado com screenshots

---

# Progresso Global

| Fase | Tasks | Concluídas | Status |
|------|-------|-----------|--------|
| **Fase 1** — Database & Parser | 4 | 0 | ⬜ Não iniciada |
| **Fase 2** — Embedding & Search | 5 | 0 | ⬜ Não iniciada |
| **Fase 3** — LLM & RAG | 4 | 0 | ⬜ Não iniciada |
| **Fase 4** — Polish & Features | 3 | 0 | ⬜ Não iniciada |
| **Fase 5** — Ship | 3 | 0 | ⬜ Não iniciada |
| **TOTAL** | **19** | **0** | **0%** |

**Milestones:**
- [ ] **MVP 1** (após TASK 2.5) — Busca Semântica Funcional
- [ ] **MVP 2** (após TASK 3.4) — IA Desktop Funcional
- [ ] **v1.0** (após TASK 5.3) — Release
