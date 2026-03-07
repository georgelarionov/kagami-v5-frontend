# Kagami v5 Architecture Design

## Overview

Web application built on Mastra agents. Two separate services: Next.js frontend/BFF and Mastra Server backend.

## User Flow

Auth (Clerk) -> Dashboard -> Project -> Chat(s)

## Stack

| Layer | Technology |
|---|---|
| UI | React + shadcn/ui (custom hooks: poll + messages) |
| Frontend/BFF | Next.js 16 (App Router, minimal) |
| Auth | Clerk (email/password, JWT) |
| Backend | Mastra Server (Hono, :4111) |
| Agents | Single agent (MVP), supervisor + subagents (phase 2) |
| DB | Neon PostgreSQL (single DB, shared by both services) |
| ORM | Drizzle (in Next.js for metadata) |
| Memory | Mastra Memory (thread/resource via Neon, isolated via resourceId/threadId) |
| Storage | PostgresStore on Mastra instance (workflow state + memory) |
| Deploy | Railway (2 services, private networking) |

## Repositories

- **kagami-web** - Next.js, shadcn, Clerk, Drizzle
- **kagami-api** - Mastra Server, agents, workflows, tools, MCP

## Architecture

```
Browser (React + shadcn, custom hooks)
    |
    | POST /api/chat              → { runId }           (fire-and-forget)
    | GET  /api/chat/active-run   → { runId, status }   (resume on mount)
    | GET  /api/chat/runs/:id     → { status, result }  (poll)
    | GET  /api/chat/messages     → messages[]           (history)
    |
Next.js (minimal BFF)
    |-- Clerk middleware (JWT verify, requires jwtKey for networkless)
    |-- POST /api/chat → reject if active run (409) → createRun({ resourceId }) → save runId to chats → run.start() → return runId (if start fails: delete runId)
    |-- GET  /api/chat/active-run → read lastRunId from chats → verify ownership → workflow.runById() → return status
    |-- GET  /api/chat/runs/:id → verify runId === chat.lastRunId (403 otherwise) → workflow.runById(runId)
    |-- GET  /api/chat/messages → getMemoryThread().listMessages()
    |-- CRUD /api/projects → Neon (Drizzle)
    |-- CRUD /api/projects/:id/chats → Neon
    |
    |  @mastra/client-js (private network)
    |
Mastra Server (:4111)
    |-- chat-workflow: wraps agent.generate() in workflow step
    |-- Single agent with static tools (MVP)
    |-- Memory (Neon, isolated by resourceId/threadId)
    |-- Workflow runs persist independently of client connections
    |-- Auto-restarts active runs on server restart
    |
Neon PostgreSQL
    |-- users, projects, chats + lastRunId (Drizzle, managed by Next.js)
    |-- mastra memory + workflow state (managed by Mastra)
```

## Authentication Between Services

- Next.js verifies Clerk JWT, extracts `userId`
- BFF passes `resourceId` and `threadId` via workflow input / MastraClient options
- `resourceId` = `${userId}:${projectId}` (composite key for defense in depth)
- `threadId` = chat ID
- `workflow.createRun({ resourceId })` — associates run with resource for Mastra-side tracking
- Run authorization: BFF verifies `runId === chat.lastRunId` for the authenticated user's chat (403 otherwise)
- No JWT verification in Mastra — private network, BFF is trusted
- If Mastra ever becomes public — add JWT verification there too

## Data Isolation

- `resourceId` = `${userId}:${projectId}` (composite, ensures ownership at Mastra level)
- `threadId` = chat ID
- BFF validates user owns project before any request to Mastra
- Same agent for all projects, different memory/context

## Execution Model (MVP)

Workflow-first: every user message creates a persistent workflow run.

