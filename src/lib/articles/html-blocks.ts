import {
  ARTICLE_LIMITS,
  escapeHtml,
  inlineToText,
  isEmptyBlock,
  isSafeLink,
  type ArticleBlock
} from './blocks'

/**
 * HTML, already parsed into nodes, as article blocks (./blocks.ts):
 * headings, paragraphs, lists and quotes, with bold, italic, links and line
 * breaks inside them. Everything else is unwrapped to its text or dropped
 * (scripts, styles, images, forms, event handlers, unsafe links).
 *
 * Parser-agnostic: the server feeds it cheerio's nodes (./sanitize.ts) and
 * the editor the browser's DOM (./dom-blocks.ts), so both apply exactly the
 * same rules, and what the editor previews and copies is what is saved.
 */

/** The parts of a parsed node this file reads (domhandler's shape). */
export type DomNode = {
  type: string
  name?: string
  data?: string
  attribs?: Record<string, string>
  children?: DomNode[]
}

const DROPPED = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'img',
  'video',
  'audio',
  'canvas',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'head',
  'title',
  'meta',
  'link'
])

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'hr',
  'table',
  'figure'
])

const isDropped = (node: DomNode) =>
  node.type === 'script' ||
  node.type === 'style' ||
  node.type === 'comment' ||
  node.type === 'directive' ||
  (node.name !== undefined && DROPPED.has(node.name.toLowerCase()))

const tagOf = (node: DomNode) => node.name?.toLowerCase() ?? ''

/** A node's inline content as the restricted inline HTML. */
export function inlineHtml(nodes: DomNode[] | undefined): string {
  let out = ''
  for (const node of nodes ?? []) {
    if (node.type === 'text') {
      out += escapeHtml((node.data ?? '').replace(/\s+/g, ' '))
      continue
    }
    if (isDropped(node)) continue
    const tag = tagOf(node)
    const inner = () => inlineHtml(node.children)
    if (tag === 'br') out += '<br>'
    else if (tag === 'strong' || tag === 'b') {
      const text = inner()
      if (text.trim()) out += `<strong>${text}</strong>`
    } else if (tag === 'em' || tag === 'i') {
      const text = inner()
      if (text.trim()) out += `<em>${text}</em>`
    } else if (tag === 'a') {
      const href = (node.attribs?.href ?? '').trim()
      const text = inner()
      out +=
        href && isSafeLink(href) && text.trim()
          ? `<a href="${escapeHtml(href)}">${text}</a>`
          : text
    } else if (BLOCK_TAGS.has(tag)) {
      // A block inside inline content (a <p> in an <li>): its text, on a new line.
      const text = inner()
      if (text.trim())
        out += (out && !out.endsWith('<br>') ? '<br>' : '') + text
    } else {
      out += inner()
    }
  }
  return out
}

/** Leading and trailing spaces and line breaks off, at most two breaks in a row. */
export function tidyInline(html: string): string {
  const tidy = html
    .replace(/^(?:\s|<br>)+|(?:\s|<br>)+$/g, '')
    .replace(/(?:<br>\s*){3,}/g, '<br><br>')
    .replace(/ {2,}/g, ' ')
  if (tidy.length <= ARTICLE_LIMITS.blockChars) return tidy
  // Cutting markup could split a tag or an entity: a block this long keeps
  // its words, as plain text.
  return escapeHtml(
    inlineToText(tidy).slice(0, ARTICLE_LIMITS.blockChars - 1000)
  )
}

function listItems(node: DomNode): string[] {
  const items: string[] = []
  for (const child of node.children ?? []) {
    const tag = tagOf(child)
    if (tag === 'li') {
      // A nested list's items follow their parent item, flattened.
      const nested = (child.children ?? []).filter(c =>
        ['ul', 'ol'].includes(tagOf(c))
      )
      const own = (child.children ?? []).filter(c => !nested.includes(c))
      const text = tidyInline(inlineHtml(own))
      if (text) items.push(text)
      for (const list of nested) items.push(...listItems(list))
    } else if (tag === 'ul' || tag === 'ol') {
      items.push(...listItems(child))
    } else if (child.type === 'text' && child.data?.trim()) {
      items.push(tidyInline(escapeHtml(child.data)))
    }
  }
  return items.slice(0, ARTICLE_LIMITS.listItems)
}

function collectBlocks(nodes: DomNode[] | undefined, out: ArticleBlock[]) {
  // Loose inline content between blocks gathers into one paragraph.
  let pending: DomNode[] = []
  const flush = () => {
    const text = tidyInline(inlineHtml(pending))
    pending = []
    if (text) out.push({ type: 'paragraph', text })
  }

  for (const node of nodes ?? []) {
    if (isDropped(node)) continue
    const tag = tagOf(node)
    if (node.type === 'text' || !BLOCK_TAGS.has(tag)) {
      pending.push(node)
      continue
    }
    flush()
    if (tag === 'h1' || tag === 'h2') {
      const text = tidyInline(inlineHtml(node.children))
      if (text) out.push({ type: 'heading', level: 2, text })
    } else if (/^h[3-6]$/.test(tag)) {
      const text = tidyInline(inlineHtml(node.children))
      if (text) out.push({ type: 'heading', level: 3, text })
    } else if (tag === 'ul' || tag === 'ol') {
      const items = listItems(node)
      if (items.length > 0)
        out.push({ type: 'list', ordered: tag === 'ol', items })
    } else if (tag === 'li') {
      const text = tidyInline(inlineHtml(node.children))
      if (text) out.push({ type: 'list', ordered: false, items: [text] })
    } else if (tag === 'blockquote') {
      const text = tidyInline(inlineHtml(node.children))
      if (text) out.push({ type: 'quote', text })
    } else if (tag === 'hr') {
      continue
    } else {
      // p, pre and the containers: a paragraph, unless they hold blocks.
      const holdsBlocks = (node.children ?? []).some(c =>
        BLOCK_TAGS.has(tagOf(c))
      )
      if (holdsBlocks && tag !== 'p' && tag !== 'pre') {
        collectBlocks(node.children, out)
      } else {
        const text = tidyInline(inlineHtml(node.children))
        if (text) out.push({ type: 'paragraph', text })
      }
    }
  }
  flush()
}

/** Merges neighbouring lists of the same kind that the editor split apart. */
function mergeLists(blocks: ArticleBlock[]): ArticleBlock[] {
  const out: ArticleBlock[] = []
  for (const block of blocks) {
    const last = out.at(-1)
    if (
      block.type === 'list' &&
      last?.type === 'list' &&
      last.ordered === block.ordered &&
      last.items.length + block.items.length <= ARTICLE_LIMITS.listItems
    ) {
      out[out.length - 1] = { ...last, items: [...last.items, ...block.items] }
    } else out.push(block)
  }
  return out
}

/** Parsed nodes as safe article blocks. */
export function nodesToArticleBlocks(
  nodes: DomNode[] | undefined
): ArticleBlock[] {
  const blocks: ArticleBlock[] = []
  collectBlocks(nodes, blocks)
  return mergeLists(blocks.filter(b => !isEmptyBlock(b))).slice(
    0,
    ARTICLE_LIMITS.blocks
  )
}
