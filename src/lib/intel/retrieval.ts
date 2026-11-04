import 'server-only'

import { db } from '@/db'
import {
  intelArticlesTable,
  intelMentionsTable,
  mailMessagesTable,
  type ArticleClaim
} from '@/db/schema'
import { and, asc, desc, eq, gte } from 'drizzle-orm'
import { goalText, type GenerationContext } from '../ai/context-blocks'

/**
 * Newsletter stories for a run's evidence: the workspace's own, from emails
 * that arrived within the freshness window, with what was read of each
 * article. Ranked by how many words of the run's goals they share, then by
 * how recent they are; embeddings would rank better and come with search.
 * Sponsored stories never count as evidence.
 */

/** Stories a run's evidence takes; each brings up to four items. */
export const NEWSLETTER_STORIES_PER_RUN = 8
/** Stories looked at before ranking. */
const CANDIDATES = 80

export type NewsletterStory = {
  headline: string
  /** The newsletter's own words about it, verbatim. */
  blurb: string | null
  url: string | null
  /** The newsletter's name: its sender. */
  newsletter: string
  receivedAt: Date
  article: {
    title: string | null
    summary: string | null
    publishedAt: Date | null
    claims: ArticleClaim[]
  } | null
}

const STOPWORDS = new Set(
  'the and for are was you our its has how why who all any can new now one out get use not but about after also because become been being between both could does each from have into make more most much need only other over same should some such than that their them then there these they this those through very what when where which while will with would your yours trust people person'.split(
    ' '
  )
)

function words(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(word => word.length >= 3 && !STOPWORDS.has(word))
  )
}

export async function retrieveNewsletterStories(
  ctx: GenerationContext,
  now = new Date()
): Promise<NewsletterStory[]> {
  const since = new Date(
    now.getTime() - ctx.prefs.research.freshness_days * 24 * 60 * 60 * 1000
  )
  const mentions = intelMentionsTable
  const messages = mailMessagesTable
  const articles = intelArticlesTable
  const rows = await db
    .select({
      headline: mentions.headline,
      blurb: mentions.blurb,
      url: mentions.url,
      articleId: mentions.articleId,
      fromName: messages.fromName,
      fromAddress: messages.fromAddress,
      receivedAt: messages.receivedAt,
      articleTitle: articles.title,
      articleSummary: articles.summary,
      articlePublishedAt: articles.publishedAt,
      articleClaims: articles.keyClaims,
      articleTopics: articles.topics
    })
    .from(mentions)
    .innerJoin(messages, eq(messages.id, mentions.messageId))
    .leftJoin(
      articles,
      and(eq(articles.id, mentions.articleId), eq(articles.status, 'done'))
    )
    .where(
      and(
        eq(mentions.accountId, ctx.account.id),
        eq(mentions.isSponsored, false),
        eq(messages.digestKind, 'newsletter'),
        gte(messages.receivedAt, since)
      )
    )
    .orderBy(desc(messages.receivedAt), asc(mentions.position))
    .limit(CANDIDATES)

  const goalWords = words(ctx.selectedGoals.map(goalText).join(' '))
  const scored = rows.map((row, order) => {
    const text = [
      row.headline,
      row.blurb,
      row.articleTitle,
      row.articleSummary,
      ...(row.articleTopics ?? [])
    ]
      .filter(Boolean)
      .join(' ')
    const shared = [...words(text)].filter(word => goalWords.has(word)).length
    return { row, shared, order }
  })
  scored.sort((a, b) => b.shared - a.shared || a.order - b.order)

  // The same article from two newsletters is one story: the best-ranked one.
  const seen = new Set<string>()
  const stories: NewsletterStory[] = []
  for (const { row } of scored) {
    const key = row.articleId ?? row.url ?? row.headline
    if (seen.has(key)) continue
    seen.add(key)
    stories.push({
      headline: row.headline,
      blurb: row.blurb,
      url: row.url,
      newsletter: row.fromName || row.fromAddress || 'a newsletter',
      receivedAt: row.receivedAt,
      article: row.articleSummary
        ? {
            title: row.articleTitle,
            summary: row.articleSummary,
            publishedAt: row.articlePublishedAt,
            claims: row.articleClaims ?? []
          }
        : null
    })
    if (stories.length === NEWSLETTER_STORIES_PER_RUN) break
  }
  return stories
}
