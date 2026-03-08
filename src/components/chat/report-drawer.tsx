'use client'

import { useState, useEffect } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Loader2, XCircle } from 'lucide-react'
import { C1Component, ThemeProvider } from '@thesysai/genui-sdk'

interface ReportDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reportId: string | null
  title: string
}

export function ReportDrawer({ open, onOpenChange, reportId, title }: ReportDrawerProps) {
  const [c1Content, setC1Content] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !reportId) return

    setLoading(true)
    setError(null)
    setC1Content(null)

    fetch(`/api/reports/${reportId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load report (${res.status})`)
        return res.json()
      })
      .then((data) => setC1Content(data.c1Content))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [open, reportId])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[80vw] overflow-y-auto data-[side=right]:sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">Interactive report</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">Loading report...</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-red-500">
              <XCircle className="size-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}
          {c1Content && (
            <ThemeProvider>
              <C1Component c1Response={c1Content} isStreaming={false} />
            </ThemeProvider>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
