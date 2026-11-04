import 'server-only'

import { db } from '@/db'
import { intelArticlesTable, intelMentionsTable } from '@/db/schema'
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  sql
} from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { extractKnowledgeClaims } from '../ai/skills/knowledge-extraction'
import {
  ArticleFetchError,
  looksLikePlaceholderPage,
  scrapeArticle,
  type ScrapedArticle
} from '../scraper'
import { canonicalArticleUrl } from './links'
import { EXTRACTION_SETTINGS, retryAt, RetryLaterError } from './settings'

/**
 * Extraction, step 2: an article a story links to → its text, facts
 * (title, site, author, date) and a summary with verbatim claims
 * (knowledge-extraction skill). Shared by every workspace, so each page is
 * read once however many emails link to it.
 *
 * Claimed like an email (extract-email.ts), several at a time. A page that is
 * gone, not a web page, or too thin to read (a paywall, a sign-in page) is
 * skipped for good; its stories keep the newsletter's own words. The same
 * text at a second address, or a page that names or redirects to an address
 * already read, becomes a duplicate of the first, and its stories are moved
 * there; only its facts are kept, never its text.
 */

const articles = intelArticlesTable
const mentions = intelMentionsTable

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

type ClaimedArticle = {
  id: string
  canonicalUrl: string
  attempts: number
  claimedAt: Date
}

async function claimArticles(limit: number): Promise<ClaimedArticle[]> {
  const now = new Date()
  const stale = new Date(now.getTime() - EXTRACTION_SETTINGS.claimTtlMs)
  const due = db
    .select({ id: articles.id })
    .from(articles)
    .where(
      or(
        and(eq(articles.status, 'pending'), lte(articles.nextAttemptAt, now)),
        and(eq(articles.status, 'processing'), lt(articles.lockedAt, stale))
      )
    )
    .orderBy(asc(articles.nextAttemptAt))
    .limit(limit)
    .for('update', { skipLocked: true })
  const rows = await db
    .update(articles)
    .set({
      status: 'processing',
      lockedAt: now,
      attempts: sql`${articles.attempts} + 1`,
      updatedAt: now
    })
    .where(inArray(articles.id, due))
    .returning({
      id: articles.id,
      canonicalUrl: articles.canonicalUrl,
      attempts: articles.attempts
    })
  return rows.map(row => ({ ...row, claimedAt: now }))
}

/** Stores the outcome while the claim holds; false when another pass took the article over. */
async function finish(
  database: Tx | typeof db,
  article: ClaimedArticle,
  values: Partial<typeof articles.$inferInsert>
) {
  const rows = await database
    .update(articles)
    .set({ ...values, lockedAt: null, updatedAt: new Date() })
    .where(
      and(eq(articles.id, article.id), eq(articles.lockedAt, article.claimedAt))
    )
    .returning({ id: articles.id })
  return rows.length > 0
}

const skip = (article: ClaimedArticle, reason: string) =>
  finish(db, article, { status: 'skipped', lastError: reason })

/** Case and spacing do not count: the same text reflowed hashes the same. */
function contentHash(text: string) {
  return createHash('sha256')
    .update(text.toLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex')
}

/**
 * An article already read with this text, or at an address this page also
 * goes by: the one it names as its own (rel=canonical, og:url) or the one
 * fetching it ended at, after redirects.
 */
async function findOriginal(
  database: Tx | typeof db,
  article: ClaimedArticle,
  hash: string,
  page: ScrapedArticle
) {
  const addresses = [page.canonicalUrl, page.url].flatMap(url => {
    const address = url ? canonicalArticleUrl(url) : null
    return address && address !== article.canonicalUrl ? [address] : []
  })
  const [original] = await database
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        ne(articles.id, article.id),
        eq(articles.status, 'done'),
        or(
          eq(articles.contentHash, hash),
          addresses.length > 0
            ? inArray(articles.canonicalUrl, addresses)
            : undefined
        )
      )
    )
    .limit(1)
  return original?.id ?? null
}

