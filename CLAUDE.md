# Kagami Web (kagami-v5-frontend)

Next.js BFF + UI for Kagami — a chat app with real-time streaming via Mastra agents.

## Architecture

Two-repo setup:
- **kagami-v5-frontend** (this repo) — Next.js App Router, Clerk auth, Drizzle ORM, shadcn/ui + prompt-kit, AI SDK v6
- **kagami-api** (separate repo, deployed on Railway) — Mastra Server with agents, memory

The BFF (Next.js API routes) sits between browser and Mastra Server. Browser never talks to Mastra directly.

```
Browser ←SSE→ Next.js API routes (Clerk auth) ←stream→ MastraClient → Mastra Server (private network)
```

## Tech Stack

- **Framework:** Next.js 16 (App Router, `src/` directory)
- **Auth:** Clerk (`@clerk/nextjs`, proxy-based via `src/proxy.ts`)
- **DB:** Neon PostgreSQL via Drizzle ORM (`@neondatabase/serverless`, neon-http driver)
- **UI:** shadcn/ui + prompt-kit + Tailwind CSS v4 + Inter font
- **Streaming:** AI SDK v6 (`ai`, `@ai-sdk/react`), `@mastra/ai-sdk` for stream conversion
- **Mastra Client:** `@mastra/client-js` for agent streaming and memory

## Key Concepts

- **Streaming:** BFF streams from `agent.stream()` via `toAISdkStream()` → `createUIMessageStream()` → SSE to browser. Client uses `useChat` from `@ai-sdk/react`
- **One active stream per chat:** BFF rejects new messages with 409 while `pendingMessage IS NOT NULL`. Client disables send when `status !== 'ready'`
- **Save-before-start:** `pendingMessage` saved to `chats` before calling `agent.stream()`. Cleared in `onFinish`/`onError`. Survives page reloads via `active-run` endpoint
- **Disconnect resilience:** BFF does NOT forward browser abort signal to Mastra. Server continues generation on disconnect, saves to memory. On reload, messages load from memory
- **Retry on failure:** UI shows Retry button for stream errors and interrupted sessions (pendingMessage present on mount)
- **Composite resourceId:** `${userId}:${projectId}` for defense in depth at Mastra memory level
- **threadId = chatId:** Direct mapping between chat records and Mastra memory threads

## Project Structure

```
src/
  app/
    layout.tsx          # ClerkProvider + Inter font
    page.tsx            # Main page, renders ChatClient
    providers.tsx       # react-query QueryClientProvider
    globals.css         # Tailwind v4 theme + prompt-kit keyframes
    api/
      chat/
        route.ts        # POST — stream message via agent.stream()
        active-run/
          route.ts      # GET/DELETE — check/clear pendingMessage
        messages/
          route.ts      # GET — read message history from Mastra memory
  components/
    chat/
      chat-client.tsx   # Data loader: fetches messages + pendingMessage, converts via toAISdkV5Messages
      chat-page.tsx     # Container: useChatStream + layout + retry wiring
      message-list.tsx  # Render UIMessage[] via message.parts + prompt-kit Message/Markdown
      composer.tsx      # PromptInput with Send/Stop toggle
      run-status.tsx    # Loader (submitted/streaming) + error display
    ui/                 # shadcn + prompt-kit components (do not edit manually)
  db/
    schema.ts           # Drizzle schema: projects, chats (incl. pendingMessage)
    index.ts            # Drizzle client (neon-http driver, lazy init via getDb())
    seed.ts             # One-time seed: default project + chat
  hooks/
    use-chat-stream.ts  # useChat wrapper with DefaultChatTransport + body: { chatId, projectId }
  lib/
    mastra.ts           # MastraClient instance
    utils.ts            # cn() utility (clsx + tailwind-merge)
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
- **shadcn/prompt-kit components** live in `src/components/ui/` — don't edit these directly, use `npx shadcn@latest add <component>`
- **Drizzle schema** is the source of truth for `projects` and `chats` tables. Mastra manages its own tables (memory)
- **Verify Mastra API** via `mastra` MCP and `context7` before implementing — code samples in plans are illustrative, not exact
- **Contracts:** see `plans-docs/v0.2/contracts.md` for inter-repo API contracts

## Mastra Integration

The BFF uses `@mastra/client-js` to communicate with Mastra Server:
- **Agent ID:** `kagami-agent` (HTTP path: `/api/agents/kagami-agent/stream`)
- `mastraClient.getAgent('kagami-agent')` — get agent handle
- `agent.stream(userText, { memory: { thread: chatId, resource: resourceId } })` — stream response with memory
- `mastraClient.getMemoryThread({ threadId, agentId: 'kagami-agent' })` — get memory thread
- `thread.listMessages({ page: 0, perPage: 50, orderBy: { field: 'createdAt', direction: 'ASC' } })` — read message history

Stream conversion chain (BFF):
```
agent.stream() → processDataStream → ReadableStream<ChunkType> → toAISdkStream → createUIMessageStream → createUIMessageStreamResponse (SSE)
```

## Railway Deployment

Both services in the same Railway project for private networking:
- kagami-api (`kagami-v5`): internal only (no public domain), Mastra listens on port 8080
- kagami-web (`kagami-v5-frontend`): public domain for users
- `MASTRA_API_URL=http://kagami-v5.railway.internal:8080` (private networking requires explicit port — no proxying)
- `DATABASE_URL` must be Neon pooled PostgreSQL string (not Mastra URL)
- Railway does NOT proxy ports on private domains — always specify the actual port
- Drizzle uses lazy init (`getDb()`) to avoid build-time crashes when `DATABASE_URL` is unavailable
