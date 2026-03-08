import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

const MASTRA_API_URL = process.env.MASTRA_API_URL || 'http://localhost:4111'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid report ID' }, { status: 400 })
  }

  try {
    const res = await fetch(`${MASTRA_API_URL}/reports/${id}`)
    if (!res.ok) {
      return NextResponse.json({ error: 'Report not found' }, { status: res.status })
    }

    const report = await res.json()

    // Ownership check: resourceId must be ${userId}:${projectId}
    if (!report.resourceId || !report.resourceId.startsWith(userId + ':')) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    return NextResponse.json(report)
  } catch (error) {
    console.error('[reports] Failed to fetch report:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
