# Contracts — kagami-api ↔ kagami-web

> Единый файл контрактов между репозиториями. Обновляется при каждом бэкенд-изменении.

## F1: Streaming

### Agent

- **Agent ID:** `kagami-supervisor` (свойство `id` в Agent constructor, изменён в F4)
- **Registration key:** `kagamiAgent` (ключ в `agents: { kagamiAgent }`)
- **HTTP endpoint:** `POST /api/agents/kagami-supervisor/stream`

### Streaming (BFF → Mastra Server)

```typescript
// MastraClient вызов из BFF
const client = new MastraClient({ baseUrl: process.env.MASTRA_API_URL })
const agent = client.getAgent('kagami-supervisor')

const stream = await agent.stream(userMessageText, {
  memory: {
    thread: chatId,                     // string — ID чата
    resource: `${userId}:${projectId}`, // composite resourceId
  },
})
```

**Важно:** `agent.stream()` принимает **строку** (последнее сообщение пользователя), не массив. История загружается из memory по `thread` ID на стороне Mastra Server.

### Memory format

```typescript
{
  memory: {
    thread: string | { id: string, title?: string, metadata?: Record<string, unknown> },
    resource: string, // `${userId}:${projectId}`
  }
}
```

### Получение истории сообщений (BFF → Mastra Server)

```typescript
const thread = client.getMemoryThread({
  threadId: chatId,
  agentId: 'kagami-supervisor',
})

const result = await thread.listMessages({
  page: 0,
  perPage: 50,
  orderBy: { field: 'createdAt', direction: 'DESC' },
})
```

**Ответ `listMessages()`:**
```typescript
{
  messages: MastraDBMessage[] // массив сообщений
  total: number              // общее количество сообщений в треде
  hasMore: boolean           // есть ли ещё страницы
}
```

**Параметры пагинации:**
- `page` — номер страницы (0-indexed)
- `perPage` — количество на странице (`number`) или `false` для загрузки всех
- `orderBy` — `{ field: 'createdAt', direction: 'ASC' | 'DESC' }`

### BFF → Browser (streaming)

- Формат: AI SDK UIMessageStream (SSE)
- Конвертация: `toAISdkStream()` из `@mastra/ai-sdk`
- Клиент: `useChat` из `@ai-sdk/react` с `DefaultChatTransport`

### Disconnect behavior

Встроенный Mastra endpoint передаёт `abortSignal` от Hono → при прямом disconnect клиента генерация останавливается.

В production это не проблема: BFF — промежуточный слой. Когда браузер закрывает вкладку, BFF→Mastra fetch продолжает работать (отдельный HTTP-запрос). Mastra заканчивает генерацию и сохраняет в memory.

**Правило для BFF:** НЕ пробрасывать abort signal из browser-запроса в fetch к Mastra Server. Использовать `onFinish` для очистки `pendingMessage`.

### Concurrency guard

- BFF проверяет `pendingMessage IS NOT NULL` → возвращает `409 Conflict`
- Клиент: disable send при `status !== 'ready'`

---

## F2: Пагинация сообщений

### BFF endpoint (Browser → BFF)

```
GET /api/chat/messages?chatId={chatId}&page={page}&perPage={perPage}
```

**Query параметры:**
| Параметр | Тип | Обязательный | Дефолт | Ограничение |
|----------|-----|:---:|--------|-------------|
| `chatId` | string | да | — | — |
| `page` | number | нет | `0` | >= 0 |
| `perPage` | number | нет | `50` | 1–100 |

**Ответ (200):**
```json
{
  "messages": [],
  "hasMore": true
}
```

**Ошибки:**
- `401` — не авторизован
- `400` — отсутствует `chatId`
- `404` — чат не найден / не принадлежит пользователю

### Логика пагинации (BFF)

1. BFF запрашивает Mastra с `orderBy: DESC` — page=0 возвращает **последние** N сообщений
2. Перед отдачей клиенту — `reverse()` в хронологический порядок (ASC)
3. `hasMore` берётся из ответа `listMessages()` (поле `hasMore`)

### Фронтенд

- `useInfiniteQuery` с ключом `['memory', 'messages', chatId]`
- page=0 — последние 50 (initial load)
- page=1, 2... — более ранние сообщения (по кнопке "Загрузить ранние")
- Склейка: `[...pages].reverse().flatMap(p => p.messages)` → хронологический порядок
- Кнопка "Загрузить ранние" заблокирована при стриминге (`status !== 'ready'`)

---

## F4: Supervisor Agent

### Agent

- **Agent ID:** `kagami-supervisor` (свойство `id` в Agent constructor)
- **Registration key:** `kagamiAgent` (ключ в `agents: { kagamiAgent: supervisorAgent }`)
- **HTTP endpoint:** `POST /api/agents/kagami-supervisor/stream`
- **`defaultOptions: { maxSteps: 10 }`** — задан в определении агента, BFF override не обязателен
- **Tools:** `researchTool` (Perplexity Sonar) — доступен supervisor'у напрямую

### Sub-agents

| Sub-agent | ID | Delegation tool name |
|---|---|---|
| Research Agent | `research-agent` | `agent-researchAgent` |
| Writer Agent | `writer-agent` | `agent-writerAgent` |

- Суб-агенты без Memory — контекст через delegation message от supervisor'а
- Delegation tool names автоматически генерируются Mastra из ключей в `agents: { researchAgent, writerAgent }`

### Delegation в стриме

Делегирование приходит как tool call parts в `message.parts`:
- `type: 'tool-agent-researchAgent'` / `type: 'tool-agent-writerAgent'`
- Состояния: `input-streaming` → `input-available` → `output-available` (или `output-error`)
- `input`: сообщение supervisor'а к суб-агенту
- `output`: ответ суб-агента

### Фронтенд — отображение

- Delegation parts (`tool-agent-*`) отображаются как `DelegationStep` (Steps из prompt-kit)
- Обычные tool parts (`tool-*` без `agent-` prefix) отображаются как `Tool` (F3)
- Порядок проверок: `isDelegationPart()` перед `isToolPart()`
