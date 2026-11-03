'use server'

import { requireIdentityId } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { INBOX_PATH } from '@/lib/inbox-path'
import { requireUser } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { runInboxSync } from '~/jobs/mail-sync'
import { runsJobsHere } from '~/jobs/role'
import { chooseInboundAddress } from '~/lib/mail/addresses'
import { normalizeLocalPart } from '~/lib/mail/local-part'
import { readMailSyncStatus, requestMailSync } from '~/lib/mail/mailbox'
import { inboundMailConfig } from '~/lib/mail/settings'
import { loadInboxMessage } from './inbox-data'

const NOT_SET_UP = 'The inbox is not set up on this server.'

/**
 * "Change" next to the address: makes the name typed (`marketing`, or all of
 * `marketing@<domain>`) the identity's address. The old one keeps delivering.
 */
export async function changeInboxAddress(input: string) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const config = inboundMailConfig()
    if (!config) return { success: false as const, error: NOT_SET_UP }
    const localPart = normalizeLocalPart(
      typeof input === 'string' ? input : '',
      config.domain
    )
    const error = await chooseInboundAddress(accountId, localPart)
    if (error) return { success: false as const, error }
    revalidatePath(INBOX_PATH)
    return {
      success: true as const,
      address: `${localPart}@${config.domain}`
    }
  } catch (err) {
    console.error('Changing the inbox address failed:', err)
    return { success: false as const, error: 'Could not change the address.' }
  }
}

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
