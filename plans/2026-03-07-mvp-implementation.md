# Kagami v5 MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Working chat app with background agent execution — send message, close tab, come back, see result.

**Architecture:** Two repos (kagami-api, kagami-v5-frontend). Mastra workflow wraps agent.generate(), BFF polls run status, UI shows complete response. One agent, no streaming, no supervisor.

**Tech Stack:** Mastra Server + PostgresStore + Memory | Next.js + Clerk + Drizzle + shadcn + react-query | Neon PostgreSQL (pooled) | Railway

**Design doc:** `docs/plans/2026-03-07-architecture-design.md`

> **IMPORTANT for Claude Code:** Code samples in this plan are illustrative, not copy-paste. Mastra API evolves rapidly. Before implementing each task, verify the actual API via `mastra` MCP server and `context7`. Do not blindly copy code from this plan — check current docs first, then implement.

---

## Phase 0: Setup

### ~~Task 1: Create Neon database~~ ✅

**Step 1:** Log into Neon, create project `kagami`

**Step 2:** Get connection strings:
- Pooled: `postgres://...@ep-...-pooler.../kagami` (for runtime)
- Direct: `postgres://...@ep-...neon.tech/kagami` (for migrations)

**Step 3:** Save both strings — you'll need them for `.env` files in both repos.

---

### Task 2: Create Clerk project

**Step 1:** Log into Clerk, create application `kagami`

**Step 2:** Enable email/password sign-in

**Step 3:** Get keys:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_KEY` (for networkless verification: Dashboard → JWT Templates or API Keys → PEM public key)

---

### ~~Task 3: Get LLM API key~~ ✅

**Step 1:** Get OpenAI API key (`OPENAI_API_KEY`) or Anthropic API key (`ANTHROPIC_API_KEY`). One provider for MVP.

---

## Phase 1: kagami-api (Mastra Server)

### ~~Task 4: Scaffold kagami-api repo~~ ✅

**Step 1:** Create repo

```bash
mkdir kagami-api && cd kagami-api
npm create mastra@latest
```

Select: TypeScript, no example agent (we'll create our own).

**Step 2:** Create `.env.example`

```bash
# kagami-api/.env.example
OPENAI_API_KEY=            # or ANTHROPIC_API_KEY
DATABASE_URL=              # Neon pooled connection string (-pooler)
```

**Step 3:** Copy `.env.example` to `.env`, fill in real values.

**Step 4:** Commit

```bash
git add -A
git commit -m "chore: scaffold kagami-api with Mastra"
```

---

### ~~Task 5: Configure PostgresStore~~ ✅

Mastra needs global storage for workflow run persistence and memory.

**Files:**
- Create: `src/mastra/index.ts`

**Files:**
- Create: `src/mastra/store.ts`
- Create: `src/mastra/index.ts`

**Step 1:** Install dependencies

```bash
npm install @mastra/pg
```

**Step 2:** Create store in its own file (prevents circular imports — agent needs store, index needs agent)

```typescript
// src/mastra/store.ts
import { PostgresStore } from '@mastra/pg'

const connectionString = process.env.DATABASE_URL!

export const store = new PostgresStore({ connectionString })
```

**Step 3:** Configure Mastra instance

```typescript
// src/mastra/index.ts
import { Mastra } from '@mastra/core/mastra'
import { store } from './store'

export const mastra = new Mastra({
  storage: store,
})
```

**Step 3:** Run `npx mastra dev` — verify it starts without errors, Studio opens.

**Step 4:** Commit

```bash
git add -A
git commit -m "feat: configure PostgresStore for workflow persistence"
```

---

### ~~Task 6: Create the agent~~ ✅

**Files:**
- Create: `src/mastra/agents/kagami-agent.ts`
- Modify: `src/mastra/index.ts`

**Step 1:** Create agent definition

```typescript
// src/mastra/agents/kagami-agent.ts
import { Agent } from '@mastra/core/agent'
import { Memory } from '@mastra/memory'
import { store } from '../store'

export const kagamiAgent = new Agent({
  id: 'kagami-agent',
  instructions: 'You are a helpful assistant. Answer questions clearly and concisely.',
  model: 'openai/gpt-5.4',
  memory: new Memory({
    storage: store,
    options: { workingMemory: { scope: 'resource' } },
  }),
})
```

**Step 2:** Register agent in Mastra instance

```typescript
// src/mastra/index.ts
import { Mastra } from '@mastra/core/mastra'
import { store } from './store'
import { kagamiAgent } from './agents/kagami-agent'

