import { extractNumbers, mentionsFigure } from '../ai/skills/ideation/guard'
import { normalizeUrlForCompare } from '../urls'
import { formatValue } from './diagram'
import {
  inlineFromMarkup,
  inlineText,
  type BlogBlock,
  type BlogDoc,
  type BlogInline,
  type BlogMark,
  type BlogParagraph,
  type LinkFilter
} from './doc'
import { sourceQuotes, type BlogSource, type FaqItem } from './types'

/**
 * A blog's sentences and the sources they link to: what the citation checks
 * read, and how a failing sentence is unlinked or rewritten in place. Pure:
 * the pipeline, the save path and the editor share it.
 */

/** Where a paragraph sits: in a hypothetical example box, a table, a quote. */
type Where = { inExample: boolean; inTable: boolean; inQuote: boolean }
const TOP: Where = { inExample: false, inTable: false, inQuote: false }

export type DocSentence = {
  text: string
  /** Every link address inside the sentence, in order, once each. */
  links: string[]
} & Where

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

/**
 * Where each sentence of a text starts and ends. A sentence ends at ., ! ?
 * or … (and any closing quote or bracket) followed by a space and a capital,
 * a digit or an opening quote, so "e.g. the" and "2.5%" stay whole.
 */
export function sentenceRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const push = (start: number, end: number) => {
    while (start < end && /\s/.test(text[start]!)) start++
    while (end > start && /\s/.test(text[end - 1]!)) end--
    if (end > start) ranges.push([start, end])
  }
  const boundary = /[.!?…]+["'”’)\]]*(\s+)/g
  let start = 0
  let match: RegExpExecArray | null
  while ((match = boundary.exec(text)) !== null) {
    const next = text[match.index + match[0].length]
    if (next && !/[\p{Lu}\p{N}"'“‘([]/u.test(next)) continue
    push(start, match.index + match[0].length - match[1]!.length)
    start = match.index + match[0].length
  }
  push(start, text.length)
  return ranges
}

/** A paragraph's text with each inline node's place in it. */
function segmentsOf(content: BlogInline[] | undefined) {
  let plain = ''
  const segments: Array<{ node: BlogInline; start: number; end: number }> = []
  for (const node of content ?? []) {
    const text = node.type === 'text' ? node.text : '\n'
    segments.push({ node, start: plain.length, end: plain.length + text.length })
    plain += text
  }
  return { plain, segments }
}

const linkOf = (node: BlogInline) =>
  node.type === 'text'
    ? node.marks?.find((mark): mark is Extract<BlogMark, { type: 'link' }> => mark.type === 'link')
    : undefined

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Every paragraph with where it sits, in reading order. */
function eachParagraph(
  blocks: BlogBlock[],
  where: Where,
  visit: (paragraph: BlogParagraph, where: Where) => void
) {
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
        visit(block, where)
        break
      case 'bulletList':
      case 'orderedList':
        for (const item of block.content) eachParagraph(item.content, where, visit)
        break
      case 'blockquote':
        eachParagraph(block.content, { ...where, inQuote: true }, visit)
        break
      case 'callout':
        eachParagraph(
          block.content,
          { ...where, inExample: where.inExample || block.attrs.variant === 'example' },
          visit
        )
        break
      case 'table':
        for (const row of block.content) {
          for (const cell of row.content) {
            eachParagraph(cell.content, { ...where, inTable: true }, visit)
          }
        }
        break
      default:
        break
    }
  }
}

/** Every sentence of the document's paragraphs (not headings), with its links. */
export function docSentences(doc: BlogDoc): DocSentence[] {
  const out: DocSentence[] = []
  eachParagraph(doc.content, TOP, (paragraph, where) => {
    const { plain, segments } = segmentsOf(paragraph.content)
    for (const [start, end] of sentenceRanges(plain)) {
      const links: string[] = []
      for (const segment of segments) {
        const link = linkOf(segment.node)
        if (!link || segment.end <= start || segment.start >= end) continue
        if (!links.includes(link.attrs.href)) links.push(link.attrs.href)
      }
      const text = collapse(plain.slice(start, end))
      if (text) out.push({ text, links, ...where })
    }
  })
  return out
}

