# Integração de UI (People.tsx) e Fluxo de Resolução

**Objetivo:** Alimentar a página de Pessoas com os dados extraídos, substituir os mocks e implementar o componente visual de Resolução de Menções na Inbox.

## 1. Conexão do People.tsx com o Backend
O arquivo atual `People.tsx` possui dados mockados. As etapas para integração são:

### IPC API (no preload e main)
- `window.api.getPeople()` -> Retorna a lista de pessoas (Tabela `people`).
- `window.api.getRelations()` -> Retorna as conexões (Tabela `person_relations`).

### Renderização Dinâmica
- **Nodes do Grafo:** Substituir o array `MOCK_PEOPLE` pela resposta do IPC. O raio dos nós deve continuar sendo calculado pela propriedade `message_count`.
- **Panel Lateral:** O componente `PersonPanel` passará a consumir a tabela real e permitirá atualizações manuais no backend (ex: `window.api.updatePersonBio(id, novaBio)`).

## 2. Componente: Inbox de Menções (MentionResolver)
Como a importação não bloqueia o usuário, criaremos um componente global (ex: `components/MentionInbox.tsx`) que pode ser aberto via um botão de notificação no Header.

### Estrutura do Modal
- **Título:** "X pessoas novas identificadas"
- **Card de Desambiguação:** Mostra:
  - *"Contexto"* em itálico extraído do texto original.
  - Pergunta: "Quem é {alias}?"
  - Botões: [Selecionar Existente] [Criar Nova Pessoa] [Ignorar]
- Se clicar em [Selecionar Existente], abrir um mini-dropdown com as pessoas da tabela `people`.
- Se clicar em [Criar Nova Pessoa], um input rápido permite adicionar o "Nome Completo" e uma tag antes de submeter.

## 3. Progresso da Task
A conclusão desta parte sinaliza que o sistema consegue ingerir, identificar e registrar a biografia de todas as pessoas com as quais o usuário interage e de quem ele ouve falar em terceiros, consolidando a base para as futuras queries sobre as relações sociais do usuário.
