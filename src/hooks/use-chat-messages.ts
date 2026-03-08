'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import type { MastraDBMessage } from '@mastra/core/agent/message-list'

interface MessagesPage {
  messages: MastraDBMessage[]
  hasMore: boolean
}

export function useChatMessages(chatId: string) {
  const query = useInfiniteQuery({
    queryKey: ['memory', 'messages', chatId],
    queryFn: async ({ pageParam = 0 }): Promise<MessagesPage> => {
      const res = await fetch(
        `/api/chat/messages?chatId=${chatId}&page=${pageParam}&perPage=50`
      )
      if (!res.ok) throw new Error('Failed to fetch messages')
      return res.json()
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.messages.length === 0) return undefined
      return lastPage.hasMore ? allPages.length : undefined
    },
  })

  // Flatten all pages in chronological order
  // Pages are stored as [page0 (newest), page1 (older), page2 (oldest)...]
  // Reverse pages so oldest come first, then flatMap messages
  const messages = query.data
    ? [...query.data.pages].reverse().flatMap((page) => page.messages)
    : []

  return {
    messages,
    isLoading: query.isLoading,
    hasMore: query.hasNextPage ?? false,
    fetchOlderMessages: query.fetchNextPage,
    isFetchingOlder: query.isFetchingNextPage,
    loadOlderError: query.error,
  }
}
