# F5. Тулы и MCP-интеграция — План реализации ✅ COMPLETE

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> Агенты используют кастомные тулы Mastra и тулы MCP-серверов для выполнения задач.
> Зависит от F4 (supervisor + суб-агенты существуют, тулы назначаем им). F3 (tool display) обрабатывает отображение в UI.
> Фронтенд не меняется — тулы видны через F3 (Tool компонент prompt-kit).

**Scope:** только бэкенд (kagami-api). Создание тулов, подключение MCP, назначение агентам.

---

## Контекст: Mastra Tools + MCP

### createTool()

Mastra тулы создаются через `createTool()` из `@mastra/core/tools`:

```typescript
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const myTool = createTool({
  id: 'my-tool',
  description: 'What this tool does (LLM uses this for decision-making)',
  inputSchema: z.object({ ... }),  // Zod schema для входных данных
  outputSchema: z.object({ ... }), // Zod schema для результата
  execute: async (inputData) => {   // Функция выполнения
    return { ... }
  },
})
```

- `id` — уникальный идентификатор тула
- `description` — описание для LLM (критично для качества вызовов)
- `inputSchema` — Zod-схема входных данных (LLM генерирует аргументы по ней)
- `outputSchema` — Zod-схема результата (валидация)
- `execute` — async функция: `async (inputData, context) => {}`. Первый параметр — валидированные данные из `inputSchema`. Второй — опциональный `context` с `requestContext`, `agent`, `mcp` и др. (используется в F6 для per-project config)

> **Альтернатива `MCPClient`:** `MastraMCPClient` — для подключения одного MCP-сервера напрямую (без namespace). В F5 используем `MCPClient` — поддерживает несколько серверов с автоматическим namespace.

### MCPClient

MCP-серверы подключаются через `MCPClient` из `@mastra/mcp`:

```typescript
import { MCPClient } from '@mastra/mcp'

const mcp = new MCPClient({
  servers: {
    serverName: {
      command: 'npx',
      args: ['-y', '@package/mcp-server'],
      env: { API_KEY: process.env.API_KEY },
    },
  },
})

const tools = await mcp.listTools()
// → Record<string, Tool>, namespaced: serverName_toolName
```

- Тулы namespaced: `serverName_toolName` (предотвращает коллизии между серверами)
- `listTools()` — async, возвращает `Record<string, Tool>` для передачи в `agent.tools`
- Транспорты: stdio (`command` + `args`) и HTTP (`url: new URL(...)`)

### Именование тулов

**Важно (из F4):** НЕ использовать prefix `agent-` в именах тулов. `isDelegationPart()` на фронтенде определяет delegation tool calls по `tool-agent-*` — коллизия с обычными тулами если имя начинается с `agent-`.

### Назначение тулов агентам

- **Суб-агенты** получают тулы через `tools` property
- **Supervisor** НЕ получает тулы напрямую — делегирует суб-агентам (auto-generated `agent-*` tools)
- Суб-агентам с тулами нужен `defaultOptions: { maxSteps: N }` где N > 1 — иначе агент вызовет тул, но не обработает результат (дефолт maxSteps = 1, это один шаг = один tool call без обработки ответа)
- Комбинирование: `tools: { ...customTools, ...mcpTools }` — spread кастомных и MCP-тулов в один map
- **Коллизии ключей:** при spread duplicate keys молча перезаписываются. При добавлении новых кастомных тулов проверять что ключ не совпадает с MCP-namespaced ключом (e.g. не называть кастомный тул `apify_*`)

### Видимость tool calls суб-агентов в стриме

При делегировании supervisor → sub-agent → tool:
- В стриме supervisor'а видны **delegation events** (`tool-agent-researchAgent`) — обрабатываются F4
- **Tool calls суб-агента** (e.g. `tool-getCurrentDatetime`) происходят **внутри** delegation tool execution
- Не подтверждено, проходят ли nested tool calls через supervisor stream — проверить при реализации
- Даже если не проходят — delegation events (F4) показывают статус, а финальный результат доступен в output делегирования. Для MVP достаточно

