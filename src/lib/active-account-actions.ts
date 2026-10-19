'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { writeActiveAccountCookie } from './active-account'
import { isUuid } from './ids'

export async function setActiveAccount(accountId: string) {
  if (!isUuid(accountId)) {
    return { success: false, error: 'Identity not found' }
  }

  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, accountId)
  })

  if (!account) {
    return { success: false, error: 'Identity not found' }
  }

  // A deactivated identity can be selected too: it shows as deactivated, with
  // Activate, and only starting runs is refused for it.
  await writeActiveAccountCookie(accountId)

  // Every account-scoped page reads the cookie server-side, so they all need
  // to re-render once it changes.
  revalidatePath('/', 'layout')

  return { success: true }
}
