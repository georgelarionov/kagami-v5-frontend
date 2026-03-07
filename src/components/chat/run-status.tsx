'use client'

interface RunStatusProps {
  status: string
  error: string | null
  onRetry?: () => void
}

export function RunStatus({ status, error, onRetry }: RunStatusProps) {
  if (error) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-destructive">
        <span>{error}</span>
        {onRetry && (
          <button onClick={onRetry} className="underline hover:no-underline">
            Retry
          </button>
        )}
      </div>
    )
  }

  if (status === 'running') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
        <span className="inline-flex gap-0.5">
          <span className="animate-bounce [animation-delay:0ms]">.</span>
          <span className="animate-bounce [animation-delay:150ms]">.</span>
          <span className="animate-bounce [animation-delay:300ms]">.</span>
        </span>
        Thinking
      </div>
    )
  }

  return null
}
