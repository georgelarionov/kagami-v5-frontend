# F5. Тулы и MCP-интеграция — План реализации

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
- **Коллизии ключей:** при spread duplicate keys молча перезаписываются. При добавлении новых кастомных тулов проверять что ключ не совпадает с MCP-namespaced ключом (e.g. не называть кастомный тул `braveSearch_web_search`)

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

| Server ID | Агент | Пакет | Описание |
|---|---|---|---|
| `braveSearch` | researchAgent | `@modelcontextprotocol/server-brave-search` | Поиск в интернете |

Brave Search — наиболее полезен для research-агента. Требует `BRAVE_API_KEY` (бесплатный ключ на brave.com/search/api).

### Распределение по агентам

| Агент | Кастомные тулы | MCP-тулы | maxSteps |
|---|---|---|---|
| researchAgent | `getCurrentDatetime` | `braveSearch_*` | 5 |
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
    braveSearch: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: {
        BRAVE_API_KEY: process.env.BRAVE_API_KEY!,
      },
    },
  },
})

export let mcpTools: Record<string, any> = {}
try {
  mcpTools = await mcpClient.listTools()
} catch (error) {
  console.error('[MCP] Failed to initialize Brave Search tools:', error)
  // Server continues without MCP tools — agent works but can't search
}
```

> **Top-level `await`** — стандартный паттерн Mastra (ESM с поддержкой TLA). Тулы резолвятся один раз при старте сервера.
>
> **Error handling:** `try/catch` предотвращает crash всего Mastra-сервера при ошибке MCP (отсутствующий API key, network error, невалидный пакет). Агент продолжает работать без MCP-тулов — кастомные тулы остаются доступны.
>
> `listTools()` возвращает `Record<string, Tool>` с namespace: `braveSearch_web_search`, `braveSearch_local_search` и т.д.
>
> **Пакет:** `@modelcontextprotocol/server-brave-search` — проверить актуальное имя в npm при реализации. Альтернатива: `@anthropic-ai/mcp-server-brave-search`.
>
> **stdio транспорт** (`command` + `args`): MCP-сервер запускается как дочерний процесс. Работает локально и на Railway. `npx -y` скачивает пакет при первом запуске — для production рассмотреть установку как dependency (см. Открытые вопросы).

### Шаг 2.2 — Environment variables

**Добавить в `.env`** (kagami-api):
```bash
BRAVE_API_KEY=your-brave-api-key
```

**Railway:** добавить `BRAVE_API_KEY` в переменные окружения сервиса `kagami-v5`.

> Получить бесплатный API ключ: https://brave.com/search/api

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
  description: 'Gathers information, analyzes data, and returns structured summaries. Has access to web search and utility tools. Use for factual questions, research tasks, and data analysis.',
  instructions: `You are a research specialist. Your role:
- Gather and analyze information based on the request
- Use web search to find current information when needed
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

> **`tools: { ...customTools, ...mcpTools }`** — spread кастомных и MCP-тулов в один map. Research agent видит все тулы.
>
> **`maxSteps: 5`** — research agent может: (1) вызвать тул → (2) обработать результат → (3) вызвать ещё тул → ... → (5) сформировать ответ. Без maxSteps > 1 агент вызовет тул, но не сможет обработать результат (останавливается после 1 шага).
>
> **`description` обновлён** — упоминает доступные инструменты. Supervisor использует description для принятия решения о делегировании.
>
> **`instructions` обновлены** — явно указывают когда использовать тулы. Помогает LLM принимать решения о вызове.

### Шаг 3.2 — writer-agent (без изменений)

`src/mastra/agents/writer-agent.ts` — остаётся без тулов.

Writer agent специализируется на генерации текста из предоставленных данных. Тулы для этого не нужны. При необходимости (grammar checker, translation) — добавить по F7 конвенциям.

### Шаг 3.3 — Обновить supervisor instructions

**Изменить:** `src/mastra/agents/supervisor.ts`

Обновить секцию `Available agents` и `Delegation strategy` в instructions:

```typescript
instructions: `You are Kagami, an intelligent assistant that coordinates specialized agents to help users.

