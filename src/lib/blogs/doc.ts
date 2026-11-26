import { cleanDiagram, type DiagramAttrs } from './diagram'
import { BLOG_LIMITS, type FaqItem } from './types'

/**
 * A blog's body as stored: TipTap (ProseMirror) document JSON limited to what
 * a blog needs. The title is the page's only H1 and lives apart from it, so
 * headings here are H2 and H3. Everything that reads or changes a document
 * goes through this file, which is pure: the editor in the browser and the
 * pipeline and checks on the server share it.
 */

export type BlogMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'link'; attrs: { href: string } }

export type BlogText = { type: 'text'; text: string; marks?: BlogMark[] }
export type BlogInline = BlogText | { type: 'hardBreak' }

export type BlogParagraph = { type: 'paragraph'; content?: BlogInline[] }
export type BlogHeading = {
  type: 'heading'
  attrs: { level: 2 | 3 }
  content?: BlogInline[]
}
export type BlogListItem = { type: 'listItem'; content: BlogBlock[] }
export type BlogBulletList = { type: 'bulletList'; content: BlogListItem[] }
export type BlogOrderedList = {
  type: 'orderedList'
  attrs?: { start: number }
  content: BlogListItem[]
}
export type BlogQuote = { type: 'blockquote'; content: BlogBlock[] }
export type BlogRule = { type: 'horizontalRule' }

/** A table cell holds paragraphs and lists; it may span columns or rows. */
export type BlogTableCell = {
  type: 'tableHeader' | 'tableCell'
  attrs?: { colspan?: number; rowspan?: number }
  content: BlogBlock[]
}
export type BlogTableRow = { type: 'tableRow'; content: BlogTableCell[] }
export type BlogTable = { type: 'table'; content: BlogTableRow[] }

/**
 * A labelled box. Its label comes from the variant, never from its text, so
 * a hypothetical example always says it is one.
 */
export const CALLOUT_VARIANTS = [
  'example',
  'takeaways',
  'tip',
  'warning',
  'note'
] as const
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number]

export const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  example: 'Hypothetical example',
  takeaways: 'Key takeaways',
  tip: 'Tip',
  warning: 'Watch out',
  note: 'Note'
}

export const isCalloutVariant = (value: unknown): value is CalloutVariant =>
  typeof value === 'string' &&
  (CALLOUT_VARIANTS as readonly string[]).includes(value)

/** A box's content: paragraphs and lists. */
export type BlogCallout = {
  type: 'callout'
  attrs: { variant: CalloutVariant }
  content: BlogBlock[]
}

/** A diagram or chart drawn from its data (src/lib/blogs/diagram.ts). */
export type BlogDiagram = { type: 'diagram'; attrs: DiagramAttrs }

/**
 * A picture made for a section: `imageId` names it in the blog's picture
 * list (blogs.images), and the node carries its own alt text and caption so
 * the author edits them in place. A picture the list does not have renders
 * as nothing.
 */
export type BlogImageAttrs = { imageId: string; alt: string; caption: string }
export type BlogImageNode = { type: 'image'; attrs: BlogImageAttrs }

/** What a picture id may look like: a UUID or a short slug, nothing else. */
const IMAGE_ID = /^[A-Za-z0-9_-]{1,64}$/

export type BlogBlock =
  | BlogParagraph
  | BlogHeading
  | BlogBulletList
  | BlogOrderedList
  | BlogQuote
  | BlogRule
  | BlogTable
  | BlogCallout
  | BlogDiagram
  | BlogImageNode

export type BlogDoc = { type: 'doc'; content: BlogBlock[] }

export const EMPTY_DOC: BlogDoc = Object.freeze({
  type: 'doc',
  content: Object.freeze([]) as unknown as BlogBlock[]
}) as BlogDoc

/**
 * A block of the model's output (src/lib/ai/skills/blog-drafting/schema.ts):
 * one flat shape for every kind, each kind reading its own fields.
 */
export type DraftBlock = {
  type:
    | 'paragraph'
    | 'subheading'
    | 'bullets'
    | 'numbered'
    | 'quote'
    | 'table'
    | 'example'
    | 'callout'
    | 'diagram'
  text?: string
  items?: string[]
  /** An example's or a box's bold first line; a diagram's title. */
  title?: string
  /** An example's paragraphs. */
  paragraphs?: string[]
  /** A table's header and rows. */
  columns?: string[]
  rows?: string[][]
  /** A box's kind: tip, warning or note. */
  variant?: string
  /** A diagram's kind: flow, timeline or bar. */
  diagram?: string
  values?: Array<number | string>
  unit?: string
  caption?: string
  alt?: string
  sourceId?: string
}

