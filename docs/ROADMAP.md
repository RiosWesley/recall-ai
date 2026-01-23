# Recall.ai — Roadmap de Desenvolvimento

> **Versão:** 1.0
> **Metodologia:** Iterativo com MVPs incrementais
> **Estimativa Total:** 12-16 semanas

---

## Visão Geral das Fases

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ROADMAP RECALL.AI                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  FASE 1          FASE 2          FASE 3          FASE 4                │
│  Foundation      AI Core         Polish          Expansion             │
│  (4 sem)         (4 sem)         (3 sem)         (2+ sem)              │
│                                                                         │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐             │
│  │ Parser  │    │Embedding│    │ Hybrid  │    │ Multi   │             │
│  │ Import  │───▶│ Search  │───▶│ Search  │───▶│  App    │             │
│  │ Storage │    │  LLM    │    │ Cache   │    │ Images  │             │
│  │   UI    │    │Streaming│    │  Perf   │    │ Sync    │             │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘             │
│                                                                         │
│      MVP 1          MVP 2          v1.0         v1.x+                  │
│   "Busca Básica" "IA Completa"  "Produção"    "Futuro"                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Fase 1: Foundation (4 semanas)

> **Objetivo:** MVP funcional com busca semântica (sem LLM)
> **Entregável:** Usuário pode importar chat e buscar por contexto

### Semana 1: Setup & Parser

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 1.1 | Setup Expo + TypeScript + estrutura de pastas | Alta | 4h |
| 1.2 | Configurar op-sqlite com schema inicial | Alta | 4h |
| 1.3 | Implementar WhatsAppParser (Android BR) | Alta | 8h |
| 1.4 | Adicionar suporte iOS EN ao parser | Alta | 4h |
| 1.5 | Testes unitários do parser | Alta | 4h |
| 1.6 | Tratamento de mensagens multilinha | Média | 4h |
| 1.7 | Detecção automática de formato | Média | 4h |

**Entregável:** Parser robusto que lê 95%+ dos exports WhatsApp

### Semana 2: Storage & Chunking

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 2.1 | Implementar ChatRepository | Alta | 4h |
| 2.2 | Implementar MessageRepository | Alta | 4h |
| 2.3 | Implementar ChunkRepository | Alta | 4h |
| 2.4 | Estratégia de chunking by_time_window | Alta | 6h |
| 2.5 | Estratégia de chunking by_message | Média | 3h |
| 2.6 | Configuração dinâmica de chunking | Média | 3h |
| 2.7 | Testes de chunking | Alta | 4h |

**Entregável:** Pipeline completo: arquivo → mensagens → chunks → banco

### Semana 3: Embedding Engine

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 3.1 | Integrar react-native-fast-tflite | Alta | 6h |
| 3.2 | Carregar modelo all-MiniLM-L6-v2 | Alta | 4h |
| 3.3 | Implementar EmbeddingService | Alta | 6h |
| 3.4 | Batch processing com progress | Alta | 4h |
| 3.5 | Serialização de vetores para SQLite | Alta | 4h |
| 3.6 | Implementar VectorSearch (cosine) | Alta | 4h |
| 3.7 | Testes de embedding e busca | Alta | 4h |

**Entregável:** Busca semântica funcionando

### Semana 4: UI Básica

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 4.1 | Tela Home (lista de chats) | Alta | 4h |
| 4.2 | Tela de Import com file picker | Alta | 6h |
| 4.3 | Progress bar de importação | Alta | 4h |
| 4.4 | Tela de Search com input | Alta | 6h |
| 4.5 | Exibição de resultados (chunks) | Alta | 4h |
| 4.6 | Navegação básica (Expo Router) | Alta | 4h |
| 4.7 | Testes em 3 dispositivos diferentes | Alta | 4h |

**Entregável:** MVP 1 completo - app usável para busca semântica

### Milestone: MVP 1 ✓

