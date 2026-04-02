import type { SearchResult } from '../../shared/types'

export const promptTemplates = {
  buildRAGPrompt: (question: string, chunks: SearchResult[]): { systemPrompt: string, userPrompt: string } => {
    const formattedChunks = chunks
      .map(c => `[${c.date} - ${c.sender}]: ${c.content}`)
      .join('\n\n')

    // Find min and max dates from context
    let dateContext = '';
    if (chunks.length > 0) {
      const dates = chunks.map(c => new Date(c.date).getTime()).filter(t => !isNaN(t));
      if (dates.length > 0) {
         const minDate = new Date(Math.min(...dates)).toISOString().split('T')[0];
         const maxDate = new Date(Math.max(...dates)).toISOString().split('T')[0];
         dateContext = `\nRegra OBRIGATÓRIA: Baseie-se EXATAMENTE nas datas providenciadas no prompt (de ${minDate} a ${maxDate}). Nunca alucine datas ou informações fora desse intervalo.`;
      }
    }

    const systemPrompt = `Você é um assistente cirúrgico que extrai informações de dados históricos. Baseie sua resposta APENAS no contexto fornecido.${dateContext}`

    const userPrompt = `DADOS E CONTEXTO OBTIDOS (Fontes imutáveis):\n${formattedChunks}\n\nPERGUNTA DO USUÁRIO: ${question}\n\nResponda EXATAMENTE o que foi perguntado, formatando de maneira limpa. Se a resposta não estiver nos dados, declare tratar-se de "dados inexistentes".`

    return { systemPrompt, userPrompt }
  }
}
