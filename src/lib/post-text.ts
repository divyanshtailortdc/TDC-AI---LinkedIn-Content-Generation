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

// A digit followed by one of these is a keycap emoji (1️⃣), not a digit.
function boldLetters(text: string): string {
  return text.replace(/[A-Za-z0-9](?![\uFE0F\u20E3])/g, ch => {
    const code = ch.charCodeAt(0)
    if (code >= 97) return String.fromCodePoint(BOLD_LOWER + code - 97)
    if (code >= 65) return String.fromCodePoint(BOLD_UPPER + code - 65)
    return String.fromCodePoint(BOLD_DIGIT + code - 48)
  })
}

// Links, email addresses and hashtags, which LinkedIn only recognises when
// they are pasted exactly as written.
const KEPT_PATTERN =
  /\b(?:https?:\/\/|www\.)[^\s<>]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?<![\p{L}\p{N}_&])#(?=[\p{N}_]*\p{L})[\p{L}\p{N}\p{M}_]+/giu

// Kept text waits in placeholder characters from a private-use plane that no
// post uses and that holds no letters or digits for bolding to change.
const KEEP_BASE = 0x100000
const PLACEHOLDER = /[\u{100000}-\u{10FFFD}]/gu
const HAS_PLACEHOLDER = /[\u{100000}-\u{10FFFD}]/u

