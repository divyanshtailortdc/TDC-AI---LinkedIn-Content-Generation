import 'server-only'

import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { isUuid } from './ids'

/**
 * The account id from an /accounts/[id] URL, checked before any query uses it.
 * A malformed id is a 404 rather than a Postgres error. One typed in capitals
 * redirects to the lowercase form Postgres returns, which the setup steps and
 * every link compare against.
 *
 * `path` is the page's path under /accounts/[id], kept by that redirect.
 */
export function accountIdOr404(id: string, path: string): string {
  if (!isUuid(id)) notFound()
  const canonical = id.toLowerCase()
  if (canonical !== id) redirect(`/accounts/${canonical}${path}`)
  return id
}

/** The account with this id, or a 404 for a malformed or unknown id. */
export async function getAccountOr404(id: string) {
  if (!isUuid(id)) notFound()
  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, id)
  })
  if (!account) notFound()
  return account
}
