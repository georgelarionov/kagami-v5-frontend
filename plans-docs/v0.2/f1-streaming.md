# F1. Стриминг — План реализации

> Замена polling на real-time стриминг. Фундамент для всех последующих фич.

## Фаза 0: Интеграция prompt-kit

Подготовительный шаг — заменить текущие компоненты чата на prompt-kit до перехода на стриминг. Так разделяем изменения: сначала UI, потом транспорт.

### Шаг 0.1 — Установить prompt-kit компоненты

Компоненты устанавливаются в `src/components/prompt-kit/` (отдельно от `ui/`).

```bash
# Сообщения + markdown
npx shadcn@latest add "https://prompt-kit.com/c/message.json"
npx shadcn@latest add "https://prompt-kit.com/c/markdown.json"

# Ввод
npx shadcn@latest add "https://prompt-kit.com/c/prompt-input.json"

# Индикаторы загрузки
npx shadcn@latest add "https://prompt-kit.com/c/loader.json"

# Layout + автоскролл
npx shadcn@latest add "https://prompt-kit.com/c/chat-container.json"
npx shadcn@latest add "https://prompt-kit.com/c/scroll-button.json"

# Код
npx shadcn@latest add "https://prompt-kit.com/c/code-block.json"
```

Дополнительные зависимости (Markdown):
```bash
npm install react-markdown remark-gfm remark-breaks
npm install -D @tailwindcss/typography
```

### Шаг 0.2 — Заменить компоненты чата

**`message-list.tsx`** → `Message` + `Markdown`:
```tsx
import { Message, MessageAvatar, MessageContent, MessageActions } from '@/components/prompt-kit/message'
import { Markdown } from '@/components/prompt-kit/markdown'

// Ассистент
<Message className="justify-start">
  <MessageAvatar src="/avatars/ai.png" alt="AI" fallback="AI" />
  <div className="max-w-[85%] flex-1">
    <Markdown id={message.id}>{message.content}</Markdown>
  </div>
</Message>

// Пользователь
<Message className="justify-end">
  <MessageContent className="bg-primary text-primary-foreground">
    {message.content}
  </MessageContent>
</Message>
```

> Важно: `Markdown` с prop `id={message.id}` мемоизирует каждый блок — критично для стриминга.

**`composer.tsx`** → `PromptInput`:
```tsx
import { PromptInput, PromptInputTextarea, PromptInputActions, PromptInputAction } from '@/components/prompt-kit/prompt-input'

<PromptInput value={input} onValueChange={setInput} isLoading={isLoading} onSubmit={handleSubmit}>
  <PromptInputTextarea placeholder="Ask me anything..." />
  <PromptInputActions className="justify-end pt-2">
    <PromptInputAction tooltip={isLoading ? "Stop" : "Send"}>
      <Button variant="default" size="icon" className="h-8 w-8 rounded-full" onClick={handleSubmit}>
        {isLoading ? <Square className="size-5 fill-current" /> : <ArrowUp className="size-5" />}
      </Button>
    </PromptInputAction>
  </PromptInputActions>
</PromptInput>
```

> Enter отправляет, Shift+Enter — перенос строки. Textarea авто-ресайзится до maxHeight (240px).

**`run-status.tsx`** → `Loader`:
```tsx
import { Loader } from '@/components/prompt-kit/loader'

// Варианты: "dots", "typing", "pulse", "text-shimmer" и др.
<Loader variant="text-shimmer" text="Thinking..." size="sm" />
```

**`chat-page.tsx`** → `ChatContainer` + `ScrollButton`:
```tsx
import { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor } from '@/components/prompt-kit/chat-container'
import { ScrollButton } from '@/components/prompt-kit/scroll-button'

<div className="relative flex h-full w-full flex-col overflow-hidden">
  <ChatContainerRoot className="flex-1">
    <ChatContainerContent className="space-y-4 p-4">
      {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
    </ChatContainerContent>
    <ChatContainerScrollAnchor />
    <div className="sticky bottom-4 flex justify-center">
      <ScrollButton />
    </div>
  </ChatContainerRoot>
  <PromptInput ... />
</div>
```

> `ScrollButton` работает только внутри `ChatContainerRoot`. Использует `use-stick-to-bottom` — стик к низу при новых сообщениях, отключается при скролле вверх.

### Шаг 0.3 — Проверить на текущей polling-системе

- [ ] Сообщения рендерятся с markdown (заголовки, списки, код, ссылки)
- [ ] Автоскролл работает: стик к низу при новом сообщении, ScrollButton при скролле вверх
- [ ] Composer: Enter отправляет, Shift+Enter — перенос, авто-ресайз
- [ ] Loader отображается при polling
- [ ] CodeBlock подсветка синтаксиса работает внутри Markdown

> После этого шага UI готов к стримингу — при переходе на `useChat` меняем только данные, не компоненты.

