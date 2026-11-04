import 'server-only'

import { extractNextEmail } from './extract-email'
import { indexDueStories } from './index-stories'
import { readDueArticles } from './read-article'
import { EXTRACTION_SETTINGS } from './settings'

/**
 * One extraction pass: due emails first (their stories add the articles),
 * then due articles, a few at a time, then the stories' embeddings. It stops
 * starting work at the deadline and the per-pass caps; the rest waits for
 * the next pass. Safe to run in several processes at once: emails and
 * articles are claimed first, and embedding a story twice does no harm.
 */
export async function runExtractionPass() {
  const deadline = Date.now() + EXTRACTION_SETTINGS.passDeadlineMs
  let emails = 0
  while (
    emails < EXTRACTION_SETTINGS.messagesPerPass &&
    Date.now() < deadline &&
    (await extractNextEmail())
  ) {
    emails++
  }

  let articles = 0
  while (
    articles < EXTRACTION_SETTINGS.articlesPerPass &&
    Date.now() < deadline
  ) {
    const read = await readDueArticles(
      Math.min(
        EXTRACTION_SETTINGS.fetchConcurrency,
        EXTRACTION_SETTINGS.articlesPerPass - articles
      )
    )
    if (read === 0) break
    articles += read
  }

  let stories = 0
  for (let batch = 0; batch < 4 && Date.now() < deadline; batch++) {
    const indexed = await indexDueStories()
    if (indexed === 0) break
    stories += indexed
  }
  return { emails, articles, stories }
}