/** The parts of the model's output that become the document. */
export type DraftDocInput = {
  introduction: string[]
  /** 3-5 points in a box after the introduction, when the piece opens with one. */
  keyTakeaways?: string[]
  sections: Array<{ heading: string; lead?: string; blocks: DraftBlock[] }>
  /** Drafts written before the closing section was one of the sections. */
  conclusion?: { heading: string; paragraphs: string[] }
}

/** Which links may stay links; null keeps every safe one. */
export type LinkFilter = ((url: string) => boolean) | null

/**
 * A section's blocks with its lead (the answer first) as the opening
 * paragraph: the page shows it as an ordinary paragraph right under the H2.
 */
export function withLead(section: { lead?: string; blocks?: DraftBlock[] }): DraftBlock[] {
  const lead = section.lead?.trim()
  const blocks = section.blocks ?? []
  return lead ? [{ type: 'paragraph', text: lead }, ...blocks] : blocks
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** A link a reader can safely follow: http(s) or mailto, of sane length. */
export function isSafeHref(href: unknown): href is string {
  if (typeof href !== 'string') return false
  const value = href.trim()
  if (!value || value !== href || value.length > BLOG_LIMITS.url) return false
  if (/^mailto:[^\s<>"]+$/i.test(value)) return true
  if (!/^https?:\/\//i.test(value)) return false
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname
    )
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Model text → inline nodes
// ---------------------------------------------------------------------------

const INLINE_PATTERNS: Array<{
  kind: 'link' | 'bold' | 'italic'
  pattern: RegExp
}> = [
  // [text](url), allowing one level of brackets inside the address.
  {
    kind: 'link',
    pattern: /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g
  },
  { kind: 'bold', pattern: /\*\*(?=\S)([^\n]+?)(?<=\S)\*\*/g },
  {
    kind: 'italic',
    pattern:
      /(?<![*\p{L}\p{N}])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![*\p{L}\p{N}])/gu
  },
  // _italic_, but never inside a word: snake_case stays as it is.
  {
    kind: 'italic',
    pattern:
      /(?<![\p{L}\p{N}_])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu
  }
]

/**
 * The order the editor's schema ranks marks in (ProseMirror sorts a text's
 * marks by it): stored documents keep it too, so a document read back from
 * the editor says exactly what was stored.
 */
export const MARK_ORDER = ['link', 'bold', 'italic'] as const

const inMarkOrder = (marks: BlogMark[]) =>
  [...marks].sort(
    (a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type)
  )

const sameMarks = (a?: BlogMark[], b?: BlogMark[]) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

function pushText(out: BlogInline[], text: string, nested: BlogMark[]) {
  if (!text) return
  const marks = inMarkOrder(nested)
  const last = out[out.length - 1]
  if (last?.type === 'text' && sameMarks(last.marks, marks)) {
    last.text += text
    return
  }
  out.push(
    marks.length
      ? { type: 'text', text, marks: [...marks] }
      : { type: 'text', text }
  )
}

function parseInline(
  text: string,
  marks: BlogMark[],
  allow: LinkFilter,
  out: BlogInline[],
  removed: string[]
) {
  let position = 0
  while (position < text.length) {
    let best: {
      kind: 'link' | 'bold' | 'italic'
      match: RegExpExecArray
    } | null = null
    for (const { kind, pattern } of INLINE_PATTERNS) {
      pattern.lastIndex = position
      const match = pattern.exec(text)
      if (match && (!best || match.index < best.match.index)) {
        best = { kind, match }
      }
    }
    if (!best) break
    const { kind, match } = best
    pushText(out, text.slice(position, match.index), marks)
    const inner = match[1]!
    if (kind === 'link') {
      const url = match[2]!
      const keep =
        isSafeHref(url) &&
        (allow === null || allow(url)) &&
        !marks.some(m => m.type === 'link')
      if (!keep) removed.push(url)
      parseInline(
        inner,
        keep ? [...marks, { type: 'link', attrs: { href: url } }] : marks,
        allow,
        out,
        removed
      )
    } else {
      const mark: BlogMark = { type: kind }
      parseInline(
        inner,
        marks.some(m => m.type === kind) ? marks : [...marks, mark],
        allow,
        out,
        removed
      )
    }
    position = match.index + match[0].length
  }
  pushText(out, text.slice(position), marks)
}

/**
 * Text the model wrote with `**bold**`, `*italic*` / `_italic_` and
 * `[text](url)` as inline nodes. A link that is unsafe or not allowed keeps
 * its words as plain text, and its address is reported in `removedLinks`.
 */
export function inlineFromMarkup(
  text: string,
  allow: LinkFilter
): { nodes: BlogInline[]; removedLinks: string[] } {
  const nodes: BlogInline[] = []
  const removedLinks: string[] = []
  parseInline(text.replace(/\s*\n\s*/g, ' '), [], allow, nodes, removedLinks)
  return { nodes, removedLinks }
}

/** A heading's words: no marks or links, no leftover "## ". */
function plainHeading(text: string | undefined): string {
  if (!text) return ''
  const { nodes } = inlineFromMarkup(text.replace(/^\s*#+\s*/, ''), null)
  return inlineText(nodes).replace(/\s+/g, ' ').trim()
}

function headingNode(level: 2 | 3, text: string): BlogHeading {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }]
  }
}

function paragraphNode(
  text: string | undefined,
  allow: LinkFilter,
  removed: string[]
): BlogParagraph | null {
  const value = text?.trim()
  if (!value) return null
  const { nodes, removedLinks } = inlineFromMarkup(value, allow)
  removed.push(...removedLinks)
  return inlineText(nodes).trim() ? { type: 'paragraph', content: nodes } : null
}

function listNode(
  type: 'bulletList' | 'orderedList',
  items: string[] | undefined,
  allow: LinkFilter,
  removed: string[]
): BlogBulletList | BlogOrderedList | null {
  const listItems: BlogListItem[] = []
  for (const item of items ?? []) {
    const paragraph = paragraphNode(item, allow, removed)
    if (paragraph) listItems.push({ type: 'listItem', content: [paragraph] })
  }
  if (listItems.length === 0) return null
  return type === 'bulletList'
    ? { type: 'bulletList', content: listItems }
    : { type: 'orderedList', content: listItems }
}

/** Tables wider or longer than this stop reading on a phone. */
const MAX_TABLE_COLUMNS = 8
const MAX_TABLE_ROWS = 30

function cellNode(
  type: 'tableHeader' | 'tableCell',
  value: unknown,
  allow: LinkFilter,
  removed: string[]
): BlogTableCell {
  const paragraph =
    typeof value === 'string' ? paragraphNode(value, allow, removed) : null
  return { type, content: [paragraph ?? { type: 'paragraph' }] }
}

/**
 * A table from the model's columns and rows: the columns as a header row,
 * short rows padded so every row has every column, empty rows dropped.
 */
function tableNode(
  block: DraftBlock,
  allow: LinkFilter,
  removed: string[]
): BlogTable | null {
  const columns = (Array.isArray(block.columns) ? block.columns : [])
    .slice(0, MAX_TABLE_COLUMNS)
    .map(value => (typeof value === 'string' ? value : ''))
  const rows = (Array.isArray(block.rows) ? block.rows : [])
    .filter(
      (row): row is string[] =>
        Array.isArray(row) &&
        row.some(cell => typeof cell === 'string' && cell.trim() !== '')
    )
    .slice(0, MAX_TABLE_ROWS)
    .map(row => row.slice(0, MAX_TABLE_COLUMNS))
  const width = Math.max(columns.length, ...rows.map(row => row.length), 0)
  if (width === 0 || rows.length === 0) return null
  const pad = (row: string[]) =>
    Array.from({ length: width }, (_, i) => row[i] ?? '')
  const content: BlogTableRow[] = []
  if (columns.some(column => column.trim())) {
    content.push({
      type: 'tableRow',
      content: pad(columns).map(value =>
        cellNode('tableHeader', value, allow, removed)
      )
    })
  }
  for (const row of rows) {
    content.push({
      type: 'tableRow',
      content: pad(row).map(value =>
        cellNode('tableCell', value, allow, removed)
      )
    })
  }
  return { type: 'table', content }
}

const boldLine = (text: string): BlogParagraph => ({
  type: 'paragraph',
  content: [{ type: 'text', text, marks: [{ type: 'bold' }] }]
})

/**
 * A labelled box: an optional bold first line, then paragraphs and a list.
 * Null when it says nothing beyond its title.
 */
function calloutNode(
  variant: CalloutVariant,
  parts: { title?: string; paragraphs?: string[]; items?: string[] },
  allow: LinkFilter,
  removed: string[]
): BlogCallout | null {
  const body: BlogBlock[] = []
  for (const text of parts.paragraphs ?? []) {
    const paragraph = paragraphNode(text, allow, removed)
    if (paragraph) body.push(paragraph)
  }
  const list = listNode('bulletList', parts.items, allow, removed)
  if (list) body.push(list)
  if (body.length === 0) return null
  const title = plainHeading(parts.title)
  return {
    type: 'callout',
    attrs: { variant },
    content: title ? [boldLine(title), ...body] : body
  }
}

/** Why a diagram the model wrote was left out, for the author. */
function droppedDiagram(block: DraftBlock): string {
  const title = plainHeading(block.title)
  const named = title ? ` "${title}"` : ''
  if (block.diagram === 'bar') {
    return `Left out a chart${named}: its labels and values did not match.`
  }
  if (block.diagram === 'flow' || block.diagram === 'timeline') {
    return `Left out a diagram${named}: it needs 2 to 8 steps.`
  }
  return `Left out a diagram${named} of a kind the editor cannot show.`
}

/** A section's blocks from the model's output, empty ones left out. */
export function draftBlocksToNodes(
  blocks: DraftBlock[],
  allow: LinkFilter
): { nodes: BlogBlock[]; removedLinks: string[]; dropped: string[] } {
  const nodes: BlogBlock[] = []
  const removedLinks: string[] = []
  const dropped: string[] = []
  for (const block of blocks ?? []) {
    let node: BlogBlock | null = null
    switch (block?.type) {
      case 'table':
        node = tableNode(block, allow, removedLinks)
        break
      case 'example':
        node = calloutNode(
          'example',
          {
            title: block.title,
            paragraphs: block.paragraphs?.length
              ? block.paragraphs
              : block.text
                ? [block.text]
                : [],
            items: block.items
          },
          allow,
          removedLinks
        )
        break
      case 'callout':
        node = calloutNode(
          isCalloutVariant(block.variant) ? block.variant : 'note',
          {
            title: block.title,
            paragraphs: [
              ...(block.text ? [block.text] : []),
              ...(block.paragraphs ?? [])
            ],
            items: block.items
          },
          allow,
          removedLinks
        )
        break
      case 'diagram': {
        const attrs = cleanDiagram({
          kind: block.diagram,
          title: block.title,
          items: block.items,
          values: block.values ?? [],
          unit: block.unit,
          caption: block.caption,
          alt: block.alt,
          sourceId: block.sourceId
        })
        if (attrs) node = { type: 'diagram', attrs }
        else dropped.push(droppedDiagram(block))
        break
      }
      case 'subheading': {
        const heading = plainHeading(block.text)
        node = heading ? headingNode(3, heading) : null
        break
      }
      case 'bullets':
        node = listNode('bulletList', block.items, allow, removedLinks)
        break
      case 'numbered':
        node = listNode('orderedList', block.items, allow, removedLinks)
        break
      case 'quote': {
        const paragraph = paragraphNode(block.text, allow, removedLinks)
        node = paragraph ? { type: 'blockquote', content: [paragraph] } : null
        break
      }
      default:
        node = paragraphNode(block?.text, allow, removedLinks)
    }
    if (node) nodes.push(node)
  }
  return { nodes, removedLinks, dropped }
}

/**
 * The document for a drafted blog: the introduction, the key takeaways box
 * when there is one, each section under its H2 (a section the model left
 * without a heading is dropped), then an older draft's conclusion under its
 * own H2. `dropped` says what was left out (a diagram that did not hold
 * together), for the author.
 */
export function docFromDraft(
  draft: DraftDocInput,
  allow: LinkFilter
): { doc: BlogDoc; removedLinks: string[]; dropped: string[] } {
  const content: BlogBlock[] = []
  const removedLinks: string[] = []
  const dropped: string[] = []
  for (const text of draft.introduction ?? []) {
    const paragraph = paragraphNode(text, allow, removedLinks)
    if (paragraph) content.push(paragraph)
  }
  const takeaways = calloutNode(
    'takeaways',
    { items: draft.keyTakeaways ?? [] },
    allow,
    removedLinks
  )
  if (takeaways) content.push(takeaways)
  for (const section of draft.sections ?? []) {
    const heading = plainHeading(section?.heading)
    if (!heading) continue
    const built = draftBlocksToNodes(withLead(section), allow)
    content.push(headingNode(2, heading), ...built.nodes)
    removedLinks.push(...built.removedLinks)
    dropped.push(...built.dropped)
  }
  const closing = plainHeading(draft.conclusion?.heading)
  const closingParagraphs = (draft.conclusion?.paragraphs ?? [])
    .map(text => paragraphNode(text, allow, removedLinks))
    .filter((p): p is BlogParagraph => p !== null)
  if (closing && closingParagraphs.length > 0)
    content.push(headingNode(2, closing))
  content.push(...closingParagraphs)
  return { doc: { type: 'doc', content }, removedLinks, dropped }
}

// ---------------------------------------------------------------------------
// Sanitizing what the editor sends
// ---------------------------------------------------------------------------

const COULD_NOT_READ = 'The document could not be read.'
const TOO_LONG = 'This blog is too long to save.'
const TOO_DEEP =
  'Lists or quotes are nested too deeply to save. Move some items out a level.'
/** Lists and quotes inside one another, at most. */
const MAX_NESTING = 16

class Refused extends Error {}

const cannotSave = (what: string) =>
  new Refused(`This document has content the editor cannot save (${what}).`)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function cleanMarks(raw: unknown): BlogMark[] {
  if (!Array.isArray(raw)) return []
  const marks: BlogMark[] = []
  for (const mark of raw) {
    if (!isRecord(mark) || marks.some(m => m.type === mark.type)) continue
    if (mark.type === 'bold' || mark.type === 'italic') {
      marks.push({ type: mark.type })
    } else if (mark.type === 'link') {
      const href = isRecord(mark.attrs) ? mark.attrs.href : undefined
      if (isSafeHref(href)) marks.push({ type: 'link', attrs: { href } })
    }
    // Other marks (underline, strike, code…) are dropped; their text stays.
  }
  return inMarkOrder(marks)
}

function cleanInlines(raw: unknown): BlogInline[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Refused(COULD_NOT_READ)
  const out: BlogInline[] = []
  for (const node of raw) {
    if (!isRecord(node) || typeof node.type !== 'string') {
      throw new Refused(COULD_NOT_READ)
    }
    if (node.type === 'hardBreak') {
      out.push({ type: 'hardBreak' })
    } else if (node.type === 'text') {
      if (typeof node.text !== 'string') throw new Refused(COULD_NOT_READ)
      if (!node.text) continue
      const marks = cleanMarks(node.marks)
      out.push(
        marks.length
          ? { type: 'text', text: node.text, marks }
          : { type: 'text', text: node.text }
      )
    } else {
      throw cannotSave(node.type)
    }
  }
  return out
}

function cleanListItems(raw: unknown, nesting: number): BlogListItem[] {
  if (!Array.isArray(raw)) throw new Refused(COULD_NOT_READ)
  return raw.map(item => {
    if (!isRecord(item) || typeof item.type !== 'string') {
      throw new Refused(COULD_NOT_READ)
    }
    if (item.type !== 'listItem') throw cannotSave(`${item.type} in a list`)
    const content = cleanBlocks(item.content, nesting)
    return {
      type: 'listItem' as const,
      content: content.length ? content : [{ type: 'paragraph' as const }]
    }
  })
}

function cleanBlocks(raw: unknown, nesting: number): BlogBlock[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Refused(COULD_NOT_READ)
  return raw
    .map(node => cleanBlock(node, nesting))
    .filter((node): node is BlogBlock => node !== null)
}

function cleanBlock(node: unknown, nesting: number): BlogBlock | null {
  if (!isRecord(node) || typeof node.type !== 'string') {
    throw new Refused(COULD_NOT_READ)
  }
  switch (node.type) {
    case 'paragraph': {
      const content = cleanInlines(node.content)
      return content.length
        ? { type: 'paragraph', content }
        : { type: 'paragraph' }
    }
    case 'heading': {
      const level = isRecord(node.attrs) ? node.attrs.level : undefined
      if (level !== 2 && level !== 3)
        throw cannotSave(`heading ${String(level)}`)
      const content = cleanInlines(node.content)
      return content.length
        ? { type: 'heading', attrs: { level }, content }
        : { type: 'heading', attrs: { level } }
    }
    case 'bulletList':
    case 'orderedList': {
      if (nesting >= MAX_NESTING) throw new Refused(TOO_DEEP)
      const content = cleanListItems(node.content, nesting + 1)
      if (content.length === 0) return null
      if (node.type === 'bulletList') return { type: 'bulletList', content }
      const start = isRecord(node.attrs) ? node.attrs.start : undefined
      return typeof start === 'number' &&
        Number.isInteger(start) &&
        start >= 0 &&
        start !== 1
        ? { type: 'orderedList', attrs: { start }, content }
        : { type: 'orderedList', content }
    }
    case 'blockquote': {
      if (nesting >= MAX_NESTING) throw new Refused(TOO_DEEP)
      const content = cleanBlocks(node.content, nesting + 1)
      return {
        type: 'blockquote',
        content: content.length ? content : [{ type: 'paragraph' }]
      }
    }
    case 'horizontalRule':
      return { type: 'horizontalRule' }
    case 'table': {
      if (nesting >= MAX_NESTING) throw new Refused(TOO_DEEP)
      const rows = cleanTableRows(node.content, nesting + 1)
      return rows.length > 0 ? { type: 'table', content: rows } : null
    }
    case 'callout': {
      if (nesting >= MAX_NESTING) throw new Refused(TOO_DEEP)
      const raw = isRecord(node.attrs) ? node.attrs.variant : undefined
      const content = cleanFlowBlocks(node.content, nesting + 1)
      return {
        type: 'callout',
        attrs: { variant: isCalloutVariant(raw) ? raw : 'note' },
        content: content.length ? content : [{ type: 'paragraph' }]
      }
    }
    case 'diagram': {
      const attrs = cleanDiagram(node.attrs)
      if (!attrs) throw cannotSave('diagram')
      return { type: 'diagram', attrs }
    }
    case 'image': {
      const attrs = isRecord(node.attrs) ? node.attrs : {}
      const imageId = typeof attrs.imageId === 'string' ? attrs.imageId.trim() : ''
      // A picture with no id shows nothing: it is left out, not refused.
      if (!IMAGE_ID.test(imageId)) return null
      const words = (value: unknown, max: number) =>
        typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max).trim() : ''
      return {
        type: 'image',
        attrs: {
          imageId,
          alt: words(attrs.alt, BLOG_LIMITS.altText),
          caption: words(attrs.caption, BLOG_LIMITS.caption)
        }
      }
    }
    default:
      throw cannotSave(node.type)
  }
}

/** Spans a table cell may keep: whole cells, within reason. */
const MAX_SPAN = 20
const cleanSpan = (value: unknown) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value > 1 &&
  value <= MAX_SPAN
    ? value
    : undefined

function cleanTableRows(raw: unknown, nesting: number): BlogTableRow[] {
  if (!Array.isArray(raw)) throw new Refused(COULD_NOT_READ)
  const rows: BlogTableRow[] = []
  for (const row of raw) {
    if (!isRecord(row) || typeof row.type !== 'string') {
      throw new Refused(COULD_NOT_READ)
    }
    if (row.type !== 'tableRow') throw cannotSave(`${row.type} in a table`)
    if (!Array.isArray(row.content)) throw new Refused(COULD_NOT_READ)
    const cells: BlogTableCell[] = row.content.map(cell => {
      if (!isRecord(cell) || typeof cell.type !== 'string') {
        throw new Refused(COULD_NOT_READ)
      }
      if (cell.type !== 'tableHeader' && cell.type !== 'tableCell') {
        throw cannotSave(`${cell.type} in a table`)
      }
      const attrs = isRecord(cell.attrs) ? cell.attrs : {}
      const colspan = cleanSpan(attrs.colspan)
      const rowspan = cleanSpan(attrs.rowspan)
      const content = cleanFlowBlocks(cell.content, nesting + 1)
      return {
        type: cell.type,
        ...(colspan || rowspan
          ? { attrs: { ...(colspan && { colspan }), ...(rowspan && { rowspan }) } }
          : {}),
        content: content.length ? content : [{ type: 'paragraph' as const }]
      }
    })
    if (cells.length > 0) rows.push({ type: 'tableRow', content: cells })
  }
  return rows
}

/**
 * What a table cell or a box holds: paragraphs and lists. A heading inside
 * one becomes a paragraph, and a table, quote or box inside one gives up its
 * words as paragraphs, so pasted content is kept rather than refused.
 */
function cleanFlowBlocks(raw: unknown, nesting: number): BlogBlock[] {
  const out: BlogBlock[] = []
  for (const block of cleanBlocks(raw, nesting)) {
    switch (block.type) {
      case 'paragraph':
      case 'bulletList':
      case 'orderedList':
        out.push(block)
        break
      case 'heading':
        out.push(
          block.content?.length
            ? { type: 'paragraph', content: block.content }
            : { type: 'paragraph' }
        )
        break
      case 'blockquote':
      case 'callout':
        out.push(...cleanFlowBlocks(block.content, nesting))
        break
      case 'table':
        for (const row of block.content) {
          for (const cell of row.content) out.push(...cell.content)
        }
        break
      case 'horizontalRule':
      case 'diagram':
      case 'image':
        break
    }
  }
  return out
}

/**
 * A document sent by the browser, reduced to what a blog may hold. Unknown
 * marks are dropped and unsafe links lose their link; an unknown node, a
 * heading other than H2/H3 or a malformed shape is refused, since the editor
 * cannot produce them.
 */
export function sanitizeDoc(
  raw: unknown,
  options: {
    /** The blog's picture ids: a picture node naming any other is left out. */
    imageIds?: string[]
  } = {}
): { ok: true; doc: BlogDoc } | { ok: false; error: string } {
  let json: string | undefined
  try {
    json = JSON.stringify(raw)
  } catch {
    return { ok: false, error: COULD_NOT_READ }
  }
  if (json === undefined) return { ok: false, error: COULD_NOT_READ }
  if (json.length > BLOG_LIMITS.docJsonChars)
    return { ok: false, error: TOO_LONG }
  if (!isRecord(raw) || raw.type !== 'doc' || !Array.isArray(raw.content)) {
    return { ok: false, error: COULD_NOT_READ }
  }
  try {
    const known = options.imageIds ? new Set(options.imageIds) : null
    const content = cleanBlocks(raw.content, 0).filter(
      block => block.type !== 'image' || !known || known.has(block.attrs.imageId)
    )
    return { ok: true, doc: { type: 'doc', content } }
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.message }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Reading a document
// ---------------------------------------------------------------------------

export function inlineText(nodes?: BlogInline[]): string {
  return (nodes ?? []).map(n => (n.type === 'text' ? n.text : '\n')).join('')
}

/** A diagram's words: its title, each item (with its value) and its caption. */
export function diagramText(attrs: DiagramAttrs): string {
  const items = attrs.items.map((item, i) =>
    attrs.kind === 'bar' && attrs.values[i] !== undefined
      ? `${item}: ${attrs.values[i]}${attrs.unit ? ` ${attrs.unit}` : ''}`
      : item
  )
  return [attrs.title, ...items, attrs.caption].filter(Boolean).join('\n')
}

/**
 * A block's words: a list's items one per line, a table's rows one per line
 * with their cells joined by " | ".
 */
export function blockText(block: BlogBlock | BlogListItem): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return inlineText(block.content)
    case 'bulletList':
    case 'orderedList':
      return block.content.map(blockText).filter(Boolean).join('\n')
    case 'listItem':
    case 'blockquote':
    case 'callout':
      return block.content.map(blockText).filter(Boolean).join('\n')
    case 'table':
      return block.content
        .map(row =>
          row.content
            .map(cell =>
              cell.content.map(blockText).filter(Boolean).join(' ')
            )
            .join(' | ')
        )
        .join('\n')
    case 'diagram':
      return diagramText(block.attrs)
    case 'image':
      return block.attrs.caption
    case 'horizontalRule':
      return ''
  }
}