```
Critérios de Aceitação:
[x] Importar arquivo .txt do WhatsApp
[x] Ver lista de chats importados
[x] Buscar por contexto ("receita de bolo")
[x] Ver trechos originais da conversa
[x] Funcionar offline após importação
```

---

## Fase 2: AI Core (4 semanas)

> **Objetivo:** Integrar LLM para respostas em linguagem natural
> **Entregável:** Usuário recebe respostas geradas por IA

### Semana 5: LLM Integration

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 5.1 | Pesquisar integração LiteRT-LM no RN | Alta | 8h |
| 5.2 | Criar módulo nativo (se necessário) | Alta | 8h |
| 5.3 | Carregar Gemma 270M INT4 | Alta | 6h |
| 5.4 | Implementar LLMService básico | Alta | 6h |
| 5.5 | Testar geração de texto simples | Alta | 4h |

**Entregável:** LLM rodando no device

### Semana 6: RAG Pipeline

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 6.1 | Implementar RAGService | Alta | 6h |
| 6.2 | Construir prompt template otimizado | Alta | 4h |
| 6.3 | Integrar busca → contexto → LLM | Alta | 6h |
| 6.4 | Implementar streaming de tokens | Alta | 6h |
| 6.5 | Componente StreamingText na UI | Alta | 4h |
| 6.6 | Tratamento de erros e fallbacks | Alta | 4h |
| 6.7 | Testes do pipeline completo | Alta | 4h |

**Entregável:** Fluxo RAG completo funcionando

### Semana 7: Device Optimization

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 7.1 | Implementar detecção de device tier | Alta | 4h |
| 7.2 | Configurações dinâmicas por tier | Alta | 6h |
| 7.3 | Testar GPU delegate (Android) | Média | 4h |
| 7.4 | Testar Metal delegate (iOS) | Média | 4h |
| 7.5 | Memory manager para modelos | Alta | 6h |
| 7.6 | Monitoramento térmico básico | Média | 4h |
| 7.7 | Fallback para search-only (Tier 4) | Alta | 4h |

**Entregável:** App funciona bem em todos os tiers

### Semana 8: UX Polish

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 8.1 | Redesign da tela de busca | Alta | 6h |
| 8.2 | Animações com Reanimated | Média | 4h |
| 8.3 | Loading states elegantes | Alta | 4h |
| 8.4 | Exibir contexto usado na resposta | Alta | 4h |
| 8.5 | Histórico de buscas | Média | 4h |
| 8.6 | Tela de Settings básica | Média | 4h |
| 8.7 | Testes de usabilidade (5 pessoas) | Alta | 6h |

**Entregável:** MVP 2 completo - app com IA

### Milestone: MVP 2 ✓

```
Critérios de Aceitação:
[x] Fazer pergunta em linguagem natural
[x] Receber resposta gerada por IA
[x] Ver streaming de texto (efeito digitação)
[x] Ver chunks usados como fonte
[x] Funcionar em devices Tier 1, 2 e 3
[x] Fallback gracioso em Tier 4
```

---

## Fase 3: Polish (3 semanas)

> **Objetivo:** Qualidade de produção
> **Entregável:** App pronto para lançamento

### Semana 9: Performance & Cache

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 9.1 | Implementar cache de queries | Alta | 6h |
| 9.2 | Cache de embeddings de queries | Alta | 4h |
| 9.3 | Otimizar cold start do LLM | Alta | 6h |
| 9.4 | Lazy loading de modelos | Alta | 4h |
| 9.5 | Profiling de memória | Alta | 4h |
| 9.6 | Profiling de CPU/bateria | Alta | 4h |
| 9.7 | Otimizações identificadas | Alta | 6h |

**Entregável:** Performance otimizada

### Semana 10: Busca Híbrida & Features

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 10.1 | Implementar busca por keyword (BM25) | Alta | 6h |
| 10.2 | Combinar semântica + keyword | Alta | 4h |
| 10.3 | Filtro por contato/data | Média | 4h |
| 10.4 | Sugestões de busca | Média | 4h |
| 10.5 | Exportar/deletar chats | Média | 4h |
| 10.6 | Tela de estatísticas do chat | Baixa | 4h |
| 10.7 | Onboarding flow | Alta | 6h |