export const mastra = new Mastra({
  storage: store,
  agents: { kagamiAgent },
})
```

**Step 3:** Run `npx mastra dev`, open Studio, verify agent appears. Send a test message in Studio chat.

**Step 4:** Commit

```bash
git add -A
git commit -m "feat: add kagami agent with memory"
```

---

### ~~Task 7: Create chat-workflow~~ ✅

The workflow wraps `agent.generate()` so runs persist independently of client connections.

**Files:**
- Create: `src/mastra/workflows/chat-workflow.ts`
- Modify: `src/mastra/index.ts`

**Step 1:** Create workflow

```typescript
// src/mastra/workflows/chat-workflow.ts
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'

const chatInputSchema = z.object({
  message: z.string(),
  threadId: z.string(),
  resourceId: z.string(),
})

const chatOutputSchema = z.object({
  response: z.string(),
})

const chatStep = createStep({
  id: 'chat',
  inputSchema: chatInputSchema,
  outputSchema: chatOutputSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent('kagamiAgent')
    if (!agent) throw new Error('Agent not found')

    const result = await agent.generate(inputData.message, {
      memory: {
        thread: inputData.threadId,
        resource: inputData.resourceId,
      },
    })

    return { response: result.text }
  },
})

export const chatWorkflow = createWorkflow({
  id: 'chat-workflow',
  inputSchema: chatInputSchema,
  outputSchema: chatOutputSchema,
})
  .then(chatStep)
  .commit()
```

**Step 2:** Register workflow in Mastra

```typescript
// src/mastra/index.ts
import { Mastra } from '@mastra/core/mastra'
import { store } from './store'
import { kagamiAgent } from './agents/kagami-agent'
import { chatWorkflow } from './workflows/chat-workflow'

export const mastra = new Mastra({
  storage: store,
  agents: { kagamiAgent },
  workflows: { chatWorkflow },
})
```

**Step 3:** Test in Studio:
- Go to Workflows → chat-workflow
- Run with input:
  ```json
  { "message": "Hello!", "threadId": "test-thread-1", "resourceId": "test:test" }
  ```
- Verify: status `success`, response contains agent's reply

**Step 4:** Test persistence — run same workflow again with same threadId. Agent should remember previous message.

**Step 5:** Commit

```bash
git add -A
git commit -m "feat: add chat-workflow wrapping agent.generate()"
```

---

### ~~Task 8: Verify background execution~~ ✅

**Step 1:** In Studio, trigger a workflow run.

**Step 2:** While it's running, stop the dev server (`Ctrl+C`).

**Step 3:** Restart: `npx mastra dev`

**Step 4:** Check workflow runs — the run should have auto-restarted or completed. Verify via Studio Runs tab.

**Step 5:** No commit needed — this is a verification step.

---

### ~~Task 9: Deploy kagami-api to Railway~~ ✅

**Step 1:** Create Railway project `kagami`

**Step 2:** Add service from GitHub repo `kagami-api`

**Step 3:** Set environment variables in Railway:
- `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`)
- `DATABASE_URL` (Neon pooled connection string)

**Step 4:** Configure:
- Build command: `npm run build` (or whatever Mastra uses)
- Start command: `npm start`
- Port: `4111`

**Step 5:** Deploy and verify service is running via Railway logs.

**Step 6:** Note the internal URL: `http://kagami-api.railway.internal:4111` — you'll need this for kagami-web.

---

## Phase 2: kagami-web (Next.js BFF + UI)

### ~~Task 10: Scaffold kagami-web repo~~ ✅

**Step 1:** Create repo

```bash
npx create-next-app@latest kagami-web --typescript --tailwind --eslint --app --src-dir
cd kagami-web
```

**Step 2:** Install dependencies

```bash
npm install @clerk/nextjs @mastra/client-js drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit
npx shadcn@latest init
```

**Step 3:** Create `.env.example`

```bash
# kagami-web/.env.example
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_JWT_KEY=
MASTRA_API_URL=http://localhost:4111
DATABASE_URL=              # Neon pooled (-pooler) for Drizzle runtime
DATABASE_URL_DIRECT=       # Neon direct for Drizzle migrations
```

**Step 4:** Copy to `.env.local`, fill in values. For local dev, `MASTRA_API_URL=http://localhost:4111`.

**Step 5:** Commit

```bash
git add -A
git commit -m "chore: scaffold kagami-web with Next.js, Clerk, Drizzle, shadcn"
```

---

