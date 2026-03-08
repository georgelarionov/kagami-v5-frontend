# Adding a Hook

## Steps

### 1. Create hook file

`src/hooks/use-<name>.ts`

Все хуки начинаются с `'use client'` directive.

### 2. Query hook (read data)

Для загрузки серверных данных — `useQuery`:

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'

export interface MyData {
  // typed response
}

export function useMyData(id: string) {
  return useQuery({
    queryKey: ['my-data', id],
    queryFn: async (): Promise<MyData> => {
      const res = await fetch(`/api/my-data?id=${id}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    },
    // staleTime/gcTime — подбирать по частоте изменений
  })
}
```

### 3. Mutation hook (write data)

Для изменения данных — `useMutation`:

```typescript
'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

export function useMyAction(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: MyInput) => {
      const res = await fetch('/api/my-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-data', id] })
    },
  })
}
```

### 4. Query + Mutation combo

Когда нужны и чтение и запись — объединить в один хук (паттерн `useProjectConfig`):

```typescript
export function useMyResource(id: string) {
  const queryClient = useQueryClient()
  const query = useQuery({ ... })
  const mutation = useMutation({ ... })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    save: mutation.mutate,
    isSaving: mutation.isPending,
  }
}
```

### 5. AI SDK streaming hook (special case)

`use-chat-stream.ts` использует `useChat` из `@ai-sdk/react` — это отдельный паттерн от react-query. Не использовать `useQuery`/`useMutation` для streaming:

```typescript
import { useChat, DefaultChatTransport } from '@ai-sdk/react'

export function useChatStream({ chatId, projectId, initialMessages }) {
  return useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    body: { chatId, projectId },
    initialMessages,
  })
}
```

Возвращает `{ messages, sendMessage, status, stop, error, setMessages }`. См. `src/hooks/use-chat-stream.ts` как reference implementation.

## Existing Hooks

| Hook | Type | Query Key | Purpose |
|---|---|---|---|
| `use-chat-stream` | AI SDK `useChat` | — | Streaming chat с Mastra |
| `use-chat-messages` | `useInfiniteQuery` | `['memory', 'messages', chatId]` | Paginated message history |
| `use-project-config` | query + mutation | `['project-config', projectId]` | Project settings CRUD |
| `use-registry` | `useQuery` | `['registry']` | Dynamic registry from backend |
| `use-clear-history` | `useMutation` | invalidates messages | Delete chat messages |

## Key Rules

- **Types** — экспортировать интерфейсы из хука, если они нужны компонентам
- **Query keys** — массив `['resource', id]`, consistent для `invalidateQueries`
- **Error handling** — `res.ok` check + parse error body для user-facing messages
- **`staleTime`** — подбирать по частоте изменений: 0 (default) для динамичных данных, 5min+ для статичных (registry)

## Checklist

- [ ] File created: `src/hooks/use-<name>.ts`
- [ ] `'use client'` directive
- [ ] Types exported (if used in components)
- [ ] Query key consistent with existing patterns
- [ ] Error handling: `res.ok` check + error body parse
- [ ] Cache invalidation on mutation success