---

## Фаза 1: Критический эксперимент (бэкенд)

Проверить: продолжает ли Mastra Server генерацию если BFF отключился от стрима.

**Что известно из документации:**
- Без `abortSignal`: сервер продолжает генерацию. Клиент узнаёт о disconnect только при попытке записи в закрытое соединение. Сообщения сохраняются в memory если генерация завершилась успешно.
- С `abortSignal`: стрим останавливается, частичные результаты НЕ сохраняются в memory.

**Эксперимент:**
1. Написать тестовый скрипт на бэкенде: `agent.stream()` с memory, оборвать HTTP-соединение на середине (без abortSignal)
2. Подождать ~30 секунд
3. Проверить `thread.listMessages()` — появился ли полный ответ

- **Если ДА** → основной план работает как есть. Ничего extra не нужно
- **Если НЕТ** → fallback варианты (выбрать один):
  - **A) Dual-path:** BFF вызывает `agent.generate()` (fire-and-forget, сохраняет в memory) + параллельно `agent.stream()` без memory для UI-стрима. Минус: двойной вызов LLM
  - **B) Server-held stream:** Mastra Server держит стрим в фоне (новый endpoint), BFF подключается/переподключается. Минус: нужна доработка kagami-api
  - **C) Hybrid:** Оставить workflow для надёжности + стриминг-UI поверх (polling статуса workflow + SSE для токенов). Минус: сложность

> По документации ожидаем ДА — сервер продолжает генерацию без abortSignal. Но это UNCONFIRMED — документация явно не описывает поведение при disconnect. Эксперимент обязателен.

---

## Фаза 2: Бэкенд (kagami-api)

### Шаг 2.0 — Создать contracts.md

Создать `plans-docs/v0.2/contracts.md` — единый файл контрактов между репо. Копировать в обе репы.

Первые контракты F1:
- Agent ID: `kagamiAgent`
- Streaming endpoint: `MastraClient.getAgent('kagamiAgent').stream(message: string, options)`
- Memory format: `{ memory: { thread: chatId, resource: '${userId}:${projectId}' } }`
- BFF → Browser: AI SDK UIMessageStream format (SSE)

**Правило:** каждый бэкенд-шаг в каждой фиче обновляет contracts.md если вводит кастомный интерфейс.

### Шаг 2.1 — Обновить agent.stream() с новым Memory API

Новый формат memory (старый `threadId`/`resourceId` удалён):
```typescript
// MastraClient (HTTP API) принимает СТРОКУ message, не массив.
// История подгружается из memory автоматически по thread ID.
const stream = await agent.stream(userMessageText, {
  memory: {
    thread: chatId,                    // string или { id, title?, metadata? }
    resource: `${userId}:${projectId}`, // resourceId
  },
})
```

Ключевые опции `agent.stream()`:
- `memory` — автосохранение в БД по завершении
- `savePerStep: false` (default) — batch save после завершения, не на каждом шаге
- `requestContext` — для будущего F6
- `onFinish`, `onError` — колбэки

### Шаг 2.2 — Сохранение pendingMessage (без изменений)

- Текущая логика сохранения `pendingMessage` в БД остаётся как fallback
- При обрыве стрима: pendingMessage сохраняется, при возврате — загрузить из memory или retry

### Шаг 2.3 — Workflow: не удалять

- `chat-workflow` остаётся в коде для будущей фазы отчётов
- Но для чата больше не используется

---

## Фаза 3: Фронтенд — стриминг (kagami-v5-frontend)

### Шаг 3.1 — Установить пакеты

```bash
npm install ai@6 @ai-sdk/react@3 @mastra/ai-sdk@1.1 @mastra/core
```

Пакеты и их роль:
- `ai` — `DefaultChatTransport`, `createUIMessageStream`, `createUIMessageStreamResponse`
- `@ai-sdk/react` — `useChat`
- `@mastra/ai-sdk` — `toAISdkStream` (BFF конвертация стрима)
- `@mastra/ai-sdk/ui` — `toAISdkV5Messages` (конвертация сообщений для initialMessages)
- `@mastra/core` — типы `ChunkType`, `MastraModelOutput`

### Шаг 3.2 — BFF streaming route

Переписать `POST /api/chat/route.ts`. Цепочка конвертации:

```
MastraClient.getAgent().stream()
  → response.processDataStream({ onChunk })
    → new ReadableStream<ChunkType>
      → toAISdkStream(stream, { from: 'agent' })
        → createUIMessageStream({ execute: writer => ... })
          → createUIMessageStreamResponse({ stream })
            → SSE Response к браузеру
```

