# Recall.ai — Roadmap de Desenvolvimento

> **Versão:** 2.0 (Desktop-First)
> **Metodologia:** Iterativo com MVPs incrementais
> **Estimativa v1.0 Desktop:** 11-14 semanas
> **Estimativa v2.0 Mobile:** 8-10 semanas adicionais

---

## Visão Geral das Fases

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          ROADMAP RECALL.AI                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ── v1.0 DESKTOP (ELECTRON) ──────────────────────────────────────────────  │
│                                                                              │
│  FASE 1          FASE 2          FASE 3          FASE 4                     │
│  Foundation      AI Core         Polish          Expansion                  │
│  (4 sem)         (4 sem)         (3 sem)         (2+ sem)                   │
│                                                                              │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐                  │
│  │ Electron│    │  LLM    │    │ Hybrid  │    │ Multi   │                  │
│  │ Parser  │───▶│Embedding│───▶│ Search  │───▶│  App    │                  │
│  │ SQLite  │    │   RAG   │    │ Cache   │    │ Images  │                  │
│  │   UI    │    │Streaming│    │  Ship   │    │ Smart   │                  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘                  │
│                                                                              │
│      MVP 1          MVP 2          v1.0         v1.x+                       │
│   "Busca Local"  "IA Desktop"   "Produção"    "Futuro"                      │
│                                                                              │
│  ── v2.0 MOBILE (REACT NATIVE) ──────────────────────────────────────────  │
│                                                                              │
│  FASE 5                                                                      │
│  Mobile Port                                                                 │
│  (8-10 sem)                                                                  │
│                                                                              │
│  ┌─────────┐                                                                │
│  │ React   │                                                                │
│  │ Native  │                                                                │
│  │ LiteRT  │                                                                │
│  │ Mobile  │                                                                │
│  └─────────┘                                                                │
│                                                                              │
│      v2.0                                                                    │
│   "Mobile App"                                                               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Fase 1: Foundation Desktop (4 semanas)

> **Objetivo:** MVP funcional com busca semântica no desktop (sem LLM)
> **Entregável:** Usuário pode importar chat via drag & drop e buscar por contexto

### Semana 1: Setup & Infraestrutura Electron

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 1.1 | Setup Electron + electron-vite + TypeScript | Alta | 4h |
| 1.2 | Configurar estrutura main/preload/renderer | Alta | 3h |
| 1.3 | Configurar better-sqlite3 com schema inicial | Alta | 4h |
| 1.4 | Integrar sqlite-vec (extensão de vetores) | Alta | 4h |
| 1.5 | Configurar FTS5 para busca textual | Alta | 3h |
| 1.6 | Implementar contextBridge (IPC seguro) | Alta | 4h |
| 1.7 | Configurar electron-builder (Win/Mac/Linux) | Média | 4h |
| 1.8 | Custom titlebar + window controls | Média | 3h |

**Entregável:** Skeleton Electron funcional com DB configurado

### Semana 2: Parser & Storage

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 2.1 | Implementar WhatsAppParser (Node.js fs) — Android BR | Alta | 6h |
| 2.2 | Adicionar suporte iOS EN ao parser | Alta | 4h |
| 2.3 | Implementar DropZone (drag & drop .txt/.zip) | Alta | 4h |
| 2.4 | Implementar ChatRepository | Alta | 3h |
| 2.5 | Implementar MessageRepository | Alta | 3h |
| 2.6 | Implementar ChunkRepository | Alta | 3h |
| 2.7 | Estratégia de chunking by_time_window | Alta | 5h |
| 2.8 | Testes unitários do parser | Alta | 4h |
| 2.9 | Detecção automática de formato | Média | 4h |

**Entregável:** Pipeline: arquivo → mensagens → chunks → SQLite

### Semana 3: Embedding Engine

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 3.1 | Integrar node-llama-cpp para embeddings | Alta | 6h |
| 3.2 | Carregar modelo all-MiniLM-L6-v2 (GGUF) | Alta | 4h |
| 3.3 | Implementar EmbeddingService | Alta | 5h |
| 3.4 | Batch processing com IPC progress callbacks | Alta | 4h |
| 3.5 | Armazenar embeddings via sqlite-vec | Alta | 4h |
| 3.6 | Implementar VectorSearch (KNN via sqlite-vec) | Alta | 4h |
| 3.7 | Testes de embedding e busca | Alta | 4h |

