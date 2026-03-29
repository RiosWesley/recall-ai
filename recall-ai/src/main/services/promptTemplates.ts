import type { SearchResult } from '../../shared/types'

export const promptTemplates = {
  buildRAGPrompt: (question: string, chunks: SearchResult[]): { systemPrompt: string, userPrompt: string } => {
    const formattedChunks = chunks
      .map(c => `[${c.date} - ${c.sender}]: ${c.content}`)
      .join('\n\n')

    const systemPrompt = `Você é um assistente encarregado de ler históricos de chat. Responda apenas com o que estiver no contexto.`;

    const userPrompt = `Contexto das mensagens (Lido do Banco de Dados):
${formattedChunks}

Pergunta do usuário: ${question}

Instruções finais:
1. Revise se o contexto nomeia os jogos.
2. Se NÃO houver jogos listados no contexto, responda: "O contexto não tem certeza do jogo procurado".
3. NÃO sugira jogos (como Minecraft, Among Us, etc) se não estiverem no contexto acima.`;

    return { systemPrompt, userPrompt }
  }
}
