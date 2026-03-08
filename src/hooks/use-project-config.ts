'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface ProjectConfigData {
  supervisorPrompt: string | null
  agentPrompts: Record<string, string> | null
  activeTools: string[] | null
  toolParams: Record<string, Record<string, unknown>> | null
  updatedAt: string | null
}

export function useProjectConfig(projectId: string) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['project-config', projectId],
    queryFn: async (): Promise<{ config: ProjectConfigData | null }> => {
      const res = await fetch(`/api/project/config?projectId=${projectId}`)
      if (!res.ok) throw new Error('Failed to fetch config')
      return res.json()
    },
  })

  const mutation = useMutation({
    mutationFn: async (data: Omit<ProjectConfigData, 'updatedAt'> & { projectId: string }) => {
      const res = await fetch('/api/project/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to save config')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-config', projectId] })
    },
  })

  return {
    config: query.data?.config ?? null,
    isLoading: query.isLoading,
    error: query.error,
    saveConfig: mutation.mutate,
    isSaving: mutation.isPending,
    saveError: mutation.error,
  }
}
