import { z } from 'zod'

/**
 * An article's body as structured blocks: what the editor edits, the
 * database stores (articles.content) and every export is made from. Pure
 * functions only, so the editor, the server and tests share them.
 *
 * Each block's text is "inline HTML" restricted to <strong>, <em>,
 * <a href="https://…"> and <br>, with everything else escaped. The server
 * enforces that (./sanitize.ts) on every save, so these functions can trust
 * stored text.
 */

export type ArticleBlock =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }

/** Generous limits that only stop runaway input. */
export const ARTICLE_LIMITS = {
  titleChars: 200,
  subtitleChars: 400,
  blocks: 400,
  blockChars: 8_000,
  listItems: 50
} as const

const inline = z.string().max(ARTICLE_LIMITS.blockChars)

export const ArticleBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    level: z.union([z.literal(2), z.literal(3)]),
    text: inline
  }),
  z.object({ type: z.literal('paragraph'), text: inline }),
  z.object({
    type: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(inline).max(ARTICLE_LIMITS.listItems)
  }),
  z.object({ type: z.literal('quote'), text: inline })
])

export const ArticleContentSchema = z
  .array(ArticleBlockSchema)
  .max(ARTICLE_LIMITS.blocks)

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

/** A link the article may carry: http(s) only, so no javascript: or data: URLs. */
export function isSafeLink(href: string): boolean {
  try {
    const url = new URL(href)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * The model's plain text as inline HTML: everything escaped, then **bold**,
 * *italic* and [text](https://…) links turned into their tags. Anything else
 * that looks like markup stays literal text.
 */
export function inlineFromPlainText(text: string): string {
  let out = escapeHtml(text.replace(/\r\n?/g, '\n').trim())
  out = out.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (match, label: string, href: string) =>
      isSafeLink(decodeEntities(href))
        ? `<a href="${href}">${label}</a>`
        : match
  )
  out = out.replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
  out = out.replace(
    /(^|[^*\p{L}\p{N}])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![*\p{L}\p{N}])/gu,
    '$1<em>$2</em>'
  )
  return out.replace(/\n/g, '<br>')
}

/** Inline HTML as the words it shows: tags dropped, entities decoded. */
export function inlineToText(html: string): string {
  return decodeEntities(
    html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
  )
}

/** Inline HTML as Markdown: bold, italic and links kept. */
function inlineToMarkdown(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '  \n')
      .replace(
        /<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
        (_, href: string, label: string) =>
          `[${label.replace(/<[^>]*>/g, '')}](${href})`
      )
      .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*')
      .replace(/<[^>]*>/g, '')
  )
}

const blockText = (block: ArticleBlock): string[] =>
  block.type === 'list' ? block.items : [block.text]

/** True when a block shows nothing. */
export const isEmptyBlock = (block: ArticleBlock) =>
  blockText(block).every(t => !inlineToText(t).trim())

/** The article's body as HTML: what the editor starts from and Copy puts on the clipboard. */
export function blocksToHtml(blocks: ArticleBlock[]): string {
  return blocks
    .filter(b => !isEmptyBlock(b))
    .map(block => {
      switch (block.type) {
        case 'heading':
          return `<h${block.level}>${block.text}</h${block.level}>`
        case 'paragraph':
          return `<p>${block.text}</p>`
        case 'quote':
          return `<blockquote>${block.text}</blockquote>`
        case 'list': {
          const tag = block.ordered ? 'ol' : 'ul'
          const items = block.items
            .filter(i => inlineToText(i).trim())
            .map(i => `<li>${i}</li>`)
            .join('')
          return `<${tag}>${items}</${tag}>`
        }
      }
    })
    .join('\n')
}

/** A whole article as one HTML document, for the HTML download. */
export function articleToHtmlDocument(article: {
  title: string
  subtitle?: string | null
  content: ArticleBlock[]
}): string {
  const title = escapeHtml(article.title || 'Untitled article')
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    '<style>body{font-family:Georgia,serif;max-width:42rem;margin:3rem auto;padding:0 1rem;line-height:1.7;color:#111}h1{font-size:2.2rem;line-height:1.2}h2{margin-top:2rem}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:1rem;color:#444}.subtitle{font-size:1.2rem;color:#555}</style>',
    '</head>',
    '<body>',
    `<h1>${title}</h1>`,
    article.subtitle
      ? `<p class="subtitle">${escapeHtml(article.subtitle)}</p>`
      : '',
    blocksToHtml(article.content),
    '</body>',
    '</html>'
  ]
    .filter(Boolean)
    .join('\n')
}

/** The article as Markdown, for the Markdown download. */
export function articleToMarkdown(article: {
  title: string
  subtitle?: string | null
  content: ArticleBlock[]
}): string {
  const parts = [`# ${article.title || 'Untitled article'}`]
  if (article.subtitle) parts.push(`*${article.subtitle}*`)
  for (const block of article.content) {
    if (isEmptyBlock(block)) continue
    switch (block.type) {
      case 'heading':
        parts.push(`${'#'.repeat(block.level)} ${inlineToMarkdown(block.text)}`)
        break
      case 'paragraph':
        parts.push(inlineToMarkdown(block.text))
        break
      case 'quote':
        parts.push(
          inlineToMarkdown(block.text)
            .split('\n')
            .map(line => `> ${line}`)
            .join('\n')
        )
        break
      case 'list':
        parts.push(
          block.items
            .filter(i => inlineToText(i).trim())
            .map(
              (item, i) =>
                `${block.ordered ? `${i + 1}.` : '-'} ${inlineToMarkdown(item)}`
            )
            .join('\n')
        )
        break
    }
  }
  return `${parts.join('\n\n')}\n`
}

/** The article as plain text: the clipboard's fallback, and what checks read. */
export function articleToPlainText(article: {
  title?: string | null
  subtitle?: string | null
  content: ArticleBlock[]
}): string {
  const parts: string[] = []
  if (article.title) parts.push(article.title)
  if (article.subtitle) parts.push(article.subtitle)
  for (const block of article.content) {
    if (isEmptyBlock(block)) continue
    if (block.type === 'list') {
      parts.push(
        block.items
          .filter(i => inlineToText(i).trim())
          .map(
            (item, i) =>
              `${block.ordered ? `${i + 1}.` : '•'} ${inlineToText(item)}`
          )
          .join('\n')
      )
    } else {
      parts.push(inlineToText(block.text))
    }
  }
  return parts.join('\n\n')
}

/** Words in the body (headings, paragraphs, lists and quotes). */
export function countArticleWords(blocks: ArticleBlock[]): number {
  return blocks
    .flatMap(blockText)
    .map(inlineToText)
    .join(' ')
    .split(/\s+/)
    .filter(w => /[\p{L}\p{N}]/u.test(w)).length
}

/** Minutes to read at about 230 words a minute, at least one. */
export const readingMinutes = (words: number) =>
  Math.max(1, Math.round(words / 230))

/** The section headings, in order: the article's outline. */
export function articleOutline(
  blocks: ArticleBlock[]
): Array<{ level: 2 | 3; text: string }> {
  return blocks
    .filter(
      (b): b is Extract<ArticleBlock, { type: 'heading' }> =>
        b.type === 'heading'
    )
    .map(b => ({ level: b.level, text: inlineToText(b.text).trim() }))
    .filter(h => h.text)
}
