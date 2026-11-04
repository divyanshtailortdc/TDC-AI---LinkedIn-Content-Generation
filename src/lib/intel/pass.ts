import 'server-only'

import { extractNextEmail } from './extract-email'
import { readDueArticles } from './read-article'
import { EXTRACTION_SETTINGS } from './settings'

/**
 * One extraction pass: due emails first (their stories add the articles),
 * then due articles, a few at a time. It stops starting work at the
 * deadline and the per-pass caps; the rest waits for the next pass. Safe to
 * run in several processes at once: every item is claimed first.
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
  return { emails, articles }
}
