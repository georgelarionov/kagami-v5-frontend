# F6. Конфигурация на уровне проекта через Request Context — План реализации

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> Конфигурация per-project: системные промпты, выбор тулов, параметры тулов. Хранится в БД, применяется через Mastra `requestContext`.
> Зависит от F4 (supervisor + суб-агенты) и F5 (тулы существуют).
> Самая комплексная фича — затрагивает оба репо, shared DB, middleware.

**Goal:** Пользователь может настроить поведение агентов и тулов per-project через UI настроек. Настройки хранятся в БД, применяются к каждому запросу через Mastra middleware + requestContext.

**Architecture:** BFF передаёт `X-Project-Id` header при каждом вызове MastraClient. Mastra Server middleware читает header, загружает конфиг из shared DB, заполняет `requestContext`. Агенты используют динамические functions для `instructions` и `tools`, читая значения из `requestContext` с fallback на захардкоженные дефолты.

**Tech Stack:** Drizzle ORM (миграция), Mastra middleware + requestContext, `@neondatabase/serverless` (backend DB read), shadcn Sheet + react-query (UI).

---

## Контекст: Mastra requestContext + middleware

**Подтверждено документацией Mastra:**

### Middleware

Middleware задаётся в `server.middleware[]` конфига Mastra instance. Получает Hono context, может читать headers и заполнять requestContext:

```typescript
import { Mastra } from '@mastra/core'

export const mastra = new Mastra({
  server: {
    middleware: [
      async (context, next) => {
        const projectId = context.req.header('X-Project-Id')
        const requestContext = context.get('requestContext')
        requestContext.set('projectId', projectId)
        await next()
      },
    ],
  },
})
```

### requestContext в агентах

Конфигурационные свойства агента (`instructions`, `tools`, `model`, `memory`) могут быть функциями, принимающими `{ requestContext }`:

```typescript
const agent = new Agent({
  instructions: async ({ requestContext }) => {
    const customPrompt = requestContext?.get('supervisorPrompt')
    return customPrompt || DEFAULT_PROMPT
  },
  tools: ({ requestContext }) => {
    const activeTools = requestContext?.get('activeTools')
    // filter tools based on config
  },
})
```

### requestContextSchema

Zod-схема для валидации полей requestContext. Определяется на агенте:

```typescript
requestContextSchema: z.object({
  supervisorPrompt: z.string().optional(),
  agentPrompts: z.record(z.string()).optional(),
  activeTools: z.array(z.string()).optional(),
  toolParams: z.record(z.record(z.unknown())).optional(),
})
```

### MastraClient custom headers

`MastraClient` принимает `headers` при инициализации. BFF создаёт instance per-request с `X-Project-Id`:

```typescript
const client = new MastraClient({
  baseUrl: process.env.MASTRA_API_URL,
  headers: { 'X-Project-Id': projectId },
})
```

> В F1 (шаг 3.2) BFF route уже создаёт MastraClient per-request — `X-Project-Id` добавлен как placeholder для F6.

### registerApiRoute

Кастомные HTTP endpoints на Mastra Server через `server.apiRoutes[]`:

```typescript
import { registerApiRoute } from '@mastra/core/server'

export const mastra = new Mastra({
  server: {
    apiRoutes: [
      registerApiRoute('/my-route', {
        method: 'GET',
        handler: async (c) => {
          return c.json({ data: '...' })
        },
      }),
    ],
  },
})
```

> Используется в F7 для `/api/registry`. В F6 может быть полезен для эндпоинта дефолтных промптов, но MVP захардкодит дефолты на фронтенде.

---

## Архитектура: поток данных

```
┌─────────┐    PUT /api/project/config     ┌──────────────────┐
│ Settings │ ─────────────────────────────→ │  project_config  │
│   UI     │ ←───────────────────────────── │   (Neon DB)      │
│          │    GET /api/project/config     │                  │
└─────────┘                                └────────┬─────────┘
                                                    │ read
┌─────────┐    POST /api/chat              ┌────────▼─────────┐
│  Chat    │ ─── X-Project-Id header ────→ │  Mastra Server   │
│   UI     │ ←── SSE stream ──────────────  │  middleware      │
└─────────┘                                │  → requestContext │
                                           │  → agent config   │
                                           └──────────────────┘
```

1. **Настройки UI** → `PUT /api/project/config` → сохраняет в `project_config` (Drizzle, frontend)
2. **Чат** → BFF добавляет `X-Project-Id` header → Mastra middleware читает header → загружает `project_config` из shared DB → заполняет `requestContext`
3. **Агенты** → динамические `instructions({ requestContext })` и `tools({ requestContext })` → fallback на дефолты если config пуст

---

## Фаза 0: Эксперимент — requestContext в суб-агентах

> По аналогии с F1 (критический эксперимент). Проверить до реализации основной логики.

**Вопрос:** получают ли суб-агенты тот же `requestContext`, что и supervisor, при делегировании через `agent.stream()` с `maxSteps`?

Если НЕТ — dynamic `instructions` и `tools` суб-агентов не сработают (молчаливый fallback на дефолты без ошибки). Потребуется альтернативная архитектура.

**Эксперимент:**
1. В kagami-api создать тестовый supervisor + sub-agent
2. Sub-agent: `instructions: ({ requestContext }) => requestContext?.get('testKey') ?? 'NO_CONTEXT'`
3. Middleware: `requestContext.set('testKey', 'HAS_CONTEXT')`
4. Вызвать supervisor через HTTP (с middleware) → делегирование → проверить ответ sub-agent'а
5. Если sub-agent ответил с "HAS_CONTEXT" → requestContext пробрасывается, план работает as-is
6. Если "NO_CONTEXT" → нужен workaround

