import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { chats, projects } from '@/db/schema'
import { mastraClient } from '@/lib/mastra'
import { eq, and } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  // Verify user owns the project
  const [chat] = await db
    .select({ id: chats.id, lastRunId: chats.lastRunId, pendingMessage: chats.pendingMessage })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))
  if (!chat?.lastRunId) {
    return NextResponse.json({ activeRun: null })
  }

  try {
    const workflow = mastraClient.getWorkflow('chat-workflow')
    const result = await workflow.runById(chat.lastRunId)

    if (result?.status === 'running' || result?.status === 'waiting') {
      return NextResponse.json({
        activeRun: { runId: chat.lastRunId, status: result.status, pendingMessage: chat.pendingMessage },
      })
    }

    // Run finished — clear pending state
    if (chat.pendingMessage) {
      await db.update(chats).set({ pendingMessage: null }).where(eq(chats.id, chatId))
    }

    return NextResponse.json({ activeRun: null })
  } catch {
    return NextResponse.json({ activeRun: null })
  }
}
