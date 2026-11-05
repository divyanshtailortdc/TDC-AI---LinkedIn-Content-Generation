import 'server-only'

import { db } from '@/db'
import {
  intelArticlesTable,
  intelMentionsTable,
  mailMessagesTable
} from '@/db/schema'
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql
} from 'drizzle-orm'
import { RESEARCH_SETTINGS } from '../ai/context-blocks'
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
 *
 * An issue sent again (a correction, a resend, the issue at a second
 * address) is a new version of it: see reconcileVersions.
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
  receivedAt: Date
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
      receivedAt: messages.receivedAt,
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
    // Held until the stories are stored: an article turning into a duplicate
    // meanwhile waits, then hands these stories to its original as well.
    .for('share')
  return new Map(
    rows.map(row => [row.canonicalUrl, row.duplicateOfId ?? row.id])
  )
}

/** A story as versions of an issue are compared: stored, or about to be. */
type ComparedStory = {
  articleId: string | null
  url: string | null
  headline: string
  isSponsored: boolean
}

/**
 * What identifies a story in another email: its article (or its link, when
 * it leads to no article) and its headline's words, so a story whose link a
 * correction fixed still matches. Short headlines ("Read more") do not
 * count, and a sponsored story never matches.
 */
function storyKeys(story: ComparedStory): string[] {
  if (story.isSponsored) return []
  const keys: string[] = []
  if (story.articleId) keys.push(`article:${story.articleId}`)
  else if (story.url) keys.push(`url:${story.url}`)
  const words = story.headline
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (words.length >= 3) keys.push(`headline:${words.join(' ')}`)
  return keys
}

/**
 * How alike two emails' stories are: the stories they share over all the
 * stories of both (0 to 1), and which of each side's stories the other has.
 */
export function compareStories(a: ComparedStory[], b: ComparedStory[]) {
  const aKeys = a.map(storyKeys)
  const bKeys = b.map(storyKeys)
  const inA = new Set(aKeys.flat())
  const inB = new Set(bKeys.flat())
  const aShared = aKeys.flatMap((keys, i) =>
    keys.some(key => inB.has(key)) ? [i] : []
  )
  const bShared = bKeys.flatMap((keys, i) =>
    keys.some(key => inA.has(key)) ? [i] : []
  )
  const aCount = aKeys.filter(keys => keys.length > 0).length
  const bCount = bKeys.filter(keys => keys.length > 0).length
  const shared = Math.min(aShared.length, bShared.length)
  const all = aCount + bCount - shared
  return { overlap: all > 0 ? shared / all : 0, aShared, bShared }
}

/**
 * Versions of one issue. An email from the same newsletter within
 * versionWindowMs, with most of its stories the same, is another version of
 * this one: a correction, a resend, or the issue at a second address. Each
 * version keeps its own email; the older points to the newer
 * (superseded_by_id), and a story both carry is kept once, with the newer
 * version's words. A story only the older one has stays with it, so a new
 * version never loses one. Different issues share far fewer stories (only
 * recurring sections), so they are left alone.
 *
 * Emails are extracted newest first, so a newer version can be stored before
 * an older one: both directions are checked. A newsletter's emails are
 * reconciled one at a time (an advisory lock), so two passes storing two
 * versions at once cannot miss each other.
 *
 * Returns the newer version this email is an older version of, if any, and
 * which of its stories that newer version already carries.
 */
