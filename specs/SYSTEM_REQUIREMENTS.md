# Recall.ai — Requisitos de Sistema

> **Versão:** 1.0 (Desktop)
> **Foco:** Compatibilidade cross-platform com otimização por hardware

---

## 1. Filosofia de Compatibilidade

O Recall.ai desktop foi projetado com a filosofia **"GPU-First, CPU-Safe"**:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRIORIDADE DE EXECUÇÃO                       │
├─────────────────────────────────────────────────────────────────┤
│  1º  GPU (CUDA/Metal/Vulkan)  →  Performance máxima            │
│  2º  CPU (SIMD: AVX2/NEON)    →  100% dos desktops suportam    │
└─────────────────────────────────────────────────────────────────┘
```

**Justificativa:** No desktop, GPUs dedicadas e integradas oferecem aceleração significativa. Porém, o app deve funcionar igualmente bem em modo CPU-only para máxima compatibilidade.

node-llama-cpp detecta automaticamente o melhor backend disponível e seleciona a estratégia ideal sem intervenção do usuário.

---

## 2. Requisitos Mínimos

### 2.1 Windows

| Requisito | Mínimo | Recomendado |
|-----------|--------|-------------|
| **Versão** | Windows 10 (64-bit) | Windows 11 |
| **CPU** | x86_64 com AVX2 | Intel Core i5 10ª gen+ / AMD Ryzen 5 3600+ |
| **RAM** | 4GB livre | 8GB+ total |
| **Armazenamento** | 1GB livre | 2GB+ livre |
| **GPU (opcional)** | — | NVIDIA GTX 1060+ (CUDA) / AMD RX 580+ (Vulkan) |
| **VRAM (se GPU)** | — | 2GB+ |

### 2.2 macOS

| Requisito | Mínimo | Recomendado |
|-----------|--------|-------------|
| **Versão** | macOS 11 (Big Sur) | macOS 13+ (Ventura) |
| **CPU** | Intel Core i5 (2018+) | Apple Silicon (M1+) |
| **RAM** | 4GB livre | 8GB+ unified memory |
| **Armazenamento** | 1GB livre | 2GB+ livre |
| **GPU** | Intel Iris integrada | Apple Silicon (Metal nativo) |

### 2.3 Linux

| Requisito | Mínimo | Recomendado |
|-----------|--------|-------------|
| **Distro** | Ubuntu 20.04+ / Fedora 36+ | Ubuntu 22.04+ LTS |
| **CPU** | x86_64 com AVX2 | Intel/AMD recente |
| **RAM** | 4GB livre | 8GB+ total |
| **Armazenamento** | 1GB livre | 2GB+ livre |
| **GPU (opcional)** | — | NVIDIA (proprietário) / AMD (Mesa Vulkan) |
| **Arch** | x86_64, arm64 | x86_64 |

---

## 3. Tiers de Hardware

### Tier 1: GPU Dedicada (Experiência Premium)

**Características:** GPU NVIDIA (CUDA) ou AMD (Vulkan) com 4GB+ VRAM, 8GB+ RAM

| Hardware Típico |
|-----------------|
| Desktop com NVIDIA RTX 2060+ / GTX 1660+ |
| Desktop com AMD RX 5600 XT+ |
| Laptop gamer com dGPU |
| Mac Studio / MacBook Pro M1 Pro+ |

**Performance esperada (Gemma 270M):**
- Embedding: 5-15ms por chunk
- LLM: 30-50 tokens/s
- Primeiro token: 100-300ms
- Resposta completa: 2-4s

**Aceleração:**
- NVIDIA → CUDA (preferido)
- AMD → Vulkan
- Apple → Metal

---

### Tier 2: GPU Integrada / Apple Silicon (Experiência Boa)

**Características:** iGPU Intel Iris/UHD, Apple M1/M2 base, 8GB RAM

| Hardware Típico |
|-----------------|
| MacBook Air M1/M2 |
| Intel NUC |
| Laptop com Intel Iris Xe |
| Desktop sem GPU dedicada (CPU 2020+) |

**Performance esperada (Gemma 270M):**
- Embedding: 15-30ms por chunk
- LLM: 15-30 tokens/s
- Primeiro token: 200-700ms
- Resposta completa: 3-6s

**Aceleração:**
- Apple Silicon → Metal (excelente performance)
- Intel Iris Xe → Vulkan (performance moderada)
- Fallback → CPU SIMD

---

### Tier 3: CPU-Only (Experiência Funcional)

**Características:** Sem GPU utilizável, 4-8GB RAM, CPU com AVX2

| Hardware Típico |
|-----------------|
| Notebooks antigos (2018-2020) |
| Desktops entry-level |
| Máquinas virtuais |
| PCs corporativos sem GPU |

**Performance esperada (Gemma 270M):**
- Embedding: 30-80ms por chunk
- LLM: 8-15 tokens/s
- Primeiro token: 500ms-2s
- Resposta completa: 5-12s

**Otimizações ativadas:**
- SIMD (AVX2/SSE4.2/NEON) automático
- Batch size reduzido para embeddings
- Cache mais agressivo
- Lazy loading do LLM

> **Nota:** Mesmo em CPU-only, o Gemma 270M entrega uma experiência aceitável. A performance é vastamente superior ao que seria possível no mobile com o mesmo modelo.

---

## 4. Detecção Automática de Hardware

### 4.1 Detecção de Tier

```typescript
interface SystemCapabilities {
  tier: 1 | 2 | 3;
  platform: 'win32' | 'darwin' | 'linux';
  arch: 'x64' | 'arm64';
  totalRAM: number;           // MB
  availableRAM: number;       // MB
  cpuModel: string;
  cpuCores: number;
  hasAVX2: boolean;
  gpu: GPUInfo | null;
}

