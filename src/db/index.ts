import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (!_db) {
    const sql = neon(process.env.DATABASE_URL!)
    _db = drizzle({ client: sql, schema })
  }
  return _db
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop]
  },
})
