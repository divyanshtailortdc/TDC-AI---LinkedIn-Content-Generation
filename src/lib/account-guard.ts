import 'server-only'

import { db } from '@/db'
import { accountsTable, runsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { isUuid } from './ids'
import { INACTIVE_ACCOUNT_MESSAGE } from './inactive-account'

/**
 * A deactivated identity is read-only: its data can be viewed, and the
 * identity selected and activated again, but nothing about it changes and
 * nothing is generated for it. Every action that would change an identity's
 * data checks the identity that owns that data here first; the pages disable
 * the same controls, so this is what holds when a page is stale.
 */
export class InactiveAccountError extends Error {
  constructor() {
    super(INACTIVE_ACCOUNT_MESSAGE)
    this.name = 'InactiveAccountError'
  }
}

/** True when the identity exists and is deactivated. An unknown id is left to the caller's own not-found handling. */
export async function isAccountInactive(accountId: string): Promise<boolean> {
  if (!isUuid(accountId)) return false
  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, accountId),
    columns: { isActive: true }
  })
  return account ? !account.isActive : false
}

/** Throws InactiveAccountError when the identity is deactivated. */
export async function assertAccountActive(accountId: string) {
  if (await isAccountInactive(accountId)) throw new InactiveAccountError()
}

/** assertAccountActive for the identity a run belongs to. */
export async function assertRunAccountActive(runId: string) {
  if (!isUuid(runId)) return
  const run = await db.query.runsTable.findFirst({
    where: eq(runsTable.id, runId),
    columns: { accountId: true }
  })
  if (run) await assertAccountActive(run.accountId)
}
