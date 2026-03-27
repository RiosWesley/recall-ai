# Recall.ai

> **Desktop-First Offline RAG** — Busca semântica e IA generativa 100% local para conversas de mensageiros.

[![Status](https://img.shields.io/badge/status-em%20desenvolvimento-yellow)]()
[![Stack](https://img.shields.io/badge/stack-Electron%20%7C%20React%20%7C%20node--llama--cpp-blue)]()
[![Privacy](https://img.shields.io/badge/privacy-100%25%20offline-green)]()
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()

---

## O Problema

Você já tentou encontrar "aquela mensagem" no WhatsApp? A busca nativa é limitada a palavras-chave exatas. Se você lembra do contexto ("aquela receita que a Maria mandou") mas não das palavras exatas, está perdido.

## A Solução

O Recall.ai usa **busca semântica** (entende significado, não apenas palavras) combinada com **IA generativa local** para:

- Encontrar mensagens por contexto e significado
- Responder perguntas sobre suas conversas
- Funcionar 100% offline, sem enviar dados para nuvem
- Rodar inteiramente no seu computador (Windows, macOS ou Linux)

> **Roadmap:** A v1.0 é uma aplicação **desktop (Electron)**. A v2.0 trará suporte **mobile** via React Native.

---

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [Arquitetura (SDD)](./docs/ARCHITECTURE.md) | Visão técnica completa do sistema desktop |
| [Especificações Técnicas](./specs/TECH_SPEC.md) | Stack, modelos, e decisões técnicas |
| [Requisitos de Sistema](./specs/SYSTEM_REQUIREMENTS.md) | Requisitos de hardware e compatibilidade |
| [Roadmap](./docs/ROADMAP.md) | Fases de desenvolvimento detalhadas |
| [Pesquisa: Parsing](./research/WHATSAPP_PARSING.md) | Análise do formato de exportação WhatsApp |
| [Pesquisa: Modelos](./research/MODEL_BENCHMARKS.md) | Benchmarks de modelos on-device |

---

## Quick Start (Desenvolvimento)

```bash
# Clone
git clone https://github.com/seu-usuario/recall-ai.git
cd recall-ai

# Instale dependências
npm install

# Execute em modo de desenvolvimento
npm run dev

# Build para produção
npm run build
```

> **Nota:** Na primeira execução, o app fará download dos modelos de IA (~200MB). Após isso, funciona 100% offline.

---

## Stack Principal

```
┌─────────────────────────────────────────────────────────────┐
│                       RECALL.AI v1.0                         │
├─────────────────────────────────────────────────────────────┤
│  Shell             │ Electron 33+                            │
│  Frontend          │ React 19 + TypeScript                   │
│  Build             │ electron-vite                            │
│  UI Components     │ Shadcn UI (Radix + Tailwind)            │
│  Estado            │ Zustand + TanStack Query                │
│  Database          │ better-sqlite3 + sqlite-vec + FTS5      │
│  ML Runtime        │ node-llama-cpp (GGUF)                   │
│  Embedding         │ all-MiniLM-L6-v2 (~25MB)               │
│  LLM              │ Gemma 3 270M INT4 (~150MB)              │
└─────────────────────────────────────────────────────────────┘
```

---

## Princípios de Design

1. **Privacy by Design** — Dados nunca saem do computador do usuário
2. **Offline First** — Funciona sem internet após download inicial dos modelos
3. **Desktop First** — Aproveita o poder de hardware do desktop para IA de qualidade
4. **Graceful Degradation** — Fallbacks inteligentes conforme hardware disponível

---

## Versões Planejadas

| Versão | Plataforma | Status |
|--------|-----------|--------|
| v1.0 | Desktop (Electron) — Windows, macOS, Linux | 🟡 Em desenvolvimento |
| v2.0 | Mobile (React Native) — Android, iOS | 🔵 Planejado |

---

## Licença

MIT License — Veja [LICENSE](./LICENSE) para detalhes.

---

<p align="center">
  <i>Feito com foco em privacidade e performance.</i>
</p>
