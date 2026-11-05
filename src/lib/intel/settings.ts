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
  /**
   * A newsletter's email within this time of another of its emails, with at
   * least this share of their stories the same, is a new version of that
   * issue: a correction, a resend, or the issue at a second address
   * (extract-email.ts). Its daily or weekly issues share far fewer.
   */
  versionWindowMs: 3 * 24 * 60 * 60_000,
  versionMinOverlap: 0.6,
  /** Attempts before an email or article is marked failed. */
  maxAttempts: 5,
  /**
   * Attempts for a failure that may pass (the AI model busy, out of budget
   * or timed out, a site down): with the back-off below, about a week. On
   * the last one, a busy model is done without: the email gets the
   * heuristic digest and the article the heuristic summary, rather than
   * nothing.
   */
  maxTransientAttempts: 20,
  /** A model call summarising an article; past this it is tried again later. */
  articleModelTimeoutMs: 2 * 60_000,
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

/**
 * An article saved to the Knowledge base from the Library (source_type
 * 'newsletter') is news: this many days after it was published (or saved,
 * without a date) it stays in the Knowledge base, but no generation reads it
 * any more (src/lib/ai/context.ts), so old figures and "latest" claims do not
 * pass for current ones. Documents the user added are never aged.
 */
export const SAVED_NEWS_MAX_AGE_DAYS = 180

/**
 * How long what extraction has used up is kept in full (src/lib/intel/tidy.ts).
 * Client-safe, so the inbox can say why an old email shows as text.
 */
export const RETENTION_SETTINGS = {
  /**
   * An email's HTML, once its stories are extracted: after this it is shown
   * as its text, which stays, as do its stories.
   */
  emailHtmlDays: 30,
  /**
   * An article's full text: after this its summary, quoted claims and link
   * stay, which is all ideas read of it.
   */
  articleTextDays: 180
} as const

/** A Knowledge base document that is saved news past SAVED_NEWS_MAX_AGE_DAYS. */
export function isOldNews(
  doc: { sourceType: string; publishedAt: Date | null; createdAt: Date },
  now = new Date()
): boolean {
  if (doc.sourceType !== 'newsletter') return false
  const dated = doc.publishedAt ?? doc.createdAt
  return now.getTime() - dated.getTime() > SAVED_NEWS_MAX_AGE_DAYS * 86_400_000
}