```typescript
// Mastra Server: chat-workflow wraps agent in a workflow step
const chatStep = createStep({
  id: 'chat',
  inputSchema: z.object({
    message: z.string(),
    threadId: z.string(),
    resourceId: z.string(),
  }),
  outputSchema: z.object({ response: z.string() }),
  execute: async ({ inputData }) => {
    const result = await agent.generate(inputData.message, {
      memory: {
        thread: inputData.threadId,
        resource: inputData.resourceId,
      },
    })
    return { response: result.text }
  },
})

const chatWorkflow = createWorkflow({
  id: 'chat-workflow',
  inputSchema: chatStep.inputSchema,
  outputSchema: chatStep.outputSchema,
}).then(chatStep).commit()
```

Mastra instance must have global storage for workflow persistence:

```typescript
const mastra = new Mastra({
  storage: new PostgresStore({ connectionString }), // workflow state + run snapshots
  agents: { kagamiAgent },
  workflows: { chatWorkflow },
})
```

Agent runs inside the workflow step. Workflow run persists on server regardless of client connection.

### One active run per chat

BFF enforces: one chat = one active run at a time.
- `POST /api/chat` checks `chats.lastRunId` status before creating new run
- If active run exists → reject with 409 Conflict
- UI disables send button while run is active
- Prevents race conditions on shared thread memory

BFF saves `runId` to `chats.lastRunId` (Drizzle) **before** calling `run.start()`. If `start()` fails — delete `lastRunId`. This prevents two concurrent runs on the same thread (save-before-start pattern: a dead record is harmless, two parallel runs corrupt memory).

## Polling Lifecycle

### `useChatRun` hook (idempotent)

```
mount(chatId)
  → GET /api/chat/active-run?chatId=...
  → if active run found: set runId, start polling
  → if no active run: ready for input

sendMessage(message)
  → POST /api/chat { message, chatId }
  → if 409 (active run exists): show "agent is still working"
  → receive { runId }
  → start stepped polling runById(runId):
      0-5s:   every 500ms (fast responses feel instant)
      5-15s:  every 2s
      15s+:   every 4s (halves BFF load on long runs)

polling loop:
  → status === 'success' → invalidate messages query → render response → stop polling
  → status === 'failed'  → show error + retry button → stop polling
  → status === 'running' → continue polling
  → network error        → retry poll with backoff (do NOT create new run)

unmount / tab close:
  → stop polling (run continues on server)

retry after error:
  → new POST /api/chat (same message) → new run → new polling
```

### Error handling

- **Run failed**: UI shows error from `result.error`, user can retry (new run)
- **Server restart mid-run**: Mastra auto-restarts active runs on server boot. Polling picks up completion transparently
- **Network error during poll**: Exponential backoff, keep polling same runId (run is still alive on server)
- **Duplicate sends**: BFF rejects with 409 if active run exists. One run per chat at a time

## Agents (MVP)

Single agent with static tools. No supervisor, no subagents.

```typescript
const store = new PostgresStore({ connectionString })

const agent = new Agent({
  id: 'kagami-agent',
  instructions: '...',
  model: 'openai/gpt-4o',  // or anthropic/claude-sonnet
  tools: { /* static tool set */ },
  memory: new Memory({
    storage: store,
    options: { workingMemory: { scope: 'resource' } }, // explicit, don't rely on defaults
  }),
})

const mastra = new Mastra({
  storage: store,  // same store for workflow state + memory
  agents: { kagamiAgent: agent },
  workflows: { chatWorkflow },
})
```

## Agents (Phase 2)

| Agent | Role | Model | Tools |
|---|---|---|---|
| **Supervisor** | Coordination, delegation, response synthesis | Strong (Claude Opus / GPT-5) | None (delegation only) |
| **Researcher** | Search and analysis | Cheap (Claude Sonnet / GPT-4o-mini) | Perplexity search |
| **Writer** | Text content generation | Cheap (Claude Sonnet / GPT-4o-mini) | None |

Dynamic tool configuration per project via `requestContext`:

