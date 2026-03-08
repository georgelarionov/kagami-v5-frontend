# F4. Supervisor Agent — План реализации

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> Замена одного агента на supervisor, который делегирует задачи специализированным суб-агентам.
> Зависит от F1 (стриминг работает). F3 (tool display) обрабатывает tool parts — делегирование приходит через тот же механизм.

**Scope:** бэкенд (создание supervisor + суб-агентов) + минимальные изменения фронтенда (maxSteps + отображение делегирования).

---

## Как работает supervisor в Mastra (контекст)

**Подтверждено документацией Mastra:**

1. **Supervisor = обычный Agent с `agents` property:**
   ```typescript
   const supervisor = new Agent({
     agents: { researchAgent, writerAgent },
     memory: new Memory({ ... }),
   })
   ```

2. **Авто-генерация тулов делегирования.** Mastra автоматически создаёт tool для каждого суб-агента:
   - `agent-researchAgent` — вызов research agent
   - `agent-writerAgent` — вызов writer agent

   Supervisor вызывает их как обычные tool calls. Описание тула берётся из `description` суб-агента — поэтому description критически важен для качества делегирования.

3. **Делегирование в стриме.** В stream делегирование приходит как tool call/result чанки:
   - `type: 'tool-agent-researchAgent'` (AI SDK v6 part format)
   - Состояния: `input-streaming` → `input-available` → `output-available`
   - `input`: сообщение от supervisor'а к суб-агенту
   - `output`: ответ суб-агента

4. **maxSteps.** Supervisor нуждается в `maxSteps` (по умолчанию 1 шаг — недостаточно для делегирования). Рекомендуется `maxSteps: 10`. Два способа задать:
   - В определении агента: `defaultOptions: { maxSteps: 10 }` — применяется ко всем вызовам
   - При вызове: `agent.stream(msg, { maxSteps: 10 })` — per-request override

   Предпочтительно задать в `defaultOptions` — тогда BFF не нужно знать о maxSteps.

5. **Memory.** Только supervisor имеет Memory instance. Суб-агенты получают контекст через delegation message от supervisor'а. Суб-агенты НЕ имеют прямого доступа к memory thread — это документированный паттерн Mastra.

6. **`.stream()` вместо `.network()`.** Метод `.network()` deprecated. Supervisor использует стандартный `.stream()` / `.generate()` с параметром `maxSteps`.

---

## Фаза 1: Бэкенд — Суб-агенты (kagami-api)

### Шаг 1.1 — Создать research-agent

**Создать:** `src/mastra/agents/research-agent.ts`

```typescript
import { Agent } from '@mastra/core/agent'

export const researchAgent = new Agent({
  id: 'research-agent',
  name: 'Research Agent',
  description: 'Gathers information, analyzes data, and returns structured summaries. Use for factual questions, research tasks, and data analysis.',
  instructions: `You are a research specialist. Your role:
- Gather and analyze information based on the request
- Return structured, factual summaries with bullet points
- Be thorough but concise
- If you cannot find specific information, clearly state what is unknown`,
  model: 'openai/gpt-5.4',
})
```

> Суб-агент без Memory — контекст получает через delegation message от supervisor'а.
> `description` критичен — supervisor использует его для решения о делегировании.
> Модель та же что у supervisor'а. Для оптимизации можно использовать cheaper model (например `gpt-4o-mini`). Решить после тестирования.

### Шаг 1.2 — Создать writer-agent

**Создать:** `src/mastra/agents/writer-agent.ts`

```typescript
import { Agent } from '@mastra/core/agent'

export const writerAgent = new Agent({
  id: 'writer-agent',
  name: 'Writer Agent',
  description: 'Creates polished content, formats text, and writes clear documents. Use for writing tasks, content creation, editing, and formatting.',
  instructions: `You are a writing specialist. Your role:
- Create clear, well-structured content based on provided information
- Use appropriate formatting (headers, lists, emphasis)
- Adapt tone and style to the context
- Edit and improve existing text when asked
- Return complete, ready-to-use content`,
  model: 'openai/gpt-5.4',
})
```

> Конкретные суб-агенты — продуктовое решение. research + writer — отправная точка, совпадает с каноническим примером Mastra. Легко добавить/заменить — по одному файлу на агента + обновление supervisor'а. В F5 суб-агенты получат тулы.

---

## Фаза 2: Бэкенд — Supervisor (kagami-api)

### Шаг 2.1 — Создать supervisor agent

**Создать:** `src/mastra/agents/supervisor.ts`

