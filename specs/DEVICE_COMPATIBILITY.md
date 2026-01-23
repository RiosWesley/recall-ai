# Recall.ai — Compatibilidade de Dispositivos

> **Versão:** 1.0
> **Foco:** Máxima compatibilidade com otimização para CPU

---

## 1. Filosofia de Compatibilidade

O Recall.ai foi projetado com a filosofia **"CPU-First"**:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRIORIDADE DE EXECUÇÃO                       │
├─────────────────────────────────────────────────────────────────┤
│  1º  CPU (SIMD otimizado)  →  100% dos dispositivos suportam   │
│  2º  GPU (via delegate)    →  ~70% dos dispositivos            │
│  3º  NPU (neural engine)   →  ~15% dos dispositivos (2025)     │
└─────────────────────────────────────────────────────────────────┘
```

**Justificativa:** NPU ainda é feature de flagship. Para atingir o maior número de usuários, a experiência deve ser excelente em CPU.

---

## 2. Requisitos Mínimos

### 2.1 Android

| Requisito | Mínimo | Recomendado |
|-----------|--------|-------------|
| **Versão Android** | 7.0 (API 24) | 10.0+ (API 29+) |
| **RAM** | 3GB | 4GB+ |
| **Armazenamento Livre** | 500MB | 1GB+ |
| **Arquitetura** | arm64-v8a | arm64-v8a |
| **CPU** | Qualquer ARM64 | Snapdragon 6xx+ / Dimensity 700+ |

### 2.2 iOS

| Requisito | Mínimo | Recomendado |
|-----------|--------|-------------|
| **Versão iOS** | 15.0 | 16.0+ |
| **Dispositivo** | iPhone 8 | iPhone 11+ |
| **RAM** | 2GB | 4GB+ |
| **Armazenamento Livre** | 500MB | 1GB+ |
| **Chip** | A11 Bionic | A13+ |

---

## 3. Tiers de Dispositivos

### Tier 1: Premium (Experiência Completa)
**Características:** NPU disponível, GPU potente, 6GB+ RAM

| Android | iOS |
|---------|-----|
| Samsung Galaxy S21+ | iPhone 12+ |
| Google Pixel 6+ | iPad Pro M1+ |
| OnePlus 9+ | |
| Xiaomi 12+ | |

**Performance esperada:**
- LLM: 20-30 tokens/s
- Embedding: 30-50ms
- Resposta completa: 3-5s

---

### Tier 2: Mainstream (Experiência Boa)
**Características:** GPU boa, 4-6GB RAM, sem NPU dedicada

| Android | iOS |
|---------|-----|
| Samsung Galaxy A53/A54 | iPhone 11 |
| Google Pixel 5/5a | iPhone SE (2ª/3ª gen) |
| Motorola Edge 30 | iPad 9ª gen |
| Xiaomi Redmi Note 11/12 Pro | |
| Realme 9/10 Pro | |

**Performance esperada:**
- LLM: 10-20 tokens/s
- Embedding: 50-80ms
- Resposta completa: 5-8s

---

### Tier 3: Entry (Experiência Funcional)
**Características:** CPU apenas, 3-4GB RAM

| Android | iOS |
|---------|-----|
| Samsung Galaxy A33/A34 | iPhone 8/8 Plus |
| Motorola Moto G (2022+) | iPhone X |
| Xiaomi Redmi Note 10 | |
| Realme C35/C55 | |
| Samsung Galaxy M (2022+) | |

**Performance esperada:**
- LLM: 5-10 tokens/s
- Embedding: 80-150ms
- Resposta completa: 8-15s

**Otimizações ativadas:**
- Batch size reduzido para embeddings
- Limite de contexto para LLM (4K tokens)
- Cache mais agressivo

---

### Tier 4: Legacy (Funcionalidade Limitada)
**Características:** RAM < 3GB, CPU antigo

| Dispositivos |
|--------------|
| Phones com 2GB RAM |
| Dispositivos pré-2019 |
| Tablets Android entry-level |

**Comportamento:**
- ⚠️ Aviso ao usuário sobre limitações
- LLM desativado (apenas busca semântica)
- Embedding com timeout estendido
- Sugestão de upgrade

---

## 4. Estratégias de Otimização por Tier

### 4.1 Detecção de Tier

```typescript
interface DeviceCapabilities {
  tier: 1 | 2 | 3 | 4;
  ram: number;           // MB
  cpuCores: number;
  hasGpu: boolean;
  hasNpu: boolean;
  gpuName?: string;
  chipset?: string;
}

