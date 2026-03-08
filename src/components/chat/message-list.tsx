'use client'

import { useEffect, useRef } from 'react'
import { Message, MessageContent } from '@/components/ui/message'
import type { UIMessage } from 'ai'

interface MessageListProps {
  messages: UIMessage[]
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 h-full items-center justify-center text-muted-foreground/50">
        Send a message to start
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4 max-w-2xl mx-auto">
      {messages.map((msg) => {
        if (msg.role === 'user') {
          const text = msg.parts
            ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map((p) => p.text)
            .join('') ?? ''

          return (
            <Message key={msg.id} className="justify-end">
              <MessageContent className="bg-primary text-primary-foreground max-w-[80%]">
                {text}
              </MessageContent>
            </Message>
          )
        }

        return (
          <Message key={msg.id} className="justify-start">
            <div className="max-w-[85%]">
              <MessageContent
                markdown
                id={msg.id}
                className="bg-transparent dark:prose-invert"
              >
                {msg.parts
                  ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                  .map((p) => p.text)
                  .join('') ?? ''}
              </MessageContent>
            </div>
          </Message>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
