'use server'

import { db } from '@/db'
import { newslettersTable } from '@/db/schema'
import { SkillError } from '@/lib/ai/run-skill'
import { getIdentity, requireIdentityId } from '@/lib/identity'
import { idSchema } from '@/lib/ids'
import {
  discoverNewsletters,
  NewsletterDiscoveryError,
  type DiscoverySummary
} from '@/lib/newsletters/discovery'
import {
  NEWSLETTER_ACTIONS,
  statusAfter,
  statusesAllowing,
  type NewsletterAction,
  type NewsletterStatus
} from '@/lib/newsletters/status'
import { requireUser } from '@/lib/session'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const NEWSLETTERS_PATH = '/newsletters'

const NewsletterIdSchema = idSchema('Newsletter not found')
const NewsletterActionSchema = z.enum(NEWSLETTER_ACTIONS)

type ActionResult<T = object> =
  ({ success: true } & T) | { success: false; error: string }

/**
 * Finds newsletters for the signed-in user's identity and saves them. The
 * user waits on this (a minute or so); see maxDuration on the page.
 */
export async function discoverNewslettersAction(): Promise<
  ActionResult<{ summary: DiscoverySummary }>
> {
  const user = await requireUser()
  try {
    const identity = await getIdentity()
    if (!identity) {
      return { success: false, error: 'Set up your identity first.' }
    }
    const summary = await discoverNewsletters({
      accountId: identity.id,
      userId: user.id
    })
    revalidatePath(NEWSLETTERS_PATH)
    return { success: true, summary }
  } catch (error) {
    if (error instanceof NewsletterDiscoveryError) {
      return { success: false, error: error.message }
    }
    if (error instanceof SkillError) {
      const messages: Record<SkillError['reason'], string> = {
        not_configured:
          'AI is not configured. Set ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to discover newsletters.',
        quota_exceeded:
          'The AI budget has been reached. Please try again later.',
        timeout: 'Discovery took too long. Please try again.',
        failed: 'Discovery could not finish. Please try again.'
      }
      if (error.reason !== 'not_configured') {
        console.error('Newsletter discovery failed:', error)
      }
      return { success: false, error: messages[error.reason] }
    }
    console.error('Newsletter discovery failed:', error)
    return {
      success: false,
      error: 'Discovery could not finish. Please try again.'
    }
  }
}

/**
 * Save, or record what the user did on the publisher's page. The status only
 * changes from the statuses the action allows (src/lib/newsletters/status.ts),
 * checked in the same UPDATE so two clicks cannot race past it.
 */
export async function updateNewsletterStatusAction(
  rawNewsletterId: string,
  rawAction: NewsletterAction
): Promise<ActionResult<{ status: NewsletterStatus }>> {
  await requireUser()
  try {
    const newsletterId = NewsletterIdSchema.parse(rawNewsletterId)
    const action = NewsletterActionSchema.parse(rawAction)
    const accountId = await requireIdentityId()

    const [updated] = await db
      .update(newslettersTable)
      .set({
        status: statusAfter(action),
        statusChangedAt: new Date(),
        updatedAt: new Date()
      })
      .where(
        and(
          eq(newslettersTable.id, newsletterId),
          eq(newslettersTable.accountId, accountId),
          inArray(newslettersTable.status, [...statusesAllowing(action)])
        )
      )
      .returning({ status: newslettersTable.status })
    if (updated) {
      revalidatePath(NEWSLETTERS_PATH)
      return { success: true, status: updated.status }
    }

    const exists = await db.query.newslettersTable.findFirst({
      columns: { id: true },
      where: and(
        eq(newslettersTable.id, newsletterId),
        eq(newslettersTable.accountId, accountId)
      )
    })
    return {
      success: false,
      error: exists
        ? 'That does not apply to this newsletter any more. Refresh the page.'
        : 'Newsletter not found'
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Newsletter not found' }
    }
    console.error('Updating newsletter status failed:', error)
    return { success: false, error: 'Could not update the newsletter.' }
  }
}

/** Notes that the signup page was opened. The status does not change. */
export async function recordSignupOpenedAction(
  rawNewsletterId: string
): Promise<ActionResult> {
  await requireUser()
  try {
    const newsletterId = NewsletterIdSchema.parse(rawNewsletterId)
    const accountId = await requireIdentityId()
    const [row] = await db
      .update(newslettersTable)
      .set({ signupOpenedAt: new Date() })
      .where(
        and(
          eq(newslettersTable.id, newsletterId),
          eq(newslettersTable.accountId, accountId)
        )
      )
      .returning({ id: newslettersTable.id })
    return row
      ? { success: true }
      : { success: false, error: 'Newsletter not found' }
  } catch {
    return { success: false, error: 'Newsletter not found' }
  }
}
