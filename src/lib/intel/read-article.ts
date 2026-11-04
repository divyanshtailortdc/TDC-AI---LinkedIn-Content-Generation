import 'server-only'

import { db } from '@/db'
import { intelArticlesTable, intelMentionsTable } from '@/db/schema'
import { and, asc, eq, inArray, lt, lte, ne, or, sql } from 'drizzle-orm'
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
 * text at a second address becomes a duplicate of the first, and its stories
 * are moved there.
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

/** An article already read with this text, or at the address the page names as its own. */
async function findOriginal(
  article: ClaimedArticle,
  hash: string,
  page: ScrapedArticle
) {
  const ownUrl = page.canonicalUrl
    ? canonicalArticleUrl(page.canonicalUrl)
    : null
  const [original] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        ne(articles.id, article.id),
        eq(articles.status, 'done'),
        or(
          eq(articles.contentHash, hash),
          ownUrl ? eq(articles.canonicalUrl, ownUrl) : undefined
        )
      )
    )
    .limit(1)
  return original?.id ?? null
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
    description: page.description?.slice(0, 1000) ?? null,
    publishedAt: page.publishedAt,
    wordCount: page.wordCount,
    contentHash: hash,
    fetchedAt: new Date(),
    lastError: null
  }

  const original = await findOriginal(article, hash, page)
  if (original) {
    await db.transaction(async tx => {
      const held = await finish(tx, article, {
        ...facts,
        status: 'duplicate',
        duplicateOfId: original
      })
      if (held) {
        await tx
          .update(mentions)
          .set({ articleId: original })
          .where(eq(mentions.articleId, article.id))
      }
    })
    return
  }

  const knowledge = await extractKnowledgeClaims(page.title, content)
  await finish(db, article, {
    ...facts,
    status: 'done',
    content,
    summary: knowledge.summary,
    topics: knowledge.topics,
    keyClaims: knowledge.claims
  })
}

async function recordFailure(article: ClaimedArticle, err: unknown) {
  if (!(err instanceof RetryLaterError))
    console.error(`Reading article ${article.canonicalUrl} failed:`, err)
  const giveUp = article.attempts >= EXTRACTION_SETTINGS.maxAttempts
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
