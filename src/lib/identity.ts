import 'server-only'

import { db } from '@/db'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { IDENTITY_PATH } from './identity-path'
import { ownedByUser } from './ownership'
import { requireUser } from './session'

export { IDENTITY_PATH } from './identity-path'

/**
 * The signed-in user's identity, or null before they have set one up. Each
 * user owns at most one (UNIQUE accounts.user_id); oldest first only matters
 * on a database that predates that rule. Requires a signed-in user: without
 * one this redirects to sign-in. Cached for the rest of the request.
 */
export const getIdentity = cache(async () => {
  const user = await requireUser()
  const identity = await db.query.accountsTable.findFirst({
    where: ownedByUser(user.id),
    orderBy: (accounts, { asc }) => [asc(accounts.createdAt)]
  })
  return identity ?? null
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

/** The user's identity, or a redirect to set one up. For pages. */
export async function requireIdentity(): Promise<Identity> {
  const identity = await getIdentity()
  if (!identity) redirect(IDENTITY_PATH)
  return identity
}

/** The user's identity id, for actions and API routes; throws without one. */
export async function requireIdentityId(): Promise<string> {
  const identity = await getIdentity()
  if (!identity) throw new Error('Set up your identity first.')
  return identity.id
}
