import 'server-only'

import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { InactiveAccountError } from './account-guard'
import { isUuid } from './ids'

export const ACTIVE_ACCOUNT_COOKIE = 'activeAccountId'

export interface ActiveAccount {
  id: string
  name: string
  handle: string
  headline: string
  avatarUrl: string | null
  accountType: string
  /** The identity's status. A deactivated identity stays selected; it just can't start runs. */
  isActive: boolean
}

/**
 * The single source of truth for "which identity am I working on right now".
 * Every page/action that reads or writes account-scoped data should resolve
 * this server-side rather than trust an accountId passed in from the client.
 *
 * The identity in the cookie is kept whatever its status: deactivating the
 * selected identity leaves it selected, and only picking another one in the
 * switcher changes the selection. Falls back only when the cookie is missing,
 * malformed or points at no account, so a stale cookie never renders an empty
 * app (or, unchecked, a Postgres error on every page).
 */
export async function getActiveAccount(): Promise<ActiveAccount | null> {
  const selected = await findCookieAccount()
  if (selected) return pick(selected)
  const fallback = await findFallbackAccount()
  return fallback ? pick(fallback) : null
}

/**
 * Writes the identity being shown into the cookie when it is only there as
 * the fallback. Call before changing an identity's status: deactivating the
 * fallback identity would otherwise move the fallback to another one,
 * switching identities without the user picking one.
 */
export async function pinActiveAccount() {
  if (await findCookieAccount()) return
  const fallback = await findFallbackAccount()
  if (fallback) await writeActiveAccountCookie(fallback.id)
}

async function findCookieAccount() {
  const cookieStore = await cookies()
  const cookieId = cookieStore.get(ACTIVE_ACCOUNT_COOKIE)?.value
  // A malformed cookie is treated as no cookie.
  if (!isUuid(cookieId)) return undefined
  return db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, cookieId)
  })
}

/** The oldest active identity, or the oldest of all when none is active. */
function findFallbackAccount() {
  return db.query.accountsTable.findFirst({
    orderBy: (accounts, { asc, desc }) => [desc(accounts.isActive), asc(accounts.createdAt)]
  })
}

/**
 * Makes `accountId` the active identity. Cookies can only be written from a
 * Server Action or Route Handler, so only call this from one of those.
 */
export async function writeActiveAccountCookie(accountId: string) {
  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_ACCOUNT_COOKIE, accountId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365
  })
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
    throw new Error('No identity selected. Add an identity first.')
  }
  return id
}

/**
 * requireActiveAccountId for actions that change the selected identity's data
 * (approve, reject, edit, generate): refused while that identity is deactivated.
 */
export async function requireWritableActiveAccountId(): Promise<string> {
  const account = await getActiveAccount()
  if (!account) {
    throw new Error('No identity selected. Add an identity first.')
  }
  if (!account.isActive) throw new InactiveAccountError()
  return account.id
}

function pick(account: typeof accountsTable.$inferSelect): ActiveAccount {
  return {
    id: account.id,
    name: account.name,
    handle: account.handle,
    headline: account.headline,
    avatarUrl: account.avatarUrl,
    accountType: account.accountType,
    isActive: account.isActive
  }
}

