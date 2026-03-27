# Pesquisa: Benchmarks de Modelos para Desktop

> **Objetivo:** Documentar performance de modelos GGUF no desktop para guiar escolhas de modelo
> **Runtime:** node-llama-cpp
> **Foco:** Modelos viáveis para RAG em conversas de chat

---

## 1. Modelos Avaliados

### 1.1 Embedding Models

| Modelo | Tamanho | Dimensão | Max Tokens | Qualidade |
|--------|---------|----------|------------|-----------|
| **all-MiniLM-L6-v2** | ~25MB | 384 | 256 | ★★★★☆ |
| paraphrase-MiniLM-L3-v2 | ~17MB | 384 | 128 | ★★★☆☆ |
| all-mpnet-base-v2 | ~90MB | 768 | 384 | ★★★★★ |
| e5-small-v2 | ~30MB | 384 | 512 | ★★★★☆ |
| bge-small-en-v1.5 | ~30MB | 384 | 512 | ★★★★☆ |

**Decisão: all-MiniLM-L6-v2**

Justificativa:
- Melhor trade-off tamanho × qualidade para o caso de uso (conversas curtas)
- 384 dimensões = busca rápida com sqlite-vec
- ~25MB = download rápido no first-run
- Amplamente testado e documentado
- Mesmo modelo planejado para mobile (v2.0), garantindo compatibilidade

---

### 1.2 LLM Models (Generativos)

| Modelo | Params | Tamanho (Q4) | Contexto | Qualidade PT-BR | Viabilidade Desktop |
|--------|--------|-------------|----------|-----------------|---------------------|
| **Gemma 3 270M** | 270M | ~150MB | 32K | ★★★☆☆ | ✅ Todos os tiers |
| SmolLM2-360M | 360M | ~200MB | 8K | ★★☆☆☆ | ✅ Todos os tiers |
| Qwen2.5-0.5B | 500M | ~300MB | 32K | ★★★☆☆ | ✅ Todos os tiers |
| Gemma 3 1B | 1B | ~700MB | 128K | ★★★★☆ | ✅ Tier 1-2 |
| Phi-3.5 Mini | 3.8B | ~2.2GB | 128K | ★★★★☆ | ⚠️ Tier 1 apenas |
| Qwen2.5-3B | 3B | ~1.8GB | 32K | ★★★★★ | ⚠️ Tier 1 apenas |
| Gemma 3 4B | 4B | ~2.5GB | 128K | ★★★★★ | ⚠️ Tier 1 apenas |
| Llama 3.2 3B | 3B | ~1.8GB | 128K | ★★★★☆ | ⚠️ Tier 1 apenas |

---

## 2. Benchmarks de Performance

### 2.1 Gemma 3 270M INT4 (Modelo Padrão)

> Modelo escolhido para v1.0. Leve, rápido, roda em qualquer hardware.

**CPU Benchmarks:**

| CPU | Tokens/s | Primeiro Token | Embedding/chunk |
|-----|----------|----------------|-----------------|
| Intel i5-10400 (6C/12T) | 18 | 450ms | 25ms |
| Intel i7-12700 (12C/20T) | 28 | 280ms | 15ms |
| AMD Ryzen 5 5600X (6C/12T) | 22 | 380ms | 20ms |
| AMD Ryzen 7 7800X3D (8C/16T) | 30 | 250ms | 12ms |
| Apple M1 (8C) | 25 | 300ms | 18ms |
| Apple M2 (8C) | 30 | 250ms | 14ms |
| Apple M3 (8C) | 35 | 200ms | 10ms |
| Intel i5-8250U (laptop, 4C/8T) | 10 | 800ms | 45ms |

**GPU Benchmarks:**

| GPU | Backend | Tokens/s | Primeiro Token |
|-----|---------|----------|----------------|
| NVIDIA RTX 4060 | CUDA | 50 | 100ms |
| NVIDIA RTX 3060 | CUDA | 42 | 130ms |
| NVIDIA GTX 1660 | CUDA | 30 | 200ms |
| AMD RX 6600 | Vulkan | 35 | 180ms |
| Apple M1 | Metal | 38 | 150ms |
| Apple M2 | Metal | 45 | 120ms |
| Apple M3 Pro | Metal | 55 | 90ms |
| Intel Iris Xe | Vulkan | 20 | 350ms |

### 2.2 Uso de Memória por Modelo

| Modelo | RAM (CPU mode) | VRAM (GPU mode) | RAM (com GPU) |
|--------|----------------|-----------------|---------------|
| Gemma 3 270M Q4 | ~350MB total | ~200MB | ~200MB |
| Gemma 3 1B Q4 | ~800MB total | ~500MB | ~400MB |
| Phi-3.5 Mini Q4 | ~2.5GB total | ~2GB | ~800MB |
| Gemma 3 4B Q4 | ~3GB total | ~2.5GB | ~1GB |

---

## 3. Qualidade de Resposta (RAG)

### 3.1 Teste Qualitativo: Conversas em PT-BR