```typescript
// src/app/api/chat/route.ts
import { MastraClient } from '@mastra/client-js'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { toAISdkStream } from '@mastra/ai-sdk'
import type { ChunkType, MastraModelOutput } from '@mastra/core/stream'

export async function POST(req: Request) {
  // 1. Auth + validation
  const { userId } = await auth()
  const { messages, chatId, projectId } = await req.json()

  // 2. Ownership check
  // ... verify chatId belongs to userId ...

  // 3. Concurrency guard — reject if another stream is active
  const chat = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1)
  if (chat[0]?.pendingMessage) {
    return new Response(JSON.stringify({ error: 'Another message is being processed' }), { status: 409 })
  }

  // 4. Extract last user message text from UIMessage parts
  // useChat sends full messages[] as UIMessage[], but MastraClient accepts a single string.
  // History is loaded from memory automatically by thread ID.
  const lastUserMessage = messages[messages.length - 1]
  const userText = lastUserMessage.parts
    ?.filter((p: { type: string }) => p.type === 'text')
    .map((p: { text: string }) => p.text)
    .join('') ?? lastUserMessage.content ?? ''

  // 5. Save pendingMessage
  await db.update(chats).set({ pendingMessage: userText }).where(eq(chats.id, chatId))

  // 6. Stream from Mastra (single string message, not array)
  const client = new MastraClient({
    baseUrl: process.env.MASTRA_API_URL,
    headers: { 'X-Project-Id': projectId }, // для будущего F6
  })
  const agent = client.getAgent('kagamiAgent')
  const response = await agent.stream(userText, {
    memory: { thread: chatId, resource: `${userId}:${projectId}` },
  })

  // 7. Convert Mastra stream → AI SDK stream
  const chunkStream = new ReadableStream<ChunkType>({
    async start(controller) {
      await response.processDataStream({
        onChunk: async (chunk) => controller.enqueue(chunk),
      })
      controller.close()
    },
  })

  const uiMessageStream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      for await (const part of toAISdkStream(
        chunkStream as unknown as MastraModelOutput,
        { from: 'agent' }
      )) {
        await writer.write(part)
      }
    },
    onFinish: async () => {
      // Clear pendingMessage when BFF finishes writing SSE to client.
      // Caveat: Mastra memory save happens independently on the server side —
      // there's a small window where pendingMessage is cleared but memory
      // hasn't saved yet. Acceptable tradeoff: on reload, messages load from
      // memory (which will have saved by then).
      await db.update(chats).set({ pendingMessage: null }).where(eq(chats.id, chatId))
    },
  })

  return createUIMessageStreamResponse({ stream: uiMessageStream })
}
```

> Примечание: `as unknown as MastraModelOutput` — документированный cast. Типы MastraClient и MastraModelOutput не совпадают, но runtime данные совместимы.
>
> Важно: `MastraClient.getAgent().stream()` принимает **строку** (последнее сообщение), не массив. `useChat` отправляет весь `messages[]` в BFF, но BFF извлекает только текст последнего user-сообщения. История диалога загружается на стороне Mastra Server из memory по `thread` ID.

### Шаг 3.3 — useChat вместо useChatRun

```typescript
// src/hooks/use-chat-stream.ts (замена use-chat-run.ts)
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { toAISdkV5Messages } from '@mastra/ai-sdk/ui'

export function useChatStream({ chatId, projectId, initialMessages }) {
  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    id: chatId,
    messages: toAISdkV5Messages(initialMessages), // Mastra messages → UIMessage[]
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { chatId, projectId }, // доп. данные в каждом запросе
    }),
  })

  return { messages, sendMessage, status, stop, error, setMessages }
}
```

**Статусы `useChat`** (замена isLoading + polling):
| Статус | Значение |
|---|---|
| `'ready'` | Idle, можно отправлять |
| `'submitted'` | Запрос отправлен, ждём первый токен |
| `'streaming'` | Получаем токены |
| `'error'` | Ошибка |

**Отправка:** `sendMessage({ text: 'Hello' })`

**Рендеринг:** итерация по `message.parts`:
```tsx
{message.parts.map((part, i) => {
  if (part.type === 'text') {
    return <Markdown key={i} id={message.id}>{part.text}</Markdown>
  }
  if (part.type.startsWith('tool-')) {
    // F3 — отображение тулов (пока пропускаем)
    return null
  }
})}
```

### Шаг 3.4 — Обновить компоненты под useChat

**`chat-page.tsx`:**
- Заменить `useChatRun` → `useChatStream`
- Использовать `status` вместо `isLoading` / `isPolling`
- `sendMessage({ text })` вместо текущего `sendMessage(text)`

**`message-list.tsx`:**
- Рендеринг через `message.parts` (уже описан выше)
- `message.role` для определения user/assistant

**`composer.tsx`:**
- Disable когда `status !== 'ready'`
- `onSubmit` → `sendMessage({ text: input })`

