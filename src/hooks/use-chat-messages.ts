'use client'

import { useQuery, keepPreviousData } from '@tanstack/react-query'

export function useChatMessages(chatId: string) {
  return useQuery({
    queryKey: ['memory', 'messages', chatId],
    queryFn: async () => {
      const res = await fetch(`/api/chat/messages?chatId=${chatId}`)
      if (!res.ok) throw new Error('Failed to fetch messages')
      const { messages } = await res.json()
      return messages
    },
    placeholderData: keepPreviousData,
  })
}