/**
 * Every paragraph and heading in the document, nested ones included (in
 * lists, quotes, boxes and table cells), in reading order.
 */
export function forEachTextBlock(
  doc: BlogDoc,
  visit: (block: BlogParagraph | BlogHeading) => void
): void {
  const walk = (blocks: Array<BlogBlock | BlogListItem>) => {
    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph':
        case 'heading':
          visit(block)
          break
        case 'bulletList':
        case 'orderedList':
        case 'listItem':
        case 'blockquote':
        case 'callout':
          walk(block.content)
          break
        case 'table':
          for (const row of block.content) {
            for (const cell of row.content) walk(cell.content)
          }
          break
        case 'horizontalRule':
        case 'diagram':
        case 'image':
          break
      }
    }
  }
  walk(doc.content)
}

/** The picture nodes of a document, in order (they sit at the top level only). */
export function docImages(doc: BlogDoc): BlogImageNode[] {
  return doc.content.filter((block): block is BlogImageNode => block.type === 'image')
}

export function docText(doc: BlogDoc): string {
  return doc.content.map(blockText).filter(Boolean).join('\n\n')
}

/**
 * Every paragraph's words in order: list items, quotes, boxes and table
 * cells included, headings not.
 */
export function docParagraphs(doc: BlogDoc): string[] {
  const out: string[] = []
  forEachTextBlock(doc, block => {
    if (block.type !== 'paragraph') return
    const text = inlineText(block.content).trim()
    if (text) out.push(text)
  })
  return out
}