interface GPUInfo {
  name: string;
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple';
  vram: number;               // MB (0 se unified memory)
  backend: 'cuda' | 'metal' | 'vulkan';
  driverVersion?: string;
}

function detectSystemTier(caps: SystemCapabilities): 1 | 2 | 3 {
  if (caps.gpu) {
    const hasHighEndGPU =
      (caps.gpu.vendor === 'nvidia' && caps.gpu.vram >= 4096) ||
      (caps.gpu.vendor === 'amd' && caps.gpu.vram >= 4096) ||
      (caps.gpu.vendor === 'apple' && caps.totalRAM >= 16384);

    if (hasHighEndGPU) return 1;

    // iGPU ou Apple Silicon base
    return 2;
  }

  // CPU only
  return 3;
}
```

### 4.2 Configuração Dinâmica por Tier

```typescript
interface TierConfig {
  embeddingBatchSize: number;
  llmMaxContext: number;
  llmMaxResponse: number;
  gpuBackend: 'cuda' | 'metal' | 'vulkan' | 'cpu';
  gpuLayers: number;            // Camadas offloaded para GPU
  cacheAggressiveness: 'low' | 'medium' | 'high';
  preloadLLM: boolean;
}

const TIER_CONFIGS: Record<number, TierConfig> = {
  1: {
    embeddingBatchSize: 32,
    llmMaxContext: 32768,
    llmMaxResponse: 512,
    gpuBackend: 'auto',        // node-llama-cpp detecta
    gpuLayers: -1,             // Todas as camadas na GPU
    cacheAggressiveness: 'low',
    preloadLLM: true,          // Carrega LLM no startup
  },
  2: {
    embeddingBatchSize: 16,
    llmMaxContext: 16384,
    llmMaxResponse: 384,
    gpuBackend: 'auto',
    gpuLayers: 20,             // Parcial GPU offload
    cacheAggressiveness: 'medium',
    preloadLLM: true,
  },
  3: {
    embeddingBatchSize: 8,
    llmMaxContext: 8192,
    llmMaxResponse: 256,
    gpuBackend: 'cpu',
    gpuLayers: 0,
    cacheAggressiveness: 'high',
    preloadLLM: false,         // Lazy load na primeira query
  },
};
```

---

## 5. Aceleradores de Hardware

### 5.1 CUDA (NVIDIA)

**Requisitos:**
- GPU NVIDIA com Compute Capability 5.2+ (Maxwell)
- Driver NVIDIA 525+
- CUDA Toolkit não é necessário no runtime (node-llama-cpp inclui runtime)

**GPUs testadas/suportadas:**
| Série | Modelos | VRAM | Performance |
|-------|---------|------|-------------|
| RTX 40xx | 4060-4090 | 8-24GB | Excelente |
| RTX 30xx | 3060-3090 | 8-24GB | Excelente |
| RTX 20xx | 2060-2080 Ti | 6-11GB | Muito boa |
| GTX 16xx | 1660-1660 Ti | 6GB | Boa |
| GTX 10xx | 1060-1080 Ti | 6-11GB | Aceitável |

### 5.2 Metal (macOS)

**Requisitos:**
- macOS 11+ (Big Sur)
- Apple Silicon (M1/M2/M3/M4) → Metal nativo, performance excelente
- Intel Mac com dGPU AMD → Metal via Rosetta/nativo

**Hardware suportado:**
| Chip | RAM (Unified) | Performance |
|------|---------------|-------------|
| M4 Pro/Max/Ultra | 24-192GB | Excepcional |
| M3 Pro/Max | 18-128GB | Excepcional |
| M2 Pro/Max | 16-96GB | Excelente |
| M1 Pro/Max | 16-64GB | Excelente |
| M1/M2/M3 base | 8-24GB | Muito boa |
| Intel + AMD dGPU | Varia | Aceitável |

### 5.3 Vulkan (AMD / Intel / Fallback)

**Requisitos:**
- Driver com suporte Vulkan 1.2+
- GPU AMD GCN 3+ ou Intel Gen 9+

**GPUs suportadas:**
| Vendor | Série | Performance |
|--------|-------|-------------|
| AMD | RX 7000/6000/5000 | Muito boa |
| AMD | RX Vega | Boa |
| Intel | Arc A-series | Boa |
| Intel | Iris Xe | Aceitável |
| Intel | UHD 630+ | Básica |

---

## 6. Gerenciamento de Memória

### 6.1 Uso de Memória Estimado

```
Recall.ai v1.0 — Estimativa de memória (Gemma 270M):