**Entregável:** Busca semântica funcionando no desktop

### Semana 4: UI Core

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 4.1 | Design System com Shadcn UI + Tailwind | Alta | 4h |
| 4.2 | Sidebar com lista de chats importados | Alta | 5h |
| 4.3 | Página de Import (drag & drop + progress) | Alta | 5h |
| 4.4 | Página de Search com input semântico | Alta | 5h |
| 4.5 | Exibição de resultados (chunks com highlight) | Alta | 4h |
| 4.6 | Dark mode premium | Alta | 4h |
| 4.7 | Teste de integração end-to-end | Alta | 4h |

**Entregável:** MVP 1 — App desktop usável para busca semântica

### Milestone: MVP 1 ✓

```
Critérios de Aceitação:
[ ] Importar arquivo .txt/.zip do WhatsApp via drag & drop
[ ] Ver lista de chats importados na sidebar
[ ] Buscar por contexto ("receita de bolo")
[ ] Ver trechos originais da conversa como resultado
[ ] Funcionar offline após download dos modelos
[ ] Rodar em Windows 10+
```

---

## Fase 2: AI Core Desktop (4 semanas)

> **Objetivo:** Integrar LLM para respostas em linguagem natural
> **Entregável:** Usuário recebe respostas geradas por IA com streaming

### Semana 5: LLM Integration

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 5.1 | Carregar Gemma 3 270M INT4 via node-llama-cpp | Alta | 6h |
| 5.2 | Implementar LLMService (Utility Process) | Alta | 6h |
| 5.3 | Testar geração de texto simples | Alta | 3h |
| 5.4 | Implementar streaming de tokens via IPC | Alta | 6h |
| 5.5 | Memory management (load/unload modelos) | Alta | 4h |
| 5.6 | Download manager para modelos (first-run) | Alta | 6h |

**Entregável:** LLM rodando nativamente no desktop com download automático

### Semana 6: RAG Pipeline

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 6.1 | Implementar RAGService (orquestrador) | Alta | 6h |
| 6.2 | Construir prompt template otimizado | Alta | 4h |
| 6.3 | Integrar busca → contexto → LLM | Alta | 5h |
| 6.4 | Componente StreamingText na UI | Alta | 4h |
| 6.5 | Exibir chunks usados como fonte (citations) | Alta | 4h |
| 6.6 | Tratamento de erros e fallbacks | Alta | 4h |
| 6.7 | Testes do pipeline RAG completo | Alta | 4h |

**Entregável:** Fluxo RAG: pergunta → busca → contexto → IA → resposta

### Semana 7: GPU Acceleration & Optimization

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 7.1 | Implementar GPU auto-detection | Alta | 4h |
| 7.2 | Testar aceleração CUDA (NVIDIA) | Alta | 4h |
| 7.3 | Testar aceleração Metal (macOS) | Alta | 4h |
| 7.4 | Testar aceleração Vulkan (AMD/Intel) | Média | 4h |
| 7.5 | CPU SIMD fallback otimizado | Alta | 3h |
| 7.6 | UI: Mostrar hardware detectado + performance | Média | 3h |
| 7.7 | Benchmark automático no first-run | Média | 4h |

**Entregável:** Aceleração GPU transparente e automática

### Semana 8: UX Polish

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 8.1 | Redesign da interface (UI premium, bespoke) | Alta | 8h |
| 8.2 | Micro-animações com Framer Motion | Alta | 4h |
| 8.3 | Conversation view (estilo chat com IA) | Alta | 5h |
| 8.4 | Histórico de queries (sidebar) | Média | 3h |
| 8.5 | Settings page (modelo, GPU, tema) | Média | 4h |
| 8.6 | Keyboard shortcuts (Ctrl+K search, etc) | Média | 3h |
| 8.7 | Onboarding flow (first-run wizard) | Alta | 4h |

**Entregável:** MVP 2 — App desktop com IA completa e UI premium

### Milestone: MVP 2 ✓

```
Critérios de Aceitação:
[ ] Fazer pergunta em linguagem natural
[ ] Receber resposta gerada por IA com streaming
[ ] Ver chunks usados como fonte da resposta
[ ] GPU detectada e utilizada automaticamente (quando disponível)
[ ] Download de modelos no first-run funcional
[ ] Keyboard shortcuts funcionando
[ ] Dark mode polido
```

