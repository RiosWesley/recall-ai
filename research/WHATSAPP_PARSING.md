# Pesquisa: Parsing de Exportação WhatsApp

> **Objetivo:** Documentar todos os formatos de exportação do WhatsApp para criar um parser robusto

---

## 1. Como Exportar Chat no WhatsApp

### Android
1. Abrir conversa → Menu (⋮) → Mais → Exportar conversa
2. Escolher "Sem mídia" (recomendado) ou "Incluir mídia"
3. Compartilhar arquivo .txt

### iOS
1. Abrir conversa → Nome do contato → Exportar conversa
2. Escolher "Sem mídia" ou "Anexar mídia"
3. Compartilhar arquivo .txt (ou .zip com mídia)

---

## 2. Formatos Identificados

### 2.1 Android - Português Brasil

```
01/05/2024 14:30 - João Silva: Mensagem aqui
01/05/2024 14:31 - Maria Santos: Outra mensagem
01/05/2024 14:32 - João Silva: Mensagem
com múltiplas
linhas
```

**Padrão Regex:**
```javascript
/^(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}) - ([^:]+): (.+)$/
```

**Componentes:**
- Data: `DD/MM/YYYY`
- Hora: `HH:MM` (24h)
- Separador: ` - `
- Nome: até `:`
- Mensagem: resto da linha

---

### 2.2 Android - Inglês (US)

```
5/1/24, 2:30 PM - John Smith: Message here
5/1/24, 2:31 PM - Mary Johnson: Another message
```

**Padrão Regex:**
```javascript
/^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2} [AP]M) - ([^:]+): (.+)$/
```

**Componentes:**
- Data: `M/D/YY` ou `M/D/YYYY`
- Hora: `H:MM AM/PM` (12h)
- Separador: ` - `

---

### 2.3 iOS - Inglês (US)

```
[5/1/24, 2:30:45 PM] John Smith: Message here
[5/1/24, 2:31:12 PM] Mary Johnson: Another message
```

**Padrão Regex:**
```javascript
/^\[(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}:\d{2} [AP]M)\] ([^:]+): (.+)$/
```

**Componentes:**
- Colchetes ao redor de data/hora
- Segundos incluídos
- Sem separador ` - `

---

### 2.4 Android - Português Portugal

```
01/05/2024, 14:30 - João Silva: Mensagem aqui
```

**Diferença:** Vírgula após a data

---

### 2.5 Android - Alemão

```
01.05.24, 14:30 - Hans Müller: Nachricht hier
```

**Diferença:** Ponto como separador de data

---

### 2.6 Android - Espanhol

```
1/5/24 14:30 - Juan García: Mensaje aquí
```

**Diferença:** Sem vírgula, data D/M/YY

---

## 3. Mensagens de Sistema

Mensagens automáticas do WhatsApp (não são de usuários):

```
01/05/2024 14:30 - As mensagens e as chamadas são protegidas com a criptografia...
01/05/2024 14:31 - João Silva adicionou Maria Santos
01/05/2024 14:32 - Você saiu
01/05/2024 14:33 - João Silva mudou a descrição do grupo
01/05/2024 14:34 - João Silva mudou o ícone do grupo
01/05/2024 14:35 - Esta mensagem foi apagada
```

**Padrões de Sistema (BR):**
```javascript
const SYSTEM_PATTERNS = [
  /criptografia de ponta/i,
  /adicionou/i,
  /removeu/i,
  /saiu/i,
  /entrou usando/i,
  /mudou a descrição/i,
  /mudou o ícone/i,
  /mensagem foi apagada/i,
  /criou o grupo/i,
  /agora é admin/i,
];
```

---

## 4. Mensagens de Mídia

```
01/05/2024 14:30 - João Silva: <Mídia oculta>
01/05/2024 14:31 - João Silva: IMG-20240501-WA0001.jpg (arquivo anexado)
01/05/2024 14:32 - João Silva: PTT-20240501-WA0001.opus (arquivo anexado)
01/05/2024 14:33 - João Silva: STK-20240501-WA0001.webp (arquivo anexado)
01/05/2024 14:34 - João Silva: DOC-20240501-WA0001.pdf (arquivo anexado)
```

**Padrões de Mídia:**
```javascript
const MEDIA_PATTERNS = [
  /<Mídia oculta>/i,
  /<Media omitted>/i,
  /\.(jpg|jpeg|png|gif|webp|mp4|opus|ogg|pdf|docx?)\s*\(arquivo anexado\)/i,
  /^(IMG|VID|PTT|STK|DOC|AUD)-\d{8}-WA\d+/,
];
```

---

## 5. Edge Cases

