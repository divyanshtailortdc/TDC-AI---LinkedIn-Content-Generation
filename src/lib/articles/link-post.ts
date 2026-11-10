/**
 * Article-link posts: a feed post that shares a web page (where the article
 * is hosted) as a link card. The publishing API takes the card's title,
 * description and thumbnail as given and never reads the page, so they are
 * part of the post. Pure functions, shared by the server and tests.
 */

/** What the card fields may hold; longer text is cut, not refused. */
export const LINK_CARD_LIMITS = { title: 200, description: 300, url: 2048 }

/**
 * The link as the platform will open it: https (or http) only, no
 * credentials, at most LINK_CARD_LIMITS.url long. Null with the reason
 * otherwise.
 */
export function validateArticleLink(
  value: string
): { url: string } | { error: string } {
  const trimmed = value.trim()
  if (!trimmed)
    return { error: 'Paste the address where the article is published.' }
  if (trimmed.length > LINK_CARD_LIMITS.url)
    return { error: 'That address is too long.' }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return {
      error: 'That is not a valid web address. It should start with https://'
    }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: 'Use an https:// address.' }
  }
  if (url.username || url.password) {
    return { error: 'Remove the user name and password from the address.' }
  }
  if (!url.hostname.includes('.')) {
    return { error: 'Use the public address of the page, not a local one.' }
  }
  return { url: url.toString() }
}

/**
 * Whether a link points at a native LinkedIn article (linkedin.com/pulse/…).
 * Those are already on LinkedIn: sharing one as a link post works, but
 * LinkedIn's own Share button on the article does the same with its card.
 */
export function isLinkedInArticleUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      /(^|\.)linkedin\.com$/i.test(url.hostname) &&
      url.pathname.startsWith('/pulse/')
    )
  } catch {
    return false
  }
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`

/** The card's title and description, cut to what the card holds. */
export function linkCardOf(article: {
  title: string
  subtitle?: string | null
}) {
  return {
    title: clip(
      article.title.replace(/\s+/g, ' ').trim(),
      LINK_CARD_LIMITS.title
    ),
    description: clip(
      (article.subtitle ?? '').replace(/\s+/g, ' ').trim(),
      LINK_CARD_LIMITS.description
    )
  }
}

/**
 * The post's text from the article's promo post: its first line or sentence
 * as the hook, the rest as the body. Without a promo post, the subtitle
 * leads and the body invites the reader in.
 */
export function linkPostCommentary(article: {
  title: string
  subtitle?: string | null
  promoPost?: string | null
}): { hook: string; body: string } {
  const promo = (article.promoPost ?? '').replace(/\r\n?/g, '\n').trim()
  if (promo) {
    const lineBreak = promo.indexOf('\n')
    const sentence = promo.search(/[.!?](\s|$)/)
    const cut =
      lineBreak > 0 && lineBreak <= 200
        ? lineBreak
        : sentence > 0 && sentence < 200
          ? sentence + 1
          : -1
    if (cut > 0) {
      const hook = promo.slice(0, cut).trim()
      const body = promo.slice(cut).trim()
      if (hook && body) return { hook, body }
    }
    if (promo.length <= 200) {
      return { hook: promo, body: 'The full article is linked below.' }
    }
    // One long paragraph: split at the last space before the fold.
    const space = promo.lastIndexOf(' ', 199)
    const at = space > 60 ? space : 199
    return { hook: promo.slice(0, at).trim(), body: promo.slice(at).trim() }
  }
  const hook = clip((article.subtitle || article.title).trim(), 200)
  return {
    hook,
    body: `I wrote up the full argument in "${article.title.trim()}". The link is below.`
  }
}
