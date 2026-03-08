'use client'

import { Loader } from '@/components/ui/loader'
import type { ChatStatus } from '@/hooks/use-chat-stream'

interface RunStatusProps {
  status: ChatStatus
  error: Error | undefined
  onRetry?: () => void
}

export function RunStatus({ status, error, onRetry }: RunStatusProps) {
  if (status === 'error' && error) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-destructive">
        <span>{error.message || 'Something went wrong'}</span>
        {onRetry && (
          <button onClick={onRetry} className="underline hover:no-underline">
            Retry
          </button>
        )}
      </div>
    )
  }

  if (status === 'submitted') {
    return (
      <div className="px-4 py-2">
        <Loader variant="text-shimmer" text="Thinking..." size="sm" />
      </div>
    )
  }

  if (status === 'streaming') {
    return (
      <div className="px-4 py-2">
        <Loader variant="dots" size="sm" />
      </div>
    )
  }

  return null
}
