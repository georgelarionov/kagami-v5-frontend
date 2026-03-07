import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { chats, projects } from '@/db/schema'
import { mastraClient } from '@/lib/mastra'
import { eq, and } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let message: string, chatId: string
  try {
    ({ message, chatId } = await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!message || typeof message !== 'string' || !chatId) {
    return NextResponse.json({ error: 'Missing message or chatId' }, { status: 400 })
  }

  // Get chat + verify user owns the project
  const [chat] = await db
    .select({ id: chats.id, lastRunId: chats.lastRunId, projectId: chats.projectId })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  // Check for active run
  if (chat.lastRunId) {
    const workflow = mastraClient.getWorkflow('chat-workflow')
    try {
      const existing = await workflow.runById(chat.lastRunId)
      const isActive = existing?.status === 'running' || existing?.status === 'waiting' || existing?.status === 'pending' || existing?.status === 'paused'
      if (isActive) {
        return NextResponse.json({ error: 'Active run exists' }, { status: 409 })
      }
    } catch {
      // Run not found or error — safe to proceed
    }
  }

  const projectId = chat.projectId
  const resourceId = `${userId}:${projectId}`
  const threadId = chatId

  // Create run
  const workflow = mastraClient.getWorkflow('chat-workflow')
  const run = await workflow.createRun({ resourceId })

  // Save-before-start: save runId + pending message
  await db.update(chats).set({ lastRunId: run.runId, pendingMessage: message }).where(eq(chats.id, chatId))

  // Start run (fire-and-forget — resolves once start request is sent)
  try {
    await run.start({
      inputData: { message, threadId, resourceId },
    })
  } catch {
    // Start failed — clean up
    await db.update(chats).set({ lastRunId: null, pendingMessage: null }).where(eq(chats.id, chatId))
    return NextResponse.json({ error: 'Failed to start run' }, { status: 500 })
  }

  return NextResponse.json({ runId: run.runId })
}