**Если ДА (ожидаемый результат):** план работает без изменений. `requestContext` привязан к HTTP-запросу, все agent executions в рамках одного запроса разделяют его.

**Если НЕТ — варианты workaround:**
- **A) Промпты через supervisor instructions:** supervisor получает кастомные промпты суб-агентов из requestContext и включает их в delegation messages. Минус: суб-агенты не получают свои промпты как system instructions, а как часть user-сообщения от supervisor'а
- **B) Промпты через supervisor tools config:** supervisor передаёт промпты как tool input при делегировании. Минус: требует модификации auto-generated delegation tools
- **C) Конфиг в supervisor instructions:** supervisor получает все промпты и tool config, передаёт суб-агентам через delegation context. Самый реалистичный workaround — supervisor уже знает контекст проекта

> По документации Mastra ожидаем ДА — requestContext привязан к HTTP-запросу. Но это **UNCONFIRMED**. Эксперимент обязателен перед реализацией Фазы 3.

---

## Фаза 1: База данных (kagami-v5-frontend)

### Шаг 1.1 — Drizzle schema: таблица project_config

**Изменить:** `src/db/schema.ts`

```typescript
import { pgTable, text, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core'

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const chats = pgTable('chats', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  title: text('title'),
  pendingMessage: text('pending_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const projectConfig = pgTable('project_config', {
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id)
    .primaryKey(),
  supervisorPrompt: text('supervisor_prompt'),
  agentPrompts: jsonb('agent_prompts').$type<Record<string, string>>(),
  activeTools: jsonb('active_tools').$type<string[]>(),
  toolParams: jsonb('tool_params').$type<Record<string, Record<string, unknown>>>(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
```

> **Primary key = `project_id`** — один конфиг на проект. PK гарантирует уникальность.
>
> **Все поля nullable** (кроме `project_id`, `updated_at`) — `null` означает "использовать дефолт". В БД хранятся только переопределения.
>
> **jsonb типизация:** `$type<T>()` — Drizzle helper для TypeScript-типов jsonb полей. Runtime валидация — на уровне BFF API.
>
> **`updatedAt`** — для UI: показать когда настройки последний раз менялись.

### Шаг 1.2 — Сгенерировать и применить миграцию

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

**Проверка:**
- [ ] Миграция создана в `drizzle/` — `CREATE TABLE project_config`
- [ ] Миграция применена без ошибок
- [ ] Таблица видна в Neon Console

> **Порядок деплоя (shared DB):** фронт деплоится первым (миграция создаёт таблицу), бэкенд вторым (middleware начинает читать из неё). Пока middleware не добавлен — бэкенд не зависит от новой таблицы.

---

## Фаза 2: BFF API (kagami-v5-frontend)

### Шаг 2.1 — GET /api/project/config

**Создать:** `src/app/api/project/config/route.ts`

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { projectConfig, projects } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })

  // Verify user owns the project
  const [project] = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Get config (may not exist — return empty config)
  const [config] = await getDb()
    .select()
    .from(projectConfig)
    .where(eq(projectConfig.projectId, projectId))

  return NextResponse.json({
    config: config
      ? {
          supervisorPrompt: config.supervisorPrompt,
          agentPrompts: config.agentPrompts,
          activeTools: config.activeTools,
          toolParams: config.toolParams,
          updatedAt: config.updatedAt,
        }
      : null,
  })
}
```

> **`config: null`** означает "нет переопределений, всё дефолтное". UI показывает пустые поля с placeholder-дефолтами.
>
> **`req.json()` не используется** — GET читает query params через `searchParams`. Конвенция `try/catch` для `req.json()` (CLAUDE.md) применяется только к endpoints с JSON body (POST, PUT).

### Шаг 2.2 — PUT /api/project/config

**Добавить в тот же файл:** `src/app/api/project/config/route.ts`

```typescript
export async function PUT(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    projectId: string
    supervisorPrompt?: string | null
    agentPrompts?: Record<string, string> | null
    activeTools?: string[] | null
    toolParams?: Record<string, Record<string, unknown>> | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.projectId) {
    return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })
  }

  // Verify user owns the project
  const [project] = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, body.projectId), eq(projects.userId, userId)))
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Upsert config
  const values = {
    projectId: body.projectId,
    supervisorPrompt: body.supervisorPrompt ?? null,
    agentPrompts: body.agentPrompts ?? null,
    activeTools: body.activeTools ?? null,
    toolParams: body.toolParams ?? null,
    updatedAt: new Date(),
  }

  await getDb()
    .insert(projectConfig)
    .values(values)
    .onConflictDoUpdate({
      target: projectConfig.projectId,
      set: {
        supervisorPrompt: values.supervisorPrompt,
        agentPrompts: values.agentPrompts,
        activeTools: values.activeTools,
        toolParams: values.toolParams,
        updatedAt: values.updatedAt,
      },
    })

  return NextResponse.json({ ok: true })
}
```

> **Upsert** через `onConflictDoUpdate` — создаёт запись при первом сохранении, обновляет при повторных.
>
> **Null = сброс к дефолту.** Клиент отправляет `null` для полей, которые нужно сбросить. Сервер сохраняет `null` в БД — middleware на бэкенде увидит `null` и агент использует дефолт.
>
> **Полная перезапись** — PUT заменяет все поля. Не partial merge — клиент всегда отправляет полный конфиг. Проще и предсказуемее чем PATCH.

### Шаг 2.3 — MastraClient с X-Project-Id

**Изменить:** `src/app/api/chat/route.ts` (после F1)

> В F1 шаг 3.2 BFF route уже создаёт MastraClient per-request. F6 активирует `X-Project-Id` header, который был placeholder.

```typescript
// В POST /api/chat route (после F1):
const projectId = chat.projectId

