import 'server-only'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '~/env'
import * as relations from './relations'
import * as schema from './schema'

// Singleton connection to prevent exhausting connections during Next.js fast refresh
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined
}

const client =
  globalForDb.conn ??
  postgres(env.DATABASE_URL, {
    max: env.APP_ENV === 'production' ? 20 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false
  })

if (env.APP_ENV !== 'production') {
  globalForDb.conn = client
}

export const db = drizzle(client, {
  schema: { ...schema, ...relations }
})

export { relations, schema }
