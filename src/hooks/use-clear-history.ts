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