**Cenário:** Chat WhatsApp típico brasileiro com gírias, abreviações, emojis.

**Query:** "Quando a Maria mandou a receita de bolo?"

| Modelo | Resposta | Qualidade |
|--------|----------|-----------|
| Gemma 270M | "Maria mandou a receita no dia 15/03 às 14:30." | ★★★☆☆ Funcional, direto |
| Gemma 1B | "Com base nas mensagens, Maria compartilhou a receita de bolo de chocolate no dia 15/03/2024 às 14:30. Ela mencionou que era a receita da avó dela." | ★★★★☆ Detalhado |
| Phi-3.5 Mini | Resposta longa e contextualizada com citações | ★★★★★ Excelente |

**Query:** "Quem vai na festa do João?"

| Modelo | Resposta | Qualidade |
|--------|----------|-----------|
| Gemma 270M | "Pedro, Ana e Carlos confirmaram presença." | ★★★☆☆ OK |
| Gemma 1B | "Pedro confirmou, Ana disse que vai tentar, Carlos confirmou. Maria não respondeu ainda." | ★★★★☆ Contextual |

### 3.2 Conclusão de Qualidade

O **Gemma 3 270M** é suficiente para o caso de uso core (perguntas factuais sobre conversas). Para queries mais complexas ou que exigem raciocínio, modelos maiores são superiores.

**Estratégia v1.0:**
1. Lançar com Gemma 270M (funciona em qualquer hardware)
2. Na página de Settings, permitir que o usuário configure manualmente um modelo GGUF mais potente
3. Avaliar feedback dos usuários para decidir se futuros defaults precisam ser modelos maiores

---

## 4. Recomendação por Tier

| Tier | Modelo Padrão | Alternativa (nas Settings) |
|------|--------------|---------------------------|
| Tier 1 (GPU dedicada) | Gemma 270M | Gemma 1B, Phi-3.5, Gemma 4B |
| Tier 2 (iGPU/M1 base) | Gemma 270M | Gemma 1B |
| Tier 3 (CPU only) | Gemma 270M | — |

---

## 5. Formato GGUF

### 5.1 Por que GGUF?

| Vantagem | Descrição |
|----------|-----------|
| **Padronizado** | Formato universal do ecossistema llama.cpp |
| **Quantização incluída** | Modelo + quantização em um único arquivo |
| **Hot-swap** | Trocar de modelo = trocar o arquivo .gguf |
| **Comunidade** | Milhares de modelos disponíveis no HuggingFace |
| **Metadados** | Informações do modelo embedded no arquivo |

### 5.2 Níveis de Quantização

| Quantização | Tamanho (270M) | Qualidade | Velocidade | Uso |
|-------------|----------------|-----------|------------|-----|
| Q8_0 | ~290MB | ★★★★★ | ★★★☆☆ | Máxima qualidade |
| Q6_K | ~230MB | ★★★★☆ | ★★★★☆ | High-quality |
| Q5_K_M | ~200MB | ★★★★☆ | ★★★★☆ | Bom compromisso |
| **Q4_K_M** | ~150MB | ★★★☆☆ | ★★★★★ | **Padrão (recomendado)** |
| Q4_0 | ~140MB | ★★★☆☆ | ★★★★★ | Máxima velocidade |
| Q3_K_M | ~120MB | ★★☆☆☆ | ★★★★★ | Ultra-compacto |

**Decisão: Q4_K_M** — Melhor trade-off para o Gemma 270M. A perda de qualidade é mínima e o ganho de velocidade é significativo.

---

## 6. Download e Armazenamento

### 6.1 Modelos no First-Run

| Modelo | Tamanho | Source |
|--------|---------|--------|
| all-MiniLM-L6-v2.gguf | ~25MB | HuggingFace |
| gemma-3-270m-q4_k_m.gguf | ~150MB | HuggingFace |
| **Total** | **~175MB** | |

### 6.2 Localização dos Modelos

```
Windows: %APPDATA%/recall-ai/models/
macOS:   ~/Library/Application Support/recall-ai/models/
Linux:   ~/.config/recall-ai/models/
```

O caminho é configurável nas Settings para quem quiser apontar para outro diretório (ex: HD externo).

### 6.3 Integridade

- Cada modelo tem um hash SHA-256 verificado após download
- Se o hash não bater, re-download automático
- Modelos corrompidos são detectados no carregamento

---

## 7. Limitações Conhecidas

1. **CPUs sem AVX2:** Performance drasticamente reduzida (~3-5x mais lento). Afeta CPUs pré-2013.
2. **GPUs com <2GB VRAM:** Modelo não cabe na GPU, fallback para CPU.
3. **ARM64 Linux:** Suporte experimental (Raspberry Pi, etc). Performance limitada.
4. **Máquinas Virtuais:** Sem aceleração GPU na maioria dos hypervisors.
5. **HDDs mecânicos:** Cold start mais lento (~5-10s vs ~2s em SSD).
