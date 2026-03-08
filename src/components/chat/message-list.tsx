'use client'

import { useCallback, useEffect, useRef } from 'react'
import { Message, MessageContent } from '@/components/ui/message'
import { Button } from '@/components/ui/button'
import { Loader2, ChevronUp } from 'lucide-react'
import type { UIMessage } from 'ai'

interface MessageListProps {
  messages: UIMessage[]
  hasMore: boolean
  isFetchingOlder: boolean
  isStreaming: boolean
  loadOlderError: Error | null
  onLoadOlder: () => Promise<void>
}

export function MessageList({
  messages,
  hasMore,
  isFetchingOlder,
  isStreaming,
  loadOlderError,
  onLoadOlder,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isPrependingRef = useRef(false)

  useEffect(() => {
    if (isPrependingRef.current) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Scroll preservation: measure before prepend, restore after
  const handleLoadOlder = useCallback(async () => {
    const container = containerRef.current?.parentElement
    const scrollHeightBefore = container?.scrollHeight ?? 0
    isPrependingRef.current = true

    await onLoadOlder()

    requestAnimationFrame(() => {
      if (container) {
        const scrollHeightAfter = container.scrollHeight
        container.scrollTop += scrollHeightAfter - scrollHeightBefore
      }
      isPrependingRef.current = false
    })
  }, [onLoadOlder])

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 h-full items-center justify-center text-muted-foreground/50">
        Send a message to start
      </div>
    )
  }

  return (
    <div ref={containerRef} className="space-y-4 p-4 max-w-2xl mx-auto">
      {hasMore && (
        <div className="flex justify-center py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLoadOlder}
            disabled={isFetchingOlder || isStreaming}
          >
            {isFetchingOlder ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <ChevronUp className="size-4 mr-2" />
            )}
            {loadOlderError ? 'Retry' : 'Load older'}
          </Button>
        </div>
      )}
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