### ~~Task 11: Configure Clerk auth~~ ✅

**Files:**
- Create: `src/middleware.ts`
- Modify: `src/app/layout.tsx`

**Step 1:** Add Clerk provider to root layout

```typescript
// src/app/layout.tsx
import { ClerkProvider } from '@clerk/nextjs'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
```

**Step 2:** Create middleware for auth

```typescript
// src/middleware.ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedRoute = createRouteMatcher(['/api/chat(.*)', '/api/projects(.*)'])

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)'],
}
```

**Step 3:** Run `npm run dev`, verify: visiting `/` works, `/api/chat` returns 401 without auth.

**Step 4:** Commit

```bash
git add -A
git commit -m "feat: configure Clerk auth middleware"
```

---

### ~~Task 12: Configure Drizzle schema~~ ✅

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/index.ts`
- Create: `drizzle.config.ts`

**Step 1:** Create schema

```typescript
// src/db/schema.ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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
  lastRunId: text('last_run_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

**Step 2:** Create db client

```typescript
// src/db/index.ts
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

const sql = neon(process.env.DATABASE_URL!)

export const db = drizzle(sql, { schema })
```

**Step 3:** Create Drizzle config

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT!,
  },
})
```

**Step 4:** Generate and run migration

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

**Step 5:** Verify tables exist in Neon (via Neon dashboard or MCP).

**Step 6:** Commit

```bash
git add -A
git commit -m "feat: add Drizzle schema (projects, chats with lastRunId)"
```

---

### ~~Task 13: Seed hardcoded project and chat~~ ✅

For MVP: one hardcoded project, one chat. No CRUD UI yet.

**Files:**
- Create: `src/db/seed.ts`

**Step 1:** Create seed script

```typescript
// src/db/seed.ts
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

async function seed() {
  const sql = neon(process.env.DATABASE_URL_DIRECT!)
  const db = drizzle(sql, { schema })

  // Replace with your actual Clerk userId after first sign-in
  const userId = process.env.SEED_USER_ID || 'user_placeholder'

  const [project] = await db.insert(schema.projects).values({
    userId,
    name: 'Default Project',
  }).returning()

  const [chat] = await db.insert(schema.chats).values({
    projectId: project.id,
    title: 'General',
  }).returning()

  console.log('Project:', project.id)
  console.log('Chat:', chat.id)
  console.log('Set these in .env.local:')
  console.log(`NEXT_PUBLIC_PROJECT_ID=${project.id}`)
  console.log(`NEXT_PUBLIC_CHAT_ID=${chat.id}`)
}

seed().catch(console.error)
```

**Step 2:** Run seed after first Clerk sign-in (to get real userId)

```bash
npx tsx src/db/seed.ts
```

**Step 3:** Add IDs to `.env.local`:

```bash
NEXT_PUBLIC_PROJECT_ID=<from seed output>
NEXT_PUBLIC_CHAT_ID=<from seed output>
```

**Step 4:** Commit

```bash
git add src/db/seed.ts
git commit -m "feat: add seed script for hardcoded project/chat"
```

---

### Task 14: Configure MastraClient

**Files:**
- Create: `src/lib/mastra.ts`

**Step 1:** Create client instance

```typescript
// src/lib/mastra.ts
import { MastraClient } from '@mastra/client-js'

