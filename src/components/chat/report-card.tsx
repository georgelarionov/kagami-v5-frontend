'use client'

import { Button } from '@/components/ui/button'
import { FileText } from 'lucide-react'
import type { ReportMarker } from '@/lib/parse-report-markers'

interface ReportCardProps {
  marker: ReportMarker
  onViewReport: (marker: ReportMarker) => void
}

export function ReportCard({ marker, onViewReport }: ReportCardProps) {
  return (
    <div className="my-3 flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <FileText className="size-5 text-green-600 dark:text-green-400" />
        <div>
          <p className="text-sm font-medium">{marker.title}</p>
          <p className="text-xs text-muted-foreground">Interactive report</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => onViewReport(marker)}>
        View Report
      </Button>
    </div>
  )
}