Available agents:
- researchAgent: Gathers information, analyzes data, returns structured summaries. Has web search and utility tools. Use for factual questions, research, analysis, and any request requiring current or external information.
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

> **Изменения vs F4:** обновлено описание researchAgent (упоминает тулы), добавлен пункт 5 (current date/time/real-time data → researchAgent).
>
> Остальные части supervisor'а (`agents`, `defaultOptions`, `memory`) — без изменений.

### Шаг 3.4 — Обновить contracts.md

**Файл:** `plans-docs/v0.2/contracts.md`

> Файл создаётся в F1 (шаг 2.0). Если F1 ещё не реализован — создать файл.

Добавить контракты F5:
- Custom tool IDs: `get-current-datetime`
- Custom tool keys (в стриме): `getCurrentDatetime` → `tool-getCurrentDatetime`
- MCP server ID: `braveSearch`
- MCP tool namespace: `braveSearch_*` (e.g. `braveSearch_web_search`)
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

Открыть Mastra Studio → Agents → kagamiAgent:

**Кастомные тулы:**
- [ ] "What time is it now?" → supervisor делегирует researchAgent → вызывает `getCurrentDatetime` → возвращает время
- [ ] "What is today's date in Europe/Berlin timezone?" → вызывает `getCurrentDatetime` с `timezone: "Europe/Berlin"`

**MCP-тулы (Brave Search):**
- [ ] "Search for latest AI news" → supervisor делегирует researchAgent → вызывает `braveSearch_web_search`
- [ ] "Find information about Mastra framework" → research agent использует web search, цитирует источники

**Без тулов:**
- [ ] "Hello, how are you?" → supervisor отвечает напрямую (без делегирования)
- [ ] "Write a short poem about coding" → supervisor делегирует writerAgent (без тулов)

**Multi-step:**
- [ ] "Search for latest trends in AI and write a summary article" → research (search) → writer (content)

**Ошибки:**
- [ ] Пустой или невалидный `BRAVE_API_KEY` → research agent получает ошибку от MCP → корректно обрабатывается, возвращает текстовый ответ об ошибке

**Тулы в Mastra Studio:**
- [ ] Agents → research-agent → Tools: видны `getCurrentDatetime` + `braveSearch_*`
- [ ] Agents → writer-agent → Tools: пусто
- [ ] Agents → kagamiAgent (supervisor) → Tools: видны `agent-researchAgent`, `agent-writerAgent` (auto-generated delegation tools)

---

## Фронтенд

**Изменений нет.** Tool calls отображаются через F3 (prompt-kit `Tool` компонент):
- Кастомные тулы: `tool-getCurrentDatetime` → сворачиваемый Tool block с именем и JSON результатом
- MCP-тулы: `tool-braveSearch_web_search` → аналогично

> **Оговорка:** если tool calls суб-агентов не проходят через supervisor stream (nested execution), они не будут видны в UI. В этом случае пользователь видит только delegation events (F4: "Research Agent..." → зелёная галочка) и финальный синтезированный ответ supervisor'а. Для MVP это допустимо.

---

## Проверка

### Бэкенд
- [ ] `npm install @mastra/mcp` — пакет установлен без ошибок
- [ ] `get-current-datetime` тул создан, возвращает корректное время
- [ ] `braveSearch` MCP-сервер подключается и возвращает тулы через `listTools()`
- [ ] Research agent видит все тулы (custom + MCP) в Mastra Studio
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

2. **Какие MCP-серверы подключаем** → Brave Search (web search). Наиболее полезен для research-агента — даёт доступ к актуальной информации из интернета. Требует `BRAVE_API_KEY` (бесплатный). Альтернативы для будущего: `@modelcontextprotocol/server-fetch` (загрузка страниц), Wikipedia MCP и др.

3. **Распределение тулов по суб-агентам** → Жёсткое, по специализации. Research agent = все тулы (сбор информации — его задача). Writer agent = без тулов (генерация текста из предоставленных данных). Supervisor = без тулов (делегирует). При добавлении тула для writer'а (e.g. grammar checker) — добавить по тому же паттерну.

