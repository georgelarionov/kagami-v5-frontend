import { ChatClient } from '@/components/chat/chat-client'

export default function Home() {
  const chatId = process.env.NEXT_PUBLIC_CHAT_ID!
  const projectId = process.env.NEXT_PUBLIC_PROJECT_ID!

  return <ChatClient chatId={chatId} projectId={projectId} />
}
