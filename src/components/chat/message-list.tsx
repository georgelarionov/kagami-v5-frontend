'use client'

import { ScrollArea } from '@/components/ui/scroll-area'
import { useEffect, useRef } from 'react'

export interface Message {
  id: string
  role: string
  content: unknown
}

interface MessageListProps {
  messages: Message[]
  isLoading: boolean
}

function extractText(parts: unknown[]): string {
  return parts
    .filter((p): p is { type: string; text: string } =>
      !!p && typeof p === 'object' && 'type' in p && (p as { type: string }).type === 'text' && 'text' in p,
    )
    .map((p) => p.text)
    .join('\n')
}

function renderContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = extractText(content)
    if (text) return text
  }
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>
    // Mastra format: { format: 2, parts: [{ type: "text", text: "..." }] }
    if (Array.isArray(obj.parts)) {
      const text = extractText(obj.parts)
      if (text) return text
    }
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.content === 'string') return obj.content
  }
  return content ? JSON.stringify(content) : ''
}

export function MessageList({ messages, isLoading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (isLoading && messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (!isLoading && messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground/50">
        Send a message to start
      </div>
    )
  }

  return (
    <ScrollArea className="h-full p-4">
      <div className="space-y-4 max-w-2xl mx-auto">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 whitespace-pre-wrap break-words overflow-hidden ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              }`}
            >
              {renderContent(msg.content)}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
