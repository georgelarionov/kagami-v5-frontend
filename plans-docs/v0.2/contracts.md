# Contracts — kagami-api ↔ kagami-web

> Единый файл контрактов между репозиториями. Обновляется при каждом бэкенд-изменении.

## F1: Streaming

### Agent

- **Agent ID:** `kagami-agent` (свойство `id` в Agent constructor)
- **Registration key:** `kagamiAgent` (ключ в `agents: { kagamiAgent }`)
- **HTTP endpoint:** `POST /api/agents/kagami-agent/stream`

### Streaming (BFF → Mastra Server)

```typescript
// MastraClient вызов из BFF
const client = new MastraClient({ baseUrl: process.env.MASTRA_API_URL })
const agent = client.getAgent('kagami-agent')

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
  agentId: 'kagami-agent',
})

const result = await thread.listMessages({
  page: 0,
  perPage: 50,
  orderBy: { field: 'createdAt', direction: 'ASC' },
})
// result.messages, result.total, result.hasMore
```

### BFF → Browser

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
