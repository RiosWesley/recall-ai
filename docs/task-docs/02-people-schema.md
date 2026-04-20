# Schema de Banco de Dados: Pessoas e Relacionamentos

**Objetivo:** Preparar as tabelas base do SQLite para mapear o "Identity Graph" do usuário, permitindo associar chunks de conversas a entidades específicas e mapear relações entre elas.

## 1. Tabelas a Serem Criadas

### Tabela `people`
Armazena as personas consolidadas (tanto as que conversaram com o usuário quanto terceiros).

```sql
CREATE TABLE people (
    id TEXT PRIMARY KEY,           -- nanoid
    name TEXT NOT NULL,
    color TEXT NOT NULL,           -- Cor fixa para a UI (ex: #00d97e)
    bio TEXT,                      -- Resumo dinâmico gerado pelo LLM
    message_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela `person_aliases`
Tabela fundamental para desambiguação. Mapeia variações de como uma pessoa é chamada no chat (apelidos). Será a base para buscas rápidas (FTS5).

```sql
CREATE TABLE person_aliases (
    person_id TEXT NOT NULL,       -- FK para people.id
    alias TEXT NOT NULL,           -- ex: "João", "Joaozinho", "JJ"
    FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE
);
-- Usaremos queries FTS ou LIKE nesta tabela para descobrir menções prováveis.
```

### Tabela `person_relations`
Opcional para este momento inicial, mas necessária para o layout em Grafo do `People.tsx`. 

```sql
CREATE TABLE person_relations (
    source_id TEXT NOT NULL,       -- FK para people.id
    target_id TEXT NOT NULL,       -- FK para people.id
    relation_type TEXT,            -- ex: "amigo", "trabalho", "família"
    strength REAL DEFAULT 0.5,     -- Força da relação (0.0 a 1.0) calculada por menções conjuntas
    PRIMARY KEY (source_id, target_id),
    FOREIGN KEY(source_id) REFERENCES people(id) ON DELETE CASCADE,
    FOREIGN KEY(target_id) REFERENCES people(id) ON DELETE CASCADE
);
```

### Tabela `person_mentions`
Faz a ponte entre a tabela de `chunks` (a sessão de memória) e a pessoa.

```sql
CREATE TABLE person_mentions (
    chunk_id TEXT NOT NULL,        -- FK para chunks.id
    person_id TEXT NOT NULL,       -- FK para people.id
    context TEXT,                  -- O que foi dito sobre ela naquele chunk
    PRIMARY KEY (chunk_id, person_id),
    FOREIGN KEY(chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
    FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE
);
```

## 2. Atualizações em Repositórios
As classes do banco (ex: `PersonRepository`) deverão ser criadas para manipular essas tabelas, com métodos transacionais para:
- `createPersonWithAlias(name: string, alias: string): string`
- `linkMention(chunkId: string, personId: string, context: string)`
- `findProbableMatch(alias: string): Person[]` (usa a tabela `person_aliases`)