async function reconcileVersions(
  tx: Tx,
  email: ClaimedEmail,
  stories: ComparedStory[]
) {
  const repeated = new Set<number>()
  let newest: { id: string; receivedAt: Date } | null = null
  const sender = email.fromAddress?.toLowerCase()
  if (!sender) return { supersededById: null, repeated }

  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`versions:${email.accountId}:${sender}`}, 0))`
  )
  const received = email.receivedAt.getTime()
  const others = await tx
    .select({ id: messages.id, receivedAt: messages.receivedAt })
    .from(messages)
    .where(
      and(
        eq(messages.accountId, email.accountId),
        sql`lower(${messages.fromAddress}) = ${sender}`,
        ne(messages.id, email.id),
        eq(messages.extractionStatus, 'done'),
        eq(messages.digestKind, 'newsletter'),
        isNull(messages.supersededById),
        gte(
          messages.receivedAt,
          new Date(received - EXTRACTION_SETTINGS.versionWindowMs)
        ),
        lte(
          messages.receivedAt,
          new Date(received + EXTRACTION_SETTINGS.versionWindowMs)
        )
      )
    )
  if (others.length === 0) return { supersededById: null, repeated }

  const theirStories = await tx
    .select({
      id: mentions.id,
      messageId: mentions.messageId,
      articleId: mentions.articleId,
      url: mentions.url,
      headline: mentions.headline,
      isSponsored: mentions.isSponsored
    })
    .from(mentions)
    .where(
      inArray(
        mentions.messageId,
        others.map(other => other.id)
      )
    )

  for (const other of others) {
    const theirs = theirStories.filter(story => story.messageId === other.id)
    const { overlap, aShared, bShared } = compareStories(stories, theirs)
    if (overlap < EXTRACTION_SETTINGS.versionMinOverlap) continue
    const isNewer =
      other.receivedAt.getTime() > received ||
      (other.receivedAt.getTime() === received && other.id > email.id)
    if (isNewer) {
      // This email is the older version: what the newer one repeats stays there.
      for (const i of aShared) repeated.add(i)
      if (!newest || other.receivedAt > newest.receivedAt) newest = other
    } else {
      // The other email is the older version: what this one repeats moves here.
      await tx
        .update(messages)
        .set({ supersededById: email.id })
        .where(eq(messages.id, other.id))
      const moved = bShared.map(i => theirs[i]!.id)
      if (moved.length > 0) {
        await tx.delete(mentions).where(inArray(mentions.id, moved))
      }
    }
  }
  return { supersededById: newest?.id ?? null, repeated }
}

/** Why an email from a sender the user unsubscribed from has no stories. */
export const NOT_READ_UNSUBSCRIBED =
  'Not read for stories: you unsubscribed from this sender.'

/** When the user unsubscribed from this email's sender, or null. */
async function senderUnsubscribedAt(email: ClaimedEmail) {
  const sender = email.fromAddress?.toLowerCase()
  if (!sender) return null
  const [row] = await db
    .select({ at: messages.senderUnsubscribedAt })
    .from(messages)
    .where(
      and(
        eq(messages.accountId, email.accountId),
        sql`lower(${messages.fromAddress}) = ${sender}`,
        isNotNull(messages.senderUnsubscribedAt)
      )
    )
    .limit(1)
  return row?.at ?? null
}

async function extract(email: ClaimedEmail) {
  // Mail from a sender the user unsubscribed from is listed, never read: no
  // model call, no stories. It inherits the date, so later mail does too.
  const unsubscribedAt = await senderUnsubscribedAt(email)
  if (unsubscribedAt) {
    await db.transaction(async tx => {
      const [held] = await tx
        .update(messages)
        .set({
          extractionStatus: 'done',
          extractionLockedAt: null,
          extractionError: NOT_READ_UNSUBSCRIBED,
          extractedAt: new Date(),
          digestKind: null,
          digestSummary: null,
          digestTopics: [],
          supersededById: null,
          senderUnsubscribedAt: unsubscribedAt
        })
        .where(holdsClaim(email))
        .returning({ id: messages.id })
      if (held)
        await tx.delete(mentions).where(eq(mentions.messageId, email.id))
    })
    return
  }

  const content = readEmailContent({
    html: email.htmlBody,
    text: email.textBody
  })
  const digest = await digestEmail(
    {
      from:
        [email.fromName, email.fromAddress && `<${email.fromAddress}>`]
          .filter(Boolean)
          .join(' ') || 'unknown sender',
      subject: email.subject ?? '(no subject)',
      content
    },
    // After about a week of a busy model, the heuristic digest, not nothing.
    {
      lastChance: email.attempts >= EXTRACTION_SETTINGS.maxTransientAttempts
    }
  )

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
        digestTopics: digest.topics,
        // Found again below, when this is an older version of an issue.
        supersededById: null
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
    const stories = digest.items.map((item, position) => {
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

    // Only a newsletter has stories, so only a newsletter has versions.
    const { supersededById, repeated } = await reconcileVersions(
      tx,
      email,
      stories
    )
    if (supersededById) {
      await tx
        .update(messages)
        .set({ supersededById })
        .where(eq(messages.id, email.id))
    }
    const kept = stories.filter((_, i) => !repeated.has(i))
    if (kept.length > 0) await tx.insert(mentions).values(kept)
  })
}

/**
 * Back to pending with back-off, or failed after the last attempt: soon for
 * an error, after about a week for a failure that may pass (a busy model).
 */
async function recordFailure(email: ClaimedEmail, err: unknown) {
  const retryable = err instanceof RetryLaterError
  if (!retryable) console.error(`Extracting email ${email.id} failed:`, err)
  const giveUp =
    email.attempts >=
    (retryable
      ? EXTRACTION_SETTINGS.maxTransientAttempts
      : EXTRACTION_SETTINGS.maxAttempts)
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

/**
 * "I unsubscribed" on an email, or Undo. Every email from its sender (the
 * exact address), now and later, carries the date. What was stored stays:
 * the inbox and the Knowledge base keep it, and retention
 * removes it in time; but runs stop using its stories (retrieval.ts), and
 * new mail from the sender is listed without being read.
 *
 * Undo clears the date everywhere, so the stories count again, and reads the
 * emails skipped meanwhile that are recent enough for a run to use. Only the
 * workspace's own email; false when it has no sender.
 */
export async function setSenderUnsubscribed(
  accountId: string,
  messageId: string,
  unsubscribed: boolean
): Promise<boolean> {
  const [email] = await db
    .select({ fromAddress: messages.fromAddress })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.accountId, accountId)))
    .limit(1)
  const sender = email?.fromAddress?.toLowerCase()
  if (!sender) return false
  const fromSender = and(
    eq(messages.accountId, accountId),
    sql`lower(${messages.fromAddress}) = ${sender}`
  )

  if (unsubscribed) {
    await db
      .update(messages)
      .set({ senderUnsubscribedAt: new Date() })
      .where(and(fromSender, isNull(messages.senderUnsubscribedAt)))
    return true
  }
  const recent = new Date(
    Date.now() - RESEARCH_SETTINGS.freshness_days * 24 * 60 * 60_000
  )
  await db.transaction(async tx => {
    await tx
      .update(messages)
      .set({ senderUnsubscribedAt: null })
      .where(fromSender)
    await tx
      .update(messages)
      .set({
        extractionStatus: 'pending',
        extractionAttempts: 0,
        extractionNextAt: new Date(),
        extractionError: null
      })
      .where(
        and(
          fromSender,
          eq(messages.extractionError, NOT_READ_UNSUBSCRIBED),
          gte(messages.receivedAt, recent)
        )
      )
  })
  return true
}