┌─────────────────────────────────────────────────┐
│  Componente              │  RAM (estimativa)     │
├──────────────────────────┼───────────────────────┤
│  Electron (Chrome + Node)│  ~200MB               │
│  React App (renderer)    │  ~50MB                │
│  better-sqlite3          │  ~20MB + dados        │
│  Embedding Model (GGUF)  │  ~30MB                │
│  LLM Model (INT4 GGUF)   │  ~200MB               │
│  Vector Cache            │  ~50MB                │
│  Working Memory          │  ~50MB                │
├──────────────────────────┼───────────────────────┤
│  TOTAL (estimado)        │  ~600MB               │
│  TOTAL (com GPU offload) │  ~400MB RAM + 200MB   │
│                          │  VRAM                 │
└──────────────────────────┴───────────────────────┘
```

### 6.2 Estratégias de Otimização

```typescript
class MemoryManager {
  // Pré-carrega modelos (Tier 1 e 2)
  async preload(): Promise<void> {
    await this.loadEmbeddingModel();
    if (this.config.preloadLLM) {
      await this.loadLLM();
    }
  }

  // Lazy loading para Tier 3
  async ensureLLMLoaded(): Promise<void> {
    if (!this.llmLoaded) {
      await this.loadLLM();
    }
  }

  // Libera LLM quando inativo por 5min (Tier 3)
  startIdleTimer(): void {
    this.idleTimer = setTimeout(() => {
      if (this.tier === 3) {
        this.unloadLLM();
      }
    }, 5 * 60 * 1000);
  }

