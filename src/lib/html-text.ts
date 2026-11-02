import type { CheerioAPI } from 'cheerio'

/**
 * Elements that end a line of text. Without a break after them, the text of
 * a page whose HTML has no whitespace between tags ran together, as in
 * "SolutionsIntegrations".
 */
const BLOCK_ELEMENTS =
  'address, article, aside, blockquote, br, dd, div, dl, dt, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, td, th, tr, ul'

/**
 * The readable text of a loaded HTML document's body, one block per line.
 * Changes `$`: scripts, styles and other noise are removed from it.
 */
export function readableText($: CheerioAPI): string {
  $('script, style, noscript, svg, iframe, [role="banner"]').remove()
  $(BLOCK_ELEMENTS).after('\n')
  // Links and buttons side by side are separate words ("Solutions Pricing");
  // spans are not, as a heading may set each letter in its own.
  $('a, button').after(' ')
  return $('body')
    .text()
    .replace(/\r\n|\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