async function detectDeviceTier(): Promise<DeviceCapabilities> {
  const ram = await getDeviceRAM();
  const cpuCores = await getCPUCores();
  const gpuInfo = await getGPUInfo();
  const npuAvailable = await checkNPUSupport();

  let tier: 1 | 2 | 3 | 4;

  if (npuAvailable && ram >= 6000) {
    tier = 1;
  } else if (gpuInfo.available && ram >= 4000) {
    tier = 2;
  } else if (ram >= 3000) {
    tier = 3;
  } else {
    tier = 4;
  }

  return { tier, ram, cpuCores, hasGpu: gpuInfo.available, hasNpu: npuAvailable };
}
```

### 4.2 Configuração Dinâmica

```typescript
interface TierConfig {
  embeddingBatchSize: number;
  llmMaxContext: number;
  llmMaxResponse: number;
  enableGpu: boolean;
  enableNpu: boolean;
  enableLLM: boolean;
  cacheAggressiveness: 'low' | 'medium' | 'high';
  showPerformanceWarning: boolean;
}

const TIER_CONFIGS: Record<number, TierConfig> = {
  1: {
    embeddingBatchSize: 16,
    llmMaxContext: 16384,
    llmMaxResponse: 512,
    enableGpu: true,
    enableNpu: true,
    enableLLM: true,
    cacheAggressiveness: 'low',
    showPerformanceWarning: false,
  },
  2: {
    embeddingBatchSize: 8,
    llmMaxContext: 8192,
    llmMaxResponse: 384,
    enableGpu: true,
    enableNpu: false,
    enableLLM: true,
    cacheAggressiveness: 'medium',
    showPerformanceWarning: false,
  },
  3: {
    embeddingBatchSize: 4,
    llmMaxContext: 4096,
    llmMaxResponse: 256,
    enableGpu: false,
    enableNpu: false,
    enableLLM: true,
    cacheAggressiveness: 'high',
    showPerformanceWarning: true,
  },
  4: {
    embeddingBatchSize: 2,
    llmMaxContext: 2048,
    llmMaxResponse: 128,
    enableGpu: false,
    enableNpu: false,
    enableLLM: false,  // Desativado!
    cacheAggressiveness: 'high',
    showPerformanceWarning: true,
  },
};
```

---

## 5. Aceleradores de Hardware

### 5.1 GPU Delegates

**Android:**
```typescript
// LiteRT GPU Delegate (via MLDrift)
const gpuDelegate = {
  type: 'gpu',
  options: {
    precision: 'float16',  // ou 'float32' para compatibilidade
    allowQuantized: true,
    waitType: 'passive',   // Economiza bateria
  }
};
```

**iOS:**
```typescript
// Metal Delegate
const metalDelegate = {
  type: 'metal',
  options: {
    allowQuantized: true,
    waitType: 'passive',
  }
};

// Core ML Delegate (alternativa)
const coremlDelegate = {
  type: 'coreml',
  options: {
    enabledDevices: 'all',  // cpu_and_gpu ou cpu_and_neural_engine
  }
};
```

### 5.2 NPU/Neural Engine

**Dispositivos com NPU (2025):**

| Chipset | NPU | Suporte LiteRT |
|---------|-----|----------------|
| Google Tensor G3/G4 | Sim | Nativo |
| Qualcomm Snapdragon 8 Gen 2/3 | Hexagon | Via NNAPI |
| MediaTek Dimensity 9000+ | APU | Via NNAPI |
| Apple A14+ | Neural Engine | Via Core ML |
| Samsung Exynos 2200+ | Sim | Via NNAPI |

**Detecção de NPU:**
```typescript
async function checkNPUSupport(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    // iOS: Neural Engine disponível em A11+
    return await CoreMLUtils.hasNeuralEngine();
  } else {
    // Android: Verificar via NNAPI
    return await NNAPIUtils.hasAccelerator('npu');
  }
}
```

---

## 6. Gerenciamento de Memória

### 6.1 Budgets por Tier

```typescript
const MEMORY_BUDGETS = {
  1: {
    embedding_model: 50,   // MB
    llm_model: 200,        // MB
    vector_cache: 100,     // MB
    working_memory: 150,   // MB
    total: 500,            // MB
  },
  2: {
    embedding_model: 30,
    llm_model: 180,
    vector_cache: 50,
    working_memory: 100,
    total: 360,
  },
  3: {
    embedding_model: 30,
    llm_model: 150,
    vector_cache: 30,
    working_memory: 50,
    total: 260,
  },
  4: {
    embedding_model: 25,
    llm_model: 0,          // LLM desativado
    vector_cache: 20,
    working_memory: 30,
    total: 75,
  },
};
```

### 6.2 Estratégias de Liberação

```typescript
class MemoryManager {
  private currentTier: number;

  // Libera modelos quando app vai para background
  async onBackground(): Promise<void> {
    if (this.currentTier >= 3) {
      await this.unloadLLM();
    }
  }

