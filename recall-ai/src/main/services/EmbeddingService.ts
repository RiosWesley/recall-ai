import { getLlama, type Llama, type LlamaModel } from 'node-llama-cpp'
import { ModelManager } from './ModelManager'
import { detectGpu } from './gpu-detection'
import { MODEL_REGISTRY } from './modelRegistry'

export class EmbeddingService {
  private static instance: EmbeddingService | null = null

  private llama: Llama | null = null
  private model: LlamaModel | null = null
  private context: any = null // LlamaEmbeddingContext type varies in exports depending on the wrapper

  private isInitializing = false
  private gpuAccelerated = false

  private constructor() {}

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService()
    }
    return EmbeddingService.instance
  }

  /**
   * Lazily initializes the node-llama-cpp runtime, resolves the embedding model 
   * via ModelManager, and allocates the embedding context.
   */
  async initialize(): Promise<void> {
    if (this.isReady() || this.isInitializing) return

    this.isInitializing = true
    try {
      console.log('[EmbeddingService] Initializing node-llama-cpp runtime...')
      this.llama = await getLlama()
      
      const gpuInfo = await detectGpu()
      this.gpuAccelerated = gpuInfo.backend !== false
      console.log(`[EmbeddingService] GPU Detected: ${gpuInfo.backend || 'none'}`)

      console.log('[EmbeddingService] Resolving embedding model...')
      const modelPath = await ModelManager.getInstance().resolve('embedding')
      
      this.model = await this.llama.loadModel({ 
        modelPath,
        // Since embeddings are fast, we can offload layers fully to GPU if available
        gpuLayers: 'max'
      })

      this.context = await this.model.createEmbeddingContext()
      
      console.log(`[EmbeddingService] Initialization complete. Hardware acceleration: ${this.gpuAccelerated}`)
    } catch (err) {
      console.error('[EmbeddingService] Failed to initialize:', err)
      throw err
    } finally {
      this.isInitializing = false
    }
  }

  isReady(): boolean {
    return this.model !== null && this.context !== null
  }

  /**
   * Generates an L2-normalized embedding for a single text block.
   */
  async embed(text: string): Promise<Float32Array> {
    if (!this.isReady()) {
      await this.initialize()
    }

    if (!text.trim()) {
      // Return zero-vector for empty text
      return new Float32Array(MODEL_REGISTRY.embedding.dimensions || 384)
    }

    const start = performance.now()
    const { vector } = await this.context.getEmbeddingFor(text)
    
    // Normalization ensures Euclidean distance maps effectively to Cosine Similarity
    const normalized = this.normalizeL2(vector)
    const floatArr = Float32Array.from(normalized)
    
    const end = performance.now()
    console.log(`[EmbeddingService] Embed single: ${Math.round(end - start)}ms`)
    
    return floatArr
  }

  /**
   * Processes an array of text chunks sequentially to prevent VRAM overflow
   * and context contention. Useful for bulk importing.
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.isReady()) {
      await this.initialize()
    }

    console.log(`[EmbeddingService] Starting batch embed for ${texts.length} items...`)
    const start = performance.now()
    
    const results: Float32Array[] = []
    
    // Process sequentially mapping out L2 normalizations
    // node-llama-cpp v3 supports queued parallelism, but a sequential map ensures
    // absolute stability inside an Electron process for massive documents.
    for (const text of texts) {
      // In a real-world edge execution we might use a semaphore here instead
      results.push(await this.embed(text))
    }
    
    const end = performance.now()
    console.log(`[EmbeddingService] Batch embed complete. Total items: ${texts.length}. Time: ${Math.round(end - start)}ms. Avg: ${Math.round((end - start) / texts.length)}ms/item.`)
    
    return results
  }

  /**
   * Normalizes a vector to L2 unit length.
   * This is mathematically required to treat Euclidean Distance as Cosine Distance.
   */
  private normalizeL2(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((acc, val) => acc + val * val, 0))
    if (norm === 0) return vector
    return vector.map(val => val / norm)
  }

  getInfo(): { modelName: string, dimensions: number, gpuAccelerated: boolean } {
    return {
      modelName: MODEL_REGISTRY.embedding.name,
      dimensions: MODEL_REGISTRY.embedding.dimensions || 384,
      gpuAccelerated: this.gpuAccelerated
    }
  }

  /**
   * Frees C++ bindings and clears VRAM. 
   * MUST be called during application shutdown to avoid memory leaks.
   */
  dispose(): void {
    if (this.context) {
      this.context.dispose()
      this.context = null
    }
    if (this.model) {
      this.model.dispose()
      this.model = null
    }
    // node-llama-cpp global instance handles its own lifecycle usually
    this.llama = null
    console.log('[EmbeddingService] Disposed and cleared memory.')
  }
}
