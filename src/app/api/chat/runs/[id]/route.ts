import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { chats, projects } from '@/db/schema'
import { mastraClient } from '@/lib/mastra'
import { parseSnapshot } from '@/lib/workflow-utils'
import { eq, and } from 'drizzle-orm'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: runId } = await params
  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  // Verify user owns project AND run belongs to this chat
  const [chat] = await db
    .select({ id: chats.id, lastRunId: chats.lastRunId })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))
  if (!chat || chat.lastRunId !== runId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const workflow = mastraClient.getWorkflow('chat-workflow')
    const result = await workflow.runById(runId)
    const snapshot = parseSnapshot(result?.snapshot)
    const status = snapshot.status
    const error = status === 'failed' ? snapshot.error : undefined

    return NextResponse.json({ runId, status, error })
  } catch {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
}
