# Recall.ai — Documento de Arquitetura de Software (SDD)

> **Versão:** 2.0
> **Status:** Em Desenvolvimento
> **Última Atualização:** Janeiro 2026

---

## 1. Visão Geral

### 1.1 Propósito

O Recall.ai é uma aplicação móvel que resolve o problema da "amnésia digital" em aplicativos de mensagem. Utiliza **Retrieval-Augmented Generation (RAG)** executado inteiramente no dispositivo do usuário.

### 1.2 Escopo

| Incluso | Não Incluso (v1) |
|---------|------------------|
| Importação de chats WhatsApp (.txt) | Integração direta com APIs |
| Busca semântica por contexto | Sincronização entre dispositivos |
| Respostas geradas por IA local | Suporte a áudio/vídeo |
| Funcionamento 100% offline | Outros mensageiros |

### 1.3 Definições e Acrônimos

| Termo | Definição |
|-------|-----------|
| **RAG** | Retrieval-Augmented Generation — técnica que combina busca + geração |
| **Embedding** | Representação vetorial de texto (array de números) |
| **LLM** | Large Language Model — modelo de linguagem generativo |
| **Chunking** | Processo de dividir texto em fragmentos menores |
| **Quantização** | Técnica de compressão de modelos (ex: Float32 → Int4) |
| **JSI** | JavaScript Interface — bridge nativa de alta performance no RN |
| **NPU** | Neural Processing Unit — chip dedicado para IA |

---

## 2. Arquitetura de Alto Nível

### 2.1 Diagrama do Sistema

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RECALL.AI - ARQUITETURA                     │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────────────────┐
│   USUÁRIO    │     │  INTERFACE   │     │      DATA LAYER          │
│              │     │   (React)    │     │                          │
│  ┌────────┐  │     │ ┌──────────┐ │     │  ┌────────────────────┐  │
│  │ Query  │──┼────▶│ │ ChatView │ │     │  │     op-sqlite      │  │
│  └────────┘  │     │ └──────────┘ │     │  │  ┌──────────────┐  │  │
│              │     │      │       │     │  │  │   messages   │  │  │
│  ┌────────┐  │     │      ▼       │     │  │  │   vectors    │  │  │
│  │ Import │──┼────▶│ ┌──────────┐ │     │  │  │   metadata   │  │  │
│  │  .txt  │  │     │ │ Importer │ │     │  │  └──────────────┘  │  │
│  └────────┘  │     │ └──────────┘ │     │  └────────────────────┘  │
└──────────────┘     └──────┬───────┘     └────────────┬─────────────┘
                           │                          │
                           ▼                          │
┌──────────────────────────────────────────────────────┼─────────────┐
│                      AI ENGINE (LiteRT)              │             │
│                                                      │             │
│  ┌─────────────────┐    ┌─────────────────┐         │             │
│  │   RETRIEVER     │    │    GENERATOR    │         │             │
│  │                 │    │                 │         │             │
│  │ all-MiniLM-L6   │    │  Gemma 3 270M   │◀────────┘             │
│  │    (~25MB)      │    │   INT4 (~150MB) │                       │
│  │                 │    │                 │                       │
│  │ texto → vetor   │    │ contexto → resp │                       │
│  └────────┬────────┘    └────────▲────────┘                       │
│           │                      │                                │
│           │   ┌──────────────┐   │                                │
│           └──▶│ Vector Search│───┘                                │
│               │ (Top-K + CosSim)                                  │
│               └──────────────┘                                    │
└───────────────────────────────────────────────────────────────────┘

                    EXECUÇÃO POR CAMADA DE HARDWARE
┌───────────────────────────────────────────────────────────────────┐
│  Prioridade: CPU (SIMD otimizado) → GPU → NPU (quando disponível)│
│  NOTA: CPU é o fallback principal para máxima compatibilidade    │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 Fluxo de Dados Principal

```
INGESTÃO (uma vez por chat):
───────────────────────────────────────────────────────────────────
arquivo.txt → Parser → Chunks → Embedding Model → Vetores → SQLite


CONSULTA (cada pergunta):
───────────────────────────────────────────────────────────────────
Pergunta → Embedding → Busca Vetorial → Top-K Chunks → LLM → Resposta
              │              │                │            │
           ~50ms          ~20ms           ~100ms      ~2-8s (streaming)
```

---

## 3. Componentes Detalhados

### 3.1 Parser de Chat

**Responsabilidade:** Converter arquivo .txt exportado do WhatsApp em estrutura de dados normalizada.

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

**Modelo:** `all-MiniLM-L6-v2`

| Especificação | Valor |
|---------------|-------|
| Tamanho | ~25MB (quantizado) |
| Dimensão do vetor | 384 |
| Max tokens input | 256 |
| Latência média | 30-80ms (CPU) |

---

### 3.4 Vector Search

**Algoritmo:** Cosine Similarity com busca linear otimizada.

**Por que busca linear?**
- Datasets típicos: 10k-50k vetores
- Latência: 20-50ms (aceitável)
- Sem overhead de indexação
- Simplicidade de implementação em RN

---

### 3.5 Generator (LLM)

**Modelo:** Gemma 3 270M (INT4 Quantizado)

| Especificação | Valor |
|---------------|-------|
| Parâmetros | 270M (170M embed + 100M transformer) |
| Tamanho (INT4) | ~150MB |
| Vocabulário | 256K tokens |
| Contexto máximo | 32K tokens |
| Latência primeiro token | 500ms-3s (CPU) |
| Tokens/segundo | 5-15 (CPU) / 15-30 (GPU) |

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