---

## Fase 3: Polish & Ship (3 semanas)

> **Objetivo:** Qualidade de produção para release
> **Entregável:** App pronto para distribuição

### Semana 9: Performance & Cache

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 9.1 | Implementar cache de queries (SQLite) | Alta | 5h |
| 9.2 | Cache de embeddings de queries frequentes | Alta | 4h |
| 9.3 | Otimizar cold start do LLM (lazy loading) | Alta | 5h |
| 9.4 | Profiling de memória | Alta | 4h |
| 9.5 | Profiling de CPU/GPU | Alta | 4h |
| 9.6 | Otimizar tamanho do bundle Electron | Média | 4h |
| 9.7 | Aplicar otimizações identificadas | Alta | 5h |

**Entregável:** Performance otimizada

### Semana 10: Busca Híbrida & Features

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 10.1 | Busca híbrida: sqlite-vec + FTS5 | Alta | 6h |
| 10.2 | Filtro por contato/data/chat | Média | 4h |
| 10.3 | Sugestões de busca (autocomplete) | Média | 4h |
| 10.4 | Exportar/deletar chats | Média | 3h |
| 10.5 | Estatísticas do chat (analytics) | Baixa | 4h |
| 10.6 | Tray icon + quick search (global shortcut) | Média | 4h |
| 10.7 | Onboarding flow completo | Alta | 4h |

**Entregável:** Features completas para v1.0

### Semana 11: Quality & Release

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 11.1 | Testes Windows 10/11 | Alta | 4h |
| 11.2 | Testes macOS (Intel + Apple Silicon) | Alta | 4h |
| 11.3 | Testes Linux (Ubuntu, Fedora) | Média | 4h |
| 11.4 | Fix de bugs encontrados | Alta | 8h |
| 11.5 | Auto-updater (electron-updater) | Alta | 4h |
| 11.6 | Installers: .exe (NSIS), .dmg, .AppImage | Alta | 4h |
| 11.7 | Assets finais (ícone, splash, screenshots) | Alta | 4h |
| 11.8 | README e documentação final | Média | 3h |

**Entregável:** v1.0 pronta para distribuição

### Milestone: v1.0 ✓

```
Critérios de Aceitação:
[ ] Busca híbrida (semântica + keyword) funcionando
[ ] Performance aceitável em CPU-only
[ ] Zero crashes em uso normal
[ ] Onboarding claro para primeiro uso
[ ] UI polida, responsiva, dark mode
[ ] Documentação completa
[ ] Installers para Windows, macOS, Linux
[ ] Auto-updater configurado
```

---

## Fase 4: Expansion Desktop (Futuro)

> **Objetivo:** Features adicionais pós-lançamento
> **Timeline:** Contínuo

### v1.1 — Multi-App Support (2 semanas)

| Task | Descrição |
|------|-----------|
| Parser para Telegram (JSON export) | |
| Parser para Instagram DMs (JSON) | |
| UI para selecionar fonte no import | |
| Ícones por plataforma de origem | |

### v1.2 — Image Search (3 semanas)

| Task | Descrição |
|------|-----------|
| Integrar CLIP via node-llama-cpp | |
| Embeddings de imagens locais | |
| Busca "foto do restaurante" | |
| Thumbnail preview nos resultados | |

### v1.3 — People Graph (3 semanas)

> **Objetivo:** Transformar o Recall.ai de motor de busca em **memória digital relacional**. O grafo de pessoas é a feature mais diferenciadora do produto.

| Task | Descrição |
|------|-----------|
| Extração de pessoas via senders (Parser → Person entities) | Semana 1 |
| Deduplicação de aliases por similaridade de string | Semana 1 |
| Schema SQLite: persons, person_relations, key_memories | Semana 1 |
| IPC handlers: getPersons, getPersonRelations, getKeyMemories | Semana 1 |
| Cálculo de força de relação por co-occurrence | Semana 1 |
| Tela People (grafo SVG interativo) | Semana 2 |
| Painel de perfil: foto, bio, tags, memórias-chave | Semana 2 |
| Upload de foto local via diálogo Electron | Semana 2 |
| NER via LLM: extração de pessoas mencionadas nos chunks | Semana 3 |
| Merge NER entities com sender-based persons | Semana 3 |
| Key memories: ranquear chunks por relevância por pessoa | Semana 3 |
| Filtros no grafo: por chat, por tag, por período | Semana 3 |

