# Conventions

Пошаговые инструкции по расширению kagami-api.

## Guides

- [Adding a Tool](./adding-tool.md) — кастомный тул для агента
- [Adding an Agent](./adding-agent.md) — новый суб-агент
- [Adding an MCP Server](./adding-mcp-server.md) — внешний MCP-сервер

## Key Naming

| Concept | Example | Where used |
|---|---|---|
| Tool `key` (object key in tools map) | `getCurrentDatetime` | `activeTools`, stream (`tool-{key}`), `TOOL_REGISTRY` |
| Tool `id` (from `createTool`) | `get-current-datetime` | Mastra internals (logs, storage) |
| Agent `id` | `research-agent` | `AGENT_REGISTRY`, `agentPrompts`, `requestContext` |
| Agent registration key | `kagamiAgent` | Mastra instance (`agents: { kagamiAgent }`) |
| MCP tool namespace | `apify_call-actor` | Same as `key` for MCP tools |

## Important Rules

- **NO `agent-` prefix** in tool keys — collision with delegation detection (`isDelegationPart()` in frontend)
- Tool `key` = camelCase (custom) or `serverName_toolName` (MCP)
- Tool `id` = kebab-case
- Agent `id` = kebab-case
