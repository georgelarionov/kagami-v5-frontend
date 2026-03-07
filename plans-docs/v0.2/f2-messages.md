# F2. Персистентность сообщений и пагинация — План реализации

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> Сервер — источник истины. Фронтенд только отображает и отправляет пользовательский ввод.
> Зависит от F1 (стриминг) — сообщения уже сохраняются в Mastra memory через `agent.stream()`.

**Scope:** пагинация и загрузка сообщений. Удаление истории — в F8.

---

## Фаза 1: Бэкенд (kagami-v5-frontend, BFF)

> **contracts.md:** обновить контракты — формат пагинации (`page`/`perPage`), формат ответа.

### Шаг 1.1 — Обновить GET /api/chat/messages (пагинация)

Текущий endpoint загружает все сообщения (`perPage: 1000`). Доработать — серверная пагинация.

**Файл:** `src/app/api/chat/messages/route.ts`

**Параметры запроса (query string):**
- `chatId` (обязательный) — как сейчас
- `page` (опциональный, дефолт `0`) — номер страницы
- `perPage` (опциональный, дефолт `50`, максимум `100`)

**Вызов Mastra (проверено по документации `@mastra/client-js`):**
```typescript
const thread = mastraClient.getMemoryThread({ threadId: chatId, agentId: 'kagamiAgent' })
const result = await thread.listMessages({
  page,
  perPage,
  orderBy: { field: 'createdAt', direction: 'DESC' },
})
// result: { messages: MastraMessage[], total: number, hasMore: boolean }
```

> Mastra API поддерживает `page`/`perPage` пагинацию (НЕ cursor).
> `orderBy: DESC` — page=0 возвращает последние 50. Перед отдачей клиенту — реверс в ASC.

**Формат ответа:**
```json
{
  "messages": [],
  "hasMore": true
}
```

**Валидация:**
```typescript
const page = Math.max(0, parseInt(req.nextUrl.searchParams.get('page') ?? '0') || 0)
const perPage = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('perPage') ?? '50') || 50))
```

**Полный код:**
```typescript
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { chats, projects } from '@/db/schema'
import { mastraClient } from '@/lib/mastra'
import { eq, and } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  const page = Math.max(0, parseInt(req.nextUrl.searchParams.get('page') ?? '0') || 0)
  const perPage = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('perPage') ?? '50') || 50))

  // Verify user owns the project
  const [chat] = await getDb()
    .select({ id: chats.id })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  try {
    const thread = mastraClient.getMemoryThread({ threadId: chatId, agentId: 'kagamiAgent' })
    const result = await thread.listMessages({
      page,
      perPage,
      orderBy: { field: 'createdAt', direction: 'DESC' },
    })
    // Reverse to chronological order (ASC) for client rendering
    const messages = [...result.messages].reverse()
    return NextResponse.json({ messages, hasMore: result.hasMore })
  } catch {
    return NextResponse.json({ messages: [], hasMore: false })
  }
}
```

Auth и ownership check — без изменений.

---

## Фаза 2: Фронтенд (kagami-v5-frontend)

### Шаг 2.1 — Заменить useChatMessages на useInfiniteQuery

**Файл:** `src/hooks/use-chat-messages.ts`

Текущий хук использует `useQuery` и возвращает плоский массив. Заменяем на `useInfiniteQuery` для поддержки пагинации.

```typescript
'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import type { Message } from '@/types/chat'

interface MessagesPage {
  messages: Message[]
  hasMore: boolean
}

export function useChatMessages(chatId: string) {
  const query = useInfiniteQuery({
    queryKey: ['memory', 'messages', chatId],
    queryFn: async ({ pageParam = 0 }): Promise<MessagesPage> => {
      const res = await fetch(
        `/api/chat/messages?chatId=${chatId}&page=${pageParam}&perPage=50`
      )
      if (!res.ok) throw new Error('Failed to fetch messages')
      return res.json()
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.hasMore ? allPages.length : undefined
    },
  })

  // Склеить все страницы в хронологическом порядке
  // Старые страницы (page=N) идут в начало, новые (page=0) в конец
  const messages = query.data
    ? [...query.data.pages].reverse().flatMap((page) => page.messages)
    : []

  const hasMore = query.data?.pages[query.data.pages.length - 1]?.hasMore ?? false

  return {
    messages,
    isLoading: query.isLoading,
    hasMore,
    fetchOlderMessages: query.fetchNextPage,
    isFetchingOlder: query.isFetchingNextPage,
  }
}
```

> **Порядок страниц:** react-query хранит страницы в порядке запроса: [page=0, page=1, page=2...].
> page=0 — последние 50, page=1 — предыдущие 50 и т.д.
> При склейке — reverse pages, затем flatMap messages. Результат: хронологический порядок (ASC).

### Шаг 2.2 — Интеграция с useChat (после F1)

В `chat-page.tsx` (или аналог после F1):

