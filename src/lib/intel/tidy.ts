import 'server-only'

import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { embeddingWindowStart } from './index-stories'
import { RETENTION_SETTINGS } from './settings'

/**
 * Upkeep of what extraction stores, once a day (src/jobs/mail-extraction.ts).
 * No email, story or Knowledge base document is deleted. What goes is what
 * nothing uses any more, or what has been used up:
 *
 * - A story's embedding, once the story is past the freshness window (with a
 *   margin) or if it is sponsored, unless the user keeps it; and always for
 *   a story the user chose never to use. Only runs read embeddings, and they
 *   take none of these (retrieval.ts). The story stays, found by its words
 *   in the Knowledge base, and is not embedded again (index-stories.ts).
 * - An article no story has pointed to for a week: its stories were replaced
 *   on a retry, kept with a newer version, or deleted. Its copies (status
 *   duplicate) go with it. Should a story link it again, it is read again.
 * * - An email's HTML, RETENTION_SETTINGS.emailHtmlDays after it arrived,
 *   once extraction is done with it and it has a text version: the inbox
 *   shows that text from then on, and its stories stay.
 * - An article's full text, RETENTION_SETTINGS.articleTextDays after it was
 *   read: its title, summary, quoted claims and link stay, which is all
 *   ideas use of it.
 *
 * Each statement stands alone and is safe in several processes at once.
 */

const DAY_MS = 24 * 60 * 60_000

export const TIDY_SETTINGS = {
  /** At most once a day in each process. */
  everyMs: DAY_MS,
  /**
   * Embeddings are kept this long past the freshness window, so a story at
   * its edge is not dropped while a run may still take it.
   */
  embeddingMarginDays: 15,
  /** An article with no story waits this long, in case one links it again. */
  orphanArticleDays: 7
} as const

export async function tidyIntelStorage(now = new Date()) {
  const embeddingsBefore = new Date(
    embeddingWindowStart(now).getTime() -
      TIDY_SETTINGS.embeddingMarginDays * DAY_MS
  )
  const orphanedBefore = new Date(
    now.getTime() - TIDY_SETTINGS.orphanArticleDays * DAY_MS
  )
  const htmlBefore = new Date(
    now.getTime() - RETENTION_SETTINGS.emailHtmlDays * DAY_MS
  )
  const articleTextBefore = new Date(
    now.getTime() - RETENTION_SETTINGS.articleTextDays * DAY_MS
  )

  // Explicit aliases throughout: the subqueries must not resolve a bare
  // column against the wrong table. Dates go as ISO text: raw queries here
  // do not take Date parameters.
  const embeddings = await db.execute(sql`
    update intel_mentions as story
    set embedding = null, embedding_model = null
    from mail_messages as email
    where email.id = story.message_id
      and story.embedding is not null
      and (
        story.use_in_ideas = 'never'
        or (
          story.use_in_ideas <> 'keep'
          and (story.is_sponsored or email.received_at < ${embeddingsBefore.toISOString()}::timestamptz)
        )
      )
    returning story.id`)

  const articles = await db.execute(sql`
    delete from intel_articles as article
    where article.status not in ('duplicate', 'processing')
      and article.updated_at < ${orphanedBefore.toISOString()}::timestamptz
      and not exists (
        select 1 from intel_mentions as story where story.article_id = article.id
      )
    returning article.id`)

  // A copy whose original was just deleted (its pointer is set to null).
  const copies = await db.execute(sql`
    delete from intel_articles as dup
    where dup.status = 'duplicate'
      and dup.duplicate_of_id is null
      and not exists (
        select 1 from intel_mentions as story where story.article_id = dup.id
      )
    returning dup.id`)

  const emailHtml = await db.execute(sql`
    update mail_messages as email
    set html_body = null
    where email.html_body is not null
      and email.text_body is not null
      and email.extraction_status in ('done', 'failed')
      and email.received_at < ${htmlBefore.toISOString()}::timestamptz
    returning email.id`)

  const articleText = await db.execute(sql`
    update intel_articles as article
    set content = null
    where article.content is not null
      and article.status = 'done'
      and article.updated_at < ${articleTextBefore.toISOString()}::timestamptz
    returning article.id`)

  return {
    embeddings: embeddings.length,
    articles: articles.length + copies.length,
    emailHtml: emailHtml.length,
    articleText: articleText.length
  }
}
