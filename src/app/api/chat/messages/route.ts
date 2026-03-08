import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { chats, projects } from '@/db/schema'
import { mastraClient } from '@/lib/mastra'
import { eq, and } from 'drizzle-orm'

export async function DELETE(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  // Verify user owns the project + check for active run
  const [chat] = await getDb()
    .select({ id: chats.id, pendingMessage: chats.pendingMessage })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  if (chat.pendingMessage) {
    return NextResponse.json(
      { error: 'Cannot clear history while a message is being processed' },
      { status: 409 },
    )
  }

  try {
    // Raw fetch: client-js thread.deleteMessages() requires listing IDs first;
    // REST API supports clearAll in one call
    const res = await fetch(
      `${process.env.MASTRA_API_URL || 'http://localhost:4111'}/memory/deleteMessages`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: chatId, clearAll: true }),
      },
    )
    if (!res.ok) throw new Error(`deleteMessages failed: ${res.status}`)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[chat/messages] Failed to delete messages:', error)
    return NextResponse.json({ error: 'Failed to clear history' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  const page = Math.max(0, parseInt(req.nextUrl.searchParams.get('page') ?? '0') || 0)
  const perPage = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('perPage') ?? '50') || 50))

  // Verify user owns the project
  const [chat] = await getDb()
    .select({ id: chats.id })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  try {
    const thread = mastraClient.getMemoryThread({ threadId: chatId, agentId: 'kagami-supervisor' })
    const result = await thread.listMessages({
      page,
      perPage,
      orderBy: { field: 'createdAt', direction: 'DESC' },
    })
    // Reverse to chronological order (ASC) for client rendering
    const messages = [...result.messages].reverse()
    // Defensive: client-js type lacks hasMore, compute from result length
    const hasMore = result.messages.length === perPage
    return NextResponse.json({ messages, hasMore })
  } catch {
    return NextResponse.json({ messages: [], hasMore: false })
  }
}
