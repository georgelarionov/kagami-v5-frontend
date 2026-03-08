# F7+F8. Стандарт реестра + Управление историей — План реализации

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> Две фичи, объединённые в один документ.
> F7 зависит от F5 (тулы) + F6 (конфиг) — заменяем дублирование промптов/метаданных на единый динамический реестр.
> F8 зависит от F2 (персистентность сообщений) — добавляем удаление истории.

**Goal:** F7 — единый источник истины для метаданных агентов и тулов, устраняющий дублирование между репо. F8 — очистка истории чата по кнопке с подтверждением.

**Architecture:** F7: бэкенд экспортирует AGENT_REGISTRY + TOOL_REGISTRY через кастомный `/api/registry` endpoint (`registerApiRoute`). BFF проксирует к фронтенду. Settings UI загружает реестр динамически вместо хардкода из `src/lib/registry.ts` (F6). F8: BFF endpoint удаляет сообщения через MastraClient memory API, UI с AlertDialog подтверждением.

**Tech Stack:** F7: `registerApiRoute` (Mastra), `zod-to-json-schema`, react-query. F8: `@mastra/client-js` memory API, shadcn AlertDialog.

---

# F7. Стандарт добавления агентов, тулов, MCP

## Контекст: что уже есть после F6

- `src/lib/registry.ts` (фронтенд) — захардкоженные `AGENT_REGISTRY`, `TOOL_REGISTRY`, `DEFAULT_SUPERVISOR_PROMPT`
- `src/mastra/config/defaults.ts` (бэкенд) — `DEFAULT_SUPERVISOR_PROMPT`, `DEFAULT_AGENT_PROMPTS`
- Дублирование промптов между репо — ручная синхронизация при изменениях
- Settings UI (`ProjectSettings`) использует хардкод из `src/lib/registry.ts`
- `toolParams` UI отложен в F6 — нужен `configSchema` из registry

F7 устраняет дублирование: бэкенд — единый источник истины, фронтенд загружает данные через API.

---

## Фаза 1: Бэкенд — Registry (kagami-api)

> **contracts.md:** обновить контракты — формат ответа `/api/registry`.

### Шаг 1.1 — Установить zod-to-json-schema

```bash
npm install zod-to-json-schema
```

> Конвертация Zod-схем в JSON Schema для передачи `configSchema` тулов на фронтенд. Фронтенд не имеет доступа к Zod runtime — нужна сериализация.

### Шаг 1.2 — Создать registry

**Создать:** `src/mastra/registry.ts`

```typescript
// zodToJsonSchema — импортировать при добавлении configSchema к тулу:
// import { zodToJsonSchema } from 'zod-to-json-schema'
// configSchema: zodToJsonSchema(z.object({ ... }))

import { DEFAULT_AGENT_PROMPTS } from './config/defaults'

// --- Agent Registry ---

export interface AgentRegistryEntry {
  id: string
  name: string
  description: string
  defaultPrompt: string
}

export const AGENT_REGISTRY: AgentRegistryEntry[] = [
  {
    id: 'research-agent',
    name: 'Research Agent',
    description: 'Gathers information, analyzes data, returns structured summaries. Has web search and utility tools.',
    defaultPrompt: DEFAULT_AGENT_PROMPTS['research-agent'],
  },
  {
    id: 'writer-agent',
    name: 'Writer Agent',
    description: 'Creates polished content, formats text, writes documents.',
    defaultPrompt: DEFAULT_AGENT_PROMPTS['writer-agent'],
  },
]

// --- Tool Registry ---

export interface ToolRegistryEntry {
  key: string          // object key in agent's tools map (e.g. 'getCurrentDatetime')
  id: string           // createTool() id (e.g. 'get-current-datetime')
  name: string         // human-readable name for UI
  description: string  // description for UI
  source: 'custom' | 'mcp'
  agentId: string      // which agent owns this tool
  configSchema: Record<string, unknown> | null  // JSON Schema for UI-configurable params
}

export const TOOL_REGISTRY: ToolRegistryEntry[] = [
  {
    key: 'getCurrentDatetime',
    id: 'get-current-datetime',
    name: 'Current Date & Time',
    description: 'Returns current date and time in UTC and specified timezone',
    source: 'custom',
    agentId: 'research-agent',
    configSchema: null,
  },
  {
    key: 'braveSearch_web_search',
    id: 'braveSearch_web_search',
    name: 'Web Search (Brave)',
    description: 'Search the web for current information',
    source: 'mcp',
    agentId: 'research-agent',
    configSchema: null,
  },
]

// Re-export for registry endpoint
export { DEFAULT_SUPERVISOR_PROMPT } from './config/defaults'
```

