# Adding a Custom Tool

## Steps

### 1. Create tool file

`src/mastra/tools/<tool-id>.ts`

```typescript
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const myNewTool = createTool({
  id: 'my-new-tool',
  description: 'What this tool does — this text is shown to the LLM',
  inputSchema: z.object({
    query: z.string().describe('Parameter description for the LLM'),
  }),
  outputSchema: z.object({
    result: z.string(),
  }),
  execute: async ({ query }) => {
    // implementation
    return { result: 'done' }
  },
})
```

### 2. Export from tools index

`src/mastra/tools/index.ts` — add camelCase key:

```typescript
import { myNewTool } from './my-new-tool'

export const customTools = {
  getCurrentDatetime: getCurrentDatetimeTool,
  researchTool,
  myNewTool,  // <-- add here
}
```

### 3. Register in TOOL_REGISTRY

`src/mastra/registry.ts` — add entry to `TOOL_REGISTRY`:

```typescript
{
  key: 'myNewTool',              // must match key in customTools
  id: 'my-new-tool',            // must match createTool id
  name: 'My New Tool',          // human-readable, shown in Settings UI
  description: 'What this tool does — shown in Settings UI',
  source: 'custom',
  agentId: 'research-agent',    // which agent uses this tool
  configSchema: null,           // or JSON Schema for UI-configurable params
},
```

### 4. Assign to agent (if needed)

Tools in `customTools` are available to `research-agent` via `{ ...customTools, ...mcpTools }` spread in `src/mastra/agents/research-agent.ts`.

Note: tools are filtered at runtime by `activeTools` from project config. If `activeTools` is set, only tools whose keys are in the whitelist will be available. A newly added tool works by default (when `activeTools` is `null`), but needs to be included in the whitelist if the project has one configured.

If the tool belongs to a different agent, add it to that agent's `tools` map.

## Tool with configurable params (configSchema)

If the tool has parameters configurable from Settings UI:

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema'

// In TOOL_REGISTRY entry:
{
  key: 'myNewTool',
  id: 'my-new-tool',
  name: 'My New Tool',
  description: 'What this tool does',
  source: 'custom',
  agentId: 'research-agent',
  configSchema: zodToJsonSchema(z.object({
    maxResults: z.number().min(1).max(100).default(10).describe('Maximum results to return'),
  })),
},
```

The frontend auto-generates a form from the JSON Schema. Supported types: `string`, `number`, `integer`, `boolean`.

To read the configured params in `execute`:

```typescript
execute: async (input, { requestContext }) => {
  const toolParams = requestContext?.get('toolParams') as Record<string, Record<string, unknown>> | undefined
  const maxResults = (toolParams?.['my-new-tool']?.maxResults as number) ?? 10
  // ...
}
```

## Checklist

- [ ] File created: `src/mastra/tools/<tool-id>.ts`
- [ ] Exported in `src/mastra/tools/index.ts` (camelCase key)
- [ ] Entry added to `TOOL_REGISTRY` in `src/mastra/registry.ts`
- [ ] Tool key does NOT start with `agent-`
- [ ] Agent has access to the tool (via spread or explicit assignment)
- [ ] Environment variables added to `.env.example` and Railway (if tool needs API keys)