const client = new MastraClient({
  baseUrl: process.env.MASTRA_API_URL || 'http://localhost:4111',
  headers: { 'X-Project-Id': projectId },
})
const agent = client.getAgent('kagami-agent')
const response = await agent.stream(userText, {
  memory: { thread: chatId, resource: `${userId}:${projectId}` },
})
```

> **Per-request MastraClient** — необходим потому что `projectId` различается между запросами. Singleton MastraClient из `src/lib/mastra.ts` остаётся для вызовов где `projectId` не нужен (e.g. `getMemoryThread` в messages endpoint).
>
> **Текущий код (до F1):** использует singleton `mastraClient` из `src/lib/mastra.ts` для workflow. После F1 — per-request для stream. F6 не добавляет новой логики, только активирует placeholder header из F1.

---

## Фаза 3: Бэкенд — middleware + dynamic config (kagami-api)

> **contracts.md:** обновить контракты — `X-Project-Id` header, формат requestContext полей, дефолтные промпты.

### Шаг 3.1 — Установить зависимость для DB read

**В kagami-api:**
```bash
npm install @neondatabase/serverless
```

> Бэкенд использует ту же Neon DB что и фронтенд (`DATABASE_URL`). `@neondatabase/serverless` — HTTP-based driver, без connection pool, минимальный overhead для одного запроса в middleware.
>
> **Почему не `store.db`?** Продуктовое описание упоминает `store.db.oneOrNone()`, но PostgresStore из `@mastra/pg` не предоставляет документированный публичный API для raw SQL queries. `@neondatabase/serverless` — явный, предсказуемый, не зависит от internal API PostgresStore.
>
> **Альтернатива (предпочтительна если доступна):** если `store` (PostgresStore) экспортирует `pool`, `db` или метод для raw queries — использовать его вместо `neon()` и убрать зависимость `@neondatabase/serverless`. Это избавит от дополнительной зависимости и второго DB connection. **Проверить первым делом при реализации** (см. Открытый вопрос 2).

### Шаг 3.2 — Создать утилиту для загрузки конфига

**Создать:** `src/mastra/config/load-project-config.ts` (kagami-api)

```typescript
import { neon } from '@neondatabase/serverless'

export interface ProjectConfig {
  supervisorPrompt: string | null
  agentPrompts: Record<string, string> | null
  activeTools: string[] | null
  toolParams: Record<string, Record<string, unknown>> | null
}

const sql = neon(process.env.DATABASE_URL!)

export async function loadProjectConfig(projectId: string): Promise<ProjectConfig | null> {
  const rows = await sql`
    SELECT supervisor_prompt, agent_prompts, active_tools, tool_params
    FROM project_config
    WHERE project_id = ${projectId}
  `
  if (rows.length === 0) return null

  const row = rows[0]
  return {
    supervisorPrompt: row.supervisor_prompt as string | null,
    agentPrompts: row.agent_prompts as Record<string, string> | null,
    activeTools: row.active_tools as string[] | null,
    toolParams: row.tool_params as Record<string, Record<string, unknown>> | null,
  }
}
```

> **Отдельная утилита** — переиспользуется в middleware и потенциально в других местах. Тестируема изолированно.
>
> **`neon()` на уровне модуля** — создаётся один раз при импорте. Neon serverless driver stateless (HTTP-based), не держит connection pool.
>
> **SQL читает фронтовую таблицу** — `project_config` создана Drizzle миграцией на фронтенде. Бэкенд только читает, не мигрирует.

### Шаг 3.3 — Middleware: X-Project-Id → requestContext

**Изменить:** `src/mastra/index.ts` (kagami-api)

```typescript
import { Mastra } from '@mastra/core/mastra'
import { PinoLogger } from '@mastra/loggers'
import { store } from './store'
import { supervisorAgent } from './agents/supervisor'
import { chatWorkflow } from './workflows/chat-workflow'
import { loadProjectConfig } from './config/load-project-config'

export const mastra = new Mastra({
  storage: store,
  agents: { kagamiAgent: supervisorAgent },
  workflows: { chatWorkflow },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  server: {
    middleware: [
      async (context, next) => {
        const projectId = context.req.header('X-Project-Id')
        const requestContext = context.get('requestContext')

        if (projectId) {
          requestContext.set('projectId', projectId)

          const config = await loadProjectConfig(projectId)
          if (config) {
            requestContext.set('supervisorPrompt', config.supervisorPrompt)
            requestContext.set('agentPrompts', config.agentPrompts)
            requestContext.set('activeTools', config.activeTools)
            requestContext.set('toolParams', config.toolParams)
          }
        }

        await next()
      },
    ],
  },
})
```

> **Middleware выполняется на каждый HTTP-запрос к Mastra Server.** BFF отправляет `X-Project-Id` при `agent.stream()` — middleware читает его и загружает конфиг.
>
> **Если `projectId` отсутствует** — requestContext остаётся пустым. Агенты используют дефолты (fallback в dynamic functions). Это обратно-совместимо — до F6 header не передавался.
>
> **Если config не найден в БД** — requestContext содержит только `projectId`. Агенты используют дефолты. Первый запрос до сохранения настроек = дефолтное поведение.
>
> **Performance:** один SQL-запрос на request. `@neondatabase/serverless` через HTTP — ~10-30ms к Neon в том же регионе. Приемлемо для middleware.

### Шаг 3.4 — Дефолтные промпты как константы

**Создать:** `src/mastra/config/defaults.ts` (kagami-api)

```typescript
// Default prompts — used when project_config has no override.
// Extracted as constants for reuse in agents and potential F7 registry endpoint.