/** Words: whitespace-separated runs with a letter or digit in them, in any script. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token)).length
}

/** The document's words and the FAQ's, as the length targets count them. */
export function blogWordCount(doc: BlogDoc, faq: FaqItem[]): number {
  return (
    countWords(docText(doc)) +
    faq.reduce(
      (sum, item) => sum + countWords(`${item.question} ${item.answer}`),
      0
    )
  )
}

/** H2 and H3 headings, each with the section it sits in (0 = introduction). */
export function docOutline(
  doc: BlogDoc
): Array<{ level: 2 | 3; text: string; section: number }> {
  const out: Array<{ level: 2 | 3; text: string; section: number }> = []
  let section = 0
  for (const block of doc.content) {
    if (block.type !== 'heading') continue
    if (block.attrs.level === 2) section++
    out.push({
      level: block.attrs.level,
      text: inlineText(block.content).trim(),
      section
    })
  }
  return out
}

/**
 * The introduction (index 0, always present) and one section per H2, each
 * starting with its heading node.
 */
export function docSections(
  doc: BlogDoc
): Array<{ index: number; heading: string | null; blocks: BlogBlock[] }> {
  const sections: Array<{
    index: number
    heading: string | null
    blocks: BlogBlock[]
  }> = [{ index: 0, heading: null, blocks: [] }]
  for (const block of doc.content) {
    if (block.type === 'heading' && block.attrs.level === 2) {
      sections.push({
        index: sections.length,
        heading: inlineText(block.content).trim(),
        blocks: [block]
      })
    } else {
      sections[sections.length - 1]!.blocks.push(block)
    }
  }
  return sections
}

