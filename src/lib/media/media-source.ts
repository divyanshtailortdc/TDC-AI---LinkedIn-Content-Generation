export const REVIEWER_SEARCH_SOURCE = 'reviewer_search'
export const REVIEWER_URL_SOURCE = 'reviewer_url'
/** A file the user uploaded to make the post from (Create from media). */
export const REVIEWER_UPLOAD_SOURCE = 'reviewer_upload'

const REVIEWER_SOURCE_LABELS: Record<string, string> = {
  user_prompt: 'Your prompt',
  [REVIEWER_SEARCH_SOURCE]: 'Your search',
  [REVIEWER_URL_SOURCE]: 'Your image',
  [REVIEWER_UPLOAD_SOURCE]: 'Your upload'
}

/** True for an image the reviewer asked for, found or supplied. */
export function isReviewerChosenSource(source: string | undefined | null): boolean {
  return Boolean(source && source in REVIEWER_SOURCE_LABELS)
}

/** The badge shown instead of a relevance verdict, or null for pipeline images. */
export function reviewerSourceLabel(source: string | undefined | null): string | null {
  return source ? (REVIEWER_SOURCE_LABELS[source] ?? null) : null
}
