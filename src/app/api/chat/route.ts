import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { chats, projects } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { mastraClient } from '@/lib/mastra'
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai'
import { toAISdkStream } from '@mastra/ai-sdk'
import type { ChunkType, MastraModelOutput } from '@mastra/core/stream'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let messages: UIMessage[]
  let chatId: string
  let projectId: string | undefined
  try {
    const body = await req.json()
    messages = body.messages
    chatId = body.chatId
    projectId = body.projectId
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!messages || !Array.isArray(messages) || messages.length === 0 || !chatId) {
    return NextResponse.json({ error: 'Missing messages or chatId' }, { status: 400 })
  }

  // Get chat + verify user owns the project
  const [chat] = await getDb()
    .select({ id: chats.id, projectId: chats.projectId, pendingMessage: chats.pendingMessage })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, chatId), eq(projects.userId, userId)))
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  // Concurrency guard — reject if another stream is active
  if (chat.pendingMessage) {
    return NextResponse.json({ error: 'Another message is being processed' }, { status: 409 })
  }

  // Extract last user message text from UIMessage parts
  const lastUserMessage = messages[messages.length - 1]
  const userText = lastUserMessage.parts
    ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('') ?? ''

  if (!userText.trim()) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  }

  const resolvedProjectId = projectId || chat.projectId
  const resourceId = `${userId}:${resolvedProjectId}`

  // Save pendingMessage before starting stream
  await getDb().update(chats).set({ pendingMessage: userText }).where(eq(chats.id, chatId))

  // Stream from Mastra — TODO(F6): add X-Project-Id header to MastraClient
  const agent = mastraClient.getAgent('kagami-supervisor')

  let response: Awaited<ReturnType<typeof agent.stream>>
  try {
    response = await agent.stream(userText, {
      memory: { thread: chatId, resource: resourceId },
    })
  } catch {
    await getDb().update(chats).set({ pendingMessage: null }).where(eq(chats.id, chatId))
    return NextResponse.json({ error: 'Failed to start stream' }, { status: 500 })
  }

  // Convert Mastra stream → AI SDK stream
  const chunkStream = new ReadableStream<ChunkType>({
    async start(controller) {
      try {
        await response.processDataStream({
          onChunk: async (chunk) => controller.enqueue(chunk),
        })
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  const uiMessageStream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      for await (const part of toAISdkStream(
        chunkStream as unknown as MastraModelOutput,
        { from: 'agent' }
      )) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await writer.write(part as any)
      }
    },
    onFinish: async () => {
      await getDb().update(chats).set({ pendingMessage: null }).where(eq(chats.id, chatId))
    },
    onError: (error) => {
      getDb().update(chats).set({ pendingMessage: null }).where(eq(chats.id, chatId))
        .catch((err) => console.error('Failed to clear pendingMessage on error:', err))
      return error instanceof Error ? error.message : 'Stream failed'
    },
  })

  return createUIMessageStreamResponse({ stream: uiMessageStream })
}