export const DEFAULT_SUPERVISOR_PROMPT = `You are Kagami, an intelligent assistant that coordinates specialized agents to help users.

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
- Keep responses concise and well-formatted`

export const DEFAULT_AGENT_PROMPTS: Record<string, string> = {
  'research-agent': `You are a research specialist. Your role:
- Gather and analyze information based on the request
- Use web search to find current information when needed
- Use the datetime tool when you need to know current date/time
- Return structured, factual summaries with bullet points
- Be thorough but concise
- If you cannot find specific information, clearly state what is unknown
- Cite sources when using search results`,

  'writer-agent': `You are a writing specialist. Your role:
- Create clear, well-structured content based on provided information
- Use appropriate formatting (headers, lists, emphasis)
- Adapt tone and style to the context
- Edit and improve existing text when asked
- Return complete, ready-to-use content`,
}
```

> **Промпты из F4 и F5** — вынесены в константы. Агенты ссылаются на них как дефолты.
>
> **Ключи `DEFAULT_AGENT_PROMPTS`** — по `id` агента (`research-agent`, `writer-agent`). Совпадают с ключами в `agentPrompts` jsonb.
>
> **Используются в:** dynamic instructions агентов (шаги 3.5-3.6) и на фронтенде (захардкожены как placeholder в UI до F7 registry).

### Шаг 3.5 — Dynamic instructions: supervisor

**Изменить:** `src/mastra/agents/supervisor.ts` (kagami-api)

```typescript
import { Agent } from '@mastra/core/agent'
import { Memory } from '@mastra/memory'
import { researchAgent } from './research-agent'
import { writerAgent } from './writer-agent'
import { DEFAULT_SUPERVISOR_PROMPT } from '../config/defaults'

export const supervisorAgent = new Agent({
  id: 'kagami-supervisor',
  name: 'Kagami',
  instructions: async ({ requestContext }) => {
    const customPrompt = requestContext?.get('supervisorPrompt') as string | undefined
    return customPrompt || DEFAULT_SUPERVISOR_PROMPT
  },
  model: 'openai/gpt-5.4',
  agents: { researchAgent, writerAgent },
  defaultOptions: { maxSteps: 10 },
  memory: new Memory({
    options: {
      workingMemory: {
        enabled: true,
        scope: 'resource',
      },
    },
  }),
})
```

> **`requestContext?.get('supervisorPrompt')`** — optional chaining. Если requestContext не задан (прямой вызов без middleware, тесты), или поле не установлено (config не существует / поле null) — fallback на `DEFAULT_SUPERVISOR_PROMPT`.
>
> **`async`** — instructions может быть async function (подтверждено документацией Mastra).

### Шаг 3.6 — Dynamic instructions: суб-агенты

**Изменить:** `src/mastra/agents/research-agent.ts` (kagami-api)

```typescript
import { Agent } from '@mastra/core/agent'
import { customTools } from '../tools'
import { mcpTools } from '../mcp'
import { DEFAULT_AGENT_PROMPTS } from '../config/defaults'

export const researchAgent = new Agent({
  id: 'research-agent',
  name: 'Research Agent',
  description: 'Gathers information, analyzes data, and returns structured summaries. Has access to web search and utility tools. Use for factual questions, research tasks, and data analysis.',
  instructions: async ({ requestContext }) => {
    const agentPrompts = requestContext?.get('agentPrompts') as Record<string, string> | undefined
    return agentPrompts?.['research-agent'] || DEFAULT_AGENT_PROMPTS['research-agent']
  },
  model: 'openai/gpt-5.4',
  tools: ({ requestContext }) => {
    const allTools = { ...customTools, ...mcpTools }
    const activeTools = requestContext?.get('activeTools') as string[] | undefined
    if (!activeTools) return allTools
    return Object.fromEntries(
      Object.entries(allTools).filter(([key]) => activeTools.includes(key))
    )
  },
  defaultOptions: { maxSteps: 5 },
})
```

**Изменить:** `src/mastra/agents/writer-agent.ts` (kagami-api)

```typescript
import { Agent } from '@mastra/core/agent'
import { DEFAULT_AGENT_PROMPTS } from '../config/defaults'