```typescript
import { Agent } from '@mastra/core/agent'
import { Memory } from '@mastra/memory'
import { researchAgent } from './research-agent'
import { writerAgent } from './writer-agent'

export const supervisorAgent = new Agent({
  id: 'kagami-supervisor',
  name: 'Kagami',
  instructions: `You are Kagami, an intelligent assistant that coordinates specialized agents to help users.

Available agents:
- researchAgent: Gathers information, analyzes data, returns structured summaries. Use for factual questions, research, and analysis.
- writerAgent: Creates polished content, formats text, writes documents. Use for writing, editing, and formatting tasks.

Delegation strategy:
1. Simple questions and greetings: Answer directly without delegation
2. Research-heavy requests (facts, analysis, comparisons): Delegate to researchAgent
3. Writing/content requests (articles, emails, documents): Delegate to writerAgent
4. Complex requests requiring both: Delegate to researchAgent first for facts, then writerAgent for polished output
5. Follow-up questions: Use context from previous messages, delegate only if new work is needed

Guidelines:
- Always synthesize sub-agent outputs into a coherent final response for the user
- Don't expose internal delegation mechanics to the user in your text responses
- If a sub-agent's response is incomplete, iterate or supplement it yourself
- Keep responses concise and well-formatted`,
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

> **Agent ID:** `id: 'kagami-supervisor'` — новый внутренний ID. Но регистрация в Mastra instance под ключом `kagamiAgent` (шаг 2.3) — обратная совместимость с BFF и memory.
>
> **Memory:** Только supervisor имеет Memory instance. Storage НЕ передаётся явно в конструктор Memory — наследуется от Mastra instance (тот же паттерн что в текущем `kagami-agent.ts`). Суб-агенты наследуют контекст через delegation.
>
> **defaultOptions:** `maxSteps: 10` задан в определении агента. BFF не нужно передавать maxSteps при каждом вызове — упрощает интеграцию. При необходимости BFF может переопределить per-request.
>
> **Instructions:** Описывают delegation strategy. Supervisor сам решает когда делегировать. `description` суб-агентов усиливает это — Mastra включает их в system prompt supervisor'а автоматически.

### Шаг 2.2 — Observational memory (опционально)

Для компрессии длинных разговоров — добавить observational memory.

```typescript
memory: new Memory({
  options: {
    workingMemory: {
      enabled: true,
      scope: 'resource',
    },
    observationalMemory: true,
  },
})
```

> **Внимание: API unconfirmed.** Точный формат параметра `observationalMemory` необходимо проверить по документации перед реализацией:
> 1. `observationalMemory: true` или `{ enabled: true }`?
> 2. Нужна ли отдельная модель? (Дефолт: `google/gemini-2.5-flash`)
> 3. Дополнительные параметры: `maxEntries`, `memorySize`?
>
> **Действие:** проверить через `mastra` MCP docs или `context7` при реализации. Если API отличается — адаптировать. Если observational memory не поддерживается в текущей версии — пропустить, добавить позже.
>
> **Не блокирует основную реализацию supervisor'а.** Можно добавить после проверки API.

### Шаг 2.3 — Обновить Mastra instance

**Изменить:** `src/mastra/index.ts`

```typescript
import { Mastra } from '@mastra/core/mastra'
import { PinoLogger } from '@mastra/loggers'
import { store } from './store'
import { supervisorAgent } from './agents/supervisor'
import { chatWorkflow } from './workflows/chat-workflow'

