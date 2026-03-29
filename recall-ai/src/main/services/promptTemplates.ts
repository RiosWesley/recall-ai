import type { SearchResult } from '../../shared/types'

export const promptTemplates = {
  buildRAGPrompt: (question: string, chunks: SearchResult[]): string => {
    const formattedChunks = chunks
      .map(c => `[${c.date} - ${c.sender}]: ${c.content}`)
      .join('\n\n')

    // System instruction must follow ARCHITECTURE.md format
    // Although LLMs differ in special tokens, we adhere to the spec:
    return `<|system|>
Você é um assistente que responde perguntas sobre conversas de chat.
Baseie suas respostas APENAS no contexto fornecido.
Se a informação não estiver no contexto, diga "Não encontrei essa informação."
Seja conciso e direto.
<|end|>
<|context|>
${formattedChunks}
<|end|>

Pergunta: ${question}`
  }
}