export const writerAgent = new Agent({
  id: 'writer-agent',
  name: 'Writer Agent',
  description: 'Creates polished content, formats text, and writes clear documents. Use for writing tasks, content creation, editing, and formatting.',
  instructions: async ({ requestContext }) => {
    const agentPrompts = requestContext?.get('agentPrompts') as Record<string, string> | undefined
    return agentPrompts?.['writer-agent'] || DEFAULT_AGENT_PROMPTS['writer-agent']
  },
  model: 'openai/gpt-5.4',
})
```

> **Паттерн одинаковый для всех агентов:** `requestContext?.get('agentPrompts')?.[agentId] || DEFAULT`. При добавлении нового суб-агента — добавить дефолтный промпт в `DEFAULT_AGENT_PROMPTS` и тот же паттерн в agent definition.
>
> **`tools` — dynamic function только для researchAgent** (единственный агент с тулами после F5). writerAgent без тулов — dynamic tools не нужен. При добавлении тулов writerAgent — добавить аналогичный паттерн.
>
> **Фильтрация `activeTools`:** если `activeTools` задан — оставляем только включённые. Если `null` (нет override) — все тулы доступны. Пустой массив `[]` — все тулы выключены.

### Шаг 3.7 — Tool params в execute (инфраструктура)

Для будущих тулов с configSchema — toolParams доступны в execute через requestContext:

```typescript
// Пример: тул с configurable параметром (для будущих F7 тулов)
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const searchTool = createTool({
  id: 'web-search',
  description: '...',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
  execute: async (inputData, { requestContext }) => {
    const toolParams = requestContext?.get('toolParams') as Record<string, Record<string, unknown>> | undefined
    const myParams = toolParams?.['web-search']
    const maxResults = (myParams?.maxResults as number) ?? 10 // default

    // use maxResults in execution...
    return { results: [] }
  },
})
```

> **В F6 не создаём новых тулов с configSchema.** Текущий `get-current-datetime` не имеет configurable параметров. MCP-тулы (Brave Search) настраиваются через env vars, не через toolParams.
>
> **Инфраструктура готова:** middleware устанавливает `toolParams` в requestContext, тулы могут читать их. UI для toolParams — в F7, когда registry предоставит configSchema.
>
> **Handoff в F7:** F7 должен реализовать: (1) configSchema в TOOL_REGISTRY для каждого тула, (2) `/api/registry` endpoint возвращает configSchema в JSON Schema формате, (3) UI настроек генерирует формы на основе configSchema, (4) сохранение toolParams через существующий PUT endpoint. Колонка `tool_params` и requestContext-инфраструктура уже готовы в F6.
>
> **Текущий `getCurrentDatetimeTool`** — не нуждается в изменениях. Его `execute` не принимает `context` — можно добавить позже при необходимости.

### Шаг 3.8 — Обновить contracts.md

**Файл:** `plans-docs/v0.2/contracts.md`

Добавить контракты F6:

```markdown
## F6: Project Config via requestContext

### Header
- `X-Project-Id`: UUID — BFF передаёт при каждом вызове MastraClient

### requestContext fields (set by middleware)
- `projectId`: string — project UUID
- `supervisorPrompt`: string | null — override supervisor instructions
- `agentPrompts`: Record<string, string> | null — override sub-agent instructions, keyed by agent id
- `activeTools`: string[] | null — whitelist of enabled tool keys (null = all enabled)
- `toolParams`: Record<string, Record<string, unknown>> | null — per-tool config params, keyed by tool id

### DB table: project_config (owned by frontend, read by backend)
- project_id: uuid PK FK→projects.id
- supervisor_prompt: text nullable
- agent_prompts: jsonb nullable
- active_tools: jsonb nullable
- tool_params: jsonb nullable
- updated_at: timestamp

### Defaults
- No config row or null fields → hardcoded defaults in agent definitions
- Default prompts: src/mastra/config/defaults.ts
```

---

## Фаза 4: Фронтенд — UI настроек (kagami-v5-frontend)

### Шаг 4.1 — React-query хук для конфига

**Создать:** `src/hooks/use-project-config.ts`

```typescript
'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface ProjectConfigData {
  supervisorPrompt: string | null
  agentPrompts: Record<string, string> | null
  activeTools: string[] | null
  toolParams: Record<string, Record<string, unknown>> | null
  updatedAt: string | null
}

export function useProjectConfig(projectId: string) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['project-config', projectId],
    queryFn: async (): Promise<{ config: ProjectConfigData | null }> => {
      const res = await fetch(`/api/project/config?projectId=${projectId}`)
      if (!res.ok) throw new Error('Failed to fetch config')
      return res.json()
    },
  })

  const mutation = useMutation({
    mutationFn: async (data: Omit<ProjectConfigData, 'updatedAt'> & { projectId: string }) => {
      const res = await fetch('/api/project/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to save config')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-config', projectId] })
    },
  })

  return {
    config: query.data?.config ?? null,
    isLoading: query.isLoading,
    error: query.error,
    saveConfig: mutation.mutate,
    isSaving: mutation.isPending,
    saveError: mutation.error,
  }
}
```

> **Query key:** `['project-config', projectId]` — изолирован от chat queries.
>
> **`config: null`** — ещё нет настроек (дефолты). UI показывает placeholder.
>
> **`invalidateQueries` on success** — после сохранения перезагружает конфиг, гарантируя UI consistency.

### Шаг 4.2 — Метаданные агентов и тулов (захардкожены до F7)

**Создать:** `src/lib/registry.ts`

```typescript
// Hardcoded registry metadata — replaced by dynamic /api/registry in F7.
// Provides display names, descriptions, and default prompts for settings UI.

export interface AgentMeta {
  id: string
  name: string
  description: string
  defaultPrompt: string
}

export interface ToolMeta {
  key: string
  name: string
  description: string
  source: 'custom' | 'mcp'
}

