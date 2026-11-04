/**
 * Caps and windows of extraction: received emails → their stories and links
 * → the articles those link to (src/lib/intel/pass.ts).
 */
export const EXTRACTION_SETTINGS = {
  /** Emails one pass extracts; the rest wait for the next pass. */
  messagesPerPass: 10,
  /** Articles one pass reads. */
  articlesPerPass: 20,
  /** Links kept per email, in the order they appear. */
  maxLinksPerEmail: 25,
  maxStoriesPerEmail: 25,
  /** Email text the digest model sees; the rest is cut. */
  promptChars: 20_000,
  /** Requests at once: following an email's links, and reading articles. */
  resolveConcurrency: 4,
  fetchConcurrency: 3,
  /** Click trackers often chain several redirects before the article. */
  maxRedirects: 6,
  requestTimeoutMs: 10_000,
  /** Fewer words than this is a teaser, a paywall or an app-only page. */
  minArticleWords: 80,
  maxArticleChars: 50_000,
  /**
   * A pass starts no new work after this, so it ends well inside a
   * serverless function's time limit (Vercel). The rest waits for the next.
   */
  passDeadlineMs: 4 * 60_000,
  /** A claim older than this belongs to a process that died; it is taken over. */
  claimTtlMs: 10 * 60_000,
  /** Attempts before an email or article is marked failed. */
  maxAttempts: 5,
  /** Back-off after a failure that may pass: 5 min, doubling, at most 12 hours. */
  backoffBaseMs: 5 * 60_000,
  backoffMaxMs: 12 * 60 * 60_000
} as const

/** When an item that failed on attempt `attempts` (1-based) is tried again. */
export function retryAt(attempts: number, now = new Date()) {
  const delay = Math.min(
    EXTRACTION_SETTINGS.backoffBaseMs * 2 ** Math.max(0, attempts - 1),
    EXTRACTION_SETTINGS.backoffMaxMs
  )
  return new Date(now.getTime() + delay)
}

/** A failure worth retrying later: a timeout, a busy site or model, a 5xx. */
export class RetryLaterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetryLaterError'
  }
}
