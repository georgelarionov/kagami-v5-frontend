import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Raw fetch: mastraClient has no method for custom apiRoutes endpoints
    const res = await fetch(
      `${process.env.MASTRA_API_URL || 'http://localhost:4111'}/registry`
    )
    if (!res.ok) throw new Error(`Registry fetch failed: ${res.status}`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('[registry] Failed to fetch registry:', error)
    return NextResponse.json({ error: 'Failed to fetch registry' }, { status: 502 })
  }
}