```typescript
const supervisor = new Agent({
  tools: async ({ requestContext }) => {
    const enabled = requestContext.get('enabledTools')
    return Object.fromEntries(
      Object.entries(allTools).filter(([key]) => enabled.includes(key))
    )
  },
  agents: { researcher, writer },
})
```

## Background Execution and Disconnection

MVP:
- Every message creates a workflow run (`run.start()` — fire-and-forget)
- Run persists on Mastra Server regardless of client connection
- UI polls `workflow.runById(runId)` for status while open
- On tab close: run continues, result saved to memory
- On return: poll run status or read `listMessages()` directly
- No token-by-token streaming — UI shows "thinking...", then complete response

Phase 2:
- Real-time streaming while UI is open (exact API TBD at implementation time)
- Falls back to polling on disconnect

## Service Communication

- `@mastra/client-js` for all operations: workflow runs, memory threads, messages
- BFF creates workflow runs (fire-and-forget), polls status, reads messages
- Clerk middleware validates JWT on every request (requires `jwtKey` for networkless verification)
- Mastra Server is not exposed publicly, only via Railway internal network

## Chat UI

Patterns derived from Mastra playground-ui (`@mastra/playground-ui`). Take patterns, not components.

### Architecture (MVP)

Container/Presentation separation:
- **Hooks** — react-query wrappers, `{ data, isLoading, error }`. Cache keys: `['workflow-runs', runId]`, `['memory', 'messages', threadId]`
- **Components** — render only, data via props/hooks
- No contexts needed for MVP (single chat, no shared state)

### Layout (MVP)

```
grid grid-rows-[1fr_auto] h-full
  ├─ Messages viewport (scrollable)
  │   ├─ Message list
  │   │   └─ MessageParts dispatch by part type:
  │   │       ├─ text content      → Markdown renderer
  │   │       └─ tool invocations  → ToolBadge card (generic)
  │   └─ Run status indicator (polling):
  │       ├─ running  → spinner
  │       ├─ success  → hidden (response already in messages)
  │       └─ failed   → error + retry button
  └─ Composer (input + send button)
      └─ Send disabled while run active
```

### Hooks (MVP)

```typescript
// useChatRun — send message, poll run status
// Stepped polling: 500ms (0-5s), 2s (5-15s), 4s (15s+)
// On mount: check for active run, resume polling if found
// On success: queryClient.invalidateQueries(['memory', 'messages', threadId])

// useChatMessages — read message history
// react-query with cache key ['memory', 'messages', threadId]
// placeholderData: keepPreviousData — prevents flash of empty state on thread switch
```

### Message Parts Rendering (MVP)

Dispatch by `part.type` to specialized components. Exact part type names determined at implementation time based on what `listMessages()` returns (Mastra Memory format, not stream events):
- Text content → Markdown (prose styling)
- Tool invocations → Generic ToolBadge: tool name, status (pending/complete/error), result as JSON

### Phase 2 additions

- Token-by-token streaming (exact integration TBD)
- Real-time tool call rendering during execution
- Thread list with active state, delete confirmation, permission checks
- `placeholderData: keepPreviousData` already handles thread switch (no extra memoization needed)
- Specialized tool badges per tool type (agent, workflow, filesystem)
- Reasoning parts (collapsible)

## Scalability

- New agents/tools: add to Mastra Server, frontend unchanged
- New UI features: add to Next.js, Mastra unchanged
- New MCP servers: connect to Mastra, agents get access automatically
- Load: Railway scales each service independently
- Auth providers: Clerk adds OAuth without architecture changes

## Key Decisions