export const mastraClient = new MastraClient({
  baseUrl: process.env.MASTRA_API_URL || 'http://localhost:4111',
})
```

**Step 2:** Commit

```bash
git add -A
git commit -m "feat: configure MastraClient for BFF"
```

---

### Task 15: Build chat API routes

**Files:**
- Create: `src/app/api/chat/route.ts` (POST — send message)
- Create: `src/app/api/chat/active-run/route.ts` (GET — check active run)
- Create: `src/app/api/chat/runs/[id]/route.ts` (GET — poll run status)
- Create: `src/app/api/chat/messages/route.ts` (GET — read history)

**Step 1:** POST /api/chat — send message, start workflow run

```typescript
// src/app/api/chat/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { chats, projects } from '@/db/schema'
import { mastraClient } from '@/lib/mastra'
import { eq, and } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message, chatId } = await req.json()
  if (!message || !chatId) {
    return NextResponse.json({ error: 'Missing message or chatId' }, { status: 400 })
  }

  // Get chat + verify user owns the project
  const [chat] = await db
    .select({ id: chats.id, lastRunId: chats.lastRunId, projectId: chats.projectId })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  // Check for active run
  if (chat.lastRunId) {
    const workflow = mastraClient.getWorkflow('chat-workflow')
    try {
      const existing = await workflow.runById(chat.lastRunId)
      if (existing?.payload?.workflowState?.status === 'running') {
        return NextResponse.json({ error: 'Active run exists' }, { status: 409 })
      }
    } catch {
      // Run not found or error — safe to proceed
    }
  }

  const projectId = process.env.NEXT_PUBLIC_PROJECT_ID!
  const resourceId = `${userId}:${projectId}`
  const threadId = chatId

  // Create run
  const workflow = mastraClient.getWorkflow('chat-workflow')
  const run = await workflow.createRun({ resourceId })

  // Save-before-start: save runId first
  await db.update(chats).set({ lastRunId: run.runId }).where(eq(chats.id, chatId))

  // Start run (fire-and-forget)
  try {
    await run.start({
      inputData: { message, threadId, resourceId },
    })
  } catch (err) {
    // Start failed — clean up lastRunId
    await db.update(chats).set({ lastRunId: null }).where(eq(chats.id, chatId))
    return NextResponse.json({ error: 'Failed to start run' }, { status: 500 })
  }

  return NextResponse.json({ runId: run.runId })
}
```

**Step 2:** GET /api/chat/active-run — check for active run on mount

```typescript
// src/app/api/chat/active-run/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { chats, projects } from '@/db/schema'
import { mastraClient } from '@/lib/mastra'
import { eq, and } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  // Verify user owns the project
  const [chat] = await db
    .select({ id: chats.id, lastRunId: chats.lastRunId })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))
  if (!chat?.lastRunId) {
    return NextResponse.json({ activeRun: null })
  }

  try {
    const workflow = mastraClient.getWorkflow('chat-workflow')
    const result = await workflow.runById(chat.lastRunId)
    const status = result?.payload?.workflowState?.status

    if (status === 'running' || status === 'waiting') {
      return NextResponse.json({ activeRun: { runId: chat.lastRunId, status } })
    }

    return NextResponse.json({ activeRun: null })
  } catch {
    return NextResponse.json({ activeRun: null })
  }
}
```

**Step 3:** GET /api/chat/runs/[id] — poll run status

```typescript
// src/app/api/chat/runs/[id]/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { chats, projects } from '@/db/schema'
import { mastraClient } from '@/lib/mastra'
import { eq, and } from 'drizzle-orm'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: runId } = await params
  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  // Verify user owns project AND run belongs to this chat
  const [chat] = await db
    .select({ id: chats.id, lastRunId: chats.lastRunId })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))
  if (!chat || chat.lastRunId !== runId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const workflow = mastraClient.getWorkflow('chat-workflow')
    const result = await workflow.runById(runId)
    const status = result?.payload?.workflowState?.status
    const error = status === 'failed' ? result?.payload?.workflowState?.error : undefined

    return NextResponse.json({ runId, status, error })
  } catch {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
}
```

**Step 4:** GET /api/chat/messages — read message history

```typescript
// src/app/api/chat/messages/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { mastraClient } from '@/lib/mastra'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  try {
    const thread = mastraClient.getMemoryThread({
      threadId: chatId,
      agentId: 'kagamiAgent',
    })
    const result = await thread.listMessages()
    return NextResponse.json({ messages: result.messages })
  } catch {
    return NextResponse.json({ messages: [] })
  }
}
```

**Step 5:** Test with curl (after signing in to get a session cookie, or temporarily disable auth for testing):

```bash
# Send message
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello!","chatId":"<your-chat-id>"}'

# Poll run
curl http://localhost:3000/api/chat/runs/<runId>?chatId=<chatId>

# Get messages
curl http://localhost:3000/api/chat/messages?chatId=<chatId>
```

**Step 6:** Commit

```bash
git add -A
git commit -m "feat: add chat API routes (send, poll, active-run, messages)"
```

---

### Task 16: Build useChatRun hook

**Files:**
- Create: `src/hooks/use-chat-run.ts`

**Step 1:** Create hook with stepped polling

```typescript
// src/hooks/use-chat-run.ts
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

type RunStatus = 'idle' | 'running' | 'success' | 'failed'

function getPollingInterval(elapsedMs: number): number {
  if (elapsedMs < 5000) return 500
  if (elapsedMs < 15000) return 2000
  return 4000
}

