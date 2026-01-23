# Recall.ai

> **Mobile-First Offline RAG** — Busca semântica e IA generativa 100% on-device para conversas de mensageiros.

[![Status](https://img.shields.io/badge/status-em%20desenvolvimento-yellow)]()
[![Stack](https://img.shields.io/badge/stack-React%20Native%20%7C%20LiteRT%20%7C%20Gemma-blue)]()
[![Privacy](https://img.shields.io/badge/privacy-100%25%20offline-green)]()

---

## O Problema

Você já tentou encontrar "aquela mensagem" no WhatsApp? A busca nativa é limitada a palavras-chave exatas. Se você lembra do contexto ("aquela receita que a Maria mandou") mas não das palavras exatas, está perdido.

## A Solução

O Recall.ai usa **busca semântica** (entende significado, não apenas palavras) combinada com **IA generativa local** para:

- Encontrar mensagens por contexto e significado
- Responder perguntas sobre suas conversas
- Funcionar 100% offline, sem enviar dados para nuvem

---

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [Arquitetura (SDD)](./docs/ARCHITECTURE.md) | Visão técnica completa do sistema |
| [Especificações Técnicas](./specs/TECH_SPEC.md) | Stack, modelos, e decisões técnicas |
| [Compatibilidade](./specs/DEVICE_COMPATIBILITY.md) | Requisitos e otimizações por dispositivo |
| [Roadmap](./docs/ROADMAP.md) | Fases de desenvolvimento detalhadas |
| [Pesquisa: Parsing](./research/WHATSAPP_PARSING.md) | Análise do formato de exportação |
| [Pesquisa: Modelos](./research/MODEL_BENCHMARKS.md) | Benchmarks de modelos on-device |

---

## Quick Start (Desenvolvimento)

```bash
# Clone
git clone https://github.com/seu-usuario/recall-ai.git
cd recall-ai

# Instale dependências
npm install

# Baixe os modelos (após setup inicial)
npm run download-models

# Execute
npm run start
```

---

## Stack Principal

```
┌─────────────────────────────────────────────────────┐
│                    RECALL.AI                        │
├─────────────────────────────────────────────────────┤
│  Frontend        │ React Native (Expo) + TypeScript │
│  Estado          │ Zustand + React Query            │
│  Database        │ op-sqlite (JSI bindings)         │
│  Vector Search   │ Cosine Similarity (otimizado)    │
│  ML Runtime      │ Google LiteRT                    │
│  Embedding       │ all-MiniLM-L6-v2 (~25MB)         │
│  LLM             │ Gemma 3 270M INT4 (~150MB)       │
└─────────────────────────────────────────────────────┘
```

---

## Princípios de Design

1. **Privacy by Design** — Dados nunca saem do dispositivo
2. **Offline First** — Funciona sem internet após setup
3. **Device Agnostic** — Roda em 80%+ dos smartphones (2020+)
4. **Graceful Degradation** — Fallbacks inteligentes para devices fracos

---

## Licença

MIT License — Veja [LICENSE](./LICENSE) para detalhes.

---

<p align="center">
  <i>Feito com foco em privacidade e performance.</i>
</p>