---

## Решение: первые тулы

### Кастомные тулы

| ID | Агент | Описание |
|---|---|---|
| `get-current-datetime` | researchAgent | Текущая дата и время (UTC + timezone) |

Минимальный набор для проверки паттерна. Дополнительные тулы — по F7 конвенциям.

### MCP-серверы

| Server ID | Агент | Транспорт | Описание |
|---|---|---|---|
| `apify` | researchAgent | HTTP/SSE (`https://mcp.apify.com/sse`) | Apify Actors — веб-поиск, скрейпинг, извлечение данных |

Apify MCP — hosted MCP-сервер с доступом к 3000+ Actors из Apify Store. Research-агент получает web search (RAG Web Browser), скрейпинг, извлечение данных с сайтов. Требует `APIFY_TOKEN` (бесплатный аккаунт на apify.com).

### Распределение по агентам

| Агент | Кастомные тулы | MCP-тулы | maxSteps |
|---|---|---|---|
| researchAgent | `getCurrentDatetime` | `apify_*` | 5 |
| writerAgent | — | — | 1 (дефолт) |
| supervisorAgent | — (делегирует) | — | 10 (из F4) |

Research agent получает все тулы (специализация — сбор информации). Writer agent — без тулов (специализация — текстовая генерация). Supervisor делегирует.

---

## Файловая структура (kagami-api)

```
src/mastra/
  tools/
    get-current-datetime.ts   ← кастомный тул
    index.ts                  ← экспорт всех кастомных тулов как Record
  mcp/
    index.ts                  ← MCPClient config + export resolved tools
  agents/
    research-agent.ts         ← ИЗМЕНИТЬ: добавить tools + maxSteps
    writer-agent.ts           ← без изменений
    supervisor.ts             ← ИЗМЕНИТЬ: обновить instructions
```

---

## Фаза 1: Бэкенд — Кастомные тулы (kagami-api)

> **contracts.md:** обновить контракты — список tool IDs, naming convention, распределение по агентам.

### Шаг 1.1 — Установить зависимости

```bash
npm install @mastra/mcp
```

> `@mastra/core` (для `createTool`) и `zod` уже установлены.

### Шаг 1.2 — Создать get-current-datetime

**Создать:** `src/mastra/tools/get-current-datetime.ts`

```typescript
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const getCurrentDatetimeTool = createTool({
  id: 'get-current-datetime',
  description: 'Returns the current date and time in UTC and a specified timezone. Use when you need to know the current time or date.',
  inputSchema: z.object({
    timezone: z
      .string()
      .optional()
      .describe('IANA timezone (e.g. "Europe/Berlin", "America/New_York"). Defaults to UTC.'),
  }),
  outputSchema: z.object({
    utc: z.string(),
    local: z.string(),
    timezone: z.string(),
    unixTimestamp: z.number(),
  }),
  execute: async (inputData) => {
    const now = new Date()
    const tz = inputData.timezone ?? 'UTC'

    return {
      utc: now.toISOString(),
      local: now.toLocaleString('en-US', { timeZone: tz }),
      timezone: tz,
      unixTimestamp: Math.floor(now.getTime() / 1000),
    }
  },
})
```

> Простой тул без внешних зависимостей — идеален для проверки паттерна. Полезен для research-задач ("what happened today?", "what's the current date?").

### Шаг 1.3 — Индекс тулов

**Создать:** `src/mastra/tools/index.ts`

```typescript
import { getCurrentDatetimeTool } from './get-current-datetime'

export const customTools = {
  getCurrentDatetime: getCurrentDatetimeTool,
}
```

> Единый экспорт как `Record<string, Tool>` для spread в `agent.tools`. При добавлении новых тулов — добавить импорт и поле в объект.
>
> **Имя тула в стриме:** Mastra использует **ключ объекта** из `tools` map (e.g. `getCurrentDatetime`) как имя тула, передаваемое LLM. В AI SDK v6 это появится как `tool-getCurrentDatetime` в `message.parts`. Поле `id` из `createTool()` (`get-current-datetime`) используется для внутренней идентификации Mastra (логи, registry). **Проверить при реализации** — если стрим использует `id` вместо ключа, обновить contracts.md.

