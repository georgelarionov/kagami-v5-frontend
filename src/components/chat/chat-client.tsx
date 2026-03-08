'use client'

import { useEffect, useState } from 'react'
import { toAISdkV5Messages } from '@mastra/ai-sdk/ui'
import type { UIMessage } from 'ai'
import { ChatPage } from './chat-page'
import { Loader } from '@/components/ui/loader'

interface ChatClientProps {
  chatId: string
  projectId: string
}

// Check if the pending message already has an assistant response in memory.
// Scans forward from the matching user message to handle potential
// intermediate messages (e.g. tool calls in future F3).
function isPendingMessageAnswered(messages: UIMessage[], pendingText: string): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') {
      const text = msg.parts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('') ?? ''
      if (text === pendingText) {
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j].role === 'assistant') return true
        }
        return false
      }
      break
    }
  }
  return false
}

export function ChatClient({ chatId, projectId }: ChatClientProps) {
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | undefined>(undefined)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadMessages() {
      try {
        const [messagesRes, activeRunRes] = await Promise.all([
          fetch(`/api/chat/messages?chatId=${chatId}`),
          fetch(`/api/chat/active-run?chatId=${chatId}`),
        ])

        let uiMessages: UIMessage[] = []
        if (messagesRes.ok) {
          const { messages } = await messagesRes.json()
          uiMessages = toAISdkV5Messages(messages) as UIMessage[]
          setInitialMessages(uiMessages)
        } else {
          setInitialMessages([])
        }

        let pending: string | null = null
        if (activeRunRes.ok) {
          const data = await activeRunRes.json()
          pending = data.activeRun?.pendingMessage ?? null
        }

        // If pendingMessage exists but memory already has the answer — clear it
        if (pending && uiMessages.length > 0 && isPendingMessageAnswered(uiMessages, pending)) {
          fetch(`/api/chat/active-run?chatId=${chatId}`, { method: 'DELETE' }).catch(() => {})
          pending = null
        }

        setPendingMessage(pending)
      } catch {
        setInitialMessages([])
      } finally {
        setIsLoading(false)
      }
    }
    loadMessages()
  }, [chatId])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader variant="dots" size="md" />
      </div>
    )
  }

  return (
    <ChatPage
      chatId={chatId}
      projectId={projectId}
      initialMessages={initialMessages}
      pendingMessage={pendingMessage}
    />
  )
}
