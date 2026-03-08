# F3. Отображение тулов — План реализации

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> Показ использования тулов агентом в виде сворачиваемых блоков в UI чата.
> Зависит от F1 (стриминг) — формат tool parts приходит через стрим и `message.parts`.
> Бэкенд не меняется — tool calls уже включены в чанки стрима и историю сообщений.

**Scope:** только фронтенд. Бэкенд и BFF не требуют изменений — tool-call/tool-result чанки уже проходят через `toAISdkStream()` и сохраняются в Mastra memory.

---

## Предпосылки (что уже сделано в F1)

После F1 Фаза 0 + Фаза 3 в проекте:
- prompt-kit компоненты: `Message`, `Markdown`, `PromptInput`, `Loader`, `ChatContainer`, `ScrollButton`, `CodeBlock`
- `useChat` из `@ai-sdk/react` с `DefaultChatTransport`
- Итерация по `message.parts` в message-list (текст рендерится через `Markdown`, tool parts пропускаются с `return null`)
- Код-плейсхолдер из F1 шаг 3.3:
  ```tsx
  if (part.type.startsWith('tool-')) {
    // F3 — отображение тулов (пока пропускаем)
    return null
  }
  ```

F3 заполняет этот плейсхолдер.

---

## Формат данных: AI SDK v6 Tool Parts

В AI SDK v6 tool parts в `message.parts` имеют динамический тип `tool-${toolName}`:

```typescript
// Тип: ToolUIPart из AI SDK v6
type ToolUIPart = {
  type: `tool-${string}`    // e.g. "tool-getWeather", "tool-searchDatabase"
  toolCallId: string
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  input?: Record<string, unknown>   // аргументы тула
  output?: Record<string, unknown>  // результат (только при output-available)
  errorText?: string                // текст ошибки (только при output-error)
}
```

**Жизненный цикл состояний при стриминге:**
```
input-streaming → input-available → output-available
                                  → output-error
```

- `input-streaming` — агент генерирует аргументы тула (стрим ещё идёт)
- `input-available` — аргументы готовы, тул выполняется на сервере
- `output-available` — тул вернул результат
- `output-error` — тул завершился ошибкой

**При загрузке из истории** — parts сразу в финальном состоянии (`output-available` или `output-error`).

---

## Формат данных: prompt-kit ToolPart

```typescript
// Интерфейс ToolPart из prompt-kit
interface ToolPart {
  type: string                      // имя тула (e.g. "getWeather")
  state: string                     // состояние
  input: Record<string, unknown>    // входные данные
  output?: Record<string, unknown>  // результат
  toolCallId: string                // ID вызова
  errorText?: string                // текст ошибки
}
```

**Совместимость:** AI SDK `ToolUIPart` и prompt-kit `ToolPart` почти совместимы. Поля `state`, `output`, `toolCallId`, `errorText` — одинаковые. Различия:

1. **`type`:** AI SDK использует `tool-${name}` (e.g. `"tool-getWeather"`), prompt-kit standalone-примеры используют просто `name` (e.g. `"getWeather"`). Но prompt-kit chatbot-пример передаёт `part as ToolPart` напрямую — компонент принимает оба формата, просто отображает `type` как заголовок блока as-is.

2. **`input` при `input-streaming`:** AI SDK v6 отдаёт `DeepPartial<T> | undefined` (частичный объект пока стрим не завершён). prompt-kit `ToolPart` объявляет `input: Record<string, unknown>` (required). Runtime это работает (chatbot-пример не делает преобразований), но TypeScript может ругаться — использовать `as ToolPart`.

> Подтверждено документацией prompt-kit: chatbot-пример передаёт `part as ToolPart` напрямую из `message.parts`.

---

## Фаза 1: Установить prompt-kit Tool компонент

### Шаг 1.1 — Добавить компонент

```bash
npx shadcn@latest add "https://prompt-kit.com/c/tool.json"
```

Компонент установится в `src/components/prompt-kit/tool.tsx`.

**Проверка:** файл `src/components/prompt-kit/tool.tsx` создан, экспортирует `Tool` и `ToolPart`.

---

## Фаза 2: Фронтенд — рендеринг тулов

### Шаг 2.1 — Хелпер isToolPart

**Файл:** `src/components/chat/message-list.tsx`

Добавить type guard для определения tool parts:

```typescript
function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith('tool-')
}
```

> В AI SDK v6 все tool parts имеют тип `tool-${toolName}`. Text parts — `type: 'text'`. Других типов (source, reasoning, file) в MVP нет.

### Шаг 2.2 — Заменить плейсхолдер на Tool компонент

**Файл:** `src/components/chat/message-list.tsx`

Импорт:
```typescript
import { Tool } from '@/components/prompt-kit/tool'
import type { ToolPart } from '@/components/prompt-kit/tool'
```

В итерации по `message.parts` заменить плейсхолдер:

```tsx
{message.parts.map((part, i) => {
  if (part.type === 'text') {
    return <Markdown key={`${message.id}-text-${i}`} id={message.id}>{part.text}</Markdown>
  }
  if (isToolPart(part)) {
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

**Логика `defaultOpen`:**
- Ошибки (`output-error`) — раскрыты по умолчанию (пользователь сразу видит проблему)
- Успешные (`output-available`) и промежуточные (`input-streaming`, `input-available`) — свёрнуты

**Ключи (`key`):**
- Для tool parts — `toolCallId` (уникален для каждого вызова)
- Для text parts — индекс (text parts не имеют стабильного ID)

### Шаг 2.3 — Стилизация tool blocks в контексте сообщения

**Файл:** `src/components/chat/message-list.tsx`

Tool blocks рендерятся внутри assistant-сообщения. Убедиться что layout корректен:

```tsx
// Ассистент
<Message className="justify-start">
  <div className="max-w-[85%] flex-1 space-y-2">
    {message.parts.map((part, i) => {
      if (part.type === 'text') {
        return <Markdown key={`${message.id}-text-${i}`} id={message.id}>{part.text}</Markdown>
      }
      if (isToolPart(part)) {
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
  </div>
</Message>
```

> `space-y-2` — вертикальный отступ между text и tool blocks внутри одного сообщения.
> Tool blocks и text blocks чередуются в порядке из `message.parts` — так агент может написать текст, вызвать тул, написать ещё текст.

### Шаг 2.4 — Одинаковый рендеринг для стрима и истории

Не требует отдельного кода — один и тот же `Tool` компонент обрабатывает оба случая:

**При стриминге:** parts обновляются в реальном времени. `useChat` обновляет `message.parts` при каждом чанке. Состояния меняются: `input-streaming` → `input-available` → `output-available`. React перерендеривает `Tool` с новым `state` — визуально переход от "loading" к "result".

**При загрузке из истории:** `toAISdkV5Messages()` конвертирует Mastra messages в UIMessage. Tool parts уже в финальном состоянии (`output-available` или `output-error`). `Tool` рендерит их как свёрнутые блоки с результатом.

**Формат Mastra memory:** tool calls хранятся как `content.toolInvocations[]` внутри assistant message. Каждый элемент: `{ toolCallId, toolName, args, result, state: 'result' }`. Функция `toAISdkV5Messages()` конвертирует эту структуру в `parts[]` формат, совместимый с `useChat` v6.

**Два пути поступления tool parts — один формат на выходе:**
- **Стриминг:** `toAISdkStream()` → `useChat` → `message.parts` с `type: 'tool-${toolName}'` (нативный v6)
- **История:** `toAISdkV5Messages()` → `useChat` (initialMessages) → тот же формат `message.parts`

В обоих случаях `useChat` v6 отдаёт parts в едином формате. Один и тот же `Tool` компонент рендерит оба случая.

---

## Фаза 3: Форматирование input/output (опционально)

prompt-kit `Tool` по умолчанию отображает `input` и `output` как JSON. Для MVP этого достаточно.

### Будущие улучшения (за рамками F3):
- Кастомный рендеринг output для конкретных тулов (F5 добавит тулы — тогда будет понятно какой формат)
- Маппинг имени тула на human-readable название (реестр из F7)
- Иконки для разных типов тулов

---

## Проверка

- [ ] `npx shadcn@latest add "https://prompt-kit.com/c/tool.json"` — компонент установлен
- [ ] При вызове тула агентом — отображается сворачиваемый блок с именем тула
- [ ] Во время стрима: видна смена состояний (input-streaming → input-available → output-available)
- [ ] Состояние `input-available` / `input-streaming` — отображается как loading
- [ ] Состояние `output-available` — отображается результат (JSON)
- [ ] Состояние `output-error` — блок раскрыт по умолчанию, показан текст ошибки
- [ ] Клик раскрывает/сворачивает детали (input, output)
- [ ] В истории: тулы отображаются в финальном состоянии (свёрнутые, с результатом)
- [ ] Несколько tool calls в одном сообщении — все отображаются в правильном порядке
- [ ] Text + tool + text чередование — порядок частей сохраняется
- [ ] Сообщения без tool calls — рендерятся как раньше (только Markdown)

---

## Решённые вопросы

1. **Совместимость AI SDK ↔ prompt-kit** → Интерфейсы `ToolUIPart` и `ToolPart` почти совместимы. `part as ToolPart` работает (подтверждено chatbot-примером prompt-kit). Различия в `type` (prefix `tool-`) и `input` (может быть `undefined` при `input-streaming`) не блокируют — prompt-kit обрабатывает оба случая runtime.

2. **Состояния** → AI SDK v6 использует 4 состояния: `input-streaming`, `input-available`, `output-available`, `output-error`. prompt-kit `Tool` поддерживает те же состояния. Маппинг 1:1, дополнительная конвертация не нужна.

3. **Отображение input/output** → Raw JSON (дефолт prompt-kit). Достаточно для MVP — тулы появятся в F5, тогда можно добавить кастомный рендеринг.

4. **Бэкенд изменения** → Не нужны. Tool call/result чанки уже проходят через `toAISdkStream({ from: 'agent' })` в BFF route (F1 шаг 3.2). Mastra memory сохраняет tool parts как `content.toolInvocations[]` внутри assistant message автоматически.

5. **Mastra memory формат** → Tool calls хранятся в `content.toolInvocations[]` (не как отдельные сообщения `role: 'tool'`). Каждый элемент: `{ toolCallId, toolName, args, result, state: 'result' }`. Конвертация в UI-формат — через `toAISdkV5Messages()`.

## Открытые вопросы

1. **Tool parts из истории** → Проверить при реализации: tool calls из Mastra memory корректно появляются в `message.parts` после прохождения через `toAISdkV5Messages()` → `useChat`. Если tool parts теряются — проверить формат `content.toolInvocations` в raw Mastra messages.

2. **Имена тулов в UI** → `type` приходит как `tool-getWeather` (AI SDK v6 формат). prompt-kit отображает `type` как заголовок блока as-is. Варианты:
   - (a) Оставить `tool-getWeather` — работает, но не красиво
   - (b) Strip `tool-` prefix: `{ ...part, type: part.type.replace(/^tool-/, '') }` — чище
   - **Рекомендация:** (b). Решить при реализации, когда увидим как выглядит.