---

## Фаза 2: Бэкенд — MCP-интеграция (kagami-api)

### Шаг 2.1 — Создать MCPClient

**Создать:** `src/mastra/mcp/index.ts`

```typescript
import { MCPClient } from '@mastra/mcp'

export const mcpClient = new MCPClient({
  servers: {
    apify: {
      url: new URL('https://mcp.apify.com/sse'),
      requestInit: {
        headers: {
          Authorization: `Bearer ${process.env.APIFY_TOKEN}`,
        },
      },
      timeout: 300_000, // 5 минут — Apify Actors могут выполняться долго
    },
  },
})

export let mcpTools: Record<string, any> = {}
try {
  mcpTools = await mcpClient.listTools()
} catch (error) {
  console.error('[MCP] Failed to initialize Apify tools:', error)
  // Server continues without MCP tools — agent works but can't search/scrape
}
```

> **Top-level `await`** — стандартный паттерн Mastra (ESM с поддержкой TLA). Тулы резолвятся один раз при старте сервера.
>
> **Error handling:** `try/catch` предотвращает crash всего Mastra-сервера при ошибке MCP (отсутствующий token, network error). Агент продолжает работать без MCP-тулов — кастомные тулы остаются доступны.
>
> `listTools()` возвращает `Record<string, Tool>` с namespace: `apify_*` (e.g. `apify_rag-web-browser`, `apify_web-scraper` и т.д.).
>
> **HTTP/SSE транспорт** (`url`): hosted MCP-сервер Apify. Не требует установки npm-пакетов — нет дочерних процессов, нет cold start. Авторизация через `Bearer` token в заголовках.
>
> **Timeout 300_000 (5 мин):** Apify Actors (скрейпинг, RAG) могут работать дольше чем простой API-вызов. Увеличенный timeout предотвращает преждевременный abort.
>
> **Проверить при реализации:** точную конфигурацию `requestInit` для `MCPClient` HTTP-транспорта. Если `MCPClient` не поддерживает `requestInit` — использовать `MastraMCPClient` напрямую или передать auth через query params (`?token=...`).

### Шаг 2.2 — Environment variables

**Добавить в `.env`** (kagami-api):
```bash
APIFY_TOKEN=your-apify-api-token
```

**Railway:** добавить `APIFY_TOKEN` в переменные окружения сервиса `kagami-v5`.

> Получить бесплатный API токен: https://console.apify.com/account/integrations

---

## Фаза 3: Бэкенд — Назначение тулов агентам (kagami-api)

### Шаг 3.1 — Обновить research-agent

**Изменить:** `src/mastra/agents/research-agent.ts`

```typescript
import { Agent } from '@mastra/core/agent'
import { customTools } from '../tools'
import { mcpTools } from '../mcp'

export const researchAgent = new Agent({
  id: 'research-agent',
  name: 'Research Agent',
  description: 'Gathers information, analyzes data, and returns structured summaries. Has access to Apify web search/scraping and utility tools. Use for factual questions, research tasks, data analysis, and extracting information from websites.',
  instructions: `You are a research specialist. Your role:
- Gather and analyze information based on the request
- Use Apify tools (web search, scraping) to find current information when needed
- Use the datetime tool when you need to know current date/time
- Return structured, factual summaries with bullet points
- Be thorough but concise
- If you cannot find specific information, clearly state what is unknown
- Cite sources when using search results`,
  model: 'openai/gpt-5.4',
  // F6: this will change to dynamic function:
  // tools: ({ requestContext }) => filterTools({ ...customTools, ...mcpTools }, requestContext)
  tools: { ...customTools, ...mcpTools },
  defaultOptions: { maxSteps: 5 },
})
```

