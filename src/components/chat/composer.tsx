'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ComposerProps {
  onSend: (message: string) => void
  disabled: boolean
}

export function Composer({ onSend, disabled }: ComposerProps) {
  const [input, setInput] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || disabled) return
    onSend(input.trim())
    setInput('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t border-border/40">
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type a message..."
        disabled={disabled}
        className="flex-1"
        autoFocus
      />
      <Button type="submit" disabled={disabled || !input.trim()}>
        Send
      </Button>
    </form>
  )
}