export const AGENT_REGISTRY: AgentMeta[] = [
  {
    id: 'research-agent',
    name: 'Research Agent',
    description: 'Gathers information, analyzes data, returns structured summaries. Has web search and utility tools.',
    defaultPrompt: `You are a research specialist. Your role:
- Gather and analyze information based on the request
- Use web search to find current information when needed
- Use the datetime tool when you need to know current date/time
- Return structured, factual summaries with bullet points
- Be thorough but concise
- If you cannot find specific information, clearly state what is unknown
- Cite sources when using search results`,
  },
  {
    id: 'writer-agent',
    name: 'Writer Agent',
    description: 'Creates polished content, formats text, writes documents.',
    defaultPrompt: `You are a writing specialist. Your role:
- Create clear, well-structured content based on provided information
- Use appropriate formatting (headers, lists, emphasis)
- Adapt tone and style to the context
- Edit and improve existing text when asked
- Return complete, ready-to-use content`,
  },
]

export const TOOL_REGISTRY: ToolMeta[] = [
  {
    key: 'getCurrentDatetime',
    name: 'Current Date & Time',
    description: 'Returns current date and time in UTC and specified timezone',
    source: 'custom',
  },
  {
    key: 'braveSearch_web_search',
    name: 'Web Search (Brave)',
    description: 'Search the web for current information',
    source: 'mcp',
  },
]

// Default supervisor prompt — must match backend DEFAULT_SUPERVISOR_PROMPT
export const DEFAULT_SUPERVISOR_PROMPT = `You are Kagami, an intelligent assistant that coordinates specialized agents to help users.

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
- Keep responses concise and well-formatted`
```

> **Дублирование промптов:** дефолтные промпты определены и на бэкенде (`config/defaults.ts`) и на фронтенде (`lib/registry.ts`). В F7 это заменится динамическим `/api/registry` endpoint. До F7 — ручная синхронизация при изменении промптов.
>
> **`key` vs `id` в TOOL_REGISTRY:** `key` — ключ из `tools` map агента (camelCase). Совпадает с тем, что приходит в стриме и что используется в `activeTools`. `id` из `createTool()` — внутренний ID Mastra (kebab-case). Для фильтрации и UI — используем `key`.

### Шаг 4.3 — Компонент ProjectSettings (Sheet panel)

**Создать:** `src/components/settings/project-settings.tsx`

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Settings, RotateCcw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useProjectConfig, type ProjectConfigData } from '@/hooks/use-project-config'
import {
  AGENT_REGISTRY,
  TOOL_REGISTRY,
  DEFAULT_SUPERVISOR_PROMPT,
} from '@/lib/registry'

interface ProjectSettingsProps {
  projectId: string
}

export function ProjectSettings({ projectId }: ProjectSettingsProps) {
  const { config, isLoading, saveConfig, isSaving, saveError } = useProjectConfig(projectId)
  const [open, setOpen] = useState(false)

  // Local form state
  const [supervisorPrompt, setSupervisorPrompt] = useState('')
  const [agentPrompts, setAgentPrompts] = useState<Record<string, string>>({})
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)

  // Sync local state when config loads or sheet opens
  useEffect(() => {
    if (!open) return
    setSupervisorPrompt(config?.supervisorPrompt ?? '')
    setAgentPrompts(config?.agentPrompts ?? {})
    setActiveTools(config?.activeTools ?? TOOL_REGISTRY.map((t) => t.key))
    setDirty(false)
  }, [config, open])

  const handleSave = () => {
    saveConfig(
      {
        projectId,
        supervisorPrompt: supervisorPrompt.trim() || null,
        agentPrompts: (() => {
          const filtered = Object.fromEntries(
            Object.entries(agentPrompts).filter(([, v]) => v.trim())
          )
          return Object.keys(filtered).length > 0 ? filtered : null
        })(),
        activeTools:
          activeTools.length === TOOL_REGISTRY.length ? null : activeTools,
        toolParams: config?.toolParams ?? null,
      },
      {
        onSuccess: () => {
          setDirty(false)
          toast.success('Settings saved')
        },
        onError: () => toast.error('Failed to save settings'),
      },
    )
  }

  const handleResetSupervisor = () => {
    setSupervisorPrompt('')
    setDirty(true)
  }

  const handleResetAgent = (agentId: string) => {
    setAgentPrompts((prev) => {
      const next = { ...prev }
      delete next[agentId]
      return next
    })
    setDirty(true)
  }

  const handleToolToggle = (toolKey: string, checked: boolean) => {
    setActiveTools((prev) =>
      checked ? [...prev, toolKey] : prev.filter((k) => k !== toolKey),
    )
    setDirty(true)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Project settings">
          <Settings className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Project Settings</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Supervisor Prompt */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="supervisor-prompt">Supervisor Prompt</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetSupervisor}
                  className="h-7 text-xs text-muted-foreground"
                >
                  <RotateCcw className="size-3 mr-1" />
                  Reset
                </Button>
              </div>
              <Textarea
                id="supervisor-prompt"
                value={supervisorPrompt}
                onChange={(e) => {
                  setSupervisorPrompt(e.target.value)
                  setDirty(true)
                }}
                placeholder={DEFAULT_SUPERVISOR_PROMPT}
                rows={8}
                className="text-sm font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to use default prompt.
              </p>
            </div>

            {/* Agent Prompts */}
            {AGENT_REGISTRY.map((agent) => (
              <div key={agent.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`agent-prompt-${agent.id}`}>
                    {agent.name}
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleResetAgent(agent.id)}
                    className="h-7 text-xs text-muted-foreground"
                  >
                    <RotateCcw className="size-3 mr-1" />
                    Reset
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {agent.description}
                </p>
                <Textarea
                  id={`agent-prompt-${agent.id}`}
                  value={agentPrompts[agent.id] ?? ''}
                  onChange={(e) => {
                    setAgentPrompts((prev) => ({
                      ...prev,
                      [agent.id]: e.target.value,
                    }))
                    setDirty(true)
                  }}
                  placeholder={agent.defaultPrompt}
                  rows={6}
                  className="text-sm font-mono"
                />
              </div>
            ))}

            {/* Tool Toggles */}
            <div className="space-y-2">
              <Label>Tools</Label>
              <div className="space-y-3">
                {TOOL_REGISTRY.map((tool) => (
                  <div key={tool.key} className="flex items-start gap-3">
                    <Checkbox
                      id={`tool-${tool.key}`}
                      checked={activeTools.includes(tool.key)}
                      onCheckedChange={(checked) =>
                        handleToolToggle(tool.key, !!checked)
                      }
                    />
                    <div className="space-y-0.5">
                      <Label
                        htmlFor={`tool-${tool.key}`}
                        className="text-sm font-medium cursor-pointer"
                      >
                        {tool.name}
                        <span className="ml-2 text-xs text-muted-foreground font-normal">
                          {tool.source === 'mcp' ? 'MCP' : 'Built-in'}
                        </span>
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {tool.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleSave} disabled={!dirty || isSaving}>
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : null}
                Save Changes
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
```