1. **Two repos over monorepo** - Mastra provides typed client (`@mastra/client-js`), no need for shared packages
2. **Next.js over plain React** - need BFF layer for auth, avoids third service
3. **Clerk over alternatives** - simplest setup for email/password, generous free tier (50k MRU). Requires `jwtKey` for networkless JWT verification
4. **Mastra workspace != project isolation** - workspaces are for filesystem/sandbox, use memory thread/resource for tenant isolation
5. **Minimal Next.js** - `"use client"` components + API routes only, no deep server components usage
6. **Single agent for MVP** - get to working product first, add supervisor/subagents in phase 2
7. **Static tools for MVP** - no dynamic `enabledTools`, no per-project tool config until phase 2
8. **Workflow-first execution** - every message is a persistent workflow run (`run.start()` fire-and-forget), runs survive client disconnects
9. **Composite resourceId** - `${userId}:${projectId}` for defense in depth at Mastra memory level
10. **Single Neon DB** - Drizzle tables and Mastra Memory tables coexist, no migration conflicts (different table sets, sequential deploys). Use pooled connection string (`-pooler`) for runtime, direct for migrations
11. **BFF-only auth** - Mastra trusts BFF on private network, no double JWT validation
12. **Supervisor pattern for phase 2** - recommended by Mastra over `.network()`, better control via delegation hooks
13. **AI SDK v6 for phase 2** - Mastra 1.0 has full support (LanguageModelV3). MVP uses custom hooks (poll + messages), phase 2 adds streaming
14. **Working memory scope = resource (explicit)** - set explicitly in config, don't rely on Mastra defaults. Shared across chats within a project (feature). Message history stays per-thread
15. **Global PostgresStore on Mastra instance** - required for workflow run persistence. Same store used by Memory
16. **One active run per chat** - prevents race conditions on shared thread memory. BFF rejects new messages with 409 while run is active
17. **Run authorization via BFF** - `runId` verified against `chat.lastRunId` for authenticated user's chat. No magic tokens
18. **requestContext = phase 2 only** - MVP uses resourceId/threadId via client options. requestContext introduced with dynamic tools

---

## Claude Code Setup Recommendations

### kagami-web (Next.js + shadcn + Clerk + Drizzle)

#### MCP Servers (.mcp.json)

| Server | Why |
|---|---|
| **context7** | Live docs for Next.js, Clerk, Drizzle, shadcn |
| **shadcn** | Browse, search, install components/blocks via natural language |
| **next-devtools-mcp** | Live errors, logs, page metadata from running dev server (requires Next.js 16+) |
| **Neon** | Direct database operations, schema inspection, migrations |
| **Railway** | Deploy, logs, env variables |

#### Hooks (.claude/settings.json)

| Hook | Type | Why |
|---|---|---|
| **Auto-format on edit** | PostToolUse (Edit/Write) | `npx prettier --write $FILE` - consistent code style |
| **Block .env edits** | PreToolUse (Edit/Write) | Prevent accidental secret exposure |
| **Type-check on edit** | PostToolUse (Edit/Write) | `npx tsc --noEmit` - catch type errors early |

#### Skills (.claude/skills/)

| Skill | Invocation | Purpose |
|---|---|---|
| **new-component** | User (`/new-component`) | Generate shadcn component with consistent patterns |
| **create-migration** | User (`/create-migration`) | Drizzle schema migration with validation |

#### Subagents (.claude/agents/)

| Agent | Purpose |
|---|---|
| **ui-reviewer** | Accessibility and UX review for shadcn components |

#### Plugins

| Plugin | Purpose |
|---|---|
| **anthropic-agent-skills** | Core skills bundle (brainstorming, TDD, debugging) |
| **frontend-design** | UI component design guidance |

---

### kagami-api (Mastra Server + agents + MCP tools)

#### MCP Servers (.mcp.json)

| Server | Why |
|---|---|
| **mastra** | Mastra docs, API reference, examples |
| **context7** | Docs for Hono, AI SDK, libraries used by agents |
| **Neon** | Memory storage inspection, query debugging |
| **Railway** | Deploy, logs, env variables |

#### Hooks (.claude/settings.json)

| Hook | Type | Why |
|---|---|---|
| **Auto-format on edit** | PostToolUse (Edit/Write) | `npx prettier --write $FILE` |
| **Block .env edits** | PreToolUse (Edit/Write) | Prevent secret exposure |
| **Type-check on edit** | PostToolUse (Edit/Write) | `npx tsc --noEmit` |

