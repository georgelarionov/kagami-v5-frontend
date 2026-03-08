# Adding a BFF API Route

## Steps

### 1. Create route file

`src/app/api/<resource>/route.ts`

Next.js App Router conventions: каждый endpoint — отдельная папка с `route.ts`.

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Parse query params
  const param = req.nextUrl.searchParams.get('param')
  if (!param) return NextResponse.json({ error: 'Missing param' }, { status: 400 })

  try {
    // Call Mastra or DB
    return NextResponse.json({ data: 'result' })
  } catch (error) {
    console.error('[resource] Failed:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

### 2. Auth pattern

Каждый route начинается с:

```typescript
const { userId } = await auth()
if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
```

### 3. Ownership verification (if resource-specific)

Для ресурсов привязанных к пользователю — проверка через DB join:

```typescript
const [chat] = await getDb()
  .select({ id: chats.id })
  .from(chats)
  .innerJoin(projects, eq(chats.projectId, projects.id))
  .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))
if (!chat) return NextResponse.json({ error: 'Not found' }, { status: 404 })
```

### 4. Mastra proxy pattern

Для проксирования к Mastra Server:

**Shared `mastraClient`** (чтение данных без project context):

```typescript
import { mastraClient } from '@/lib/mastra'

const thread = mastraClient.getMemoryThread({ threadId, agentId: 'kagami-supervisor' })
const result = await thread.listMessages({ page, perPage })
```

**Per-request client** (когда нужен `X-Project-Id` для requestContext middleware):

```typescript
import { MastraClient } from '@mastra/client-js'

const client = new MastraClient({
  baseUrl: process.env.MASTRA_API_URL || 'http://localhost:4111',
  headers: { 'X-Project-Id': chat.projectId },
})
const agent = client.getAgent('kagami-supervisor')
```

Используется в `POST /api/chat` — бэкенд middleware читает `X-Project-Id` из заголовка и прокидывает через requestContext (F6).

**Raw `fetch`** (когда `mastraClient` не имеет метода):

```typescript
// Raw fetch: mastraClient has no method for this endpoint
const res = await fetch(
  `${process.env.MASTRA_API_URL || 'http://localhost:4111'}/endpoint`
)
```

Добавить комментарий почему используется `fetch` вместо `mastraClient`.

### 5. Input validation

`req.json()` обёрнут в try/catch, type checks на входных данных:

```typescript
let body
try {
  body = await req.json()
} catch {
  return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
}
if (typeof body.field !== 'string') {
  return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
}
```

### 6. Error logging

Формат: `[resource] Failed to <action>:` — для grep по логам.

```typescript
console.error('[chat/messages] Failed to delete messages:', error)
```

## Existing Routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/chat` | POST | Send message, start stream |
| `/api/chat/active-run` | GET, DELETE | Check/clear pending message |
| `/api/chat/messages` | GET, DELETE | Message history + clear history |
| `/api/project/config` | GET, PUT | Project config CRUD |
| `/api/registry` | GET | Proxy backend registry |

## Checklist

- [ ] File created: `src/app/api/<resource>/route.ts`
- [ ] Auth check: `await auth()` → 401
- [ ] Ownership verification (if resource-specific)
- [ ] Input validation with proper error messages
- [ ] Error logging with `[resource]` prefix
- [ ] Updated `plans-docs/v0.2/contracts.md` with endpoint spec