**Индикатор загрузки (замена run-status.tsx):**
```tsx
{status === 'submitted' && <Loader variant="text-shimmer" text="Thinking..." size="sm" />}
{status === 'streaming' && <Loader variant="dots" size="sm" />}
{status === 'error' && <RetryButton error={error} onRetry={...} />}
```

### Шаг 3.5 — Initial messages (загрузка истории)

При открытии чата: загрузить сообщения из memory.

```typescript
// В chat-page.tsx или серверном компоненте
const res = await fetch(`/api/chat/messages?chatId=${chatId}`)
const { messages: mastraMessages } = await res.json()

// Передать в useChatStream
<ChatClient initialMessages={mastraMessages} chatId={chatId} projectId={projectId} />
```

`toAISdkV5Messages()` принимает:
- `MastraDBMessage[]` (из Mastra memory) → `UIMessage[]`
- Каждый UIMessage: `{ id, role, parts: UIMessagePart[], metadata }`

Endpoint `/api/chat/messages` остаётся (возвращает Mastra messages), конвертация на клиенте.

### Шаг 3.6 — Обработка обрывов

**Reload страницы:**
1. Загрузить messages из memory → `toAISdkV5Messages()` → отрендерить
2. Проверить `pendingMessage` в БД (через `GET /api/chat/active-run` или новый endpoint)
3. Если есть pendingMessage но нет ответа → показать pending + retry кнопку

**Обрыв стрима (закрытие вкладки):**
- Сервер продолжает генерацию (без abortSignal)
- Memory автосохраняет по завершении
- При следующем визите: messages загружаются из memory — ответ уже там

**`stop()` по кнопке:**
- Вызывает `stop()` из useChat — обрывает SSE соединение на клиенте
- Сервер продолжает генерацию (без abortSignal от BFF)
- Частичный текст уже показан пользователю, полный ответ сохранится в memory
- **UX caveat:** пользователь видит частичный текст, но при reload — полный ответ (сервер доделал). Это intentional: сервер не знает о клиентском stop. TODO: в будущем можно добавить визуальную пометку или post-stop trimming

### Шаг 3.7 — Удаление polling-инфраструктуры

- Удалить `src/app/api/chat/active-run/route.ts`
- Удалить `src/app/api/chat/runs/[id]/route.ts`
- Удалить `src/hooks/use-chat-run.ts`
- Удалить из `chat-page.tsx`: polling-логику, таймеры, `MAX_POLL_DURATION`
- Удалить из `db/schema.ts`: поле `lastRunId` из chats (pendingMessage оставить)

> Не удалять `pendingMessage` — используется как fallback при обрыве.

---

## Проверка

- [ ] Сообщение отправляется, токены стримятся в реальном времени
- [ ] Markdown рендерится корректно во время стриминга (заголовки, списки, код)
- [ ] Закрытие вкладки → генерация продолжается → при возврате ответ загружен из memory
- [ ] Кнопка Stop → обрывает стрим на клиенте, частичный текст виден
- [ ] Обрыв стрима → retry работает через pendingMessage
- [ ] История сообщений загружается при открытии чата (toAISdkV5Messages)
- [ ] Polling endpoints удалены, нет регрессий
- [ ] Composer disabled при status !== 'ready'
- [ ] Автоскролл работает при стриминге (ChatContainer stick-to-bottom)

## Решённые вопросы

1. **chatRoute() vs ручная конвертация** → Ручная конвертация через `toAISdkStream()`. `handleChatStream()` требует embedded Mastra — не работает в 2-repo. `chatRoute()` можно добавить позже как оптимизацию.
2. **One active run constraint** → Клиент: disable send при `status !== 'ready'`. Сервер: BFF проверяет `pendingMessage IS NOT NULL` и возвращает 409 — защита от race conditions и параллельных табов.
3. **initialMessages формат** → `toAISdkV5Messages()` из `@mastra/ai-sdk/ui` конвертирует Mastra messages → UIMessage[]. Передать как `messages` prop в `useChat`.
4. **Memory API** → Новый формат: `memory: { thread: chatId, resource: resourceId }`. Старый `threadId`/`resourceId` удалён.
5. **Tool parts** → AI SDK v6: `tool-<toolName>` (per-tool naming), состояния: `input-streaming`, `input-available`, `output-available`, `output-error`. Маппится 1:1 с prompt-kit `Tool` компонентом.

## Открытые вопросы (оставшиеся)

1. Результат эксперимента Фазы 1 — подтвердить что Mastra продолжает генерацию при disconnect (документация UNCONFIRMED — явно не описывает поведение при disconnect)
2. ~~Нужно ли передавать `messages` от клиента в BFF route или BFF читает из memory + добавляет новое?~~ → **Решено:** `useChat` отправляет полный `messages[]`, BFF извлекает текст последнего user-сообщения и передаёт строкой в `MastraClient.stream()`. История загружается из memory по thread ID на стороне Mastra Server