### 5.1 Nome com Dois Pontos
```
01/05/2024 14:30 - Dr. João: Silva: Mensagem
```
**Solução:** Pegar apenas até o primeiro `:` após o nome

### 5.2 Mensagem Vazia
```
01/05/2024 14:30 - João Silva:
```
**Solução:** Tratar como mensagem vazia, não descartar

### 5.3 Emoji no Nome
```
01/05/2024 14:30 - João 🎮: Mensagem
```
**Solução:** Suportar unicode no nome

### 5.4 Número de Telefone como Nome
```
01/05/2024 14:30 - +55 11 99999-9999: Mensagem
```
**Solução:** Regex aceita números e símbolos

### 5.5 Mensagem com Quebra de Linha
```
01/05/2024 14:30 - João Silva: Linha 1
Linha 2
Linha 3
01/05/2024 14:31 - Maria: Outra msg
```
**Solução:** Linhas sem timestamp são continuação da anterior

---

## 6. Algoritmo de Parsing Proposto

```typescript
interface ParseResult {
  messages: ParsedMessage[];
  format: DetectedFormat;
  errors: ParseError[];
  stats: ParseStats;
}

interface DetectedFormat {
  platform: 'android' | 'ios';
  locale: string;
  dateFormat: string;
  timeFormat: '12h' | '24h';
  hasSeconds: boolean;
  hasBrackets: boolean;
}

async function parseWhatsAppExport(content: string): Promise<ParseResult> {
  const lines = content.split('\n');
  const format = detectFormat(lines.slice(0, 20));  // Detecta com primeiras linhas
  const pattern = getPatternForFormat(format);

  const messages: ParsedMessage[] = [];
  let currentMessage: Partial<ParsedMessage> | null = null;
  const errors: ParseError[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = pattern.exec(line);

    if (match) {
      // Nova mensagem
      if (currentMessage) {
        messages.push(finalizeMessage(currentMessage));
      }
      currentMessage = {
        timestamp: parseTimestamp(match[1], match[2], format),
        sender: match[3].trim(),
        content: match[4],
        type: detectType(match[4]),
        lineNumber: i + 1,
      };
    } else if (currentMessage && line.trim()) {
      // Continuação da mensagem anterior
      currentMessage.content += '\n' + line;
    } else if (line.trim() && !currentMessage) {
      // Linha órfã - erro de parsing
      errors.push({ line: i + 1, content: line, reason: 'orphan_line' });
    }
  }

  // Última mensagem
  if (currentMessage) {
    messages.push(finalizeMessage(currentMessage));
  }

  return {
    messages,
    format,
    errors,
    stats: {
      totalLines: lines.length,
      totalMessages: messages.length,
      errorCount: errors.length,
      participants: [...new Set(messages.map(m => m.sender))],
    }
  };
}

function detectFormat(sampleLines: string[]): DetectedFormat {
  // Tenta cada padrão conhecido
  const patterns = [
    { regex: ANDROID_BR, platform: 'android', locale: 'pt-BR', ... },
    { regex: IOS_EN, platform: 'ios', locale: 'en-US', ... },
    { regex: ANDROID_EN, platform: 'android', locale: 'en-US', ... },
    // ... outros
  ];

  for (const line of sampleLines) {
    for (const p of patterns) {
      if (p.regex.test(line)) {
        return p;
      }
    }
  }

  throw new Error('Formato não reconhecido');
}
```

---

## 7. Testes Necessários

| Cenário | Arquivo de Teste |
|---------|------------------|
| Android BR básico | `android_br_basic.txt` |
| iOS EN básico | `ios_en_basic.txt` |
| Mensagens multilinha | `multiline.txt` |
| Mensagens de sistema | `system_messages.txt` |
| Mídia | `with_media.txt` |
| Edge cases (emoji, etc) | `edge_cases.txt` |
| Chat grande (100k+ msgs) | `large_chat.txt` |
| Caracteres especiais | `special_chars.txt` |

---

## 8. Limitações Conhecidas

1. **Formatos não cobertos:** Idiomas não testados podem falhar
2. **Versões antigas:** WhatsApp antigo pode ter formato diferente
3. **WhatsApp Business:** Pode ter campos extras
4. **Edições:** Mensagens editadas aparecem com "(editada)" no final
5. **Respostas:** Citações não são identificadas como tal

---

## 9. Estratégia de Fallback

Se parsing falhar:
1. Tentar todos os padrões conhecidos
2. Se nenhum funcionar, solicitar ao usuário que identifique o formato
3. Logar formato desconhecido para análise futura
4. Permitir parsing "best effort" ignorando linhas problemáticas
