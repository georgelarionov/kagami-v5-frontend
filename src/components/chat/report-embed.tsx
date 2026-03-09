'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, XCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { C1Component, ThemeProvider } from '@thesysai/genui-sdk'
import type { ReportMarker } from '@/lib/parse-report-markers'

interface ReportEmbedProps {
  marker: ReportMarker
}

export function ReportEmbed({ marker }: ReportEmbedProps) {
  const [c1Content, setC1Content] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchKey, setFetchKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(`/api/reports/${marker.id}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load report (${res.status})`)
        return res.json()
      })
      .then((data) => setC1Content(data.c1Content))
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message)
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [marker.id, fetchKey])

  const handleRetry = useCallback(() => setFetchKey((k) => k + 1), [])

  if (loading) {
    return (
      <div className="my-3 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Loading report...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="my-3 flex items-center gap-2 text-red-500">
        <XCircle className="size-4" />
        <span className="text-sm">{error}</span>
        <Button variant="ghost" size="sm" className="h-auto px-2 py-1 text-red-500" onClick={handleRetry}>
          <RotateCcw className="size-3 mr-1" />
          Retry
        </Button>
      </div>
    )
  }

  if (!c1Content) return null

  return (
    <div className="my-3">
      <ThemeProvider>
        <C1Component c1Response={c1Content} isStreaming={false} />
      </ThemeProvider>
    </div>
  )
}