> **`tools: { ...customTools, ...mcpTools }`** — spread кастомных и MCP-тулов в один map. Research agent видит все тулы (custom + Apify).
>
> **`maxSteps: 5`** — research agent может: (1) вызвать тул → (2) обработать результат → (3) вызвать ещё тул → ... → (5) сформировать ответ. Без maxSteps > 1 агент вызовет тул, но не сможет обработать результат (останавливается после 1 шага).
>
> **`description` обновлён** — упоминает Apify и доступные инструменты. Supervisor использует description для принятия решения о делегировании.
>
> **`instructions` обновлены** — явно указывают когда использовать Apify тулы. Помогает LLM принимать решения о вызове.

### Шаг 3.2 — writer-agent (без изменений)

`src/mastra/agents/writer-agent.ts` — остаётся без тулов.

Writer agent специализируется на генерации текста из предоставленных данных. Тулы для этого не нужны. При необходимости (grammar checker, translation) — добавить по F7 конвенциям.

### Шаг 3.3 — Обновить supervisor instructions

**Изменить:** `src/mastra/agents/supervisor.ts`

Обновить секцию `Available agents` и `Delegation strategy` в instructions:

```typescript
instructions: `You are Kagami, an intelligent assistant that coordinates specialized agents to help users.

Available agents:
- researchAgent: Gathers information, analyzes data, returns structured summaries. Has Apify (web search, scraping) and utility tools. Use for factual questions, research, analysis, and any request requiring current or external information.
- writerAgent: Creates polished content, formats text, writes documents. Use for writing, editing, and formatting tasks.

Delegation strategy:
1. Simple questions and greetings: Answer directly without delegation
2. Research-heavy requests (facts, analysis, comparisons, current events): Delegate to researchAgent
3. Writing/content requests (articles, emails, documents): Delegate to writerAgent
4. Complex requests requiring both: Delegate to researchAgent first for facts, then writerAgent for polished output
5. Questions about current date, time, or real-time data: Delegate to researchAgent (has tools for this)
6. Follow-up questions: Use context from previous messages, delegate only if new work is needed

Guidelines:
- Always synthesize sub-agent outputs into a coherent final response for the user
- Don't expose internal delegation mechanics to the user in your text responses
- If a sub-agent's response is incomplete, iterate or supplement it yourself
- Keep responses concise and well-formatted`,
```

> **Изменения vs F4:** обновлено описание researchAgent (упоминает Apify тулы), добавлен пункт 5 (current date/time/real-time data → researchAgent).
>
> Остальные части supervisor'а (`agents`, `defaultOptions`, `memory`) — без изменений.

### Шаг 3.4 — Обновить contracts.md

**Файл:** `plans-docs/v0.2/contracts.md`

> Файл создаётся в F1 (шаг 2.0). Если F1 ещё не реализован — создать файл.

Добавить контракты F5:
- Custom tool IDs: `get-current-datetime`
- Custom tool keys (в стриме): `getCurrentDatetime` → `tool-getCurrentDatetime`
- MCP server ID: `apify`
- MCP tool namespace: `apify_*` (e.g. `apify_rag-web-browser`, `apify_web-scraper`)
- Tool assignment: researchAgent = all tools, writerAgent = none, supervisor = none (delegates)
- Research agent maxSteps: 5
- Tool name convention: NO `agent-` prefix (collision with delegation detection in F4)
- Tool calls in stream: standard `tool-{toolKey}` format (handled by F3 Tool component)

---

## Фаза 4: Проверка через Mastra Studio

### Шаг 4.1 — Запуск и тестирование

```bash
cd /path/to/kagami-v5
npm run dev
```

Открыть Mastra Studio → Agents → kagami-agent:

**Кастомные тулы:**
- [ ] "What time is it now?" → supervisor делегирует researchAgent → вызывает `getCurrentDatetime` → возвращает время
- [ ] "What is today's date in Europe/Berlin timezone?" → вызывает `getCurrentDatetime` с `timezone: "Europe/Berlin"`

**MCP-тулы (Apify):**
- [ ] "Search for latest AI news" → supervisor делегирует researchAgent → вызывает Apify web search tool
- [ ] "Find information about Mastra framework" → research agent использует Apify для поиска, цитирует источники