> **`key`** — ключ из `tools` map агента. Используется для фильтрации в `activeTools` и идентификации в стриме (`tool-${key}`).
>
> **`agentId`** — для UI: группировка тулов по агентам в настройках.
>
> **`configSchema: null`** — текущие тулы не имеют UI-настраиваемых параметров. Для тулов с configurable params:
> ```typescript
> configSchema: zodToJsonSchema(z.object({
>   maxResults: z.number().min(1).max(100).default(10).describe('Maximum results to return'),
> })),
> ```
>
> **`defaultPrompt`** берётся из `config/defaults.ts` — единый источник. Фронтенд получит промпты через API.
>
> **При добавлении нового суб-агента:** добавить запись в `AGENT_REGISTRY` + промпт в `DEFAULT_AGENT_PROMPTS`.
>
> **При добавлении нового тула:** добавить запись в `TOOL_REGISTRY`.

### Шаг 1.3 — API endpoint /api/registry

**Изменить:** `src/mastra/index.ts` (kagami-api)

Добавить `apiRoutes` в конфиг Mastra instance (к существующему `middleware` из F6):

```typescript
import { registerApiRoute } from '@mastra/core/server'
import { AGENT_REGISTRY, TOOL_REGISTRY, DEFAULT_SUPERVISOR_PROMPT } from './registry'

export const mastra = new Mastra({
  // ... storage, agents, workflows, logger, server.middleware (F6) — без изменений
  server: {
    middleware: [
      // F6 middleware — без изменений
    ],
    apiRoutes: [
      registerApiRoute('/api/registry', {
        method: 'GET',
        handler: async (c) => {
          return c.json({
            agents: AGENT_REGISTRY,
            tools: TOOL_REGISTRY,
            supervisorDefaultPrompt: DEFAULT_SUPERVISOR_PROMPT,
          })
        },
      }),
    ],
  },
})
```

> **`registerApiRoute`** — Hono-based handler на Mastra Server. Доступен по `{MASTRA_API_URL}/api/registry`.
>
> **Без auth** — endpoint внутри private network (Railway internal). BFF проксирует с Clerk auth.
>
> **Статический ответ** — реестр не зависит от requestContext или project. Одинаковый для всех.
>
> **Проверить при реализации:** точный import path для `registerApiRoute` — `'@mastra/core/server'` или `'@mastra/core'`. Если не доступен — использовать Hono route handler напрямую через `server.apiRoutes` формат.

### Шаг 1.4 — Проверить через curl

```bash
curl http://localhost:4111/api/registry | jq .
```

Ожидаемый ответ:
```json
{
  "agents": [
    { "id": "research-agent", "name": "Research Agent", "description": "...", "defaultPrompt": "..." },
    { "id": "writer-agent", "name": "Writer Agent", "description": "...", "defaultPrompt": "..." }
  ],
  "tools": [
    { "key": "getCurrentDatetime", "id": "get-current-datetime", "name": "Current Date & Time", "description": "...", "source": "custom", "agentId": "research-agent", "configSchema": null },
    { "key": "braveSearch_web_search", ... }
  ],
  "supervisorDefaultPrompt": "You are Kagami..."
}
```

---

## Фаза 2: Фронтенд — BFF + хуки (kagami-v5-frontend)

### Шаг 2.1 — BFF proxy: GET /api/registry

**Создать:** `src/app/api/registry/route.ts`

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const res = await fetch(
      `${process.env.MASTRA_API_URL || 'http://localhost:4111'}/api/registry`
    )
    if (!res.ok) throw new Error(`Registry fetch failed: ${res.status}`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('[registry] Failed to fetch registry:', error)
    return NextResponse.json({ error: 'Failed to fetch registry' }, { status: 502 })
  }
}
```

> **Proxy pattern** — BFF добавляет Clerk auth, проксирует к Mastra Server на private network.

### Шаг 2.2 — React-query хук useRegistry

**Создать:** `src/hooks/use-registry.ts`

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'

export interface AgentMeta {
  id: string
  name: string
  description: string
  defaultPrompt: string
}

export interface ToolMeta {
  key: string
  id: string
  name: string
  description: string
  source: 'custom' | 'mcp'
  agentId: string
  configSchema: Record<string, unknown> | null
}

export interface RegistryData {
  agents: AgentMeta[]
  tools: ToolMeta[]
  supervisorDefaultPrompt: string
}

export function useRegistry() {
  return useQuery({
    queryKey: ['registry'],
    queryFn: async (): Promise<RegistryData> => {
      const res = await fetch('/api/registry')
      if (!res.ok) throw new Error('Failed to fetch registry')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,  // 5 минут — реестр статичен
    gcTime: 30 * 60 * 1000,    // 30 минут в cache
  })
}
```