/**
 * The document's sentence that is, or holds, `fragment` (spacing ignored):
 * what a checker quoting part of a sentence meant. Null when none does.
 */
export function wholeSentence(doc: BlogDoc, fragment: string): string | null {
  const wanted = collapse(fragment)
  if (!wanted) return null
  const sentences = docSentences(doc).map(sentence => sentence.text)
  return (
    sentences.find(sentence => sentence === wanted) ??
    sentences.find(sentence => sentence.includes(wanted)) ??
    null
  )
}

/** The prose paragraphs of a document: not table cells. */
export function proseParagraphs(doc: BlogDoc): string[] {
  const out: string[] = []
  eachParagraph(doc.content, TOP, (paragraph, where) => {
    const text = collapse(inlineText(paragraph.content))
    if (text && !where.inTable) out.push(text)
  })
  return out
}

/** Sources by the page they link to. */
const byPage = (sources: BlogSource[]) =>
  new Map(
    sources
      .filter(source => source.url)
      .map(source => [normalizeUrlForCompare(source.url!), source])
  )

/**
 * Each sentence linked to a source, once per source: what the model check
 * reads (ids C1, C2…). Links to the author's own pages that are not sources
 * are not claims.
 */
export function citedClaims(
  doc: BlogDoc,
  sources: BlogSource[]
): Array<{ id: string; sentence: string; sourceId: string }> {
  const pages = byPage(sources)
  const claims: Array<{ id: string; sentence: string; sourceId: string }> = []
  const seen = new Set<string>()
  for (const sentence of docSentences(doc)) {
    for (const href of sentence.links) {
      const source = pages.get(normalizeUrlForCompare(href))
      if (!source) continue
      const key = `${source.id}\n${sentence.text}`
      if (seen.has(key)) continue
      seen.add(key)
      claims.push({ id: `C${claims.length + 1}`, sentence: sentence.text, sourceId: source.id })
    }
  }
  return claims
}

// ---------------------------------------------------------------------------
// Checks without a model
// ---------------------------------------------------------------------------

export type CitationProblem = {
  rule:
    | 'figure_not_in_source'
    | 'uncited_figure'
    | 'unlabelled_specific'
    | 'chart_value_not_in_source'
  sentence: string
  sourceId?: string
  figures?: string[]
}

const textOf = (source: BlogSource) => [source.title, ...sourceQuotes(source)].join('\n')

const states = (text: string, figure: string) =>
  mentionsFigure(text, figure) || extractNumbers(text).includes(figure)

/** An order number ("#1048") or a clock time ("10:24"): specifics that read as real events. */
const SPECIFICS = /#\d{3,}\b|\b\d{1,2}:\d{2}\b/g

/**
 * What can be checked without a model: a figure in a sentence must be in a
 * source that sentence links (or in the author's own details); a figure a
 * source gives must link it; a chart's values must be in its source; order
 * numbers and clock times belong in a hypothetical example box. Figures in no
 * source at all are the linter's unsupported-figure check, not repeated here.
 */
