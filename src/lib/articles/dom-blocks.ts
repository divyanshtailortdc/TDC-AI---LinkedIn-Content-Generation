import type { ArticleBlock } from './blocks'
import { nodesToArticleBlocks, type DomNode } from './html-blocks'

/**
 * The editor's content as article blocks, in the browser: the DOM adapted to
 * the shape ./html-blocks.ts reads, so the preview, Copy and the downloads
 * apply the same rules the server applies on save. Browser only.
 */

const MAX_DEPTH = 40

function adapt(node: Node, depth = 0): DomNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return { type: 'text', data: node.textContent ?? '' }
  }
  if (node.nodeType === Node.COMMENT_NODE) return { type: 'comment' }
  if (node.nodeType !== Node.ELEMENT_NODE || depth > MAX_DEPTH) return null
  const el = node as Element
  const attribs: Record<string, string> = {}
  const href = el.getAttribute('href')
  if (href) attribs.href = href
  return {
    type: 'tag',
    name: el.tagName.toLowerCase(),
    attribs,
    children: Array.from(el.childNodes)
      .map(child => adapt(child, depth + 1))
      .filter((n): n is DomNode => n !== null)
  }
}

/** An element's children (the editor's content) as article blocks. */
export function elementToArticleBlocks(root: Element): ArticleBlock[] {
  return nodesToArticleBlocks(
    Array.from(root.childNodes)
      .map(child => adapt(child))
      .filter((n): n is DomNode => n !== null)
  )
}

/**
 * An HTML string (pasted content) as article blocks. DOMParser builds an
 * inert document: nothing in it runs or loads.
 */
export function htmlStringToArticleBlocks(html: string): ArticleBlock[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return elementToArticleBlocks(doc.body)
}
