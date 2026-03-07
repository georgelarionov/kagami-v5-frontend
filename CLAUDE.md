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
- **Auth:** Clerk (`@clerk/nextjs`, middleware-based)
- **DB:** Neon PostgreSQL via Drizzle ORM (`@neondatabase/serverless`)
- **UI:** shadcn/ui + Tailwind CSS
- **State:** react-query (`@tanstack/react-query`) for server state
- **Mastra Client:** `@mastra/client-js` for workflow runs and memory

## Key Concepts

- **Workflow-first execution:** Every user message creates a Mastra workflow run (`run.start()` fire-and-forget). Runs persist on the server regardless of client connection
- **Polling, not streaming:** UI polls run status with stepped intervals (500ms → 2s → 4s), then reads completed messages
- **One active run per chat:** BFF rejects new messages with 409 while a run is active. Prevents race conditions on shared thread memory
- **Save-before-start:** `runId` saved to `chats.lastRunId` before calling `run.start()`. If start fails, `lastRunId` is cleared
- **Composite resourceId:** `${userId}:${projectId}` for defense in depth at Mastra memory level
- **threadId = chatId:** Direct mapping between chat records and Mastra memory threads

## Project Structure

```
src/
  app/
    layout.tsx          # ClerkProvider + QueryClientProvider
    page.tsx            # Main page, renders ChatPage
    providers.tsx       # react-query QueryClientProvider
    api/
      chat/
        route.ts        # POST — send message, start workflow run
        active-run/
          route.ts      # GET — check for active run on mount
        runs/[id]/
          route.ts      # GET — poll run status
        messages/
          route.ts      # GET — read message history from Mastra memory
  components/
    chat/
      chat-page.tsx     # Container: useChatRun + useChatMessages
      message-list.tsx  # Render messages, auto-scroll
      composer.tsx      # Input + send button
      run-status.tsx    # "Thinking..." / error + retry
    ui/                 # shadcn components (do not edit manually)
  db/
    schema.ts           # Drizzle schema: projects, chats
    index.ts            # Drizzle client (neon-http driver)
    seed.ts             # One-time seed: default project + chat
  hooks/
    use-chat-run.ts     # Send message, poll run, check active-run on mount
    use-chat-messages.ts # react-query wrapper for messages
  lib/
    mastra.ts           # MastraClient instance
drizzle.config.ts       # Drizzle Kit config (uses DATABASE_URL_DIRECT)
drizzle/                # Generated migrations
```

## Environment Variables

See `.env.example`. Key vars:
- `MASTRA_API_URL` — Mastra Server URL. Local: `http://localhost:4111`. Railway: `http://kagami-v5.railway.internal`
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
- **shadcn components** live in `src/components/ui/` — don't edit these directly, use `npx shadcn@latest add <component>`
- **Drizzle schema** is the source of truth for `projects` and `chats` tables. Mastra manages its own tables (memory, workflow state)
- **No streaming** in MVP — poll for complete responses only
- **Verify Mastra API** via `mastra` MCP and `context7` before implementing — code samples in plans are illustrative, not exact

## Mastra Integration

The BFF uses `@mastra/client-js` to communicate with Mastra Server:
- `mastraClient.getWorkflow('chat-workflow')` — get workflow handle
- `workflow.createRun({ resourceId })` — create a new run
- `run.start({ inputData })` — start execution
- `workflow.runById(runId)` — check run status
- `mastraClient.getMemoryThread({ threadId, agentId: 'kagamiAgent' })` — get memory thread
- `thread.listMessages()` — read message history

## Railway Deployment

Both services in the same Railway project for private networking:
- kagami-api: internal only (no public domain)
- kagami-web: public domain for users
- `MASTRA_API_URL=http://kagami-v5.railway.internal` (no port — Railway proxies)
