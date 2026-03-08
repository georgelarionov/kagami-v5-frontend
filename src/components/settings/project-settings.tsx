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
