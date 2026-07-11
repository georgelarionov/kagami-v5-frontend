# Adding an MCP Server

## Steps

### 1. Add server config

`src/mastra/mcp/index.ts` — add to `MCPClient` servers:

```typescript
export const mcpClient = new MCPClient({
  servers: {
    apify: {
      // existing...
    },
    brave: {
      url: new URL('https://mcp.brave.com/sse'),
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers || {})
        headers.set('Authorization', `Bearer ${process.env.BRAVE_API_KEY}`)
        return fetch(url, { ...init, headers })
      },
      timeout: 30_000,
    },
  },
})
```

The server key (`brave`) becomes the tool namespace prefix: `brave_*`.

### 2. Spread tools into agent

`src/mastra/agents/research-agent.ts` — MCP tools are already spread via `{ ...customTools, ...mcpTools }`. All MCP servers share the same `mcpTools` object.

If the new MCP server's tools should go to a different agent, filter by namespace in that agent's `tools` function. Preserve the `activeTools` filtering:

```typescript
tools: ({ requestContext }) => {
  const agentMcpTools = Object.fromEntries(
    Object.entries(mcpTools).filter(([key]) => key.startsWith('brave_'))
  )
  const allTools = { ...customTools, ...agentMcpTools }
  const activeTools = requestContext?.get('activeTools') as string[] | undefined
  if (!activeTools) return allTools
  return Object.fromEntries(
    Object.entries(allTools).filter(([key]) => activeTools.includes(key)),
  )
}
```

### 3. Add entries to TOOL_REGISTRY

`src/mastra/registry.ts` — add entry for each MCP tool:

```typescript
{
  key: 'brave_web_search',
  id: 'brave_web_search',
  name: 'Web Search (Brave)',
  description: 'Search the web for current information',
  source: 'mcp',
  agentId: 'research-agent',
  configSchema: null,
},
```

To discover tool names, run:

```bash
# Create a temp script or use the dev server logs
cp .env .worktrees/<branch>/.env  # if in worktree
node --import tsx/esm -e "
  import 'dotenv/config'
  import { mcpClient } from './src/mastra/mcp/index.ts'
  const tools = await mcpClient.listTools()
  for (const [key, tool] of Object.entries(tools)) {
    console.log(key, '|', (tool as any).description?.slice(0, 80))
  }
  process.exit(0)
"
```

### 4. Add environment variables

`.env.example` — add the required env var:

```bash
BRAVE_API_KEY=   # Brave Search MCP server
```

Also add to Railway variables for production.

### 5. Handle graceful fallback

MCP tools are loaded at startup in `src/mastra/mcp/index.ts`. If the server is unavailable, the `try/catch` ensures the app continues without those tools:

```typescript
export let mcpTools: Record<string, any> = {}
try {
  mcpTools = await mcpClient.listTools()
} catch (error) {
  console.error('[MCP] Failed to initialize tools:', error)
}
```

## Checklist

- [ ] Server config added to `src/mastra/mcp/index.ts`
- [ ] Tools spread into the appropriate agent's `tools` map
- [ ] Entries added to `TOOL_REGISTRY` in `registry.ts` with `source: 'mcp'`
- [ ] Env var added to `.env.example`
- [ ] Env var added to Railway variables
- [ ] Graceful fallback works (server starts even if MCP unavailable)
- [ ] Frontend displays new tools automatically (via `/registry` endpoint)
- [ ] Update `TOOL_REGISTRY` if MCP server updates its tool set in future versions
