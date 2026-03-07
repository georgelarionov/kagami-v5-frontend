import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { mastraClient } from '@/lib/mastra'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  try {
    const thread = mastraClient.getMemoryThread({ threadId: chatId, agentId: 'kagamiAgent' })
    const result = await thread.listMessages()
    return NextResponse.json({ messages: result.messages })
  } catch {
    return NextResponse.json({ messages: [] })
  }
}
