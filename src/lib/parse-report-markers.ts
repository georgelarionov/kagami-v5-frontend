export interface ReportMarker {
  id: string
  title: string
}

export interface TextSegment {
  type: 'text'
  content: string
}

export interface ReportSegment {
  type: 'report'
  marker: ReportMarker
}

export type MessageSegment = TextSegment | ReportSegment

const REPORT_MARKER_RE = /:::report\{id="([^"]+)"\s*title="([^"]+)"\}:::/g

export function parseReportMarkers(text: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  let lastIndex = 0

  for (const match of text.matchAll(REPORT_MARKER_RE)) {
    const before = text.slice(lastIndex, match.index)
    if (before) segments.push({ type: 'text', content: before })

    segments.push({
      type: 'report',
      marker: { id: match[1], title: match[2] },
    })

    lastIndex = match.index + match[0].length
  }

  const after = text.slice(lastIndex)
  if (after) segments.push({ type: 'text', content: after })

  return segments
}
