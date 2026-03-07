# [COMPLETED] kagami-web Setup Instructions

> **Status:** COMPLETED (2026-03-08). Kept for historical reference only.

> Instructions for Claude Code to scaffold and implement kagami-web (Next.js BFF + UI).

## Context

kagami-api (Mastra Server) is already deployed on Railway:
- Private URL: `http://kagami-v5.railway.internal` (no port — Railway proxies)
- Local dev: `http://localhost:4111`
- Agent ID: `kagamiAgent`, Workflow ID: `chat-workflow`
- Neon database and Clerk project already exist — just plug in the keys

Full architecture: see `docs/plans/2026-03-07-architecture-design.md` in kagami-v5 repo.
Full implementation plan (Tasks 10-18): see `docs/plans/2026-03-07-mvp-implementation.md` in kagami-v5 repo.

## MCP Servers

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/context7-mcp@latest"]
    },
    "mastra": {
      "command": "npx",
      "args": ["-y", "@mastra/mcp-docs-server@latest"]
    },
    "neon": {
      "command": "npx",
      "args": ["-y", "neon-mcp-server"],
      "env": { "NEON_API_KEY": "<from env>" }
    },
    "railway": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/railway-mcp@latest"],
      "env": { "RAILWAY_API_TOKEN": "<from env>" }
    }
  }
}
```

## Environment Variables

```bash
# .env.local
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_JWT_KEY=
MASTRA_API_URL=http://localhost:4111
DATABASE_URL=              # Neon pooled (-pooler)
DATABASE_URL_DIRECT=       # Neon direct (for migrations)
NEXT_PUBLIC_PROJECT_ID=    # from seed script output
NEXT_PUBLIC_CHAT_ID=       # from seed script output
```

## Implementation Checklist

### Task 10: Scaffold
- `npx create-next-app@latest kagami-web --typescript --tailwind --eslint --app --src-dir`
- Install deps: `@clerk/nextjs @mastra/client-js drizzle-orm @neondatabase/serverless @tanstack/react-query`
- Install dev deps: `drizzle-kit`
- `npx shadcn@latest init` + add components: `button input card scroll-area`

### Task 11: Clerk Auth
- ClerkProvider in root layout
- Middleware protecting `/api/chat(.*)` and `/api/projects(.*)`

### Task 12: Drizzle Schema
- `projects` table: id (uuid), userId (text), name (text), createdAt
- `chats` table: id (uuid), projectId (uuid FK), title (text), lastRunId (text), createdAt
- `drizzle.config.ts` using `DATABASE_URL_DIRECT`
- Run `drizzle-kit generate` + `drizzle-kit migrate`

### Task 13: Seed Script
- `src/db/seed.ts` — insert one project + one chat
- Run after first Clerk sign-in to get real userId
- Output project/chat IDs for `.env.local`

### Task 14: MastraClient
- `src/lib/mastra.ts` — `new MastraClient({ baseUrl: process.env.MASTRA_API_URL })`

### Task 15: API Routes
- `POST /api/chat` — verify auth + ownership, reject if active run (409), create run, save-before-start, fire-and-forget
- `GET /api/chat/active-run?chatId=` — check for active run on mount
- `GET /api/chat/runs/[id]?chatId=` — poll run status, verify runId matches chat.lastRunId
- `GET /api/chat/messages?chatId=` — read history via `getMemoryThread({ threadId, agentId }).listMessages()`

### Task 16: useChatRun Hook
- Stepped polling: 500ms (0-5s), 2s (5-15s), 4s (15s+)
- On success: `invalidateQueries(['memory', 'messages', chatId])`
- On mount: check `/api/chat/active-run` to resume polling
- Handle 409 ("agent is still working")

### Task 17: useChatMessages Hook
- react-query wrapper around `GET /api/chat/messages`
- QueryClientProvider in layout

### Task 18: Chat UI
- `ChatPage` — container combining useChatRun + useChatMessages
- `MessageList` — render messages, auto-scroll to bottom
- `Composer` — input + send, disabled while running
- `RunStatus` — "Thinking..." spinner / error + retry
- Wire up in `src/app/page.tsx` with hardcoded `NEXT_PUBLIC_CHAT_ID`

## Key Constraints

- Code samples in the plan are **illustrative** — always verify Mastra API via `mastra` MCP and `context7` before implementing
- `resourceId = ${userId}:${projectId}` (composite key)
- `threadId = chatId`
- Working memory scope: `resource` (set on agent side, not client side)
- No streaming — poll + complete response only
- One active run per chat — BFF rejects with 409
- Save-before-start: persist `runId` to `chats.lastRunId` before calling `run.start()`
- Mastra Server trusts BFF — no double JWT validation on API side

## Railway Deploy (Task 20)

- Add kagami-web as second service in the same Railway project (`kagami-v5-api`)
- Set `MASTRA_API_URL=http://kagami-v5.railway.internal`
- Generate public domain for kagami-web (this one needs to be public)
