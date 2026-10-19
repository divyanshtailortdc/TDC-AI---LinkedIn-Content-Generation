import 'server-only'

import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { adminUserIds, auth, type SessionUser } from './auth'
import { isAdminUser } from './roles'
import { LOGIN_PATH } from './safe-redirect'

/**
 * Who is signed in, checked against the database (not just the cookie).
 * Cached for the rest of the request, so the layout, the page and the helpers
 * they call share one lookup.
 */
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() })
)

/** The signed-in user, or null. For API routes, which answer 401 themselves. */
export async function getSessionUser(): Promise<SessionUser | null> {
  return (await getSession())?.user ?? null
}

/**
 * The signed-in user, or a redirect to the sign-in page. For pages, layouts
 * and Server Actions.
 *
 * The redirect is thrown, so in a Server Action call this before any
 * try/catch: caught, it would come back as an error message instead.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)
  return user
}

/**
 * The signed-in user when they are an admin. Anyone else gets a 404, so
 * admin-only pages and actions do not reveal that they exist.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (!isAdminUser(user, adminUserIds)) notFound()
  return user
}