#### Skills (.claude/skills/)

| Skill | Invocation | Purpose |
|---|---|---|
| **new-agent** | User (`/new-agent`) | Scaffold new Mastra agent with consistent config |
| **new-tool** | User (`/new-tool`) | Create Mastra tool with input schema and execute fn |

#### Subagents (.claude/agents/)

| Agent | Purpose |
|---|---|
| **security-reviewer** | Review agent prompts and tool definitions for injection risks |

#### Plugins

| Plugin | Purpose |
|---|---|
| **anthropic-agent-skills** | Core skills bundle (brainstorming, TDD, debugging) |

---

### Shared Recommendations

- **context7** should be in both repos - different libraries but same need for up-to-date docs
- **Railway MCP** in both repos - each service deploys independently
- **Neon MCP** in both repos - web manages metadata tables, api manages memory tables
- **anthropic-agent-skills** plugin in both repos - consistent development workflow

---

## Pre-Launch Checklist

### Accounts and API Keys

Before starting implementation, set up:

- **Clerk** - create project, get NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY
- **Neon** - create dedicated database for kagami. Get both pooled (`-pooler`) and direct connection strings
- **OpenAI or Anthropic** - API key for the model used by the agent

### Implementation Order

Start with backend, then frontend. Mastra Server gives Swagger UI for testing without a frontend.

```
1. kagami-api: Mastra Server + one agent + chat-workflow + memory
2. kagami-api: verify workflow run completes, saves to memory (via Studio)
3. kagami-api: deploy to Railway, verify workflow runs from MastraClient
4. kagami-web: Next.js + Clerk + single chat screen
5. kagami-web: connect to kagami-api via MastraClient (workflow + messages)
6. Iterate: add features one at a time
```

### First Milestone (MVP)

Do not build everything at once. First working version:

- One agent, one LLM provider, static tools
- Workflow-first: `run.start()` fire-and-forget, poll for completion
- One project (hardcoded), one chat
- Background execution: close tab → run continues → return → see result
- History persists via `listMessages()`
- Clerk auth, ownership validation on BFF
- No token-by-token streaming (poll + complete response)

### Phase 2 (after MVP works)

- Token-by-token streaming while UI is open
- Supervisor + Researcher (Perplexity) + Writer
- Dynamic tool configuration per project (`requestContext` + `enabledTools`)
- CRUD projects, multiple chats
- Dashboard UI

### Background Execution Test Scenarios

Main source of bugs. Verify each scenario:

- Send message → poll → run completes → response displayed
- Close tab mid-run → reopen → run completed → response in history
- Close tab mid-run → reopen → run still active → poll resumes via `active-run`
- Long response (>30 seconds) → run completes in background
- Tool call result saved correctly in memory
- Send message while run active → 409 rejected → UI shows "agent is still working"
- Network error during poll → retry with backoff → eventually get result
- Run fails → error displayed → retry creates new run → succeeds
- Server restart mid-run → auto-restart → poll picks up completion
- Mount with no active run → ready for input immediately

### Environment Variables

Keep `.env.example` in each repo:

```bash
# kagami-web/.env.example
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_JWT_KEY=             # Required for networkless JWT verification
MASTRA_API_URL=http://localhost:4111
DATABASE_URL=              # Neon pooled connection string (-pooler) for Drizzle runtime
DATABASE_URL_DIRECT=       # Neon direct connection string for Drizzle migrations

# kagami-api/.env.example
OPENAI_API_KEY=            # or ANTHROPIC_API_KEY — one provider for MVP
DATABASE_URL=              # Neon pooled connection string (-pooler) for PostgresStore
```

### Railway Deployment

Both services must be in the **same Railway project** for private networking. kagami-web connects to kagami-api via `http://kagami-api.railway.internal:4111` (no public internet).

### Git Strategy

Trunk-based development: work in `main`, feature branches for large changes only. Keep it simple at the start.
