import { getLlama } from 'node-llama-cpp'

export interface GpuInfo {
  vulkan: boolean
  cuda: boolean
  metal: boolean
  backend: string | false
}

/**
 * Detects the available GPU acceleration backend used by node-llama-cpp.
 * node-llama-cpp v3 natively resolves the best available backend
 * (Vulkan, CUDA, or Metal) automatically during the getLlama() initialization.
 */
export async function detectGpu(): Promise<GpuInfo> {
  const llama = await getLlama()
  
  const backend = llama.gpu
  
  return {
    vulkan: backend === 'vulkan',
    cuda: backend === 'cuda',
    metal: backend === 'metal',
    backend: backend,
  }
}
