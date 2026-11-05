'use server'

import { requireIdentityId } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { INBOX_PATH } from '@/lib/inbox-path'
import { KNOWLEDGE_PATH } from '@/lib/knowledge-path'
import { requireUser } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { runMailExtraction } from '~/jobs/mail-extraction'
import { runInboxSync } from '~/jobs/mail-sync'
import { runsJobsHere } from '~/jobs/role'
import {
  retryEmailExtraction,
  setSenderUnsubscribed
} from '~/lib/intel/extract-email'
import { chooseInboundAddress } from '~/lib/mail/addresses'
import { normalizeLocalPart } from '~/lib/mail/local-part'
import { readMailSyncStatus, requestMailSync } from '~/lib/mail/mailbox'
import { inboxConfig } from '~/lib/mail/settings'
import { loadInboxInsights, loadInboxMessage } from './inbox-data'

const NOT_SET_UP = 'The inbox is not set up on this server.'

/**
 * "Change" next to the address: makes the name typed (`marketing`, or all of
 * `marketing@<domain>`) the identity's address. The old one keeps delivering.
 */
export async function changeInboxAddress(input: string) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const config = inboxConfig()
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
 * jobs, starts it after the response, then extracts what arrived. One pass
 * at a time (the sync lease), so pressing it again while one runs does
 * nothing extra. Without IMAP there is nothing to pull: webhook mail is
 * stored as it arrives, so only its extraction runs.
 */
export async function refreshInbox() {
  await requireUser()
  try {
    await requireIdentityId()
    const config = inboxConfig()
    if (!config) return { success: false as const, error: NOT_SET_UP }
    if (!config.imap) {
      if (runsJobsHere()) after(runMailExtraction)
      return { success: true as const }
    }
    await requestMailSync(config.imap.user)
    if (runsJobsHere()) after(() => runInboxSync().then(runMailExtraction))
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
    const config = inboxConfig()
    if (!config) return { success: false as const, error: NOT_SET_UP }
    return {
      success: true as const,
      status: await readMailSyncStatus(config.statusMailbox)
    }
  } catch (err) {
    console.error('Reading the inbox sync status failed:', err)
    return { success: false as const, error: 'Could not check the sync.' }
  }
}

/**
 * The stories and links extracted from one email, for the reading pane,
 * which polls this while extraction runs. Only the user's own identity's.
 */
export async function getInboxInsights(messageId: string) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const insights = isUuid(messageId)
      ? await loadInboxInsights(accountId, messageId)
      : null
    if (!insights) return { success: false as const, error: 'Email not found.' }
    return { success: true as const, insights }
  } catch (err) {
    console.error("Loading an email's extraction failed:", err)
    return {
      success: false as const,
      error: 'Could not load what was found in this email.'
    }
  }
}

/** "Try again" after an email's extraction failed: due at once. */
export async function retryInboxInsights(messageId: string) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const retried =
      isUuid(messageId) && (await retryEmailExtraction(accountId, messageId))
    if (!retried) {
      return { success: false as const, error: 'There is nothing to retry.' }
    }
    if (runsJobsHere()) after(runMailExtraction)
    return { success: true as const }
  } catch (err) {
    console.error("Retrying an email's extraction failed:", err)
    return { success: false as const, error: 'Could not try again.' }
  }
}

/**
 * "I unsubscribed from this sender" on an email, or Undo
 * (setSenderUnsubscribed). Undo reads the emails skipped meanwhile.
 */
export async function setInboxSenderUnsubscribed(
  messageId: string,
  unsubscribed: boolean
) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const changed =
      isUuid(messageId) &&
      (await setSenderUnsubscribed(accountId, messageId, unsubscribed))
    if (!changed) {
      return { success: false as const, error: 'This email has no sender.' }
    }
    if (!unsubscribed && runsJobsHere()) after(runMailExtraction)
    revalidatePath(KNOWLEDGE_PATH)
    return { success: true as const }
  } catch (err) {
    console.error('Changing a sender subscription failed:', err)
    return { success: false as const, error: 'Could not save that.' }
  }
}