### v1.4 — Smart Features (2 semanas)

| Task | Descrição |
|------|-----------|
| Resumos automáticos de conversa | |
| Timeline de eventos mencionados | |
| Extração de contatos/datas/links | |
| Exportação de relatórios | |

---

## v2.0 — Mobile (React Native) 🔮

> **Pré-requisito:** v1.x desktop estável e validada com usuários reais.
> **Estimativa:** 8-10 semanas

### Fase 5: Port para Mobile

| Task | Descrição | Estimativa |
|------|-----------|------------|
| Setup React Native (Expo SDK 52+) | Projeto mobile | 1 semana |
| Portar shared/ types e constants | Reutilizar tipos | 2 dias |
| Adaptar parser para expo-file-system | FS sandboxed mobile | 3 dias |
| Substituir better-sqlite3 → op-sqlite | DB mobile (JSI) | 1 semana |
| Substituir node-llama-cpp → LiteRT | ML runtime mobile | 2 semanas |
| Manter Gemma 3 270M (já otimizado) | Mesmo modelo | 3 dias |
| Implementar sistema de tiers mobile | Compatibilidade devices | 1 semana |
| Adaptar UI para touch + responsivo | UX mobile nativo | 2 semanas |
| Gerenciamento de memória/bateria | Otimização mobile | 1 semana |
| Testes em dispositivos reais | QA mobile | 1 semana |

### Milestone: v2.0 ✓

```
Critérios de Aceitação:
[ ] App mobile funcional em Android e iOS
[ ] Busca semântica offline no dispositivo
[ ] IA generativa rodando on-device (Tier 1-3)
[ ] Fallback para search-only (Tier 4)
[ ] Performance aceitável em smartphones 2020+
[ ] Publicação em Play Store e App Store
```

---

## Métricas de Sucesso

### Performance Targets (Desktop v1.0)

| Métrica | Target | Aceitável |
|---------|--------|-----------|
| Importação (10k msgs) | < 5s | < 15s |
| Embedding por chunk | < 30ms | < 80ms |
| Busca vetorial (50k) | < 10ms | < 30ms |
| LLM primeiro token (CPU) | < 1s | < 3s |
| LLM primeiro token (GPU) | < 500ms | < 1s |
| LLM tokens/s (CPU) | > 15 | > 8 |
| LLM tokens/s (GPU) | > 30 | > 15 |
| Memória total | < 1GB | < 2GB |
| Cold start do app | < 3s | < 5s |

### Quality Targets

| Métrica | Target |
|---------|--------|
| Crash rate | < 0.1% |
| Relevância da busca | > 80% (subjetivo) |
| User satisfaction | > 4.0/5.0 |
| Tamanho do installer | < 150MB (sem modelos) |

---

## Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| node-llama-cpp instável em Windows | Baixa | Alto | Pre-built binaries, testes extensivos |
| Gemma 270M qualidade insuficiente | Média | Médio | Prompt engineering, fallback search-only |
| sqlite-vec incompatível com Electron | Baixa | Alto | Fallback para cosine similarity manual |
| Electron bundle muito grande | Média | Baixo | Tree-shaking, compressão, lazy loading |
| GPU detection falhar | Média | Baixo | CPU sempre funciona como fallback |
| Download de modelos falhar | Média | Médio | Retry logic, mirrors, verificação de hash |

---

## Checkpoints de Revisão

| Data | Checkpoint | Decisão |
|------|------------|---------|
| Fim Semana 2 | Parser + DB funcionando? | Go/No-Go Fase 1 |
| Fim Semana 4 | MVP 1 usável? | Review com usuários |
| Fim Semana 6 | LLM + RAG funcionando? | Go/No-Go para polish |
| Fim Semana 8 | MVP 2 completo? | Review com usuários |
| Fim Semana 11 | Qualidade para release? | Go/No-Go para v1.0 |
| Pós v1.0 | Feedback de usuários | Decidir timeline v2.0 mobile |
