import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { chats, projects } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  // Verify user owns the project
  const [chat] = await getDb()
    .select({ id: chats.id, pendingMessage: chats.pendingMessage })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))

  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  // In streaming mode, pendingMessage is the sole indicator of an interrupted operation
  if (chat.pendingMessage) {
    return NextResponse.json({
      activeRun: { pendingMessage: chat.pendingMessage },
    })
  }

  return NextResponse.json({ activeRun: null })
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  const [chat] = await getDb()
    .select({ id: chats.id })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))

  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  await getDb().update(chats).set({ pendingMessage: null }).where(eq(chats.id, chatId))
  return NextResponse.json({ cleared: true })
}