/** Stores the article as a copy of `original` and hands its stories over. */
async function storeDuplicate(
  tx: Tx,
  article: ClaimedArticle,
  facts: Partial<typeof articles.$inferInsert>,
  original: string
) {
  const held = await finish(tx, article, {
    ...facts,
    status: 'duplicate',
    duplicateOfId: original
  })
  if (held) {
    // Their stories now read as the original: embedded again with it.
    await tx
      .update(mentions)
      .set({ articleId: original, embedding: null, embeddingModel: null })
      .where(eq(mentions.articleId, article.id))
  }
}

async function read(article: ClaimedArticle) {
  let page: ScrapedArticle
  try {
    page = await scrapeArticle(article.canonicalUrl, {
      minWords: EXTRACTION_SETTINGS.minArticleWords,
      maxRedirects: EXTRACTION_SETTINGS.maxRedirects,
      timeoutMs: EXTRACTION_SETTINGS.requestTimeoutMs
    })
  } catch (err) {
    if (err instanceof ArticleFetchError && err.permanent) {
      await skip(article, err.message)
      return
    }
    throw new RetryLaterError(err instanceof Error ? err.message : String(err))
  }
  if (looksLikePlaceholderPage(page.title, page.content)) {
    await skip(article, 'The link leads to an error or sign-in page.')
    return
  }

  const content = page.content.slice(0, EXTRACTION_SETTINGS.maxArticleChars)
  const hash = contentHash(content)
  const facts = {
    title: page.title.slice(0, 500),
    siteName: page.siteName,
    author: page.author?.slice(0, 200) ?? null,
    publishedAt: page.publishedAt,
    wordCount: page.wordCount,
    contentHash: hash,
    lastError: null
  }

  // A copy already read needs no model call.
  const original = await findOriginal(db, article, hash, page)
  if (original) {
    await db.transaction(tx => storeDuplicate(tx, article, facts, original))
    return
  }

  let knowledge
  try {
    knowledge = await extractKnowledgeClaims(page.title, content, {
      timeoutMs: EXTRACTION_SETTINGS.articleModelTimeoutMs,
      // After about a week of a busy model, the heuristic summary.
      throwWhenBusy: article.attempts < EXTRACTION_SETTINGS.maxTransientAttempts
    })
  } catch (err) {
    // A busy model: the page is read again on the next attempt.
    throw new RetryLaterError(
      `The AI model was busy: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  await db.transaction(async tx => {
    // Looked for again under a lock on the text: the same text at another
    // address may have been read at the same time (a pass reads several at
    // once), and only the first one stored is kept.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`article:${hash}`}, 0))`
    )
    const first = await findOriginal(tx, article, hash, page)
    if (first) return storeDuplicate(tx, article, facts, first)

    const held = await finish(tx, article, {
      ...facts,
      status: 'done',
      content,
      summary: knowledge.summary,
      topics: knowledge.topics,
      keyClaims: knowledge.claims
    })
    // A story embedded before its article was read (index-stories.ts) is
    // embedded again with the article's summary.
    if (held) {
      await tx
        .update(mentions)
        .set({ embedding: null, embeddingModel: null })
        .where(
          and(eq(mentions.articleId, article.id), isNotNull(mentions.embedding))
        )
    }
  })
}

/** As for an email (extract-email.ts): soon for an error, after about a week for a failure that may pass. */
async function recordFailure(article: ClaimedArticle, err: unknown) {
  const retryable = err instanceof RetryLaterError
  if (!retryable)
    console.error(`Reading article ${article.canonicalUrl} failed:`, err)
  const giveUp =
    article.attempts >=
    (retryable
      ? EXTRACTION_SETTINGS.maxTransientAttempts
      : EXTRACTION_SETTINGS.maxAttempts)
  await finish(db, article, {
    status: giveUp ? 'failed' : 'pending',
    nextAttemptAt: giveUp ? undefined : retryAt(article.attempts),
    lastError:
      err instanceof RetryLaterError
        ? err.message.slice(0, 300)
        : 'Something went wrong while reading this article.'
  })
}

/** Reads up to `limit` due articles at once; how many were claimed. */
export async function readDueArticles(limit: number): Promise<number> {
  const claimed = await claimArticles(limit)
  await Promise.all(
    claimed.map(article =>
      read(article).catch(err =>
        recordFailure(article, err).catch(error =>
          console.error('Recording an article failure failed:', error)
        )
      )
    )
  )
  return claimed.length
}
