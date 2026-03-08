'use client'

import { useMemo } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { UIMessage, ChatStatus } from 'ai'

export type { ChatStatus }

interface UseChatStreamOptions {
  chatId: string
  projectId: string
  initialMessages?: UIMessage[]
}

export function useChatStream({ chatId, projectId, initialMessages }: UseChatStreamOptions) {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { chatId, projectId } }),
    [chatId, projectId]
  )

  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
  })

  return { messages, sendMessage, status, stop, error, setMessages }
}