export const mastra = new Mastra({
  storage: store,
  agents: { kagamiAgent: supervisorAgent },
  workflows: { chatWorkflow },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
})
```

> **Ключ `kagamiAgent` сохранён** — BFF вызывает `client.getAgent('kagamiAgent')` без изменений.
> Workflow остаётся в регистрации для будущего использования (не используется для чата после F1).

### Шаг 2.4 — Удалить старый agent

**Удалить:** `src/mastra/agents/kagami-agent.ts`

Supervisor полностью заменяет старый агент. Все его обязанности (чат, memory) перенесены в supervisor.

### Шаг 2.5 — Обновить workflow (совместимость)

**Изменить:** `src/mastra/workflows/chat-workflow.ts`

Workflow использует `mastra?.getAgent('kagamiAgent')` — продолжит работать, т.к. ключ не изменился. Но `agent.generate()` в workflow не передаёт `maxSteps`, что может быть проблемой для supervisor'а.

Два варианта:
- **A)** Добавить `maxSteps: 10` в вызов `agent.generate()` внутри workflow
- **B)** Оставить как есть — workflow не используется для чата после F1, можно обновить позже

**Рекомендация:** Вариант B. Workflow сохраняется для будущих отчётов. Обновить когда потребуется.

**Действие:** добавить код-комментарий в `chat-workflow.ts`:
```typescript
// NOTE (F4): agent.generate() here does not pass maxSteps.
// After F4, kagamiAgent is a supervisor — delegation requires maxSteps >= 10.
// This workflow is not used for chat after F1 (replaced by direct agent.stream()).
// If reactivated, add { maxSteps: 10 } to agent.generate() options.
```

### Шаг 2.6 — Обновить contracts.md

**Файл:** `plans-docs/v0.2/contracts.md`

> Файл создаётся в F1 (шаг 2.0). Если F1 ещё не реализован — создать файл.

Добавить контракты F4:
- Agent registration key: `kagamiAgent` (без изменений)
- Agent internal ID: `kagami-supervisor` (новый)
- Sub-agent IDs: `research-agent`, `writer-agent`
- Delegation tool names в стриме: `agent-researchAgent`, `agent-writerAgent`
- `defaultOptions: { maxSteps: 10 }` в определении агента (BFF override не обязателен)

### Шаг 2.7 — Проверить через Mastra Studio

```bash
cd /path/to/kagami-v5
npm run dev
```

Открыть Mastra Studio → Agents → kagamiAgent:
- [ ] Supervisor отображается с суб-агентами
- [ ] Тест: "Research the latest trends in AI" → supervisor делегирует researchAgent
- [ ] Тест: "Write a short poem about coding" → supervisor делегирует writerAgent
- [ ] Тест: "Hello, how are you?" → supervisor отвечает напрямую (без делегирования)
- [ ] Тест: "Research quantum computing and write an article about it" → multi-step delegation (research → writer)
- [ ] Working memory сохраняется между сообщениями в одном thread
- [ ] Стрим: delegation events видны в output (tool calls `agent-researchAgent` / `agent-writerAgent`)

---

## Фаза 3: Фронтенд — BFF (kagami-v5-frontend)

> Зависит от F1 (стриминг). BFF route уже использует `agent.stream()` после F1.

### Шаг 3.1 — Проверить maxSteps (изменений BFF может не потребоваться)

**Файл:** `src/app/api/chat/route.ts`

`maxSteps: 10` задан в `defaultOptions` агента (шаг 2.1). BFF вызов `agent.stream()` **не требует изменений** — maxSteps применится автоматически.

При необходимости BFF может переопределить per-request:
```typescript
const response = await agent.stream(userText, {
  memory: { thread: chatId, resource: `${userId}:${projectId}` },
  maxSteps: 15, // override, если нужно больше шагов
})
```

> **Подтверждено ревью:** `MastraClient.getAgent().stream()` поддерживает `maxSteps` через HTTP API.
> `maxSteps` входит в `AgentExecutionOptions` и не исключён из `StreamParamsBase` в типах `@mastra/client-js`.
> Не блокер — работает как через `defaultOptions` агента, так и через per-request parameter.

---

## Фаза 4: Фронтенд — Отображение делегирования

> Делегирование приходит как tool calls в стриме. F3 уже обрабатывает tool parts через `isToolPart()` и `Tool` компонент.
> Дополнительно: отличить delegation tool calls от обычных и отобразить через `Steps` (prompt-kit).

### Шаг 4.0 — Установить prompt-kit Steps

```bash
npx shadcn@latest add "https://prompt-kit.com/c/steps.json"
```

Компонент установится в `src/components/prompt-kit/steps.tsx`.

**Проверка:** файл создан, экспортирует `Steps`, `StepsTrigger`, `StepsContent`, `StepsItem`, `StepsBar`.

### Шаг 4.1 — Хелперы для delegation parts

**Файл:** `src/components/chat/message-list.tsx`

```typescript
// Определяет delegation tool calls (supervisor → sub-agent)
function isDelegationPart(part: { type: string }): boolean {
  return part.type.startsWith('tool-agent-')
}

// Human-readable имена агентов (захардкожены для MVP, в F7 заменится на реестр)
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  'researchAgent': 'Research Agent',
  'writerAgent': 'Writer Agent',
}

function getAgentDisplayName(part: { type: string }): string {
  const agentKey = part.type.replace(/^tool-agent-/, '')
  return AGENT_DISPLAY_NAMES[agentKey] ?? agentKey
}
```

> **Порядок проверок в рендеринге:** `isDelegationPart` перед `isToolPart` (из F3).
> Delegation parts тоже начинаются с `tool-`, но имеют дополнительный prefix `tool-agent-`.
> Если проверять `isToolPart` первым — delegation отобразится как обычный Tool block.

### Шаг 4.2 — Компонент DelegationStep

**Создать:** `src/components/chat/delegation-step.tsx`

```tsx
'use client'

