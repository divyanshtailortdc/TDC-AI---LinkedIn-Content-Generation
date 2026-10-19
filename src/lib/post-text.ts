/**
 * The text of a post as it is published: hook, body and call to action, each
 * on its own paragraph. One definition for the draft, the quality checks and
 * the character count shown, so they cannot disagree about how long a post is.
 */
export function postFullText(post: {
  hook: string
  body: string
  cta?: string | null
}): string {
  return [post.hook, post.body, post.cta].filter(Boolean).join('\n\n')
}

export function postCharCount(post: {
  hook: string
  body: string
  cta?: string | null
}): number {
  return postFullText(post).length
}

// Starts of the Mathematical Sans-Serif Bold blocks for A-Z, a-z and 0-9.
const BOLD_UPPER = 0x1d5d4
const BOLD_LOWER = 0x1d5ee
const BOLD_DIGIT = 0x1d7ec

/**
 * LinkedIn strips formatting on paste, so bold has to live in the characters
 * themselves. Letters and digits become their Unicode bold forms; everything
 * else (punctuation, emoji, accented letters) has none and is kept as is.
 */
export function toUnicodeBold(text: string): string {
  return text.replace(/[A-Za-z0-9]/g, ch => {
    const code = ch.charCodeAt(0)
    if (code >= 97) return String.fromCodePoint(BOLD_LOWER + code - 97)
    if (code >= 65) return String.fromCodePoint(BOLD_UPPER + code - 65)
    return String.fromCodePoint(BOLD_DIGIT + code - 48)
  })
}
