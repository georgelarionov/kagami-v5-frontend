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
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}
