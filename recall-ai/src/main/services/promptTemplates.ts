import type { SearchResult } from '../../shared/types'

export const promptTemplates = {
  buildRAGPrompt: (question: string, chunks: SearchResult[]): { systemPrompt: string, userPrompt: string } => {
    const formattedChunks = chunks
      .map(c => `[${c.date} - ${c.sender}]: ${c.content}`)
      .join('\n\n')

    const systemPrompt = `Você é um assistente que responde perguntas sobre históricos de conversa. Baseie sua resposta apenas no contexto fornecido.`

    const userPrompt = `Contexto das mensagens:\n${formattedChunks}\n\nPergunta: ${question}\n\nResponda de forma direta com base apenas no contexto acima.`

    return { systemPrompt, userPrompt }
  }
}
