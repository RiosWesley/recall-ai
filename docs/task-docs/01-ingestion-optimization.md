# Otimização de Ingestão e Extração de Menções

**Objetivo:** Elevar o desempenho e a qualidade da extração de dados brutos das memórias utilizando o LFM2.5, com foco na identificação precisa de terceiros (Mentions) e na redução do overhead de processamento.

## 1. Melhorias no Chunking (Agrupamento Temporal)
Atualmente, o chunking funciona agrupando mensagens por uma janela fixa ou inatividade longa (2h). Para otimizar:
- **Agrupamento Adaptativo:** Ao invés de mandar chunks gigantes, o Worker deve quebrar sessões maiores em "Sub-Sessões Temáticas" se passarem de X tokens (~400 tokens), evitando diluição da atenção do LLM.
- **Micro-Batching:** O `WorkerProcess` (LFM2.5) usará inferência batch real se o node-llama-cpp permitir avaliação em lote contíguo, enfileirando 4 a 6 sub-sessões para parse simultâneo ou contínuo.

## 2. Refinamento do Prompt (Strict JSON)
O sistema exige que o LFM2.5 não faça síntese literária, apenas Data Parsing agressivo.
O prompt deverá ser atualizado para o seguinte formato de saída obrigatória:

```json
{
  "summary": "Resumo em 1 frase da sessão",
  "mentioned_entities": [
    {
      "name": "Maria",
      "type": "person",
      "context": "Indicada para fazer o bolo do aniversário do João",
      "sentiment": "positive",
      "is_participant": false
    }
  ]
}
```

### Regras do LFM2.5:
1. **Ignorar** nomes comuns genéricos que não se refiram a uma pessoa (ex: marca de loja).
2. O campo `context` deve ser copiado ou muito próximo das palavras originais da conversa, para embasar futuramente a `bio` do usuário.
3. Se for o interlocutor com quem o usuário está falando, `is_participant` = true. Se for um terceiro mencionado na conversa, `is_participant` = false.

## 3. Desempenho e Degradação Progressiva
Se a extração falhar por JSON malformado:
- **1º Fallback:** Usar regex fixo para extrair chaves parciais do output corrompido do LLM.
- **2º Fallback:** Ignorar a entidade e salvar apenas o resumo, evitando que o pipeline de ingestão trave.
- **Relatório de Ingestão:** Ao final da importação, um relatório deve exibir (em milissegundos) o tempo médio por chunk, servindo de métrica técnica de sucesso para esta task.
