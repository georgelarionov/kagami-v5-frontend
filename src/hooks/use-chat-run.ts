'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

type RunStatus = 'idle' | 'running' | 'success' | 'failed'

function getPollingInterval(elapsedMs: number): number {
  if (elapsedMs < 5000) return 500
  if (elapsedMs < 15000) return 2000
  return 4000
}

export function useChatRun(chatId: string) {
  const [runId, setRunId] = useState<string | null>(null)
  const [status, setStatus] = useState<RunStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const queryClient = useQueryClient()

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const pollRun = useCallback(
    async (currentRunId: string) => {
      try {
        const res = await fetch(`/api/chat/runs/${currentRunId}?chatId=${chatId}`)
        if (!res.ok) throw new Error('Poll failed')
        const data = await res.json()

        if (data.status === 'success') {
          setStatus('success')
          stopPolling()
          queryClient.invalidateQueries({ queryKey: ['memory', 'messages', chatId] })
          return
        }

        // All terminal non-success statuses: failed, tripwire, canceled, bailed, suspended
        if (data.status && data.status !== 'running' && data.status !== 'waiting' && data.status !== 'pending' && data.status !== 'paused') {
          setStatus('failed')
          const errMsg =
            typeof data.error === 'string'
              ? data.error
              : data.error?.message || `Run ${data.status}`
          setError(errMsg)
          stopPolling()
          return
        }

        // Still running — schedule next poll
        const elapsed = Date.now() - startTimeRef.current
        const interval = getPollingInterval(elapsed)
        timerRef.current = setTimeout(() => pollRun(currentRunId), interval)
      } catch {
        // Network error — retry with backoff
        const elapsed = Date.now() - startTimeRef.current
        const interval = Math.min(getPollingInterval(elapsed) * 2, 8000)
        timerRef.current = setTimeout(() => pollRun(currentRunId), interval)
      }
    },
    [chatId, stopPolling, queryClient],
  )

  const startPolling = useCallback(
    (id: string) => {
      setRunId(id)
      setStatus('running')
      setError(null)
      startTimeRef.current = Date.now()
      pollRun(id)
    },
    [pollRun],
  )

  const sendMessage = useCallback(
    async (message: string) => {
      setError(null)
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, chatId }),
        })

        if (res.status === 409) {
          setError('Agent is still working')
          return
        }

        if (!res.ok) throw new Error('Failed to send')

        const { runId: newRunId } = await res.json()
        startPolling(newRunId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send message')
      }
    },
    [chatId, startPolling],
  )

  // On mount: check for active run
  useEffect(() => {
    async function checkActiveRun() {
      try {
        const res = await fetch(`/api/chat/active-run?chatId=${chatId}`)
        if (!res.ok) return
        const { activeRun } = await res.json()
        if (activeRun) {
          startPolling(activeRun.runId)
        }
      } catch {
        // No active run
      }
    }
    checkActiveRun()
    return stopPolling
  }, [chatId, startPolling, stopPolling])

  return {
    sendMessage,
    status,
    error,
    runId,
    isRunning: status === 'running',
  }
}
