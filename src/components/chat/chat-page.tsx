'use client'

import { useCallback, useRef, useState } from 'react'
import { useChatStream } from '@/hooks/use-chat-stream'
import { MessageList } from './message-list'
import { Composer } from './composer'
import { RunStatus } from './run-status'
import type { UIMessage } from 'ai'

interface ChatPageProps {
  chatId: string
  projectId: string
  initialMessages?: UIMessage[]
  pendingMessage?: string | null
}

export function ChatPage({ chatId, projectId, initialMessages, pendingMessage: initialPendingMessage }: ChatPageProps) {
  const { messages, sendMessage, status, stop, error } = useChatStream({
    chatId,
    projectId,
    initialMessages,
  })

  const [pendingMessage, setPendingMessage] = useState(initialPendingMessage ?? null)
  const lastSentRef = useRef<string | null>(null)

  const handleSend = useCallback((params: { text: string }) => {
    lastSentRef.current = params.text
    sendMessage(params)
  }, [sendMessage])

  const handleRetry = useCallback(() => {
    const textToRetry = pendingMessage || lastSentRef.current
    if (textToRetry) {
      lastSentRef.current = textToRetry
      sendMessage({ text: textToRetry })
      setPendingMessage(null)
    }
  }, [pendingMessage, sendMessage])

  const showPendingRetry = pendingMessage && status === 'ready' && messages.length > 0

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <MessageList messages={messages} />
      </div>
      <div>
        {showPendingRetry && (
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
            <span>Previous message was interrupted.</span>
            <button onClick={handleRetry} className="underline hover:no-underline text-foreground">
              Retry
            </button>
          </div>
        )}
        <RunStatus
          status={status}
          error={error}
          onRetry={status === 'error' ? handleRetry : undefined}
        />
        <Composer onSend={handleSend} onStop={stop} status={status} />
      </div>
    </div>
  )
}
