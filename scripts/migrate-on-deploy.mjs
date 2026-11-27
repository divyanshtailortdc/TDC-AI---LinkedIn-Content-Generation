// Applies pending database migrations (src/db/migrations) before a Vercel
// production build, so new code never goes live against a database that is
// missing its tables. Runs only when VERCEL_ENV is "production"; everywhere
// else (local builds, Preview deployments, the Dockerfile) it does nothing.
//
// A failure here fails the build, which leaves the previous deployment live.
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const MIGRATIONS_FOLDER = './src/db/migrations'
// Any fixed number: keeps two production builds from migrating at once.
const LOCK_KEY = 7_204_311_906

if (process.env.VERCEL_ENV !== 'production') {
  console.log(`[migrate] skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'})`)
  process.exit(0)
}

// Neon's direct (unpooled) URL when the integration provides it: migrations
// run DDL in one transaction, which is safest without PgBouncer in between.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error('[migrate] DATABASE_URL is not set for Production')
  process.exit(1)
}

// One connection, so the advisory lock and the migrations share a session.
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} })

async function appliedCount() {
  const [{ exists }] = await client`
    select to_regclass('drizzle.__drizzle_migrations') is not null as exists`
  if (!exists) return null
  const [{ count }] = await client`select count(*)::int as count from drizzle.__drizzle_migrations`
  return count
}

try {
  await client`select pg_advisory_lock(${LOCK_KEY})`

  const before = await appliedCount()
  if (!before) {
    // No migration history. If the app's tables are already there, the
    // database was made with `drizzle-kit push`, and migrating would start at
    // 0000 and fail on "already exists". Stop with a clear message instead.
    const [{ exists }] = await client`
      select to_regclass('public.accounts') is not null as exists`
    if (exists) {
      console.error(
        '[migrate] the database has tables but no drizzle migration history, ' +
          'so it cannot tell which migrations are applied. Record a baseline in ' +
          'drizzle.__drizzle_migrations (or apply the missing .sql files by hand), ' +
          'then redeploy.'
      )
      process.exitCode = 1
    }
  }

  if (process.exitCode !== 1) {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER })
    const after = await appliedCount()
    console.log(`[migrate] applied ${(after ?? 0) - (before ?? 0)} (total ${after ?? 0})`)
  }
} catch (error) {
  console.error('[migrate] failed:', error)
  process.exitCode = 1
} finally {
  await client.end({ timeout: 5 })
}
