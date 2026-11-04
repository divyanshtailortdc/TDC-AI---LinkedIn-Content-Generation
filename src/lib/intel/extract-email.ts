import 'server-only'

import { db } from '@/db'
import {
  intelArticlesTable,
  intelMentionsTable,
  mailMessagesTable
} from '@/db/schema'
import { and, desc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm'
import { digestEmail } from '../ai/skills/newsletter-digest'
import { mapConcurrently } from '../research/web-search'
import { readEmailContent } from './email-content'
import { canonicalArticleUrl, isArticleUrl } from './links'
import { resolveLink } from './resolve-link'
import { EXTRACTION_SETTINGS, retryAt, RetryLaterError } from './settings'

/**
 * Extraction, step 1: one received email → what kind it is, a summary, and
 * its stories (intel_mentions), each with the article its link leads to
 * (intel_articles, read in step 2 by read-article.ts).
 *
 * The email row is the queue item. A pass claims it with a conditional
 * update (`extraction_locked_at` is the claim's token), so two processes
 * never extract the same email; a claim older than claimTtlMs belongs to a
 * process that died and is taken over. Everything is stored in one
 * transaction that still holds the claim, replacing what an earlier attempt
 * stored, so a retry never duplicates stories.
 */

const messages = mailMessagesTable
const articles = intelArticlesTable
const mentions = intelMentionsTable

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

type ClaimedEmail = {
  id: string
  accountId: string
  fromName: string | null
  fromAddress: string | null
  subject: string | null
  htmlBody: string | null
  textBody: string | null
  attempts: number
  claimedAt: Date
}

/** The newest due email, claimed for this pass, or null when none is due. */
async function claimNextEmail(): Promise<ClaimedEmail | null> {
  const now = new Date()
  const stale = new Date(now.getTime() - EXTRACTION_SETTINGS.claimTtlMs)
  const due = db
    .select({ id: messages.id })
    .from(messages)
    .where(
      or(
        and(
          eq(messages.extractionStatus, 'pending'),
          lte(messages.extractionNextAt, now)
        ),
        and(
          eq(messages.extractionStatus, 'processing'),
          lt(messages.extractionLockedAt, stale)
        )
      )
    )
    .orderBy(desc(messages.receivedAt))
    .limit(1)
    .for('update', { skipLocked: true })
  const [row] = await db
    .update(messages)
    .set({
      extractionStatus: 'processing',
      extractionLockedAt: now,
      extractionAttempts: sql`${messages.extractionAttempts} + 1`
    })
    .where(inArray(messages.id, due))
    .returning({
      id: messages.id,
      accountId: messages.accountId,
      fromName: messages.fromName,
      fromAddress: messages.fromAddress,
      subject: messages.subject,
      htmlBody: messages.htmlBody,
      textBody: messages.textBody,
      attempts: messages.extractionAttempts
    })
  return row ? { ...row, claimedAt: now } : null
}

/** Only while this pass still holds the email's claim. */
const holdsClaim = (email: ClaimedEmail) =>
  and(
    eq(messages.id, email.id),
    eq(messages.extractionLockedAt, email.claimedAt)
  )

/**
 * Where a story's link leads: the article's address when it is a readable
 * page, otherwise the address alone, or the link when it cannot be followed.
 * Followed without its reader parameters: some are sign-in tokens, which
 * must not be sent (or used up) from here. Click trackers keep their target
 * in the path, so they still redirect.
 */
async function followLink(raw: string) {
  const written = canonicalArticleUrl(raw) ?? raw
  const landed = await resolveLink(written)
  if (!landed) return { url: written, article: false }
  const url = canonicalArticleUrl(landed) ?? landed
  return { url, article: isArticleUrl(url) }
}

/** The article ids for these addresses, adding the new ones as pending. */
async function articleIdsFor(tx: Tx, urls: string[]) {
  const unique = [...new Set(urls)]
  if (unique.length === 0) return new Map<string, string>()
  await tx
    .insert(articles)
    .values(unique.map(canonicalUrl => ({ canonicalUrl })))
    .onConflictDoNothing({ target: articles.canonicalUrl })
  const rows = await tx
    .select({
      id: articles.id,
      canonicalUrl: articles.canonicalUrl,
      duplicateOfId: articles.duplicateOfId
    })
    .from(articles)
    .where(inArray(articles.canonicalUrl, unique))
  return new Map(
    rows.map(row => [row.canonicalUrl, row.duplicateOfId ?? row.id])
  )
}

async function extract(email: ClaimedEmail) {
  const content = readEmailContent({
    html: email.htmlBody,
    text: email.textBody
  })
  const digest = await digestEmail({
    from:
      [email.fromName, email.fromAddress && `<${email.fromAddress}>`]
        .filter(Boolean)
        .join(' ') || 'unknown sender',
    subject: email.subject ?? '(no subject)',
    content
  })

  const linkUrls = new Map(content.links.map(link => [link.n, link.url]))
  const targets = await mapConcurrently(
    digest.items,
    EXTRACTION_SETTINGS.resolveConcurrency,
    async item => {
      const link = item.link === null ? undefined : linkUrls.get(item.link)
      return link ? followLink(link) : null
    }
  )

  await db.transaction(async tx => {
    const [held] = await tx
      .update(messages)
      .set({
        extractionStatus: 'done',
        extractionLockedAt: null,
        extractionError: null,
        extractedAt: new Date(),
        digestKind: digest.kind,
        digestSummary: digest.summary || null,
        digestTopics: digest.topics
      })
      .where(holdsClaim(email))
      .returning({ id: messages.id })
    // Another pass took the email over; it stores its own result.
    if (!held) return

    await tx.delete(mentions).where(eq(mentions.messageId, email.id))
    if (digest.items.length === 0) return
    const articleIds = await articleIdsFor(
      tx,
      targets.flatMap(target => (target?.article ? [target.url] : []))
    )
    await tx.insert(mentions).values(
      digest.items.map((item, position) => {
        const target = targets[position]
        return {
          messageId: email.id,
          accountId: email.accountId,
          position,
          headline: item.headline,
          blurb: item.blurb,
          url: target?.url ?? null,
          articleId: target?.article
            ? (articleIds.get(target.url) ?? null)
            : null,
          isSponsored: item.sponsored
        }
      })
    )
  })
}

/** Back to pending with back-off, or failed after the last attempt. */
async function recordFailure(email: ClaimedEmail, err: unknown) {
  const retryable = err instanceof RetryLaterError
  if (!retryable) console.error(`Extracting email ${email.id} failed:`, err)
  const giveUp = email.attempts >= EXTRACTION_SETTINGS.maxAttempts
  await db
    .update(messages)
    .set({
      extractionStatus: giveUp ? 'failed' : 'pending',
      extractionNextAt: giveUp ? undefined : retryAt(email.attempts),
      extractionLockedAt: null,
      extractionError: retryable
        ? 'The AI model was busy or timed out.'
        : 'Something went wrong while reading this email.'
    })
    .where(holdsClaim(email))
}

/** Extracts the newest due email. False when none was due. */
export async function extractNextEmail(): Promise<boolean> {
  const email = await claimNextEmail()
  if (!email) return false
  try {
    await extract(email)
  } catch (err) {
    await recordFailure(email, err).catch(error =>
      console.error('Recording an extraction failure failed:', error)
    )
  }
  return true
}

/**
 * "Try again" on an email whose extraction failed: due at once, with its
 * attempts reset. Only the workspace's own email; false when there is no
 * such failed email.
 */
export async function retryEmailExtraction(
  accountId: string,
  messageId: string
): Promise<boolean> {
  const rows = await db
    .update(messages)
    .set({
      extractionStatus: 'pending',
      extractionAttempts: 0,
      extractionNextAt: new Date(),
      extractionError: null
    })
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.accountId, accountId),
        eq(messages.extractionStatus, 'failed')
      )
    )
    .returning({ id: messages.id })
  return rows.length > 0
}
