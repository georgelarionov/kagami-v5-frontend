'use client'

import { useState, useEffect } from 'react'
import { Loader2, XCircle } from 'lucide-react'
import { C1Component, ThemeProvider } from '@thesysai/genui-sdk'
import type { ReportMarker } from '@/lib/parse-report-markers'

interface ReportEmbedProps {
  marker: ReportMarker
}

export function ReportEmbed({ marker }: ReportEmbedProps) {
  const [c1Content, setC1Content] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/reports/${marker.id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load report (${res.status})`)
        return res.json()
      })
      .then((data) => setC1Content(data.c1Content))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [marker.id])

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
