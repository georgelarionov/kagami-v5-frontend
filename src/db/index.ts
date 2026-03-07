import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

type Db = ReturnType<typeof drizzle<typeof schema>>

let _db: Db | null = null

export function getDb(): Db {
  if (!_db) {
    const sql = neon(process.env.DATABASE_URL!)
    _db = drizzle({ client: sql, schema })
  }
  return _db
}