  // Recarrega quando volta para foreground
  async onForeground(): Promise<void> {
    if (this.currentTier >= 3) {
      // Lazy load - só carrega quando usuário fizer query
    } else {
      await this.preloadLLM();
    }
  }

  // Monitora memória disponível
  async checkMemoryPressure(): Promise<void> {
    const available = await getAvailableMemory();
    if (available < 200) {  // MB
      await this.clearVectorCache();
    }
    if (available < 100) {
      await this.unloadLLM();
    }
  }
}
```

---

## 7. Bateria e Térmica

### 7.1 Limites de Consumo

```typescript
const BATTERY_LIMITS = {
  // Máximo de % bateria por sessão de uso
  maxBatteryPerSession: 3,

  // Pausa inferência se bateria < X%
  lowBatteryThreshold: 15,

  // Desativa GPU se temperatura > X°C
  thermalThrottleTemp: 40,

  // Intervalo mínimo entre inferências pesadas
  cooldownMs: 500,
};
```

### 7.2 Monitoramento Térmico

```typescript
class ThermalManager {
  async shouldThrottle(): Promise<boolean> {
    const temp = await getDeviceTemperature();
    return temp > BATTERY_LIMITS.thermalThrottleTemp;
  }

  async getRecommendedDelegate(): Promise<'cpu' | 'gpu' | 'npu'> {
    if (await this.shouldThrottle()) {
      return 'cpu';  // CPU é mais frio que GPU
    }
    return this.preferredDelegate;
  }
}
```

---

## 8. Testes de Compatibilidade

### 8.1 Matriz de Testes

| Categoria | Dispositivos para Testar |
|-----------|-------------------------|
| **Tier 1 Android** | Pixel 8, Galaxy S24, OnePlus 12 |
| **Tier 1 iOS** | iPhone 15, iPhone 14 Pro |
| **Tier 2 Android** | Pixel 6a, Galaxy A54, Redmi Note 12 Pro |
| **Tier 2 iOS** | iPhone 11, iPhone SE 3 |
| **Tier 3 Android** | Galaxy A34, Moto G 2023, Redmi 12 |
| **Tier 3 iOS** | iPhone X, iPhone 8 |
| **Edge Cases** | Tablets, Foldables, Dispositivos chineses |

### 8.2 Checklist de Validação

```markdown
## Por Dispositivo Testado

- [ ] App inicia sem crash
- [ ] Modelos carregam corretamente
- [ ] Importação de chat funciona
- [ ] Embedding executa sem timeout
- [ ] LLM gera resposta (se habilitado)
- [ ] UI mantém 60fps durante inferência
- [ ] Memória não excede budget
- [ ] Bateria não drena excessivamente
- [ ] App não esquenta dispositivo
- [ ] Funciona em modo avião (offline)
```

---

## 9. Fallbacks e Degradação Graciosa

### 9.1 Cenários de Fallback

```typescript
const FALLBACK_SCENARIOS = {
  // Se LLM falhar
  llmFailure: {
    action: 'show_chunks_only',
    message: 'Mostrando trechos encontrados (IA temporariamente indisponível)',
  },

  // Se embedding demorar muito
  embeddingTimeout: {
    action: 'reduce_batch_size',
    retryWithBatchSize: 2,
  },

  // Se memória insuficiente
  outOfMemory: {
    action: 'unload_and_retry',
    message: 'Liberando memória...',
  },

  // Se device muito antigo
  unsupportedDevice: {
    action: 'search_only_mode',
    message: 'Seu dispositivo suporta apenas busca por palavras-chave',
  },
};
```

### 9.2 Modo Search-Only (Tier 4)

Para dispositivos que não suportam LLM:

```typescript
// Em vez de RAG completo, oferece:
// 1. Busca semântica (embeddings ainda funcionam)
// 2. Mostra os chunks mais relevantes
// 3. Destaca termos buscados
// 4. Permite navegar para mensagem original

interface SearchOnlyResult {
  query: string;
  chunks: Array<{
    content: string;
    similarity: number;
    highlightedTerms: string[];
    jumpToMessageId: string;
  }>;
  llmAvailable: false;
  suggestion: 'Para respostas em linguagem natural, use um dispositivo mais recente';
}
```

---

## 10. Estatísticas de Mercado (Brasil 2025)

Estimativa de cobertura por tier:

```
Tier 1 (Premium):     ~15% dos usuários
Tier 2 (Mainstream):  ~45% dos usuários
Tier 3 (Entry):       ~35% dos usuários
Tier 4 (Legacy):      ~5% dos usuários
─────────────────────────────────────────
Cobertura com LLM:    ~95%
Cobertura total:      ~100% (com fallbacks)
```

**Fonte:** Estimativas baseadas em dados de mercado de smartphones Brasil 2024/2025.
