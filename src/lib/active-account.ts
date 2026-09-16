import 'server-only'

import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { accountsTable } from '@/db/schema'

export const ACTIVE_ACCOUNT_COOKIE = 'activeAccountId'

export interface ActiveAccount {
  id: string
  name: string
  handle: string
  headline: string
  avatarUrl: string | null
  accountType: string
}

/**
 * The single source of truth for "which identity am I working on right now".
 * Every page/action that reads or writes account-scoped data should resolve
 * this server-side rather than trust an accountId passed in from the client.
 *
 * Falls back to the first active account if the cookie is missing or points
 * at an account that no longer exists/was deactivated, so a stale cookie
 * never silently renders an empty app.
 */
export async function getActiveAccount(): Promise<ActiveAccount | null> {
  const cookieStore = await cookies()
  const cookieId = cookieStore.get(ACTIVE_ACCOUNT_COOKIE)?.value

  if (cookieId) {
    const account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, cookieId)
    })
    if (account && account.isActive) {
      return pick(account)
    }
  }

  const fallback = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.isActive, true),
    orderBy: (accounts, { asc }) => [asc(accounts.createdAt)]
  })

  return fallback ? pick(fallback) : null
}

/** Convenience for call sites that only need the id and already handle the "no accounts yet" case. */
export async function getActiveAccountId(): Promise<string | null> {
  const account = await getActiveAccount()
  return account?.id ?? null
}

/**
 * Same as getActiveAccountId but throws — for actions that mutate account-scoped
 * data and have no sensible behavior with no active account.
 */
export async function requireActiveAccountId(): Promise<string> {
  const id = await getActiveAccountId()
  if (!id) {
    throw new Error('No active identity selected. Add or activate an identity first.')
  }
  return id
}

function pick(account: typeof accountsTable.$inferSelect): ActiveAccount {
  return {
    id: account.id,
    name: account.name,
    handle: account.handle,
    headline: account.headline,
    avatarUrl: account.avatarUrl,
    accountType: account.accountType
  }
}

