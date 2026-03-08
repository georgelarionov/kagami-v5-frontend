'use client'

import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Settings, RotateCcw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useProjectConfig } from '@/hooks/use-project-config'
import {
  AGENT_REGISTRY,
  TOOL_REGISTRY,
  DEFAULT_SUPERVISOR_PROMPT,
} from '@/lib/registry'

interface ProjectSettingsProps {
  projectId: string
}

export function ProjectSettings({ projectId }: ProjectSettingsProps) {
  const { config, isLoading, saveConfig, isSaving } = useProjectConfig(projectId)
  const [open, setOpen] = useState(false)

  // Local form state
  const [supervisorPrompt, setSupervisorPrompt] = useState('')
  const [agentPrompts, setAgentPrompts] = useState<Record<string, string>>({})
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)

  // Sync local state when config loads or sheet opens
  useEffect(() => {
    if (!open) return
    setSupervisorPrompt(config?.supervisorPrompt ?? '')
    setAgentPrompts(config?.agentPrompts ?? {})
    setActiveTools(config?.activeTools ?? TOOL_REGISTRY.map((t) => t.key))
    setDirty(false)
  }, [config, open])

  const handleSave = () => {
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
          activeTools.length === TOOL_REGISTRY.length ? null : activeTools,
        toolParams: config?.toolParams ?? null,
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
        ) : (
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
                placeholder={DEFAULT_SUPERVISOR_PROMPT}
                rows={8}
                className="text-sm font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to use default prompt.
              </p>
            </div>

            {/* Agent Prompts */}
            {AGENT_REGISTRY.map((agent) => (
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

            {/* Tool Toggles */}
            <div className="space-y-2">
              <Label>Tools</Label>
              <div className="space-y-3">
                {TOOL_REGISTRY.map((tool) => (
                  <div key={tool.key} className="flex items-start gap-3">
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
        )}
      </SheetContent>
    </Sheet>
  )
}