/** The document with one section's blocks replaced; the original is left as it is. */
export function replaceSection(
  doc: BlogDoc,
  index: number,
  blocks: BlogBlock[]
): BlogDoc {
  const sections = docSections(doc)
  if (!Number.isInteger(index) || index < 0 || index >= sections.length) {
    throw new RangeError(`There is no section ${index} in this blog.`)
  }
  return {
    type: 'doc',
    content: sections.flatMap((section, i) =>
      i === index ? blocks : section.blocks
    )
  }
}

/** Every link address in the document, once each, in order. */
export function docLinks(doc: BlogDoc): string[] {
  const links = new Set<string>()
  forEachTextBlock(doc, block => {
    for (const node of block.content ?? []) {
      if (node.type !== 'text') continue
      for (const mark of node.marks ?? []) {
        if (mark.type === 'link') links.add(mark.attrs.href)
      }
    }
  })
  return [...links]
}

/**
 * A URL slug: lowercase words joined by hyphens, accents folded on Latin
 * letters, other scripts kept, cut at a word boundary within `maxLength`.
 */
export function slugify(text: string, maxLength = 75): string {
  const folded = text
    .normalize('NFD')
    .replace(/([A-Za-z])\p{M}+/gu, '$1')
    .normalize('NFC')
  const words = folded
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
  let slug = ''
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word
    if (next.length > maxLength) break
    slug = next
  }
  return slug || (words[0] ?? '').slice(0, maxLength)
}

/** JSON with every object's keys sorted, so key order never makes two values differ. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * What a document says, as one string: the same for the editor's JSON and for
 * the copy the database gives back (jsonb reorders keys; saving drops
 * editor-only attributes). Lets the editor tell its own text coming back
 * after a save from a different text (a restore or a rewrite).
 */
export function docSignature(raw: unknown): string {
  const result = sanitizeDoc(raw)
  return canonicalJson(result.ok ? result.doc : raw)
}

/**
 * The editor's document as plain data. ProseMirror builds node and mark
 * attributes with Object.create(null), and a server action does not send
 * such objects as data (they arrive unreadable), so the editor hands the app
 * this copy instead.
 */
export function plainDoc(raw: unknown): BlogDoc {
  return JSON.parse(JSON.stringify(raw)) as BlogDoc
}