import {
  Steps,
  StepsTrigger,
  StepsContent,
} from '@/components/prompt-kit/steps'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

interface DelegationStepProps {
  agentName: string
  state: string
  errorText?: string
}

export function DelegationStep({ agentName, state, errorText }: DelegationStepProps) {
  const isLoading = state === 'input-streaming' || state === 'input-available'
  const isError = state === 'output-error'

  const icon = isLoading
    ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
    : isError
    ? <AlertCircle className="size-4 text-destructive" />
    : <CheckCircle2 className="size-4 text-green-500" />

  return (
    <Steps defaultOpen={isError}>
      <StepsTrigger leftIcon={icon}>
        {isLoading ? `${agentName}...` : agentName}
      </StepsTrigger>
      {isError && errorText && (
        <StepsContent>
          <p className="text-sm text-destructive">{errorText}</p>
        </StepsContent>
      )}
    </Steps>
  )
}
```

> **UX решения:**
> - **Loading** (`input-streaming`, `input-available`): "Research Agent..." с spinning loader — inline status
> - **Done** (`output-available`): "Research Agent" с зелёной галочкой — свёрнут
> - **Error** (`output-error`): "Research Agent" с красной иконкой — раскрыт, текст ошибки виден
>
> **Output суб-агента не показываем:** supervisor синтезирует ответы в свой текст.
> Показывать raw output избыточно. При необходимости — добавить collapsible output позже.

### Шаг 4.3 — Интеграция в message-list

**Изменить:** `src/components/chat/message-list.tsx`

Импорт:
```typescript
import { DelegationStep } from '@/components/chat/delegation-step'
```

Обновить итерацию по `message.parts` в assistant-сообщении:

```tsx
{message.parts.map((part, i) => {
  if (part.type === 'text') {
    return <Markdown key={`${message.id}-text-${i}`} id={message.id}>{part.text}</Markdown>
  }
  if (isDelegationPart(part)) {
    return (
      <DelegationStep
        key={`${message.id}-delegation-${part.toolCallId}`}
        agentName={getAgentDisplayName(part)}
        state={part.state}
        errorText={part.errorText}
      />
    )
  }
  if (isToolPart(part)) {
    // F3: обычные тулы (не делегирование)
    return (
      <Tool
        key={`${message.id}-tool-${part.toolCallId}`}
        toolPart={part as ToolPart}
        defaultOpen={part.state === 'output-error'}
      />
    )
  }
  return null
})}
```

> **Чередование:** text + delegation + text — порядок частей из `message.parts` сохраняется.
> Supervisor может написать текст, делегировать, получить результат, написать ещё текст.
>
> **История:** delegation parts загружаются из Mastra memory и конвертируются через `toAISdkV5Messages()` → тот же формат `message.parts`. Один компонент обрабатывает оба случая (стрим и история).

---

## Проверка

### Бэкенд
- [ ] Supervisor корректно делегирует задачи суб-агентам (через Mastra Studio)
- [ ] Простые вопросы — supervisor отвечает напрямую (без делегирования)
- [ ] Research-запросы → делегирование research-agent
- [ ] Writing-запросы → делегирование writer-agent
- [ ] Сложные запросы → multi-step delegation (research → writer)
- [ ] Working memory сохраняется между сообщениями
- [ ] Стрим: delegation events видны как tool call чанки

### Фронтенд
- [ ] Стриминг работает через supervisor (токены приходят в реальном времени)
- [ ] Делегирование видно в UI как Steps (inline status с иконкой)
- [ ] Состояния Steps: loading (spinner) → done (зелёная галочка)
- [ ] Ошибка делегирования: Steps раскрыт с текстом ошибки
- [ ] Обычные tool calls (F3) отображаются как Tool, не как Steps
- [ ] Ответ supervisor'а рендерится как текст (Markdown)
- [ ] Несколько делегирований в одном сообщении — все отображаются в правильном порядке
- [ ] Text + delegation + text чередование — порядок сохраняется
- [ ] История: delegation parts загружаются из memory и отображаются корректно
- [ ] Сообщения без делегирования — рендерятся как раньше (только Markdown)

---

## Решённые вопросы

1. **Agent ID** → Registration key `kagamiAgent` сохранён в Mastra instance (`agents: { kagamiAgent: supervisorAgent }`) для обратной совместимости с BFF. Внутренний `id: 'kagami-supervisor'`. BFF не требует изменений кроме `maxSteps`.

2. **Delegation events в стриме** → Делегирование приходит как tool calls с именами `agent-{subAgentId}` (автоматически генерируются Mastra). Проходит через `toAISdkStream()` → `message.parts` как `type: 'tool-agent-{subAgentId}'`. Подтверждено документацией: supervisor автоматически получает tools для каждого суб-агента.

3. **Memory sharing** → Только supervisor имеет Memory instance. Суб-агенты получают контекст через delegation message. Суб-агенты НЕ имеют прямого доступа к memory thread — это документированный паттерн Mastra.

4. **Какие суб-агенты** → research-agent и writer-agent как начальные. Каноничный пример Mastra. Конкретные специализации — продуктовое решение. Легко добавить/изменить: один файл на агента + обновление supervisor. В F5 суб-агенты получат инструменты.

5. **Отображение делегирования** → `Steps` компонент (prompt-kit) для delegation tool calls. `Tool` компонент (F3) для обычных tool calls. Различаем по prefix: `tool-agent-*` = delegation, остальные `tool-*` = regular tools.

6. **maxSteps** → Необходим для supervisor'а. Без него supervisor выполнит только 1 шаг и не обработает ответы суб-агентов. `maxSteps: 10` задан через `defaultOptions` в определении агента — BFF не нужно передавать явно. `MastraClient.getAgent().stream()` поддерживает `maxSteps` через HTTP API (подтверждено проверкой типов `@mastra/client-js`).

7. **Workflow** → Не блокирует. Workflow продолжает работать (ключ `kagamiAgent` сохранён), но для чата не используется после F1. Добавить код-комментарий о необходимости maxSteps при реактивации.

8. **`.network()` vs `.stream()`** → `.network()` deprecated. Supervisor использует стандартный `.stream()` с `maxSteps`. Подтверждено migration guide Mastra.

9. **Memory storage** → Не передаём `storage` явно в конструктор Memory. Текущий агент (`kagami-agent.ts`) тоже не передаёт — Memory наследует storage от Mastra instance. Сохраняем тот же паттерн для consistency.

10. **Delegation hooks** → Продуктовое описание упоминает `onDelegationStart`/`onDelegationComplete`. В рамках F4 не реализуем — не блокирует основную функциональность. Хуки добавить при необходимости (мониторинг, логирование). См. секцию "Будущие возможности Mastra".

## Будущие возможности Mastra (для F5-F7)

Mastra supervisor поддерживает дополнительные параметры, которые могут быть полезны в последующих фичах:

| Параметр | Описание | Применение |
|---|---|---|
| `onDelegationStart` | Колбэк при начале делегирования | F7: логирование, мониторинг |
| `onDelegationComplete` | Колбэк при завершении делегирования | F7: метрики, аналитика |
| `messageFilter` | Фильтрация сообщений, передаваемых суб-агенту | F6: кастомизация контекста per-project |
| `isTaskComplete` | Кастомная проверка завершённости задачи (scorer) | Качество ответов |
| `onIterationComplete` | Колбэк после каждого шага supervisor'а | Отладка delegation chains |

> Не реализуем в F4 — минимальный scope. Добавить при необходимости в F5-F7.

---

## Открытые вопросы

1. **Observational memory API** → Точный формат: `observationalMemory: true` или `{ enabled: true }`? Нужна ли отдельная модель? Проверить через Mastra docs. Не блокирует основную реализацию.

2. **Модели суб-агентов** → Та же модель (`openai/gpt-5.4`) или cheaper (`gpt-4o-mini`)? Cheaper модели достаточно для выполнения задач в рамках специализации, supervisor нуждается в лучшем judgment для делегирования. Решить после тестирования.

3. **Delegation parts из истории** → Проверить при реализации: delegation tool calls из Mastra memory корректно появляются в `message.parts` после `toAISdkV5Messages()`. Они хранятся как `content.toolInvocations[]` с `toolName: 'agent-researchAgent'` — должны конвертироваться в `type: 'tool-agent-researchAgent'`. Если нет — адаптировать `isDelegationPart()`.

4. **Имена суб-агентов в UI** → `AGENT_DISPLAY_NAMES` захардкожен. В F7 (реестр) заменится на динамический lookup из `AGENT_REGISTRY`. До F7 — при добавлении нового суб-агента обновлять map вручную.

5. **Коллизия имён `tool-agent-*`** → `isDelegationPart()` предполагает, что ни один обычный тул (F5) не будет называться `agent-*`. При создании тулов в F5 — не использовать prefix `agent-` в именах тулов.
