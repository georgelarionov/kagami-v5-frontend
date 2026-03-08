'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from '@/components/ui/prompt-input'
import { ArrowUp, Square } from 'lucide-react'
import type { ChatStatus } from '@/hooks/use-chat-stream'

interface ComposerProps {
  onSend: (params: { text: string }) => void
  onStop: () => void
  status: ChatStatus
}

export function Composer({ onSend, onStop, status }: ComposerProps) {
  const [input, setInput] = useState('')

  const isActive = status === 'submitted' || status === 'streaming'
  const canSend = status === 'ready' && input.trim().length > 0

  const handleSubmit = () => {
    if (!canSend) return
    onSend({ text: input.trim() })
    setInput('')
  }

  return (
    <div className="p-4 border-t border-border/40">
      <PromptInput
        value={input}
        onValueChange={setInput}
        isLoading={isActive}
        onSubmit={handleSubmit}
        disabled={isActive}
      >
        <PromptInputTextarea placeholder="Ask me anything..." />
        <PromptInputActions className="justify-end pt-2">
          {isActive ? (
            <PromptInputAction tooltip="Stop">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={onStop}
              >
                <Square className="size-4 fill-current" />
              </Button>
            </PromptInputAction>
          ) : (
            <PromptInputAction tooltip="Send">
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={handleSubmit}
                disabled={!canSend}
              >
                <ArrowUp className="size-5" />
              </Button>
            </PromptInputAction>
          )}
        </PromptInputActions>
      </PromptInput>
    </div>
  )
}
