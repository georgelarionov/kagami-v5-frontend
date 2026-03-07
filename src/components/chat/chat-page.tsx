'use client'

import { useMemo } from 'react'
import { useChatRun } from '@/hooks/use-chat-run'
import { useChatMessages } from '@/hooks/use-chat-messages'
import { MessageList } from './message-list'
import type { Message } from '@/types/chat'
import { Composer } from './composer'
import { RunStatus } from './run-status'

interface ChatPageProps {
  chatId: string
}

export function ChatPage({ chatId }: ChatPageProps) {
  const { sendMessage, retry, status, error, isRunning, pendingMessage } = useChatRun(chatId)
  const { data: messages = [], isLoading } = useChatMessages(chatId)

  const allMessages: Message[] = useMemo(() => {
    const base = [...messages]
    if (pendingMessage && isRunning) {
      base.push({
        id: 'pending',
        role: 'user',
        content: pendingMessage,
      })
    }
    return base
  }, [messages, pendingMessage, isRunning])

  return (
    <div className="grid grid-rows-[1fr_auto] h-screen">
      <div className="min-h-0">
        <MessageList messages={allMessages} isLoading={isLoading} />
      </div>
      <div>
        <RunStatus status={status} error={error} onRetry={status === 'failed' ? retry : undefined} />
        <Composer onSend={sendMessage} disabled={isRunning} />
      </div>
    </div>
  )
}