/** Punctuation that ends a sentence, or a bracket the link never opened. */
function trimLink(link: string): string {
  const count = (ch: string) => link.split(ch).length - 1
  while (link) {
    const last = link.slice(-1)
    if (/[.,;:!?'"’”*~]/.test(last)) link = link.slice(0, -1)
    else if (last === ')' && count('(') < count(')')) link = link.slice(0, -1)
    else if (last === ']' && count('[') < count(']')) link = link.slice(0, -1)
    else break
  }
  return link
}

/**
 * Sets links, email addresses and hashtags aside so a transform cannot touch
 * them. `hold` sets aside any other text; `restore` puts it all back.
 */
function keepSpans(text: string) {
  const kept: string[] = []
  const hold = (span: string) =>
    String.fromCodePoint(KEEP_BASE + kept.push(span) - 1)
  const held = text.replace(KEPT_PATTERN, match => {
    const span = trimLink(match)
    return hold(span) + match.slice(span.length)
  })
  const restore = (out: string) => {
    // Held code can itself hold a link, so this runs until nothing is left.
    for (let pass = 0; pass < 3 && HAS_PLACEHOLDER.test(out); pass++) {
      out = out.replace(
        PLACEHOLDER,
        ch => kept[ch.codePointAt(0)! - KEEP_BASE] ?? ch
      )
    }
    return out
  }
  return { text: held, hold, restore }
}

/**
 * LinkedIn strips formatting on paste, so bold has to live in the characters
 * themselves. Letters and digits become their Unicode bold forms; everything
 * else (punctuation, emoji, accented letters) has none and is kept as is.
 * Links, email addresses and hashtags stay plain, or LinkedIn would not
 * recognise them.
 */
export function toUnicodeBold(text: string): string {
  const { text: held, restore } = keepSpans(text)
  return restore(boldLetters(held))
}

/** A link as LinkedIn can show it: the address itself, after its text. */
function linkText(label: string, href: string): string {
  const url = href.trim().replace(/^mailto:/i, '')
  // A relative link or an anchor leads nowhere outside the page it was on.
  if (!/^(?:https?:\/\/|www\.)\S+$|^[^\s@]+@[^\s@]+$/i.test(url)) return label
  const bare = (s: string) =>
    s
      .replace(/<[^>]*>/g, '')
      .trim()
      .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
      .replace(/\/$/, '')
      .toLowerCase()
  return !bare(label) || bare(label) === bare(url) ? url : `${label} (${url})`
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™'
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi,
    (match, dec, hex, name) => {
      if (name) return ENTITIES[name.toLowerCase()] ?? match
      const code = dec ? Number(dec) : parseInt(hex, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
  )
}

// The attributes of an HTML tag. They must contain "=", so prose such as
// "a <b and c> d" is not mistaken for a tag.
const ATTRS = '(?:\\s+[^<>]*?=[^<>]*?)?\\s*'

// An HTML tag by name: opening or closing, or with `closing` '' opening only.
const tag = (names: string, closing = '\\/?', after = '') =>
  new RegExp(`<${closing}(?:${names})${ATTRS}\\/?>${after}`, 'gi')

const BLOCK_TAGS = 'p|div|br|hr|ul|ol|li|h[1-6]|blockquote'

/** HTML into the plain text it shows: lines, paragraphs, bullets and links. */
function htmlToText(text: string): string {
  return (
    text
      .replace(/<!--[\s\S]*?-->/g, '')
      // Line breaks in HTML source between two blocks are not lines.
      .replace(
        new RegExp(
          `(<\\/?(?:${BLOCK_TAGS})\\b[^<>]*>)\\s+(?=<\\/?(?:${BLOCK_TAGS})\\b)`,
          'gi'
        ),
        '$1'
      )
      .replace(
        /<a\b[^<>]*?\bhref\s*=\s*(["'])(.*?)\1[^<>]*>([\s\S]*?)<\/a\s*>/gi,
        (_, _q, href, label) => linkText(label, decodeEntities(href))
      )
      .replace(
        new RegExp(
          `<(h[1-6]|strong|b)${ATTRS}>(\\s*)([\\s\\S]*?)(\\s*)<\\/\\1\\s*>`,
          'gi'
        ),
        (_, name: string, lead, inner, trail) =>
          !inner
            ? lead + trail
            : name.toLowerCase().startsWith('h')
              ? `\n\n**${inner}**\n\n`
              : `${lead}**${inner}**${trail}`
      )
      .replace(
        new RegExp(`<ol${ATTRS}>([\\s\\S]*?)<\\/ol\\s*>`, 'gi'),
        (_, items: string) => {
          let n = 0
          return `\n\n${items.replace(tag('li', ''), () => `\n${++n}. `)}\n\n`
        }
      )
      .replace(tag('li', ''), '\n• ')
      // A <br> at the end of a source line is that line's one break.
      .replace(tag('br', '', '[ \\t]*\\n?'), '\n')
      .replace(tag('div', ''), '\n')
      .replace(tag('p|ul|ol|blockquote|hr'), '\n\n')
      .replace(
        tag(
          'li|div|h[1-6]|span|u|ins|mark|small|sup|sub|font|code|s|strike|del|em|i|strong|b|a|abbr|cite|q|section|article|header|footer'
        ),
        ''
      )
  )
}

/** Markdown emphasis, code and strikethrough within one line, as LinkedIn can show it. */
function inlineMarkdown(line: string, hold: (span: string) => string): string {
  return (
    line
      // Code is shown as written, without the backticks.
      .replace(/`([^`]+)`/g, (_, code) => hold(code))
      .replace(/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, (_, s) => boldLetters(s))
      .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, (_, s) => boldLetters(s))
      .replace(
        /(^|[^\p{L}\p{N}_])__(?=\S)(.+?)(?<=\S)__(?![\p{L}\p{N}_])/gu,
        (_, lead, s) => lead + boldLetters(s)
      )
      // Italic has no form that survives a paste, so it is shown plain.
      .replace(
        /(^|[^*\p{L}\p{N}])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![*\p{L}\p{N}])/gu,
        '$1$2'
      )
      .replace(
        /(^|[^\p{L}\p{N}_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu,
        '$1$2'
      )
      .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
  )
}

/** Markdown as LinkedIn can show it: headings and bold in Unicode bold, `*` lists as bullets. */
function markdownToText(text: string): string {
  const withLinks = text
    // An image cannot go in post text; the post's own image is attached apart.
    .replace(/!\[[^\]\n]*\]\((?:[^()\s]|\([^()\s]*\))+(?:\s+"[^"\n]*")?\)/g, '')
    .replace(
      /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"\n]*")?\)/g,
      (_, label, href) => linkText(label, href)
    )
  const { text: held, hold, restore } = keepSpans(withLinks)
  let inFence = false
  const lines = held.split('\n').flatMap(line => {
    if (/^[ \t]*(?:```|~~~)[^`~]*$/.test(line)) {
      inFence = !inFence
      return []
    }
    if (inFence) return [line]
    // A rule made of * or _ (--- reads as a divider and stays).
    if (/^[ \t]*([*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) return ['']
    const heading = line.match(
      /^[ \t]{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/
    )?.[1]
    if (heading) return [boldLetters(inlineMarkdown(heading, hold))]
    const bullet = line.match(/^([ \t]*)[*+][ \t]+(.*)$/)
    if (bullet) {
      const [, indent = '', item = ''] = bullet
      const marker = indent.replace(/\t/g, '  ').length >= 2 ? '◦' : '•'
      return [`${marker} ${inlineMarkdown(item, hold)}`]
    }
    return [inlineMarkdown(line, hold)]
  })
  return restore(lines.join('\n'))
}

/**
 * One part of a post (hook, body, call to action or comment) as it pastes into
 * LinkedIn's composer, which keeps only plain text and line breaks. Markdown
 * and HTML become what they show; spaces LinkedIn would drop are dropped here,
 * leaving at most one blank line between paragraphs. Emoji, hashtags, links,
 * bullet characters and Unicode-styled letters are kept exactly.
 */
export function toLinkedInText(text: string | null | undefined): string {
  if (!text) return ''
  const plain = decodeEntities(
    markdownToText(htmlToText(text.replace(/\r\n?|[\u2028\u2029]/g, '\n')))
  )
  return plain
    .split('\n')
    .map(line => line.replace(/[ \t\f\v]+/g, ' ').replace(/^ | $/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}

/**
 * Hashtags as LinkedIn links them: one word each, with no spaces or
 * punctuation (a tag stops at the first), each tag once.
 */
export function linkedInHashtags(tags: string[] | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags || []) {
    const word = raw.replace(/[^\p{L}\p{N}\p{M}_]/gu, '')
    if (!word || seen.has(word.toLowerCase())) continue
    seen.add(word.toLowerCase())
    out.push(`#${word}`)
  }
  return out
}

/**
 * The post exactly as Copy puts it on the clipboard and the preview shows it:
 * the hook in Unicode bold (the only bold that survives pasting into
 * LinkedIn), then body, call to action and hashtags, a blank line apart.
 * The first comment is copied on its own.
 */
export function linkedInPostText(post: {
  hook: string
  body: string
  cta?: string | null
  hashtags?: string[] | null
}): string {
  return [
    toUnicodeBold(toLinkedInText(post.hook)),
    toLinkedInText(post.body),
    toLinkedInText(post.cta),
    linkedInHashtags(post.hashtags).join(' ')
  ]
    .filter(Boolean)
    .join('\n\n')
}