4. **maxSteps суб-агентов с тулами** → Research agent: `defaultOptions: { maxSteps: 5 }`. Необходим для цикла: вызвать тул → получить результат → обработать → (опционально) вызвать ещё тул → сформировать ответ. Без `maxSteps > 1` агент вызывает тул, но не может обработать результат (дефолт = 1 шаг). Writer agent: без изменений (`maxSteps: 1`, тулов нет). Supervisor: `maxSteps: 10` (из F4, без изменений).

5. **Именование тулов** → Кастомные: camelCase ключ в exports (`getCurrentDatetime`). MCP: автоматический namespace `serverName_toolName` (`braveSearch_web_search`). Ни один не начинается с `agent-` — нет коллизии с F4 `isDelegationPart()` (`tool-agent-*`).

6. **Top-level await для MCPClient** → Стандартный паттерн Mastra (ESM + top-level await). `await mcpClient.listTools()` резолвится один раз при старте сервера. Тулы статические на уровне F5 — не меняются per-request. Для динамических тулов per-project (F6) — использовать `toolsets` API или `tools: ({ requestContext }) => ...`.

7. **Supervisor и тулы** → Supervisor НЕ получает тулы напрямую. Его единственные "тулы" — auto-generated `agent-researchAgent` и `agent-writerAgent` (из `agents` property). Все реальные тулы живут на суб-агентах. Supervisor решает **кому** делегировать, суб-агент решает **какой тул** вызвать.

8. **Бэкенд vs фронтенд scope** → Только бэкенд. Фронтенд не требует изменений — F3 уже обрабатывает tool parts через `isToolPart()` и prompt-kit `Tool` компонент. F4 обрабатывает delegation events через `isDelegationPart()` и `DelegationStep`.

9. **Комбинирование тулов** → Spread в один объект: `tools: { ...customTools, ...mcpTools }`. Оба возвращают `Record<string, Tool>`. Namespace MCP-тулов (`serverName_toolName`) предотвращает коллизии с кастомными тулами.

---

## Открытые вопросы

1. **Nested tool visibility в supervisor stream** → Проходят ли tool calls суб-агента (e.g. `getCurrentDatetime`) через supervisor stream как отдельные tool parts? Или они скрыты внутри `agent-researchAgent` tool execution? Если скрыты — в UI видны только delegation events (F4), без деталей об использовании конкретных тулов. Проверить при реализации. Не блокирует — delegation events достаточны для MVP.

2. **Точное имя MCP-пакета** → `@modelcontextprotocol/server-brave-search` или `@anthropic-ai/mcp-server-brave-search`? Проверить в npm registry при реализации. Функциональность одинаковая — stdio MCP server для Brave Search API.

3. **MCP в production (Railway)** → `npx -y` скачивает пакет при первом запуске — медленный cold start. Варианты:
   - (a) Установить MCP-сервер как dependency (`npm install @.../server-brave-search`) и запускать через `node node_modules/.bin/...`
   - (b) Оставить `npx -y` — после первого запуска кэшируется
   - (c) Использовать HTTP-транспорт если MCP-сервер доступен как hosted service
   - Рекомендация: начать с (b), перейти на (a) если cold start проблематичен.

4. **MCPClient lifecycle** → Поведение при crash дочернего MCP-процесса (stdio). Автоматический reconnect? Нужен ли health check? Mastra MCPClient может обрабатывать это внутри — проверить документацию и поведение при реализации.

5. **Модель research-агента** → Та же модель что у supervisor'а (`openai/gpt-5.4`) или дешевле? Research с тулами может работать на cheaper модели (tool calling хорошо работает и на меньших моделях). Решить после тестирования качества. Тот же вопрос в F4 (Open Question 2) — решить в одном месте.

6. **Tool ID vs object key в стриме** → `createTool({ id: 'get-current-datetime' })` экспортируется как `{ getCurrentDatetime: tool }`. Какое имя использует LLM и появляется в стриме — `id` (kebab-case) или ключ объекта (camelCase)? По паттерну Mastra ожидается ключ объекта. Проверить при первом тесте в Mastra Studio — от этого зависят записи в contracts.md.
