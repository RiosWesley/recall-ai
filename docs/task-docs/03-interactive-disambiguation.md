# Fluxo de Desambiguação de Menções (Human-in-the-loop)

**Objetivo:** Permitir que o sistema aprenda quem são as pessoas mencionadas garantindo máxima precisão através de perguntas assíncronas ao usuário.

## 1. Gatilho de Desambiguação
Durante a importação:
1. O LFM2.5 retorna que no chunk foi detectada uma pessoa chamada "João".
2. O Backend (`PersonRepository.findProbableMatch("João")`) não retorna certeza absoluta (ex: existem 2 Joões ou a pontuação de similaridade não é 100%).
3. O Backend paralisa o processamento *somente daquela menção* (salva num cache temporário `pending_mentions`) e emite via IPC:
   `ipcMain.emit('ingest:mention_detected', { mentionId, alias: 'João', context: 'João fez bolo' })`

## 2. Estratégia de Não-Bloqueio (Inbox de Menções)
Para não impedir a ingestão de milhares de mensagens por causa de 1 pergunta:
- O arquivo continua sendo ingerido no banco, mas as "tags" e a amarração em `person_mentions` ficam num estado *Pending*.
- A UI pode armazenar essas "Perguntas Pendentes" numa fila e o usuário as responde quando quiser, durante ou após a importação.

## 3. Resolução da Menção (Respostas do Usuário)
Quando a UI apresenta o modal "Identificamos João nesta conversa: 'João fez bolo'", o usuário tem 3 opções:
1. **É uma pessoa que já existe:** O usuário seleciona (ex: João Silva - Trabalho).
   -> Backend insere em `person_mentions` ligando ao ID de "João Silva".
   -> Adiciona "João" como um `person_aliases` válido se ainda não for.
2. **É uma pessoa nova:** 
   -> Backend pergunta: "Deseja criar um perfil para ele?".
   -> Se Sim: Cria a pessoa `João` na tabela `people` com a `bio` inicial baseada no contexto ("Faz bolo").
3. **Ignorar/Não é uma pessoa:** 
   -> Descarta a menção (falso positivo do LFM2.5).

## 4. Orquestração e Processamento Final
Assim que o usuário responde (enviando via IPC `ipcRenderer.invoke('ingest:resolve_mention', mentionId, action)`), o Main Process commita a decisão no SQLite, gerando a amarração definitiva.