**Без тулов:**
- [ ] "Hello, how are you?" → supervisor отвечает напрямую (без делегирования)
- [ ] "Write a short poem about coding" → supervisor делегирует writerAgent (без тулов)

**Multi-step:**
- [ ] "Search for latest trends in AI and write a summary article" → research (search) → writer (content)

**Ошибки:**
- [ ] Пустой или невалидный `APIFY_TOKEN` → research agent получает ошибку от MCP → корректно обрабатывается, возвращает текстовый ответ об ошибке

**Тулы в Mastra Studio:**
- [ ] Agents → research-agent → Tools: видны `getCurrentDatetime` + `apify_*`
- [ ] Agents → writer-agent → Tools: пусто
- [ ] Agents → kagami-agent (supervisor) → Tools: видны `agent-researchAgent`, `agent-writerAgent` (auto-generated delegation tools)

---

## Фронтенд

**Изменений нет.** Tool calls отображаются через F3 (prompt-kit `Tool` компонент):
- Кастомные тулы: `tool-getCurrentDatetime` → сворачиваемый Tool block с именем и JSON результатом
- MCP-тулы: `tool-apify_*` → аналогично

> **Оговорка:** если tool calls суб-агентов не проходят через supervisor stream (nested execution), они не будут видны в UI. В этом случае пользователь видит только delegation events (F4: "Research Agent..." → зелёная галочка) и финальный синтезированный ответ supervisor'а. Для MVP это допустимо.

---

## Проверка

### Бэкенд
- [ ] `npm install @mastra/mcp` — пакет установлен без ошибок
- [ ] `get-current-datetime` тул создан, возвращает корректное время
- [ ] Apify MCP-сервер подключается по HTTP/SSE и возвращает тулы через `listTools()`
- [ ] Research agent видит все тулы (custom + Apify MCP) в Mastra Studio
- [ ] Writer agent без тулов
- [ ] Supervisor делегирует research-агенту для tool-based задач
- [ ] Research agent корректно вызывает тулы и обрабатывает результаты (`maxSteps: 5`)
- [ ] Ошибки тулов корректно обрабатываются (не крашат агента, возвращается текстовое описание ошибки)
- [ ] Multi-step delegation: research (с тулами) → writer → финальный ответ

### Фронтенд (через F3, без изменений F5)
- [ ] Tool calls отображаются как сворачиваемые блоки (если видны в supervisor stream)
- [ ] Delegation events (F4 `DelegationStep`) показывают статус sub-agent'ов
- [ ] Ошибки тулов: `output-error` отображается в раскрытом Tool блоке
- [ ] Стриминг: tool states обновляются в реальном времени (`input-streaming` → `output-available`)
- [ ] История: tool calls из memory отображаются в финальном состоянии

---

## Решённые вопросы

1. **Какие кастомные тулы создаём** → `get-current-datetime` — минимальный набор для проверки паттерна `createTool()`. Дополнительные тулы добавляются по F7 конвенциям (один файл на тул + регистрация в index + TOOL_REGISTRY).

2. **Какие MCP-серверы подключаем** → Apify MCP (hosted, HTTP/SSE). Наиболее полезен для research-агента — даёт доступ к 3000+ Actors: веб-поиск (RAG Web Browser), скрейпинг, извлечение данных. Hosted сервер — не нужен npm-пакет, нет дочерних процессов, нет cold start. Требует `APIFY_TOKEN` (бесплатный аккаунт). Альтернативы для будущего: `@modelcontextprotocol/server-fetch` (загрузка страниц), Wikipedia MCP и др.

3. **Распределение тулов по суб-агентам** → Жёсткое, по специализации. Research agent = все тулы (сбор информации — его задача). Writer agent = без тулов (генерация текста из предоставленных данных). Supervisor = без тулов (делегирует). При добавлении тула для writer'а (e.g. grammar checker) — добавить по тому же паттерну.