export function useChatRun(chatId: string) {
  const [runId, setRunId] = useState<string | null>(null)
  const [status, setStatus] = useState<RunStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const queryClient = useQueryClient()

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const pollRun = useCallback(async (currentRunId: string) => {
    try {
      const res = await fetch(`/api/chat/runs/${currentRunId}?chatId=${chatId}`)
      if (!res.ok) throw new Error('Poll failed')
      const data = await res.json()

      if (data.status === 'success') {
        setStatus('success')
        stopPolling()
        queryClient.invalidateQueries({ queryKey: ['memory', 'messages', chatId] })
        return
      }

      if (data.status === 'failed') {
        setStatus('failed')
        setError(data.error?.message || 'Run failed')
        stopPolling()
        return
      }

      // Still running — schedule next poll
      const elapsed = Date.now() - startTimeRef.current
      const interval = getPollingInterval(elapsed)
      timerRef.current = setTimeout(() => pollRun(currentRunId), interval)
    } catch {
      // Network error — retry with backoff
      const elapsed = Date.now() - startTimeRef.current
      const interval = Math.min(getPollingInterval(elapsed) * 2, 8000)
      timerRef.current = setTimeout(() => pollRun(currentRunId), interval)
    }
  }, [chatId, stopPolling, queryClient])

  const startPolling = useCallback((id: string) => {
    setRunId(id)
    setStatus('running')
    setError(null)
    startTimeRef.current = Date.now()
    pollRun(id)
  }, [pollRun])

  const sendMessage = useCallback(async (message: string) => {
    setError(null)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, chatId }),
      })

      if (res.status === 409) {
        setError('Agent is still working')
        return
      }

      if (!res.ok) throw new Error('Failed to send')

      const { runId: newRunId } = await res.json()
      startPolling(newRunId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    }
  }, [chatId, startPolling])

  // On mount: check for active run
  useEffect(() => {
    async function checkActiveRun() {
      try {
        const res = await fetch(`/api/chat/active-run?chatId=${chatId}`)
        if (!res.ok) return
        const { activeRun } = await res.json()
        if (activeRun) {
          startPolling(activeRun.runId)
        }
      } catch {
        // No active run
      }
    }
    checkActiveRun()
    return stopPolling
  }, [chatId, startPolling, stopPolling])

  return {
    sendMessage,
    status,
    error,
    runId,
    isRunning: status === 'running',
  }
}
```

**Step 2:** Commit

```bash
git add -A
git commit -m "feat: add useChatRun hook with stepped polling"
```

---

### Task 17: Build useChatMessages hook

**Files:**
- Create: `src/hooks/use-chat-messages.ts`

**Step 1:** Install react-query

```bash
npm install @tanstack/react-query
```

**Step 2:** Create QueryClient provider

```typescript
// src/app/providers.tsx
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
```

Add to `src/app/layout.tsx` — wrap children with `<Providers>`.

**Step 3:** Create hook

```typescript
// src/hooks/use-chat-messages.ts
'use client'

import { useQuery, keepPreviousData } from '@tanstack/react-query'

export function useChatMessages(chatId: string) {
  return useQuery({
    queryKey: ['memory', 'messages', chatId],
    queryFn: async () => {
      const res = await fetch(`/api/chat/messages?chatId=${chatId}`)
      if (!res.ok) throw new Error('Failed to fetch messages')
      const { messages } = await res.json()
      return messages
    },
    placeholderData: keepPreviousData,
  })
}
```

**Step 4:** Commit

```bash
git add -A
git commit -m "feat: add useChatMessages hook with react-query"
```

---

### Task 18: Build chat UI

**Files:**
- Create: `src/components/chat/chat-page.tsx`
- Create: `src/components/chat/message-list.tsx`
- Create: `src/components/chat/composer.tsx`
- Create: `src/components/chat/run-status.tsx`
- Modify: `src/app/page.tsx`

**Step 1:** Install shadcn components

```bash
npx shadcn@latest add button input card scroll-area
```

**Step 2:** Create Composer

```typescript
// src/components/chat/composer.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ComposerProps {
  onSend: (message: string) => void
  disabled: boolean
}

export function Composer({ onSend, disabled }: ComposerProps) {
  const [input, setInput] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || disabled) return
    onSend(input.trim())
    setInput('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t">
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type a message..."
        disabled={disabled}
      />
      <Button type="submit" disabled={disabled || !input.trim()}>
        Send
      </Button>
    </form>
  )
}
```

**Step 3:** Create RunStatus indicator

```typescript
// src/components/chat/run-status.tsx
'use client'

interface RunStatusProps {
  status: string
  error: string | null
  onRetry?: () => void
}

