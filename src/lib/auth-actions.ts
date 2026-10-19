'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from './auth'
import { LOGIN_PATH } from './safe-redirect'

/**
 * Signs out on the server, so the session row is deleted (not just the
 * cookie), then returns to sign-in.
 * Sign-out needs no signed-in check: with no session there is nothing to end.
 */
export async function signOutAction() {
  try {
    // nextCookies() in auth.ts makes this clear the session cookies too.
    await auth.api.signOut({ headers: await headers() })
  } catch (error) {
    // An already-expired session is fine: there is nothing left to end.
    console.warn('Sign-out did not find a session to end:', error)
  }
  redirect(LOGIN_PATH)
}