4. **maxSteps суб-агентов с тулами** → Research agent: `defaultOptions: { maxSteps: 5 }`. Необходим для цикла: вызвать тул → получить результат → обработать → (опционально) вызвать ещё тул → сформировать ответ. Без `maxSteps > 1` агент вызывает тул, но не может обработать результат (дефолт = 1 шаг). Writer agent: без изменений (`maxSteps: 1`, тулов нет). Supervisor: `maxSteps: 10` (из F4, без изменений).

5. **Именование тулов** → Кастомные: camelCase ключ в exports (`getCurrentDatetime`). MCP: автоматический namespace `serverName_toolName` (`apify_*`). Ни один не начинается с `agent-` — нет коллизии с F4 `isDelegationPart()` (`tool-agent-*`).

6. **Top-level await для MCPClient** → Стандартный паттерн Mastra (ESM + top-level await). `await mcpClient.listTools()` резолвится один раз при старте сервера. Тулы статические на уровне F5 — не меняются per-request. Для динамических тулов per-project (F6) — использовать `toolsets` API или `tools: ({ requestContext }) => ...`. HTTP/SSE транспорт Apify — не требует дочерних процессов.

7. **Supervisor и тулы** → Supervisor НЕ получает тулы напрямую. Его единственные "тулы" — auto-generated `agent-researchAgent` и `agent-writerAgent` (из `agents` property). Все реальные тулы живут на суб-агентах. Supervisor решает **кому** делегировать, суб-агент решает **какой тул** вызвать.

8. **Бэкенд vs фронтенд scope** → Только бэкенд. Фронтенд не требует изменений — F3 уже обрабатывает tool parts через `isToolPart()` и prompt-kit `Tool` компонент. F4 обрабатывает delegation events через `isDelegationPart()` и `DelegationStep`.

9. **Комбинирование тулов** → Spread в один объект: `tools: { ...customTools, ...mcpTools }`. Оба возвращают `Record<string, Tool>`. Namespace MCP-тулов (`serverName_toolName`) предотвращает коллизии с кастомными тулами.

---

## Открытые вопросы

1. **Nested tool visibility в supervisor stream** → Проходят ли tool calls суб-агента (e.g. `getCurrentDatetime`) через supervisor stream как отдельные tool parts? Или они скрыты внутри `agent-researchAgent` tool execution? Если скрыты — в UI видны только delegation events (F4), без деталей об использовании конкретных тулов. Проверить при реализации. Не блокирует — delegation events достаточны для MVP.

2. **MCPClient HTTP auth конфигурация** → Apify MCP требует `Authorization: Bearer` header. Точный формат конфигурации `MCPClient` для HTTP/SSE с auth headers (`requestInit`?) — проверить в документации Mastra при реализации. Альтернатива: `MastraMCPClient` (single server) с явным `connect()` и `tools()`.

3. **Apify Actors в MCP** → Какие конкретно Actors доступны через `mcp.apify.com/sse` по умолчанию? Нужна ли конфигурация `actors` параметра для выбора конкретных Actors? Проверить документацию Apify и вывод `listTools()` при реализации.

4. **MCPClient SSE reconnect** → Поведение при разрыве HTTP/SSE соединения с Apify MCP. Автоматический reconnect? Timeout handling? Mastra MCPClient может обрабатывать это внутри — проверить при реализации.

5. **Модель research-агента** → Та же модель что у supervisor'а (`openai/gpt-5.4`) или дешевле? Research с тулами может работать на cheaper модели (tool calling хорошо работает и на меньших моделях). Решить после тестирования качества. Тот же вопрос в F4 (Open Question 2) — решить в одном месте.

6. **Tool ID vs object key в стриме** → `createTool({ id: 'get-current-datetime' })` экспортируется как `{ getCurrentDatetime: tool }`. Какое имя использует LLM и появляется в стриме — `id` (kebab-case) или ключ объекта (camelCase)? По паттерну Mastra ожидается ключ объекта. Проверить при первом тесте в Mastra Studio — от этого зависят записи в contracts.md.
