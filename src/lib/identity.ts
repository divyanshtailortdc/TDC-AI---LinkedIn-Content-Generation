import 'server-only'

import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import {
  ACTIVE_IDENTITY_COOKIE,
  ACTIVE_IDENTITY_MAX_AGE
} from './active-identity'
import { IDENTITY_PATH } from './identity-path'
import { ownedByUser } from './ownership'
import { isUuid } from './ids'
import { requireUser } from './session'

export { IDENTITY_PATH } from './identity-path'

/**
 * A user can own several identities (a professional one and a separate
 * persona, say). Every page and action works on one at a time, the active
 * identity: the one named by the active-identity cookie when it is still the
 * user's, else the user's oldest. Switching sets the cookie
 * (switchIdentity); nothing else depends on which identity is active.
 */

/** The user's identities, oldest first, as the switcher lists them. */
export const listIdentities = cache(async () => {
  const user = await requireUser()
  return db
    .select({
      id: accountsTable.id,
      name: accountsTable.name,
      handle: accountsTable.handle,
      accountType: accountsTable.accountType,
      avatarUrl: accountsTable.avatarUrl
    })
    .from(accountsTable)
    .where(ownedByUser(user.id))
    .orderBy(asc(accountsTable.createdAt))
})

export type IdentityListItem = Awaited<ReturnType<typeof listIdentities>>[number]

/**
 * The signed-in user's active identity, or null before they have set one up.
 * Requires a signed-in user: without one this redirects to sign-in. Cached
 * for the rest of the request.
 */
export const getIdentity = cache(async () => {
  const user = await requireUser()
  const chosen = (await cookies()).get(ACTIVE_IDENTITY_COOKIE)?.value
  if (isUuid(chosen)) {
    const active = await db.query.accountsTable.findFirst({
      where: and(eq(accountsTable.id, chosen), ownedByUser(user.id))
    })
    if (active) return active
  }
  // No choice yet, or the chosen identity was deleted or is someone else's.
  const oldest = await db.query.accountsTable.findFirst({
    where: ownedByUser(user.id),
    orderBy: (accounts, { asc }) => [asc(accounts.createdAt)]
  })
  return oldest ?? null
})

export type Identity = NonNullable<Awaited<ReturnType<typeof getIdentity>>>

/** What client components show of the identity; pass this, not the whole row. */
export type IdentitySummary = Pick<Identity, 'id' | 'name' | 'handle'>

export function toIdentitySummary({
  id,
  name,
  handle
}: Identity): IdentitySummary {
  return { id, name, handle }
}

/** The active identity, or a redirect to set one up. For pages. */
export async function requireIdentity(): Promise<Identity> {
  const identity = await getIdentity()
  if (!identity) redirect(IDENTITY_PATH)
  return identity
}

/** The active identity's id, for actions and API routes; throws without one. */
export async function requireIdentityId(): Promise<string> {
  const identity = await getIdentity()
  if (!identity) throw new Error('Set up your identity first.')
  return identity.id
}

/**
 * Makes `accountId` the active identity for this browser. Only from a server
 * action or route handler, after checking the user owns it.
 */
export async function setActiveIdentity(accountId: string) {
  ;(await cookies()).set(ACTIVE_IDENTITY_COOKIE, accountId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ACTIVE_IDENTITY_MAX_AGE,
    path: '/'
  })
}
