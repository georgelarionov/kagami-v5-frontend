import { ChatPage } from '@/components/chat/chat-page'

export default function Home() {
  const chatId = process.env.NEXT_PUBLIC_CHAT_ID!

  return <ChatPage chatId={chatId} />
}
