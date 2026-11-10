import { load } from 'cheerio'
import { ARTICLE_LIMITS, isEmptyBlock, type ArticleBlock } from './blocks'
import {
  inlineHtml,
  nodesToArticleBlocks,
  tidyInline,
  type DomNode
} from './html-blocks'

/**
 * The editor's HTML as safe article blocks, on the server: parsed with
 * cheerio, then reduced by the shared rules in ./html-blocks.ts. Every save
 * goes through here, so whatever the browser sends, what is stored is safe to
 * render. Server-side only; the editor never imports it.
 */

const rootNodes = (html: string) =>
  (load(html ?? '', null, false).root()[0] as unknown as DomNode).children

/** The editor's HTML as safe article blocks. */
export function htmlToArticleBlocks(html: string): ArticleBlock[] {
  return nodesToArticleBlocks(rootNodes(html))
}

/**
 * Blocks as safe as ones made from HTML: each block's inline text passed
 * through the same filter. For blocks that arrive as JSON.
 */
export function sanitizeArticleBlocks(blocks: ArticleBlock[]): ArticleBlock[] {
  const clean = (text: string) => tidyInline(inlineHtml(rootNodes(text)))
  return blocks
    .map((block): ArticleBlock => {
      switch (block.type) {
        case 'heading':
          return {
            type: 'heading',
            level: block.level === 3 ? 3 : 2,
            text: clean(block.text)
          }
        case 'paragraph':
          return { type: 'paragraph', text: clean(block.text) }
        case 'quote':
          return { type: 'quote', text: clean(block.text) }
        case 'list':
          return {
            type: 'list',
            ordered: Boolean(block.ordered),
            items: block.items.map(clean).filter(Boolean)
          }
      }
    })
    .filter(b => !isEmptyBlock(b))
    .slice(0, ARTICLE_LIMITS.blocks)
}