**Entregável:** Features completas para v1.0

### Semana 11: Quality & Launch Prep

| Task | Descrição | Prioridade | Estimativa |
|------|-----------|------------|------------|
| 11.1 | Testes em 10+ dispositivos | Alta | 8h |
| 11.2 | Fix de bugs encontrados | Alta | 8h |
| 11.3 | Testes de edge cases | Alta | 4h |
| 11.4 | Preparar assets (ícone, splash) | Alta | 4h |
| 11.5 | Escrever README e docs finais | Média | 4h |
| 11.6 | Screenshots e vídeo demo | Média | 4h |
| 11.7 | Setup de build para stores | Alta | 4h |

**Entregável:** v1.0 pronta para lançamento

### Milestone: v1.0 ✓

```
Critérios de Aceitação:
[x] Busca híbrida funcionando
[x] Performance aceitável em todos os tiers
[x] Zero crashes em uso normal
[x] Onboarding claro
[x] UI polida e responsiva
[x] Documentação completa
[x] Builds para iOS e Android
```

---

## Fase 4: Expansion (Futuro)

> **Objetivo:** Features adicionais pós-lançamento
> **Timeline:** Contínuo

### v1.1 - Multi-App Support (2 semanas)

| Task | Descrição |
|------|-----------|
| Parser para Telegram (JSON) | |
| Parser para Instagram DMs (JSON) | |
| UI para selecionar fonte | |
| Ícones por plataforma | |

### v1.2 - Image Search (3 semanas)

| Task | Descrição |
|------|-----------|
| Integrar MobileCLIP | |
| Embeddings de imagens | |
| Busca "foto do restaurante" | |
| Thumbnail cache | |

### v1.3 - Smart Features (2 semanas)

| Task | Descrição |
|------|-----------|
| Resumos de conversa | |
| Timeline de eventos | |
| Extração de contatos/datas | |
| Lembretes baseados em contexto | |

### v2.0 - Sync & Collaboration (4+ semanas)

| Task | Descrição |
|------|-----------|
| E2E encrypted sync | |
| Multi-device | |
| Backup na nuvem | |

---

## Métricas de Sucesso

### Performance Targets

| Métrica | Target | Aceitável |
|---------|--------|-----------|
| Importação (10k msgs) | < 30s | < 60s |
| Embedding por chunk | < 100ms | < 200ms |
| Busca vetorial (50k) | < 50ms | < 100ms |
| LLM primeiro token | < 2s | < 4s |
| LLM tokens/s (Tier 2) | > 10 | > 5 |
| Memória total | < 400MB | < 600MB |

### Quality Targets

| Métrica | Target |
|---------|--------|
| Crash rate | < 0.1% |
| ANR rate (Android) | < 0.1% |
| Relevância da busca | > 80% (subjetivo) |
| User satisfaction | > 4.0/5.0 |

---

## Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| LiteRT não ter bindings RN | Média | Alto | Criar módulo nativo próprio |
| Gemma 270M muito lento | Baixa | Médio | Fallback para search-only |
| Parsing falhar em formatos novos | Alta | Baixo | Sistema de feedback de usuário |
| Memória insuficiente em devices | Média | Médio | Tiers + degradação graciosa |
| Apple rejeitar app | Baixa | Alto | Seguir guidelines, testar bem |

---

## Checkpoints de Revisão

| Data | Checkpoint | Decisão |
|------|------------|---------|
| Fim Semana 2 | Parser funciona? | Go/No-Go para Fase 1 |
| Fim Semana 4 | MVP 1 usável? | Review com usuários |
| Fim Semana 6 | LLM roda no device? | Go/No-Go para RAG |
| Fim Semana 8 | MVP 2 funciona? | Review com usuários |
| Fim Semana 11 | Qualidade OK? | Go/No-Go para launch |