> **`staleTime: 5 min`** — реестр меняется только при деплое бэкенда. Баланс между свежестью и количеством запросов.
>
> **Типы** — `AgentMeta`, `ToolMeta` заменяют одноимённые типы из `src/lib/registry.ts` (F6).

### Шаг 2.3 — Удалить хардкод src/lib/registry.ts

**Удалить:** `src/lib/registry.ts`

Файл создан в F6 (шаг 4.2) с захардкоженными данными. После F7 все данные загружаются через `useRegistry()`.

> **Обновить импорты:**
> - `src/components/settings/project-settings.tsx` — заменить импорт из `@/lib/registry` на данные из `useRegistry()`
> - `src/components/chat/message-list.tsx` — `AGENT_DISPLAY_NAMES` из F4 остаётся как хардкод (для delegation parts, не для settings). Замена на registry lookup — future improvement

---

## Фаза 3: Фронтенд — Обновить Settings UI (kagami-v5-frontend)

### Шаг 3.1 — ProjectSettings с динамическим реестром

**Изменить:** `src/components/settings/project-settings.tsx`

Основные изменения vs F6:
1. Добавить `useRegistry()` вызов
2. Заменить хардкоженные константы на данные из хука
3. Добавить loading/error state для registry
4. Добавить `ToolParamsForm` для тулов с configSchema

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Settings, RotateCcw, Loader2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useProjectConfig } from '@/hooks/use-project-config'
import { useRegistry } from '@/hooks/use-registry'
import { ToolParamsForm } from '@/components/settings/tool-params-form'

interface ProjectSettingsProps {
  projectId: string
}

