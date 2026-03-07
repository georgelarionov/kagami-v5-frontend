import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

async function seed() {
  const sql = neon(process.env.DATABASE_URL_DIRECT!)
  const db = drizzle({ client: sql, schema })

  // Replace with your actual Clerk userId after first sign-in
  const userId = process.env.SEED_USER_ID || 'user_placeholder'

  const [project] = await db.insert(schema.projects).values({
    userId,
    name: 'Default Project',
  }).returning()

  const [chat] = await db.insert(schema.chats).values({
    projectId: project.id,
    title: 'General',
  }).returning()

  console.log('Project:', project.id)
  console.log('Chat:', chat.id)
  console.log('Set these in .env.local:')
  console.log(`NEXT_PUBLIC_PROJECT_ID=${project.id}`)
  console.log(`NEXT_PUBLIC_CHAT_ID=${chat.id}`)
}

seed().catch(console.error)