export function checkCitations(input: {
  doc: BlogDoc
  sources: BlogSource[]
  authorText: string
}): CitationProblem[] {
  const problems: CitationProblem[] = []
  const pages = byPage(input.sources)
  const author = input.authorText.toLowerCase()
  const everything = input.sources.map(textOf).join('\n')

  for (const sentence of docSentences(input.doc)) {
    if (!sentence.inExample) {
      const specifics = Array.from(new Set(sentence.text.match(SPECIFICS) ?? []))
      if (specifics.length > 0) {
        problems.push({ rule: 'unlabelled_specific', sentence: sentence.text, figures: specifics })
      }
    }
    if (sentence.inExample || sentence.inQuote) continue
    const figures = extractNumbers(sentence.text).filter(
      figure => !(author && states(author, figure))
    )
    if (figures.length === 0) continue
    const linked = sentence.links
      .map(href => pages.get(normalizeUrlForCompare(href)))
      .filter((source): source is BlogSource => Boolean(source))
    if (linked.length > 0) {
      const missing = figures.filter(
        figure => !linked.some(source => states(textOf(source), figure))
      )
      if (missing.length > 0) {
        problems.push({
          rule: 'figure_not_in_source',
          sentence: sentence.text,
          sourceId: linked[0]!.id,
          figures: missing
        })
      }
    } else if (!sentence.inTable) {
      const fromSources = figures.filter(figure => states(everything, figure))
      if (fromSources.length > 0) {
        problems.push({ rule: 'uncited_figure', sentence: sentence.text, figures: fromSources })
      }
    }
  }

  for (const block of input.doc.content) {
    if (block.type !== 'diagram' || block.attrs.kind !== 'bar') continue
    const d = block.attrs
    const source = input.sources.find(s => s.id === d.sourceId)
    const text = source ? textOf(source) : everything
    const missing = d.values
      .map(value => ({ value, shown: formatValue(value, d.unit) }))
      .filter(({ value, shown }) => !states(text, shown) && !states(text, String(value)))
      .map(({ shown }) => shown)
    if (missing.length > 0) {
      problems.push({
        rule: 'chart_value_not_in_source',
        sentence: d.title || d.alt || 'Chart',
        ...(source && { sourceId: source.id }),
        figures: missing
      })
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// Changing sentences in place
// ---------------------------------------------------------------------------

const sameMarks = (a?: BlogMark[], b?: BlogMark[]) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

function mergeText(nodes: BlogInline[]): BlogInline[] {
  const out: BlogInline[] = []
  for (const node of nodes) {
    const last = out[out.length - 1]
    if (node.type === 'text' && !node.text) continue
    if (node.type === 'text' && last?.type === 'text' && sameMarks(last.marks, node.marks)) {
      out[out.length - 1] = { ...last, text: last.text + node.text }
    } else out.push(node)
  }
  return out
}

/** The paragraph's inline nodes with [start, end) of its text replaced by `insert`. */
function spliceInline(
  content: BlogInline[],
  start: number,
  end: number,
  insert: BlogInline[]
): BlogInline[] {
  const out: BlogInline[] = []
  let position = 0
  let inserted = false
  const place = () => {
    if (!inserted) out.push(...insert)
    inserted = true
  }
  for (const node of content) {
    const length = node.type === 'text' ? node.text.length : 1
    const from = position
    const to = position + length
    position = to
    if (to <= start) {
      out.push(node)
      continue
    }
    if (from >= end) {
      place()
      out.push(node)
      continue
    }
    if (node.type === 'text') {
      const before = node.text.slice(0, Math.max(0, start - from))
      const after = node.text.slice(Math.max(0, end - from))
      if (before) out.push({ ...node, text: before })
      place()
      if (after) out.push({ ...node, text: after })
    } else place()
  }
  place()
  return mergeText(out)
}

/** The sentence as a pattern that allows any run of spaces between its words. */
const sentencePattern = (sentence: string) =>
  new RegExp(
    collapse(sentence)
      .split(' ')
      .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+')
  )

/**
 * Every paragraph passed through `change`: null removes it. A list item left
 * empty goes, then an empty list; a box or quote left empty goes; a table
 * cell keeps an empty paragraph, as tables need.
 */
function mapParagraphs(
  blocks: BlogBlock[],
  where: Where,
  change: (paragraph: BlogParagraph, where: Where) => BlogParagraph | null
): BlogBlock[] {
  const out: BlogBlock[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph': {
        const next = change(block, where)
        if (next) out.push(next)
        break
      }
      case 'bulletList':
      case 'orderedList': {
        const items = block.content
          .map(item => ({ ...item, content: mapParagraphs(item.content, where, change) }))
          .filter(item => item.content.length > 0)
        if (items.length > 0) out.push({ ...block, content: items })
        break
      }
      case 'blockquote': {
        const content = mapParagraphs(block.content, { ...where, inQuote: true }, change)
        if (content.length > 0) out.push({ ...block, content })
        break
      }
      case 'callout': {
        const content = mapParagraphs(
          block.content,
          { ...where, inExample: where.inExample || block.attrs.variant === 'example' },
          change
        )
        if (content.length > 0) out.push({ ...block, content })
        break
      }
      case 'table':
        out.push({
          ...block,
          content: block.content.map(row => ({
            ...row,
            content: row.content.map(cell => {
              const content = mapParagraphs(cell.content, { ...where, inTable: true }, change)
              return { ...cell, content: content.length > 0 ? content : [{ type: 'paragraph' as const }] }
            })
          }))
        })
        break
      default:
        out.push(block)
    }
  }
  return out
}

/**
 * The document with the link to `url` taken off each named sentence; the
 * words stay. `removed` counts the sentences that lost a link.
 */
export function unlinkSentences(
  doc: BlogDoc,
  targets: Array<{ sentence: string; url: string }>
): { doc: BlogDoc; removed: number } {
  let removed = 0
  const content = mapParagraphs(doc.content, TOP, paragraph => {
    const { plain, segments } = segmentsOf(paragraph.content)
    const ranges = sentenceRanges(plain)
    const strip = new Set<number>()
    for (const target of targets) {
      const url = normalizeUrlForCompare(target.url)
      const wanted = collapse(target.sentence)
      for (const [start, end] of ranges) {
        if (collapse(plain.slice(start, end)) !== wanted) continue
        let hit = false
        segments.forEach((segment, i) => {
          const link = linkOf(segment.node)
          if (link && segment.start < end && segment.end > start && normalizeUrlForCompare(link.attrs.href) === url) {
            strip.add(i)
            hit = true
          }
        })
        if (hit) removed++
      }
    }
    if (strip.size === 0) return paragraph
    return {
      ...paragraph,
      content: mergeText(
        segments.map(({ node }, i) => {
          if (!strip.has(i) || node.type !== 'text') return node
          const marks = node.marks?.filter(mark => mark.type !== 'link') ?? []
          return marks.length ? { ...node, marks } : { type: 'text' as const, text: node.text }
        })
      )
    }
  })
  return { doc: { type: 'doc', content }, removed }
}

/**
 * Rewrites failing sentences in place, in the document and the FAQ: each
 * sentence is replaced by its replacement (Markdown links allowed by
 * `allow`), or removed when the replacement is empty. Everything else stays
 * as it is, links included. `missed` lists the sentences not found.
 */
export function applySentenceFixes(
  content: { doc: BlogDoc; faq: FaqItem[] },
  fixes: Array<{ sentence: string; replacement: string }>,
  allow: LinkFilter
): { doc: BlogDoc; faq: FaqItem[]; missed: string[]; removedLinks: string[] } {
  let doc = content.doc
  let faq = content.faq
  const missed: string[] = []
  const removedLinks: string[] = []
  for (const fix of fixes) {
    const pattern = sentencePattern(fix.sentence)
    const replacement = collapse(fix.replacement)
    let done = false
    const blocks = mapParagraphs(doc.content, TOP, paragraph => {
      if (done) return paragraph
      const { plain } = segmentsOf(paragraph.content)
      const match = pattern.exec(plain)
      if (!match) return paragraph
      // Only a whole sentence is replaced: part of one would leave the rest
      // of it dangling.
      const whole = sentenceRanges(plain).some(
        ([from, to]) => from === match.index && to === match.index + match[0].length
      )
      if (!whole) return paragraph
      done = true
      let start = match.index
      let end = match.index + match[0].length
      let insert: BlogInline[] = []
      if (replacement) {
        const parsed = inlineFromMarkup(replacement, allow)
        insert = parsed.nodes
        removedLinks.push(...parsed.removedLinks)
      } else if (/\s/.test(plain[end] ?? '')) {
        while (/\s/.test(plain[end] ?? '')) end++
      } else {
        while (start > 0 && /\s/.test(plain[start - 1]!)) start--
      }
      const next = spliceInline(paragraph.content ?? [], start, end, insert)
      return inlineText(next).trim() ? { ...paragraph, content: next } : null
    })
    if (done) {
      doc = { type: 'doc', content: blocks }
      continue
    }
    const at = faq.findIndex(item => {
      const match = pattern.exec(item.answer)
      return Boolean(
        match &&
          sentenceRanges(item.answer).some(
            ([from, to]) => from === match.index && to === match.index + match[0].length
          )
      )
    })
    if (at >= 0) {
      faq = faq.map((item, i) =>
        i === at
          ? { ...item, answer: collapse(item.answer.replace(pattern, replacement)) }
          : item
      )
      continue
    }
    missed.push(fix.sentence)
  }
  return { doc, faq, missed, removedLinks }
}