export function ProjectSettings({ projectId }: ProjectSettingsProps) {
  const { config, isLoading: isConfigLoading, saveConfig, isSaving } = useProjectConfig(projectId)
  const { data: registry, isLoading: isRegistryLoading, error: registryError } = useRegistry()
  const [open, setOpen] = useState(false)

  // Local form state
  const [supervisorPrompt, setSupervisorPrompt] = useState('')
  const [agentPrompts, setAgentPrompts] = useState<Record<string, string>>({})
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [toolParams, setToolParams] = useState<Record<string, Record<string, unknown>>>({})
  const [dirty, setDirty] = useState(false)

  const isLoading = isConfigLoading || isRegistryLoading

  // Sync local state when config loads or sheet opens
  useEffect(() => {
    if (!open || !registry) return
    setSupervisorPrompt(config?.supervisorPrompt ?? '')
    setAgentPrompts(config?.agentPrompts ?? {})
    setActiveTools(config?.activeTools ?? registry.tools.map((t) => t.key))
    setToolParams(config?.toolParams ?? {})
    setDirty(false)
  }, [config, registry, open])

  const handleSave = () => {
    if (!registry) return
    saveConfig(
      {
        projectId,
        supervisorPrompt: supervisorPrompt.trim() || null,
        agentPrompts: (() => {
          const filtered = Object.fromEntries(
            Object.entries(agentPrompts).filter(([, v]) => v.trim())
          )
          return Object.keys(filtered).length > 0 ? filtered : null
        })(),
        activeTools:
          activeTools.length === registry.tools.length ? null : activeTools,
        toolParams:
          Object.keys(toolParams).length > 0 ? toolParams : null,
      },
      {
        onSuccess: () => {
          setDirty(false)
          toast.success('Settings saved')
        },
        onError: () => toast.error('Failed to save settings'),
      },
    )
  }

  const handleResetSupervisor = () => {
    setSupervisorPrompt('')
    setDirty(true)
  }

  const handleResetAgent = (agentId: string) => {
    setAgentPrompts((prev) => {
      const next = { ...prev }
      delete next[agentId]
      return next
    })
    setDirty(true)
  }

  const handleToolToggle = (toolKey: string, checked: boolean) => {
    setActiveTools((prev) =>
      checked ? [...prev, toolKey] : prev.filter((k) => k !== toolKey),
    )
    // Clean up toolParams for disabled tool
    if (!checked) {
      setToolParams((prev) => {
        const next = { ...prev }
        const tool = registry?.tools.find((t) => t.key === toolKey)
        if (tool) delete next[tool.id]
        return next
      })
    }
    setDirty(true)
  }

  const handleToolParamChange = (toolId: string, param: string, value: unknown) => {
    setToolParams((prev) => ({
      ...prev,
      [toolId]: { ...prev[toolId], [param]: value },
    }))
    setDirty(true)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Project settings">
          <Settings className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Project Settings</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : registryError ? (
          <div className="flex items-center gap-2 py-8 text-destructive">
            <AlertCircle className="size-5" />
            <p className="text-sm">Failed to load registry. Try again later.</p>
          </div>
        ) : registry ? (
          <div className="space-y-6 py-4">
            {/* Supervisor Prompt */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="supervisor-prompt">Supervisor Prompt</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetSupervisor}
                  className="h-7 text-xs text-muted-foreground"
                >
                  <RotateCcw className="size-3 mr-1" />
                  Reset
                </Button>
              </div>
              <Textarea
                id="supervisor-prompt"
                value={supervisorPrompt}
                onChange={(e) => {
                  setSupervisorPrompt(e.target.value)
                  setDirty(true)
                }}
                placeholder={registry.supervisorDefaultPrompt}
                rows={8}
                className="text-sm font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to use default prompt.
              </p>
            </div>

            {/* Agent Prompts — from registry */}
            {registry.agents.map((agent) => (
              <div key={agent.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`agent-prompt-${agent.id}`}>
                    {agent.name}
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleResetAgent(agent.id)}
                    className="h-7 text-xs text-muted-foreground"
                  >
                    <RotateCcw className="size-3 mr-1" />
                    Reset
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {agent.description}
                </p>
                <Textarea
                  id={`agent-prompt-${agent.id}`}
                  value={agentPrompts[agent.id] ?? ''}
                  onChange={(e) => {
                    setAgentPrompts((prev) => ({
                      ...prev,
                      [agent.id]: e.target.value,
                    }))
                    setDirty(true)
                  }}
                  placeholder={agent.defaultPrompt}
                  rows={6}
                  className="text-sm font-mono"
                />
              </div>
            ))}

            {/* Tool Toggles + Params — from registry */}
            <div className="space-y-2">
              <Label>Tools</Label>
              <div className="space-y-3">
                {registry.tools.map((tool) => (
                  <div key={tool.key}>
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={`tool-${tool.key}`}
                        checked={activeTools.includes(tool.key)}
                        onCheckedChange={(checked) =>
                          handleToolToggle(tool.key, !!checked)
                        }
                      />
                      <div className="space-y-0.5">
                        <Label
                          htmlFor={`tool-${tool.key}`}
                          className="text-sm font-medium cursor-pointer"
                        >
                          {tool.name}
                          <span className="ml-2 text-xs text-muted-foreground font-normal">
                            {tool.source === 'mcp' ? 'MCP' : 'Built-in'}
                          </span>
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {tool.description}
                        </p>
                      </div>
                    </div>

                    {/* Tool Params — auto-generated from configSchema */}
                    {tool.configSchema && activeTools.includes(tool.key) && (
                      <ToolParamsForm
                        toolId={tool.id}
                        schema={tool.configSchema}
                        values={toolParams[tool.id] ?? {}}
                        onChange={(param, value) =>
                          handleToolParamChange(tool.id, param, value)
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleSave} disabled={!dirty || isSaving}>
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : null}
                Save Changes
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
```

> **Diff vs F6:** импорт `AGENT_REGISTRY`, `TOOL_REGISTRY`, `DEFAULT_SUPERVISOR_PROMPT` из `@/lib/registry` заменён на `useRegistry()`. Добавлен `registryError` handling. Добавлен `ToolParamsForm` для тулов с `configSchema`. Добавлен `toolParams` state и `handleToolParamChange`.

### Шаг 3.2 — Компонент ToolParamsForm

**Создать:** `src/components/settings/tool-params-form.tsx`

```tsx
'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

interface ToolParamsFormProps {
  toolId: string
  schema: Record<string, unknown>  // JSON Schema
  values: Record<string, unknown>
  onChange: (param: string, value: unknown) => void
}

export function ToolParamsForm({ toolId, schema, values, onChange }: ToolParamsFormProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties = (schema as any).properties as Record<string, any> | undefined
  if (!properties) return null

  return (
    <div className="ml-7 mt-2 space-y-2 rounded-md border p-3">
      {Object.entries(properties).map(([key, prop]) => {
        const label = prop.description || key
        const defaultValue = prop.default

        if (prop.type === 'boolean') {
          return (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                id={`${toolId}-${key}`}
                checked={(values[key] as boolean) ?? defaultValue ?? false}
                onCheckedChange={(checked) => onChange(key, !!checked)}
              />
              <Label htmlFor={`${toolId}-${key}`} className="text-xs cursor-pointer">
                {label}
              </Label>
            </div>
          )
        }

        if (prop.type === 'number' || prop.type === 'integer') {
          return (
            <div key={key} className="space-y-1">
              <Label htmlFor={`${toolId}-${key}`} className="text-xs">
                {label}
              </Label>
              <Input
                id={`${toolId}-${key}`}
                type="number"
                value={(values[key] as number) ?? defaultValue ?? ''}
                onChange={(e) =>
                  onChange(key, e.target.value ? Number(e.target.value) : undefined)
                }
                min={prop.minimum}
                max={prop.maximum}
                className="h-8 text-xs"
              />
            </div>
          )
        }

        // Default: string input
        return (
          <div key={key} className="space-y-1">
            <Label htmlFor={`${toolId}-${key}`} className="text-xs">
              {label}
            </Label>
            <Input
              id={`${toolId}-${key}`}
              type="text"
              value={(values[key] as string) ?? defaultValue ?? ''}
              onChange={(e) => onChange(key, e.target.value || undefined)}
              className="h-8 text-xs"
            />
          </div>
        )
      })}
    </div>
  )
}
```

> **JSON Schema → Form:** Простой маппинг `type` → input. `boolean` → Checkbox, `number`/`integer` → number Input, `string` → text Input. Достаточно для MVP — configSchema тулов обычно плоские.
>
> **`defaultValue`** из JSON Schema `default` field — начальное значение если нет override в `toolParams`.
>
> **`description`** из JSON Schema — используется как label.
>
> **Вложенные объекты** — не поддерживаются в MVP. Расширить при необходимости.

---

## Фаза 4: Документация — Конвенции (kagami-api)

### Шаг 4.1 — Документация процесса добавления

**Создать:** `docs/conventions.md` (в kagami-api)

```markdown
# Conventions: Adding Agents, Tools, MCP

## Adding a new custom tool

1. Create `src/mastra/tools/<tool-id>.ts`
2. Export via `createTool()` with id, description, inputSchema, outputSchema, execute
3. Optionally: add `configSchema` (zod) for UI-configurable parameters
4. Add to `src/mastra/tools/index.ts` (camelCase key in exports object)
5. Assign to agent's `tools` map (spread in agent definition)
6. Add entry to `TOOL_REGISTRY` in `src/mastra/registry.ts`
7. Do NOT use `agent-` prefix in tool key (collision with F4 delegation detection)

## Adding a new sub-agent

1. Create `src/mastra/agents/<agent-id>.ts`
2. Export Agent with id, description, dynamic instructions (`requestContext` with fallback)
3. Add default prompt to `DEFAULT_AGENT_PROMPTS` in `src/mastra/config/defaults.ts`
4. Register in supervisor's `agents` map (`src/mastra/agents/supervisor.ts`)
5. Update supervisor instructions to describe new agent
6. Add entry to `AGENT_REGISTRY` in `src/mastra/registry.ts`

## Adding an MCP server

1. Add server config to `src/mastra/mcp/index.ts` (MCPClient servers)
2. Spread MCP tools into the appropriate agent's `tools` map
3. Add entries to `TOOL_REGISTRY` with `source: 'mcp'`
4. Add required env vars to `.env.example` and Railway variables
5. Tools are automatically namespaced: `serverName_toolName`

## Key naming

| Concept | Example | Where used |
|---|---|---|
| Tool `key` (object key in tools map) | `getCurrentDatetime` | `activeTools`, stream (`tool-{key}`), TOOL_REGISTRY |
| Tool `id` (from createTool) | `get-current-datetime` | Mastra internals (logs, storage) |
| Agent `id` | `research-agent` | AGENT_REGISTRY, agentPrompts, requestContext |
| Agent registration key | `kagamiAgent` | Mastra instance, MastraClient.getAgent() |
| MCP tool namespace | `braveSearch_web_search` | Same as `key` for MCP tools |
```

### Шаг 4.2 — Обновить contracts.md

**Файл:** `plans-docs/v0.2/contracts.md`

Добавить контракты F7:

```markdown
## F7: Registry API

### Endpoint
- `GET {MASTRA_API_URL}/api/registry` — returns full registry (no auth, private network)
- BFF proxy: `GET /api/registry` (with Clerk auth)

### Response fields
- `agents[]`: id, name, description, defaultPrompt
- `tools[]`: key, id, name, description, source, agentId, configSchema
- `supervisorDefaultPrompt`: string

### configSchema format
- JSON Schema (converted from Zod via zod-to-json-schema)
- null if tool has no configurable params
- Supported property types: string, number, integer, boolean

### Example response
```json
{
  "agents": [
    { "id": "research-agent", "name": "Research Agent", "description": "...", "defaultPrompt": "..." }
  ],
  "tools": [
    { "key": "getCurrentDatetime", "id": "get-current-datetime", "name": "Current Date & Time", "description": "...", "source": "custom", "agentId": "research-agent", "configSchema": null }
  ],
  "supervisorDefaultPrompt": "You are Kagami..."
}
```

---

# F8. Управление историей чата

## Контекст: что уже есть после F2

- Mastra memory хранит сообщения по `threadId = chatId`
- `@mastra/client-js`: `thread.deleteMessages(messageIds)` — удаление конкретных сообщений
- Mastra Server REST API: возможно `DELETE /memory/threads/:threadId/messages` с `clearAll` (проверить)
- `useChat` (F1) — `setMessages([])` для очистки UI
- `useChatMessages` (F2) — react-query хук, `invalidateQueries` для перезагрузки

---

## Фаза 1: Бэкенд — BFF endpoint (kagami-v5-frontend)

### Шаг 1.1 — DELETE handler в /api/chat/messages

**Изменить:** `src/app/api/chat/messages/route.ts`

Добавить DELETE handler к существующему GET:

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { chats, projects } from '@/db/schema'
import { mastraClient } from '@/lib/mastra'
import { eq, and } from 'drizzle-orm'

// GET handler (F2) — без изменений

export async function DELETE(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  // Verify user owns the project
  const [chat] = await getDb()
    .select({ id: chats.id, pendingMessage: chats.pendingMessage })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  // Reject if there's an active run
  if (chat.pendingMessage) {
    return NextResponse.json(
      { error: 'Cannot clear history while a message is being processed' },
      { status: 409 },
    )
  }

  try {
    const thread = mastraClient.getMemoryThread({
      threadId: chatId,
      agentId: 'kagamiAgent',
    })
    const result = await thread.listMessages({ perPage: 1000 })

    if (result.messages.length > 0) {
      const messageIds = result.messages.map((m: { id: string }) => m.id)
      await thread.deleteMessages(messageIds)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[chat/messages] Failed to delete messages:', error)
    return NextResponse.json({ error: 'Failed to clear history' }, { status: 500 })
  }
}
```

> **Стратегия удаления:** загружаем все ID → удаляем пачкой. `deleteMessages()` принимает массив ID.
>
> **409 при активном run:** нельзя удалять пока агент генерирует — может сломать memory consistency.
>
> **`perPage: 1000`** — для получения всех ID. Если чат длиннее (маловероятно при observational memory) — добавить пагинированное удаление.
>
> **Thread preservation:** удаляются только сообщения, не thread. `threadId = chatId` маппинг сохраняется. Новые сообщения пойдут в тот же thread при следующем `agent.stream()`.
>
> **Проверить при реализации:** (1) поддерживает ли `deleteMessages()` большие массивы; (2) есть ли endpoint с `clearAll` — если да, использовать вместо list+delete.

### Шаг 1.2 — Обновить contracts.md

**Файл:** `plans-docs/v0.2/contracts.md`

```markdown
## F8: Chat History Management

### Endpoint
- `DELETE /api/chat/messages?chatId=<uuid>` — clear all messages

### Response
- 200: `{ "ok": true }`
- 400: Missing chatId
- 401: Unauthorized
- 404: Chat not found / not owned
- 409: Active run (pendingMessage set)
- 500: Server error

### Behavior
- Deletes all messages from Mastra memory thread
- Thread itself preserved (can send new messages)
- Does NOT delete chat record from frontend DB
- Rejected while pendingMessage is set (active run)
```

---

## Фаза 2: Фронтенд — UI (kagami-v5-frontend)

### Шаг 2.1 — Установить AlertDialog

```bash
npx shadcn@latest add alert-dialog
```

> Пропустить если `src/components/ui/alert-dialog.tsx` уже существует.

### Шаг 2.2 — Хук useClearHistory

**Создать:** `src/hooks/use-clear-history.ts`

```typescript
'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

export function useClearHistory(chatId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/chat/messages?chatId=${chatId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to clear history')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memory', 'messages', chatId] })
    },
  })
}
```

> **`invalidateQueries`** — `useChatMessages` (F2) перезагрузит пустой чат.
>
> **`setMessages([])`** вызывается в chat-page, не в хуке — зависит от `useChat` API.

### Шаг 2.3 — Компонент ClearHistoryButton

**Создать:** `src/components/chat/clear-history-button.tsx`

```tsx
'use client'

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface ClearHistoryButtonProps {
  onClear: () => Promise<void>
  disabled?: boolean
}

export function ClearHistoryButton({ onClear, disabled }: ClearHistoryButtonProps) {
  const [open, setOpen] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  const handleClear = async () => {
    setIsClearing(true)
    try {
      await onClear()
      toast.success('Chat history cleared')
      setOpen(false)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to clear history',
      )
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Clear chat history"
        >
          <Trash2 className="size-5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear chat history?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete all messages in this chat.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleClear()
            }}
            disabled={isClearing}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isClearing ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : null}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

> **`disabled`** — `true` при `status !== 'ready'` (стриминг активен).
>
> **Destructive styling** — красная кнопка "Delete" (`bg-destructive`).
>
> **Toast feedback** — sonner success/error.

### Шаг 2.4 — Интеграция в chat-page

**Изменить:** `src/components/chat/chat-page.tsx`

```tsx
import { ClearHistoryButton } from '@/components/chat/clear-history-button'
import { useClearHistory } from '@/hooks/use-clear-history'

// В компоненте:
const clearHistory = useClearHistory(chatId)

const handleClearHistory = async () => {
  await clearHistory.mutateAsync()
  setMessages([])  // useChat setMessages — мгновенно очищает UI
}

// В header (рядом с ProjectSettings из F6):
<div className="flex items-center justify-between border-b px-4 py-2">
  <h1 className="text-lg font-semibold">Kagami</h1>
  <div className="flex items-center gap-1">
    <ClearHistoryButton
      onClear={handleClearHistory}
      disabled={status !== 'ready'}
    />
    <ProjectSettings projectId={projectId} />
  </div>
</div>
```

> **`setMessages([])`** — мгновенно очищает UI. `invalidateQueries` в хуке перезагрузит (пустой) кэш.
>
> **`disabled={status !== 'ready'}`** — блокировка при стриминге (аналогично "Загрузить ранние" из F2).
>
> **Порядок кнопок:** Clear History → Settings. Деструктивное действие менее визуально приоритетно.

---

## Проверка

### F7

#### Бэкенд
- [ ] `npm install zod-to-json-schema` — установлено
- [ ] `AGENT_REGISTRY` содержит все суб-агенты с метаданными и `defaultPrompt`
- [ ] `TOOL_REGISTRY` содержит все тулы с метаданными
- [ ] `GET {MASTRA_API_URL}/api/registry` — возвращает полный реестр (curl)
- [ ] configSchema сериализуется корректно (JSON Schema из zod)
- [ ] `supervisorDefaultPrompt` совпадает с `DEFAULT_SUPERVISOR_PROMPT`

#### Фронтенд
- [ ] `GET /api/registry` (BFF) — проксирует и возвращает данные
- [ ] Auth: 401 без Clerk session
- [ ] `useRegistry()` загружает данные, кэширует на 5 минут
- [ ] Settings UI показывает агентов из реестра (не хардкод)
- [ ] Settings UI показывает тулы из реестра (не хардкод)
- [ ] Placeholder промптов — из реестра (`defaultPrompt`)
- [ ] Добавление нового агента в бэкенд → появляется в Settings UI без изменений фронтенда
- [ ] Добавление нового тула в бэкенд → появляется в Settings UI без изменений фронтенда
- [ ] Тул с `configSchema` → автоматическая форма параметров под чекбоксом
- [ ] Registry error → сообщение об ошибке в Settings panel
- [ ] `src/lib/registry.ts` удалён, нет broken imports

#### Документация
- [ ] `docs/conventions.md` создан в kagami-api
- [ ] Процесс добавления тула документирован
- [ ] Процесс добавления суб-агента документирован
- [ ] Процесс добавления MCP-сервера документирован

### F8

#### Бэкенд (BFF)
- [ ] `DELETE /api/chat/messages?chatId=...` — удаляет все сообщения
- [ ] Auth: 401 без Clerk session
- [ ] Ownership: 404 для чужого chatId
- [ ] 409 при активном `pendingMessage`
- [ ] После удаления: `thread.listMessages()` возвращает пустой массив
- [ ] Chat record сохраняется в БД (только сообщения удалены)

#### Фронтенд
- [ ] Кнопка Clear history (Trash2) видна в header чата
- [ ] Кнопка disabled при стриминге (`status !== 'ready'`)
- [ ] AlertDialog появляется при клике
- [ ] "Cancel" закрывает диалог
- [ ] "Delete" удаляет сообщения, чат мгновенно пуст
- [ ] Toast success: "Chat history cleared"
- [ ] Toast error при ошибке API
- [ ] Loading state на кнопке "Delete"
- [ ] После очистки можно писать новые сообщения
- [ ] Reload страницы после очистки — чат пуст
- [ ] Кнопка "Загрузить ранние" (F2) скрыта после очистки

---

## Решённые вопросы

### F7

1. **Формат сериализации zod-схемы** → `zodToJsonSchema()` из пакета `zod-to-json-schema`. Стандартный подход — JSON Schema совместим с JSON.stringify. Ручной маппинг не нужен.

2. **Кэширование реестра на фронте** → `staleTime: 5 min` в react-query. Реестр статичен (меняется только при деплое). Background refetch раз в 5 минут.

3. **Связь с F6** → F7 заменяет хардкод `src/lib/registry.ts` (F6 шаг 4.2) на динамический `useRegistry()`. Типы `AgentMeta`, `ToolMeta` переехали в хук. Settings UI использует данные из хука вместо импорта констант.

4. **AGENT_DISPLAY_NAMES в F4** → Остаётся как хардкод в `message-list.tsx`. Замена на registry lookup — future improvement (требует React context или preload). Не блокирует F7.

5. **configSchema → toolParams UI** → F6 подготовил инфраструктуру: колонка `tool_params` в БД, `requestContext.set('toolParams', ...)` в middleware, `execute(input, { requestContext })` в тулах. F7 добавляет: `configSchema` в TOOL_REGISTRY → JSON Schema → `ToolParamsForm`. End-to-end цепочка.

6. **Единый источник промптов** → После F7 дефолтные промпты определяются один раз в бэкенде (`config/defaults.ts`), передаются через `/api/registry`. Фронтенд НЕ дублирует промпты. `src/lib/registry.ts` удаляется.

### F8

1. **Пересечение с F2** → F2 описал API удаления как scope для F8 (resolved question 6). F8 реализует: BFF endpoint + UI.

2. **Стратегия удаления** → `thread.listMessages()` → собрать ID → `thread.deleteMessages(ids)`. Если Mastra REST API поддерживает `clearAll` — использовать вместо list+delete (проверить при реализации).

3. **Thread preservation** → Удаляются только сообщения, не thread. `threadId = chatId` маппинг сохраняется. Новые сообщения создаются в том же thread.

4. **Блокировка при стриминге** → `disabled={status !== 'ready'}` на клиенте + BFF проверяет `pendingMessage IS NOT NULL` → 409. Defense in depth.

5. **Working memory при очистке** → Working memory НЕ очищается при удалении сообщений (живёт отдельно). Агент помнит контекст, даже если сообщения удалены. Для MVP приемлемо — пользователь очищает визуальную историю. Кнопка "Reset memory" — future improvement.

---

## Открытые вопросы

### F7

1. **`registerApiRoute` import path** → `'@mastra/core/server'` или `'@mastra/core'`? Проверить актуальный экспорт при реализации через `mastra` MCP или `context7`. Если не доступен — Hono route handler напрямую.

2. **configSchema для MCP-тулов** → MCP-тулы не имеют Zod-схемы (конфигурируются через env vars). `configSchema: null` для всех MCP-тулов. Для UI-настройки MCP-параметров — обернуть MCP-вызов кастомным тулом с configSchema.

3. **Автоматическая сборка TOOL_REGISTRY** → В текущем плане ведётся вручную. Автоматическая сборка из `tools/index.ts` + `mcp/index.ts` — возможная оптимизация, но добавляет сложность (нужны метаданные name/description, отличающиеся от LLM-facing description). Для MVP — ручной подход.

### F8

1. **`deleteMessages()` batch size limit** → Поддерживает ли `thread.deleteMessages()` массив из 1000+ ID? Если нет — разбить на chunks. Проверить при реализации.

2. **Working memory clearing** → Нужна ли кнопка "Reset memory" (помимо "Clear history")? Для MVP — нет. Добавить при необходимости.

3. **Thread deletion vs message deletion** → Альтернатива: удалить весь thread → пересоздать. `memory.deleteThread(threadId)` — гарантирует полную очистку. Но нужно пересоздать thread с тем же ID — поддерживает ли Mastra? Текущий план (delete messages) безопаснее.

4. **Mastra REST API clearAll** → Есть ли endpoint для удаления всех сообщений за один вызов (вместо list+delete)? Проверить документацию через `mastra` MCP или `context7` при реализации.