> **Sheet** (shadcn) — боковая панель. Не отдельная страница — MVP имеет один захардкоженный чат, переключение страниц избыточно.
>
> **shadcn компоненты:** Sheet, Button, Textarea, Label, Checkbox — большинство уже установлены. Если нет — установить через `npx shadcn@latest add sheet checkbox label textarea`.
>
> **Local state + dirty flag** — форма редактируется локально, сохраняется по кнопке. `dirty` предотвращает случайное сохранение без изменений.
>
> **Reset = очистить поле** → отправляем `null` на сервер → middleware видит `null` → агент использует дефолт. Визуально: поле пустое, placeholder показывает дефолтный промпт.
>
> **activeTools default:** если в БД `null` (нет override) — все тулы включены. В UI: все checkbox checked. При сохранении: если все тулы checked — отправляем `null` (не override), иначе — массив включённых ключей.
>
> **toolParams UI:** отложен до F7 (нужен configSchema из registry). `config?.toolParams` передаётся as-is при сохранении — не теряется.

### Шаг 4.4 — Установить недостающие shadcn компоненты

```bash
npx shadcn@latest add sheet checkbox label textarea sonner
```

> Пропустить если компоненты уже установлены (проверить `src/components/ui/`).
> `sonner` — toast-уведомления для feedback при сохранении/ошибке. Требует `<Toaster />` в layout (если ещё не добавлен).

### Шаг 4.5 — Интеграция в chat-page

**Изменить:** `src/components/chat/chat-page.tsx`

Добавить кнопку настроек в header чата:

```tsx
import { ProjectSettings } from '@/components/settings/project-settings'

// В header (или рядом с composer):
<div className="flex items-center justify-between border-b px-4 py-2">
  <h1 className="text-lg font-semibold">Kagami</h1>
  <ProjectSettings projectId={projectId} />
</div>
```

> **`projectId`** приходит из `NEXT_PUBLIC_PROJECT_ID` (захардкожен в MVP). Передаётся через props chain: `page.tsx → ChatPage → header`.
>
> Точная интеграция зависит от layout после F1. Ключевое: кнопка Settings (иконка шестерёнки) в верхнем правом углу чата.

---

## Проверка

### База данных
- [ ] Таблица `project_config` создана миграцией
- [ ] Запись создаётся при первом сохранении настроек (upsert)
- [ ] Nullable поля: `null` означает "дефолт"
- [ ] `updatedAt` обновляется при каждом сохранении

### BFF API
- [ ] `GET /api/project/config?projectId=...` — возвращает конфиг или `{ config: null }`
- [ ] `PUT /api/project/config` — создаёт / обновляет конфиг
- [ ] Auth: unauthorized без Clerk session → 401
- [ ] Ownership: чужой projectId → 404
- [ ] Невалидный JSON body → 400

### Middleware + requestContext (бэкенд)
- [ ] `X-Project-Id` header читается из запроса
- [ ] `loadProjectConfig()` загружает данные из `project_config`
- [ ] Конфиг записывается в requestContext: `supervisorPrompt`, `agentPrompts`, `activeTools`, `toolParams`
- [ ] Без header — requestContext пуст, агенты используют дефолты
- [ ] Без config row — requestContext содержит только `projectId`, агенты используют дефолты

### Dynamic instructions
- [ ] Supervisor: кастомный промпт из конфига применяется
- [ ] Supervisor: при `null` — дефолтный промпт
- [ ] Research agent: кастомный промпт из `agentPrompts['research-agent']` применяется
- [ ] Writer agent: кастомный промпт из `agentPrompts['writer-agent']` применяется
- [ ] Суб-агенты: при `null` — дефолтные промпты

### Dynamic tools
- [ ] Все тулы включены → `activeTools: null` → research agent видит все тулы
- [ ] Часть тулов выключена → `activeTools: ['getCurrentDatetime']` → research agent видит только `getCurrentDatetime`
- [ ] Все тулы выключены → `activeTools: []` → research agent без тулов
- [ ] Изменения применяются к следующему сообщению (без перезагрузки)

