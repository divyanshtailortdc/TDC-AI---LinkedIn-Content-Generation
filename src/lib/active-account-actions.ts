'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { ACTIVE_ACCOUNT_COOKIE } from './active-account'

export async function setActiveAccount(accountId: string) {
  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, accountId)
  })

  if (!account) {
    return { success: false, error: 'Identity not found' }
  }

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_ACCOUNT_COOKIE, accountId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365
  })

  // Every account-scoped page reads the cookie server-side, so they all need
  // to re-render once it changes.
  revalidatePath('/', 'layout')

  return { success: true }
}