export function RunStatus({ status, error, onRetry }: RunStatusProps) {
  if (status === 'running') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
        <span className="animate-spin">&#9696;</span>
        Thinking...
      </div>
    )
  }

  if (status === 'failed' && error) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-destructive">
        <span>Error: {error}</span>
        {onRetry && (
          <button onClick={onRetry} className="underline">
            Retry
          </button>
        )}
      </div>
    )
  }

  return null
}
```

**Step 4:** Create MessageList

```typescript
// src/components/chat/message-list.tsx
'use client'

import { ScrollArea } from '@/components/ui/scroll-area'
import { useEffect, useRef } from 'react'

interface Message {
  id: string
  role: string
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
}

interface MessageListProps {
  messages: Message[]
  isLoading: boolean
}

function renderContent(content: Message['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n')
  }
  return ''
}

export function MessageList({ messages, isLoading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (isLoading && messages.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">Loading...</div>
  }

  return (
    <ScrollArea className="flex-1 p-4">
      <div className="space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              }`}
            >
              {renderContent(msg.content)}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
```

**Step 5:** Create ChatPage (container)

```typescript
// src/components/chat/chat-page.tsx
'use client'

import { useChatRun } from '@/hooks/use-chat-run'
import { useChatMessages } from '@/hooks/use-chat-messages'
import { MessageList } from './message-list'
import { Composer } from './composer'
import { RunStatus } from './run-status'

interface ChatPageProps {
  chatId: string
}

export function ChatPage({ chatId }: ChatPageProps) {
  const { sendMessage, status, error, isRunning } = useChatRun(chatId)
  const { data: messages = [], isLoading } = useChatMessages(chatId)

  return (
    <div className="grid grid-rows-[1fr_auto] h-screen">
      <MessageList messages={messages} isLoading={isLoading} />
      <div>
        <RunStatus status={status} error={error} />
        <Composer onSend={sendMessage} disabled={isRunning} />
      </div>
    </div>
  )
}
```

**Step 6:** Wire up the page

```typescript
// src/app/page.tsx
import { ChatPage } from '@/components/chat/chat-page'

export default function Home() {
  const chatId = process.env.NEXT_PUBLIC_CHAT_ID!

  return <ChatPage chatId={chatId} />
}
```

**Step 7:** Run `npm run dev`, sign in via Clerk, verify:
- Chat UI renders
- Can type and send message
- "Thinking..." appears
- Response shows after run completes

**Step 8:** Commit

```bash
git add -A
git commit -m "feat: add chat UI (message list, composer, run status)"
```

---

## Phase 3: End-to-end verification

### Task 19: Test background execution

**Step 1:** Send a message in the chat UI.

**Step 2:** While "Thinking..." is showing, close the browser tab.

**Step 3:** Wait 10 seconds.

**Step 4:** Reopen the tab. Verify:
- `useChatRun` on mount calls `/api/chat/active-run`
- If run completed: messages appear immediately
- If run still active: polling resumes, then messages appear

**Step 5:** Test error scenario — temporarily break the agent (invalid API key). Send message. Verify error shows with retry option.

**Step 6:** Test 409 — send message, then quickly try to send another. Verify "agent is still working" error.

---

### Task 20: Deploy kagami-web to Railway

**Step 1:** Add service `kagami-web` to the same Railway project as `kagami-api`.

**Step 2:** Set environment variables:
- All from `.env.example`
- `MASTRA_API_URL=http://kagami-api.railway.internal:4111`

**Step 3:** Generate public domain for kagami-web.

**Step 4:** Deploy and verify the full flow works on Railway:
- Sign in via Clerk
- Send message
- Close tab, reopen
- Verify background execution works

**Step 5:** Commit any deployment-related config changes.

```bash
git commit -m "chore: configure for Railway deployment"
```

---

## Post-MVP checklist

After all tasks are done, verify against the test scenarios from the architecture design:

- [ ] Send message -> poll -> run completes -> response displayed
- [ ] Close tab mid-run -> reopen -> run completed -> response in history
- [ ] Close tab mid-run -> reopen -> run still active -> poll resumes via active-run
- [ ] Long response (>30 seconds) -> run completes in background
- [ ] Send message while run active -> 409 rejected -> UI shows "agent is still working"
- [ ] Network error during poll -> retry with backoff -> eventually get result
- [ ] Run fails -> error displayed -> retry creates new run -> succeeds
- [ ] Server restart mid-run -> auto-restart -> poll picks up completion
- [ ] Mount with no active run -> ready for input immediately
