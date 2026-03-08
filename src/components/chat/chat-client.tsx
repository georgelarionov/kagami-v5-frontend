'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toAISdkV5Messages } from '@mastra/ai-sdk/ui'
import type { UIMessage } from 'ai'
import { ChatPage } from './chat-page'
import { Loader } from '@/components/ui/loader'
import { useChatMessages } from '@/hooks/use-chat-messages'

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
  const { messages: rawMessages, isLoading, hasMore, fetchOlderMessages, isFetchingOlder, loadOlderError } = useChatMessages(chatId)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [pendingChecked, setPendingChecked] = useState(false)

  const uiMessages = useMemo(
    () => !isLoading ? (toAISdkV5Messages(rawMessages) as UIMessage[]) : [],
    [isLoading, rawMessages]
  )

  // Wrap fetchOlderMessages to return converted UIMessage[] for prepending
  const loadOlderAsUIMessages = useCallback(async (): Promise<UIMessage[]> => {
    const result = await fetchOlderMessages()
    if (result.data) {
      // pages: [page0 (newest), page1, page2 (oldest)...]
      // page 0 is already in initialMessages, take only older pages
      const olderPages = result.data.pages.slice(1)
      const olderMessages = [...olderPages].reverse().flatMap(p => p.messages)
      if (olderMessages.length > 0) {
        return toAISdkV5Messages(olderMessages) as UIMessage[]
      }
    }
    return []
  }, [fetchOlderMessages])

  // Check for active run (pending message) on mount
  useEffect(() => {
    async function checkActiveRun() {
      try {
        const res = await fetch(`/api/chat/active-run?chatId=${chatId}`)
        if (res.ok) {
          const data = await res.json()
          const pending = data.activeRun?.pendingMessage ?? null
          setPendingMessage(pending)
        }
      } catch {
        // ignore
      } finally {
        setPendingChecked(true)
      }
    }
    checkActiveRun()
  }, [chatId])

  // Clear stale pending message once both messages and pending are loaded
  useEffect(() => {
    if (isLoading || !pendingChecked || !pendingMessage) return
    if (uiMessages.length > 0 && isPendingMessageAnswered(uiMessages, pendingMessage)) {
      fetch(`/api/chat/active-run?chatId=${chatId}`, { method: 'DELETE' }).catch(() => {})
      setPendingMessage(null)
    }
  }, [isLoading, pendingChecked, pendingMessage, uiMessages, chatId])

  if (isLoading || !pendingChecked) {
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
      initialMessages={uiMessages}
      pendingMessage={pendingMessage}
      hasMore={hasMore}
      onLoadOlder={loadOlderAsUIMessages}
      isFetchingOlder={isFetchingOlder}
      loadOlderError={loadOlderError}
    />
  )
}
