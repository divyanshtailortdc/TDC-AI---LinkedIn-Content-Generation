'use server'

import { requireIdentityId } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { requireUser } from '@/lib/session'
import { after } from 'next/server'
import { runInboxSync } from '~/jobs/mail-sync'
import { runsJobsHere } from '~/jobs/role'
import { readMailSyncStatus, requestMailSync } from '~/lib/mail/mailbox'
import { inboundMailConfig } from '~/lib/mail/settings'
import { loadInboxMessage } from './inbox-data'

const NOT_SET_UP = 'The inbox is not set up on this server.'

/** One email in full, for the reading pane. Only the user's own identity's. */
export async function getInboxMessage(messageId: string) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    // Missing and foreign ids get the same answer.
    const message = isUuid(messageId)
      ? await loadInboxMessage(accountId, messageId)
      : null
    if (!message) return { success: false as const, error: 'Email not found.' }
    return { success: true as const, message }
  } catch (err) {
    console.error('Loading an inbox email failed:', err)
    return { success: false as const, error: 'Could not load this email.' }
  }
}

/**
 * "Refresh": asks for a sync of the mailbox and, where this process runs
 * jobs, starts it after the response. One pass at a time (the sync lease),
 * so pressing it again while one runs does nothing extra.
 */
export async function refreshInbox() {
  await requireUser()
  try {
    await requireIdentityId()
    const config = inboundMailConfig()
    if (!config) return { success: false as const, error: NOT_SET_UP }
    await requestMailSync(config.user)
    if (runsJobsHere()) after(runInboxSync)
    return { success: true as const }
  } catch (err) {
    console.error('Requesting an inbox sync failed:', err)
    return { success: false as const, error: 'Could not start syncing.' }
  }
}

/** Where the mailbox sync stands, for the inbox's polling. */
export async function getInboxSyncStatus() {
  await requireUser()
  try {
    const config = inboundMailConfig()
    if (!config) return { success: false as const, error: NOT_SET_UP }
    return {
      success: true as const,
      status: await readMailSyncStatus(config.user)
    }
  } catch (err) {
    console.error('Reading the inbox sync status failed:', err)
    return { success: false as const, error: 'Could not check the sync.' }
  }
}