  // Monitora memória disponível
  async checkMemoryPressure(): Promise<void> {
    const available = os.freemem() / 1024 / 1024;
    if (available < 500) {
      await this.clearQueryCache();
    }
    if (available < 300) {
      await this.unloadLLM();
    }
  }
}
```

---

## 7. Testes de Compatibilidade

### 7.1 Matriz de Testes

| Categoria | Sistemas para Testar |
|-----------|---------------------|
| **Tier 1 Windows** | Win 11 + RTX 3060/4060 |
| **Tier 1 macOS** | MacBook Pro M1 Pro+ |
| **Tier 2 Windows** | Win 10/11 + Intel Iris Xe |
| **Tier 2 macOS** | MacBook Air M1 base (8GB) |
| **Tier 3 Windows** | Win 10 + CPU-only (Intel i5 8ª gen) |
| **Tier 3 Linux** | Ubuntu 22.04 + CPU-only |
| **Edge Cases** | ARM64 Linux, VMs, HDDs lentos |

### 7.2 Checklist de Validação

```markdown
## Por Sistema Testado

- [ ] App inicia sem crash
- [ ] Hardware detectado corretamente (CPU/GPU/RAM)
- [ ] Tier atribuído corretamente
- [ ] Download de modelos funciona (first-run)
- [ ] Importação de chat funciona
- [ ] Embedding executa sem timeout
- [ ] LLM gera resposta
- [ ] Streaming de tokens sem travamentos
- [ ] UI responsiva durante inferência (sem freeze)
- [ ] Memória dentro do budget
- [ ] Funciona offline (após download)
- [ ] Auto-updater funciona
- [ ] Installer funciona (NSIS/DMG/AppImage)
```

---

## 8. Fallbacks e Degradação Graciosa

### 8.1 Cenários de Fallback

```typescript
const FALLBACK_SCENARIOS = {
  // Se GPU não disponível
  noGPU: {
    action: 'cpu_mode',
    message: 'GPU não detectada. Usando CPU (performance pode ser menor).',
  },

  // Se LLM falhar ao carregar
  llmLoadFailure: {
    action: 'show_chunks_only',
    message: 'Modelo de IA não disponível. Mostrando trechos encontrados.',
  },

  // Se embedding demorar muito
  embeddingTimeout: {
    action: 'reduce_batch_size',
    retryWithBatchSize: 4,
  },

  // Se memória insuficiente
  outOfMemory: {
    action: 'unload_llm_retry',
    message: 'Memória insuficiente. Liberando recursos...',
  },

  // Se download de modelo falhar
  downloadFailure: {
    action: 'retry_with_mirror',
    message: 'Falha no download. Tentando servidor alternativo...',
    maxRetries: 3,
  },

  // Se AVX2 não disponível (CPU muito antigo)
  noAVX2: {
    action: 'warn_slow_performance',
    message: 'CPU sem AVX2 detectada. A performance será significativamente reduzida.',
  },
};
```

---

## 9. Distribuição

### Installers por Plataforma

| Plataforma | Formato | Tamanho Estimado |
|-----------|---------|-----------------|
| Windows | `.exe` (NSIS installer) | ~100MB |
| macOS (Intel) | `.dmg` | ~110MB |
| macOS (Apple Silicon) | `.dmg` | ~100MB |
| Linux | `.AppImage` | ~120MB |
| Linux | `.deb` | ~100MB |

> **Nota:** Os modelos de IA (~175MB) são baixados separadamente no first-run, mantendo o installer leve.

### Auto-Update

- **Mecanismo:** electron-updater
- **Canal:** GitHub Releases
- **Verificação:** Assinatura digital dos builds
- **Cadência:** Check a cada 24h ou manualmente
