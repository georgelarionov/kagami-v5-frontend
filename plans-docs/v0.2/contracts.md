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
- **Tools:** нет (делегирует суб-агентам). В F4 был `researchTool` напрямую — перенесён на research-agent в F5

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

---

## F5: Tools & MCP

### Custom Tools

| Tool ID | Object key (in stream) | Agent |
|---|---|---|
| `get-current-datetime` | `getCurrentDatetime` → `tool-getCurrentDatetime` | researchAgent |
| `research` | `researchTool` → `tool-researchTool` | researchAgent (перенесён с supervisor в F5) |

- Naming convention: NO `agent-` prefix in tool names (collision with F4 delegation detection `isDelegationPart()`)
- Tool calls in stream: standard `tool-{objectKey}` format (handled by F3 Tool component)

### MCP Servers

| Server ID | Transport | Agent | Namespace |
|---|---|---|---|
| `apify` | HTTP/SSE (`https://mcp.apify.com/sse`) | researchAgent | `apify_*` |

- MCP tools namespaced: `apify_{toolName}` (e.g. `apify_rag-web-browser`)
- Auth: `Bearer ${APIFY_TOKEN}` via custom fetch
- Timeout: 300s (Apify Actors can run long)
- Graceful fallback: if MCP init fails, server continues without MCP tools

### Tool Assignment

| Agent | Custom tools | MCP tools | maxSteps |
|---|---|---|---|
| researchAgent | `getCurrentDatetime`, `researchTool` | `apify_*` | 5 |
| writerAgent | — | — | 1 (default) |
| supervisorAgent | — (delegates) | — | 10 (from F4) |

### Environment Variables (kagami-api)

```bash
APIFY_TOKEN=   # Apify API token for MCP server
```

---

## F6: Project Config

> Контракты F6 см. в `plans-docs/v0.2/f6-project-config.md`

---

## F7: Registry API

### Endpoint (Mastra Server)

- `GET {MASTRA_API_URL}/registry` — returns full registry (no auth, private network)

### BFF proxy (Browser → BFF)

- `GET /api/registry` — proxied with Clerk auth

### Response (200)

```json
{
  "agents": [
    { "id": "research-agent", "name": "Research Agent", "description": "...", "defaultPrompt": "..." }
  ],
  "tools": [
    { "key": "getCurrentDatetime", "id": "get-current-datetime", "name": "Current Date & Time", "description": "...", "source": "custom", "agentId": "research-agent", "configSchema": null }
  ],
  "supervisorDefaultPrompt": "You are Kagami..."
}
```

### Response fields

- `agents[]`: id, name, description, defaultPrompt
- `tools[]`: key, id, name, description, source (`'custom'` | `'mcp'`), agentId, configSchema
- `supervisorDefaultPrompt`: string

### configSchema format

- JSON Schema (converted from Zod via `zod-to-json-schema`)
- `null` if tool has no configurable params
- Supported property types: string, number, integer, boolean

### Errors

- `401` — Unauthorized (BFF proxy only)
- `502` — Mastra server unreachable

---

## F8: Chat History Management

### Endpoint (BFF)

- `DELETE /api/chat/messages?chatId=<uuid>` — clear all messages

### Response

- `200`: `{ "ok": true }`
- `400`: Missing chatId
- `401`: Unauthorized
- `404`: Chat not found / not owned
- `409`: Active run (pendingMessage set)
- `500`: Server error

### Behavior

- Deletes all messages from Mastra memory thread via `DELETE /memory/deleteMessages` with `{ threadId, clearAll: true }`
- Thread itself preserved (can send new messages)
- Does NOT delete chat record from frontend DB
- Rejected while pendingMessage is set (active run)

---

## F9: Thesys Reports (Revised)

### Architecture

Reports are stored on kagami-api side (PostgresStore `kagami_reports` table).
Research agent calls `generateReport` tool, saves c1Content to DB, returns `{ reportId, title }`.
Research agent includes text marker `:::report{id="<reportId>" title="<title>"}:::` in response.
Frontend parses markers in text parts, renders ReportCard, fetches c1Content from BFF proxy on demand.

### Text Marker Format

```
:::report{id="<uuid>" title="<report title>"}:::
```

Embedded in assistant message text parts. Parsed by `src/lib/parse-report-markers.ts`.

### Backend Endpoint (kagami-api)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reports/:id` | Fetch report by ID (c1Content + metadata). Uses custom route, not `/api/*` (reserved by Mastra). |

### BFF Proxy (kagami-web)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports/[id]` | Proxy to kagami-api with Clerk auth + ownership check |

```
Response: { id, resourceId, threadId, title, c1Content, artifactId, createdAt }
Errors: 401, 404, 500
```

### Report Guidelines

Stored in `project_config.toolParams.generateReport.guidelines` (string).
Tool reads from requestContext via F6 middleware.

### Environment (kagami-api)

```bash
THESYS_API_KEY=   # Thesys C1 API key
```
