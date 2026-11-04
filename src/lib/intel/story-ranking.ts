import type { ArticleClaim } from '@/db/schema'
import { articleUrlKey } from './links'

/**
 * Choosing a run's newsletter stories from the rows retrieval.ts loads. Pure,
 * so the rules are tested on their own.
 */

/** A story as a run's evidence takes it (grounding-corpus.ts). */
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

/** A story as retrieval loads it: the mention, its email and its article. */
export type StoryRow = {
  id: string
  headline: string
  blurb: string | null
  url: string | null
  articleId: string | null
  fromName: string | null
  fromAddress: string | null
  receivedAt: Date
  articleTitle: string | null
  articleSummary: string | null
  articlePublishedAt: Date | null
  articleClaims: ArticleClaim[] | null
  articleTopics: string[] | null
}

/** What a story's embedding is made from. */
export function storyText(story: {
  headline: string
  blurb: string | null
  articleTitle: string | null
  articleSummary: string | null
}) {
  return [
    story.headline,
    story.blurb,
    story.articleTitle !== story.headline ? story.articleTitle : null,
    story.articleSummary
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000)
}

const STOPWORDS = new Set(
  'the and for are was you our its has how why who all any can new now one out get use not but about after also because become been being between both could does each from have into make more most much need only other over same should some such than that their them then there these they this those through very what when where which while will with would your yours trust people person'.split(
    ' '
  )
)

export function wordsOf(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(word => word.length >= 3 && !STOPWORDS.has(word))
  )
}

/**
 * The rows that share at least one word with the goals, most shared first,
 * otherwise in their order (newest first). A story about something else is
 * not evidence, so the rest are left out.
 */
export function rankByWords(rows: StoryRow[], goalTexts: string[]): StoryRow[] {
  const goalWords = wordsOf(goalTexts.join(' '))
  return rows
    .map((row, order) => {
      const text = [
        row.headline,
        row.blurb,
        row.articleTitle,
        row.articleSummary,
        ...(row.articleTopics ?? [])
      ]
        .filter(Boolean)
        .join(' ')
      const shared = [...wordsOf(text)].filter(word => goalWords.has(word))
      return { row, shared: shared.length, order }
    })
    .filter(ranked => ranked.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.order - b.order)
    .map(ranked => ranked.row)
}

/**
 * The stories, from ranked lists best first, at most `limit`. A story two
 * newsletters covered is taken once, and an article already saved to the
 * knowledge base (`savedUrls`) not at all: the run reads it there.
 */
export function pickStories(
  lists: StoryRow[][],
  savedUrls: Iterable<string>,
  limit: number
): NewsletterStory[] {
  // However the address is written ("www.", a trailing slash, tracking).
  const saved = new Set([...savedUrls].map(articleUrlKey))
  const seen = new Set<string>()
  const stories: NewsletterStory[] = []
  for (const row of lists.flat()) {
    const address = row.url ? articleUrlKey(row.url) : null
    const key = row.articleId ?? address ?? row.headline
    if (seen.has(key)) continue
    seen.add(key)
    if (address && saved.has(address)) continue
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
    if (stories.length === limit) break
  }
  return stories
}
