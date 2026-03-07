# Kagami Web (kagami-v5-frontend)

Next.js BFF + UI for Kagami — a chat app with background agent execution via Mastra workflows.

## Architecture

Two-repo setup:
- **kagami-v5-frontend** (this repo) — Next.js App Router, Clerk auth, Drizzle ORM, shadcn/ui, react-query
- **kagami-api** (separate repo, deployed on Railway) — Mastra Server with agents, workflows, memory

The BFF (Next.js API routes) sits between browser and Mastra Server. Browser never talks to Mastra directly.

```
Browser → Next.js API routes (Clerk auth) → MastraClient → Mastra Server (private network)
```

## Tech Stack

- **Framework:** Next.js 16 (App Router, `src/` directory)
- **Auth:** Clerk (`@clerk/nextjs`, proxy-based via `src/proxy.ts`)
- **DB:** Neon PostgreSQL via Drizzle ORM (`@neondatabase/serverless`, neon-http driver)
- **UI:** shadcn/ui + Tailwind CSS v4 + Inter font
- **State:** react-query (`@tanstack/react-query`) for server state
- **Mastra Client:** `@mastra/client-js` for workflow runs and memory

## Key Concepts

- **Workflow-first execution:** Every user message creates a Mastra workflow run (`run.start()` fire-and-forget). Runs persist on the server regardless of client connection
- **Polling, not streaming:** UI polls run status with stepped intervals (500ms → 2s → 4s), with a 1-hour max timeout
- **One active run per chat:** BFF rejects new messages with 409 while a run is active (`running`, `waiting`, `pending`, `paused`). Prevents race conditions on shared thread memory
- **Save-before-start:** `runId` and `pendingMessage` saved to `chats` before calling `run.start()`. If start fails, both are cleared. `pendingMessage` survives page reloads via the `active-run` endpoint
- **Retry on failure:** When a run fails, the UI shows a Retry button that re-sends the `pendingMessage`. Retry only appears for `status === 'failed'`, not for 409 errors
- **Composite resourceId:** `${userId}:${projectId}` for defense in depth at Mastra memory level
- **threadId = chatId:** Direct mapping between chat records and Mastra memory threads

## Project Structure

```
src/
  app/
    layout.tsx          # ClerkProvider + QueryClientProvider + Inter font
    page.tsx            # Main page, renders ChatPage with NEXT_PUBLIC_CHAT_ID
    providers.tsx       # react-query QueryClientProvider
    globals.css         # Tailwind v4 theme (shadcn tokens, system mono font)
    api/
      chat/
        route.ts        # POST — send message, start workflow run
        active-run/
          route.ts      # GET — check for active run on mount
        runs/[id]/
          route.ts      # GET — poll run status (async params, Next.js 16)
        messages/
          route.ts      # GET — read message history from Mastra memory
  components/
    chat/
      chat-page.tsx     # Container: useChatRun + useChatMessages + retry wiring
      message-list.tsx  # Render messages, auto-scroll via ScrollArea viewport
      composer.tsx      # Input + send button
      run-status.tsx    # "Thinking..." / error + retry button
    ui/                 # shadcn components (do not edit manually)
  db/
    schema.ts           # Drizzle schema: projects, chats (incl. pendingMessage)
    index.ts            # Drizzle client (neon-http driver, lazy init via getDb())
    seed.ts             # One-time seed: default project + chat
  hooks/
    use-chat-run.ts     # Send message, poll run, retry, check active-run on mount
    use-chat-messages.ts # react-query wrapper for messages
  lib/
    mastra.ts           # MastraClient instance
    utils.ts            # cn() utility (clsx + tailwind-merge)
  types/
    chat.ts             # Shared Message type
  proxy.ts              # Clerk auth proxy (Next.js 16 replaces middleware.ts)
drizzle.config.ts       # Drizzle Kit config (uses DATABASE_URL_DIRECT)
drizzle/                # Generated migrations
```

## Environment Variables

See `.env.example`. Key vars:
- `MASTRA_API_URL` — Mastra Server URL. Local: `http://localhost:4111`. Railway: `http://kagami-v5.railway.internal:8080` (private networking requires explicit port)
- `DATABASE_URL` — Neon pooled (`-pooler`) for runtime
- `DATABASE_URL_DIRECT` — Neon direct for migrations
- `NEXT_PUBLIC_PROJECT_ID` / `NEXT_PUBLIC_CHAT_ID` — hardcoded IDs from seed script (MVP only)

## Commands

```bash
npm run dev              # Start dev server
npm run build            # Production build
npx drizzle-kit generate # Generate migration from schema changes
npx drizzle-kit migrate  # Run pending migrations
npx tsx src/db/seed.ts   # Seed default project + chat
```

## Conventions

- **"use client"** for all interactive components. Server components only for layout/static content
- **API routes** handle auth (Clerk), ownership verification, and proxy to Mastra. All business logic validation happens in BFF
- **API route input validation:** `req.json()` wrapped in try/catch, type checks on inputs
- **shadcn components** live in `src/components/ui/` — don't edit these directly, use `npx shadcn@latest add <component>`
- **Drizzle schema** is the source of truth for `projects` and `chats` tables. Mastra manages its own tables (memory, workflow state)
- **No streaming** in MVP — poll for complete responses only
- **Verify Mastra API** via `mastra` MCP and `context7` before implementing — code samples in plans are illustrative, not exact
- **Shared types** go in `src/types/` — not exported from UI components

## Mastra Integration

The BFF uses `@mastra/client-js` to communicate with Mastra Server:
- `mastraClient.getWorkflow('chat-workflow')` — get workflow handle
- `workflow.createRun({ resourceId })` — create a new run (resourceId required)
- `run.start({ inputData })` — start execution
- `workflow.runById(runId)` — check run status
- `mastraClient.getMemoryThread({ threadId, agentId: 'kagamiAgent' })` — get memory thread
- `thread.listMessages({ perPage: 1000 })` — read message history (default perPage is 40, must override)

## Railway Deployment

Both services in the same Railway project for private networking:
- kagami-api (`kagami-v5`): internal only (no public domain), Mastra listens on port 8080
- kagami-web (`kagami-v5-frontend`): public domain for users
- `MASTRA_API_URL=http://kagami-v5.railway.internal:8080` (private networking requires explicit port — no proxying)
- `DATABASE_URL` must be Neon pooled PostgreSQL string (not Mastra URL)
- Railway does NOT proxy ports on private domains — always specify the actual port
- Drizzle uses lazy init (`getDb()`) to avoid build-time crashes when `DATABASE_URL` is unavailable