1. `useChatMessages(chatId)` загружает историю (page=0, последние 50)
2. `messages` передаются как `initialMessages` в `useChat` через `toAISdkV5Messages()`
3. Новые сообщения из стрима `useChat` добавляет автоматически
4. При "загрузить ранние" — prepend старых сообщений к `messages` в `useChat` через `setMessages`

```typescript
// Пример интеграции в chat-page.tsx
const { messages: historyMessages, hasMore, fetchOlderMessages, isFetchingOlder } = useChatMessages(chatId)

const { messages, sendMessage, status, setMessages } = useChatStream({
  chatId,
  projectId,
  initialMessages: historyMessages,
})

// При подгрузке старых — обновить messages в useChat
const handleLoadOlder = async () => {
  const result = await fetchOlderMessages()
  if (result.data) {
    // Prepend older messages
    const olderMessages = [...result.data.pages].reverse().flatMap(p => p.messages)
    setMessages([...toAISdkV5Messages(olderMessages), ...messages])
  }
}
```

> Точная интеграция зависит от API `useChat` из F1. Возможны варианты:
> `setMessages` для обновления полного списка, или сохранение в отдельном state + merge.
> Уточнить при реализации, когда F1 завершён.

### Шаг 2.3 — Кнопка "Загрузить ранние" в message-list

**Файл:** `src/components/chat/message-list.tsx`

Добавить кнопку вверху списка сообщений:

```tsx
{hasMore && (
  <div className="flex justify-center py-2">
    <Button
      variant="ghost"
      size="sm"
      onClick={onLoadOlder}
      disabled={isFetchingOlder}
    >
      {isFetchingOlder ? (
        <Loader2 className="size-4 animate-spin mr-2" />
      ) : (
        <ChevronUp className="size-4 mr-2" />
      )}
      Загрузить ранние
    </Button>
  </div>
)}
```

**Props** — добавить:
```typescript
interface MessageListProps {
  messages: Message[]
  isLoading: boolean
  hasMore: boolean
  isFetchingOlder: boolean
  onLoadOlder: () => void
}
```

### Шаг 2.4 — Сохранение позиции скролла при prepend

При добавлении старых сообщений в начало списка скролл не должен прыгать.

```typescript
// В message-list.tsx или хуке
const handleLoadOlder = async () => {
  const viewport = contentRef.current?.closest('[data-slot="scroll-area-viewport"]')
  const scrollHeightBefore = viewport?.scrollHeight ?? 0

  await onLoadOlder()

  // После рендера — восстановить позицию
  requestAnimationFrame(() => {
    if (viewport) {
      const scrollHeightAfter = viewport.scrollHeight
      viewport.scrollTop += scrollHeightAfter - scrollHeightBefore
    }
  })
}
```

> Если F1 заменит ScrollArea на ChatContainer (prompt-kit) — адаптировать селектор viewport.
> `ChatContainerRoot` использует `use-stick-to-bottom`, у которого свой ref для viewport.

### Шаг 2.5 — Восстановление при перезагрузке

При reload страницы:
1. `useChatMessages` загружает page=0 (последние 50) — автоматически при mount
2. `useChat` инициализируется с этими `initialMessages` — сообщения видны сразу
3. Ранее подгруженные страницы (page=1, 2...) теряются — ожидаемое поведение
4. `pendingMessage` без ответа → retry (обработка из F1, без изменений)

Дополнительных действий не требуется — react-query + useChat покрывают этот кейс.

---

## Проверка

- [ ] При открытии чата загружаются последние 50 сообщений
- [ ] Reload страницы — сообщения на месте
- [ ] Кнопка "Загрузить ранние" видна когда `hasMore === true`
- [ ] Нажатие кнопки подгружает предыдущую пачку (50)
- [ ] Скролл не прыгает при подгрузке старых сообщений
- [ ] Кнопка скрыта когда все сообщения загружены
- [ ] Пустой чат — "Send a message to start", кнопки нет
- [ ] Менее 50 сообщений — все загружены, кнопки нет
- [ ] Новые сообщения через стрим не конфликтуют с подгрузкой старых

## Решённые вопросы

1. **Формат пагинации** → `page`/`perPage` (нативная поддержка Mastra API). НЕ cursor — Mastra API не поддерживает cursor-пагинацию.
2. **Mastra API ответ** → `{ messages, total, hasMore }` — `hasMore` для определения видимости кнопки.
3. **Размер пачки** → 50 сообщений (стандарт для чатов).
4. **UI подгрузки** → Явная кнопка "Загрузить ранние" (не infinite scroll).
5. **Удаление истории** → Вынесено в F8. В F2 только пагинация.
6. **API удаления (для F8)** → `thread.deleteMessages(messageIds)` в client-js (конкретные ID), или `DELETE /memory/deleteMessages` с `{ threadId, clearAll: true }` через REST API Mastra Server.