### UI настроек
- [ ] Кнопка Settings (шестерёнка) видна в header чата
- [ ] Sheet открывается/закрывается
- [ ] Supervisor prompt: пустое поле с placeholder (дефолтный промпт)
- [ ] Agent prompts: textarea для каждого суб-агента
- [ ] Reset: очищает поле, после сохранения — дефолт на бэкенде
- [ ] Tool toggles: checkbox для каждого тула, все checked по умолчанию
- [ ] Save: кнопка disabled без изменений, loading state при сохранении
- [ ] Save success: toast "Settings saved"
- [ ] Save error: toast "Failed to save settings"
- [ ] После сохранения — следующее сообщение использует новые настройки
- [ ] Reload страницы — настройки загружаются из БД

### E2E
- [ ] Изменить supervisor prompt → отправить сообщение → поведение изменилось
- [ ] Выключить Brave Search → отправить research-запрос → research agent не ищет в интернете
- [ ] Сбросить все настройки → поведение как до F6

---

## Решённые вопросы

1. **Формат `X-Project-Id` header** → UUID строка. MastraClient поддерживает `headers` в конструкторе. BFF создаёт per-request instance (паттерн из F1 шаг 3.2). Singleton MastraClient в `src/lib/mastra.ts` остаётся для вызовов без projectId (e.g. messages endpoint).

2. **Как BFF передаёт header** → Per-request MastraClient instance с `headers: { 'X-Project-Id': projectId }`. Не через query params, не через body — через HTTP header, чтобы middleware на Mastra Server читал стандартным `context.req.header()`.

3. **Как бэкенд читает фронтовые таблицы** → `@neondatabase/serverless` с тем же `DATABASE_URL`. Raw SQL в утилите `loadProjectConfig()`. Не через ORM — бэкенд не владеет Drizzle schema для `project_config`. Альтернатива: использовать PostgresStore's internal connection, если доступен. Проверить при реализации.

4. **UI настроек — страница или панель** → Sheet (боковая панель). MVP имеет один чат — отдельная страница избыточна. Кнопка Settings (шестерёнка) в header чата открывает Sheet с формой.

5. **Связь с F7 (реестр)** → До F7 метаданные агентов и тулов захардкожены в `src/lib/registry.ts` на фронтенде. После F7 — динамический `/api/registry` endpoint заменит хардкод. Дефолтные промпты дублируются в обоих репо до F7 (ручная синхронизация).

6. **Partial update vs full replace** → Full replace (PUT). Клиент всегда отправляет полный конфиг. Проще чем PATCH с merge-логикой. `null` = сброс к дефолту.

7. **requestContext для суб-агентов** → Суб-агенты должны получать requestContext при делегировании от supervisor'а, т.к. requestContext привязан к HTTP-запросу, а не к агенту. Все agent executions в рамках одного запроса разделяют один requestContext. **Верифицируется в Фазе 0** — эксперимент перед реализацией. Если суб-агенты не получают requestContext — workaround'ы описаны в Фазе 0.

8. **activeTools семантика** → `null` = все тулы включены (нет override). `string[]` = whitelist включённых. Пустой `[]` = все выключены. Фильтрация в `tools({ requestContext })` function агента.

9. **toolParams UI** → Отложен до F7. В F6 инфраструктура готова (middleware устанавливает `toolParams` в requestContext, тулы могут читать, колонка БД существует). UI для configSchema-based форм — в F7, когда registry предоставит метаданные. Явный handoff описан в шаге 3.7.

10. **Дефолтные промпты** → Вынесены в `src/mastra/config/defaults.ts` (бэкенд) и `src/lib/registry.ts` (фронтенд). Дублирование intentional — фронтенд показывает placeholder, бэкенд использует как fallback. В F7 — единый источник через registry endpoint.

---

## Открытые вопросы

1. **requestContext для суб-агентов при делегировании** → Подтвердить что суб-агенты получают тот же requestContext что и supervisor при delegation через `agent.stream()` с `maxSteps`. Документация Mastra не описывает это явно. **Верифицируется в Фазе 0** (эксперимент, первый шаг реализации). Workaround'ы описаны там же.

2. **PostgresStore raw query API** → Имеет ли `@mastra/pg` PostgresStore публичный API для raw SQL queries (e.g. `store.db`, `store.pool`, `store.query()`)? Если да — можно убрать зависимость `@neondatabase/serverless` из бэкенда и использовать store напрямую. Проверить при реализации.

3. **Caching project config** → Middleware загружает конфиг из БД на каждый запрос (~10-30ms). Для MVP приемлемо. Если станет bottleneck — добавить in-memory cache с TTL (e.g. 60 секунд). Кнопка "Apply" в UI очистит cache (через отдельный endpoint или заголовок).

4. **Валидация agentPrompts ключей** → PUT API принимает `agentPrompts` с произвольными ключами. Если пользователь отправит `{ "nonexistent-agent": "..." }` — запись сохранится, но не будет использована. Нужна ли валидация ключей по списку известных агентов? Для MVP — нет (UI гарантирует правильные ключи через `AGENT_REGISTRY`). В F7 — валидация по registry.

5. **Синхронизация дефолтных промптов** → До F7 дефолтные промпты дублируются в двух репо. При изменении промпта в бэкенде — обновить и фронтенд (placeholder). Риск рассинхронизации. Автоматизировать в F7 через registry endpoint.

6. **Авторизация middleware** → Middleware на Mastra Server не проверяет `X-Project-Id` на ownership. BFF уже проверил через Clerk auth + ownership query. Mastra Server доверяет BFF. Это безопасно пока Mastra Server доступен только через private network (Railway internal). Если Mastra Server станет публичным — добавить auth middleware.
