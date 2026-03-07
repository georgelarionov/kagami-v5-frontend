import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { mastraClient } from '@/lib/mastra'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = req.nextUrl.searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })

  try {
    const thread = mastraClient.getMemoryThread(chatId, 'kagamiAgent')
    const result = await thread.getMessages()
    return NextResponse.json({ messages: result.uiMessages })
  } catch {
    return NextResponse.json({ messages: [] })
  }
}
