# Adding a Sub-Agent

## Steps

### 1. Create agent file

`src/mastra/agents/<agent-id>.ts`

```typescript
import { Agent } from '@mastra/core/agent'
import { DEFAULT_AGENT_PROMPTS } from '../config/defaults'

export const analyticsAgent = new Agent({
  id: 'analytics-agent',
  name: 'Analytics Agent',
  description:
    'Analyzes data, builds charts, provides insights. Use for data-heavy requests.',
  instructions: async ({ requestContext }) => {
    const agentPrompts = requestContext?.get('agentPrompts') as Record<string, string> | undefined
    return agentPrompts?.['analytics-agent'] || DEFAULT_AGENT_PROMPTS['analytics-agent']
  },
  model: 'openai/gpt-5.4',
  // tools: { ...customTools },  // if agent needs tools
  // defaultOptions: { maxSteps: 5 },  // if agent uses tools
})
```

Key points:
- `id` — kebab-case, unique
- `instructions` — always use `requestContext` fallback pattern for dynamic prompt override
- `description` — used by supervisor to decide when to delegate

### 2. Add default prompt

`src/mastra/config/defaults.ts` — add to `DEFAULT_AGENT_PROMPTS`:

```typescript
export const DEFAULT_AGENT_PROMPTS: Record<string, string> = {
  'research-agent': `...`,
  'writer-agent': `...`,
  'analytics-agent': `You are an analytics specialist. Your role:
- Analyze data and provide insights
- Create clear visualizations descriptions
- Summarize trends and patterns`,
}
```

### 3. Register in supervisor

`src/mastra/agents/supervisor.ts` — add to `agents` map:

```typescript
import { analyticsAgent } from './analytics-agent'

export const supervisorAgent = new Agent({
  // ...
  agents: { researchAgent, writerAgent, analyticsAgent },
  // ...
})
```

The registration key (`analyticsAgent`) determines the delegation tool name: `agent-analyticsAgent`.

### 4. Update supervisor instructions

`src/mastra/config/defaults.ts` — update `DEFAULT_SUPERVISOR_PROMPT`:

```
Available agents:
- researchAgent: ...
- writerAgent: ...
- analyticsAgent: Analyzes data, builds charts, provides insights. Use for data-heavy requests.

Delegation strategy:
...
6. Data analysis requests: Delegate to analyticsAgent
```

### 5. Register in AGENT_REGISTRY

`src/mastra/registry.ts` — add entry to `AGENT_REGISTRY`:

```typescript
{
  id: 'analytics-agent',
  name: 'Analytics Agent',
  description: 'Analyzes data, builds charts, provides insights.',
  defaultPrompt: DEFAULT_AGENT_PROMPTS['analytics-agent'],
},
```

### 6. Register in Mastra instance (if standalone)

Only needed if agent is NOT a sub-agent of supervisor (i.e., has its own HTTP endpoint).

`src/mastra/index.ts`:

```typescript
agents: { kagamiAgent: supervisorAgent, analyticsAgent },
```

Sub-agents registered via supervisor's `agents` map do NOT need separate Mastra registration.

## Checklist

- [ ] File created: `src/mastra/agents/<agent-id>.ts`
- [ ] Default prompt added to `DEFAULT_AGENT_PROMPTS` in `config/defaults.ts`
- [ ] Added to supervisor's `agents` map
- [ ] Supervisor instructions updated to describe new agent
- [ ] Entry added to `AGENT_REGISTRY` in `registry.ts`
- [ ] Frontend displays new agent automatically (via `/registry` endpoint)
