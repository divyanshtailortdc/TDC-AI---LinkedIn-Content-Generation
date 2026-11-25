import {
  blogWordCount,
  CALLOUT_LABELS,
  docLinks,
  isSafeHref,
  slugify,
  type BlogBlock,
  type BlogDoc,
  type BlogInline,
  type BlogListItem,
  type BlogTable,
  type BlogTableCell
} from './doc'
import {
  diagramDescription,
  renderDiagramSvg,
  type DiagramAttrs
} from './diagram'
import { normalizeUrlForCompare } from '../urls'
import { BLOG_KIND_DEFAULTS, type BlogContent, type BlogSource } from './types'

/**
 * Every way a blog leaves the editor: HTML for the preview and "Copy
 * formatted", Markdown, plain text and a standalone HTML page for the
 * exports. All of it is built here from validated document JSON, escaping
 * every piece of text, so nothing stored is ever rendered as HTML.
 */

const FAQ_HEADING = 'Frequently asked questions'
const REFERENCES_HEADING = 'References'

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The sources an export lists: the cited ones a reader can open, in pool
 * order, each page once (several knowledge passages can come from one page).
 */
export function exportedSources(sources: BlogSource[]): BlogSource[] {
  const seen = new Set<string>()
  return sources.filter(s => {
    if (!s.cited || !s.url || !isSafeHref(s.url)) return false
    const page = normalizeUrlForCompare(s.url)
    if (seen.has(page)) return false
    seen.add(page)
    return true
  })
}

/**
 * The References list: cited sources a reader can open, each page once. Once
 * the citations were checked, only sources the text still links to, and not
 * those whose every checked sentence the check found unsupported (their links
 * were taken off). A source the check did not rule on stays. Blogs written
 * before checking existed list every cited source, as before.
 */
export function referenceList(
  blog: Pick<BlogContent, 'sources' | 'verification' | 'content'>
): BlogSource[] {
  const sources = exportedSources(blog.sources)
  if (!blog.verification) return sources
  const linked = new Set(docLinks(blog.content).map(normalizeUrlForCompare))
  const verdicts = new Map<string, boolean>()
  for (const citation of blog.verification.citations) {
    const supports = citation.verdict !== 'unsupported'
    verdicts.set(citation.sourceId, (verdicts.get(citation.sourceId) ?? false) || supports)
  }
  return sources.filter(
    s => linked.has(normalizeUrlForCompare(s.url!)) && verdicts.get(s.id) !== false
  )
}

const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./i, '') : ''
  } catch {
    return ''
  }
}

/** "2025-06-25" as "25 Jun 2025"; anything else as given. */
function readableDate(date: string | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return date ?? ''
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
      })
}

/**
 * A reference as a list shows it: the title without the "..." a search
 * engine cut it with, the publisher (or the site), and the date.
 */
export function formatReference(source: BlogSource): {
  title: string
  publisher: string
  date: string
} {
  const title =
    source.title
      .replace(/\s+/g, ' ')
      .replace(/\s*(?:\.{3}|…)\s*$/, '')
      .trim() || source.url || ''
  return {
    title,
    publisher: source.publisher?.trim() || hostOf(source.url),
    date: readableDate(source.publishedAt)
  }
}

/** ". Publisher, 25 Jun 2025." after a reference's title. */
const referenceTail = (source: BlogSource) => {
  const { publisher, date } = formatReference(source)
  const parts = [publisher, date].filter(Boolean)
  return parts.length > 0 ? `. ${parts.join(', ')}.` : '.'
}

/**
 * The files a blog's pictures go out as, in document order: the featured
 * image, then each diagram as a PNG. Markdown refers to them by these names.
 */
export function figureFiles(
  blog: Pick<BlogContent, 'slug' | 'title' | 'content' | 'featuredImage'>
): Array<{ name: string; kind: 'featured' | 'diagram'; index: number }> {
  const base = slugify(blog.slug) || slugify(blog.title) || 'blog'
  const files: Array<{ name: string; kind: 'featured' | 'diagram'; index: number }> = []
  if (blog.featuredImage?.src) {
    files.push({
      name: `${base}-featured.${imageExtension(blog.featuredImage.src)}`,
      kind: 'featured',
      index: 0
    })
  }
  let n = 0
  for (const block of blog.content.content) {
    if (block.type !== 'diagram') continue
    n++
    files.push({ name: `${base}-figure-${n}.png`, kind: 'diagram', index: n })
  }
  return files
}

/** The file extension an image's data URL or link implies; WebP when unknown. */
function imageExtension(src: string): string {
  const fromData = /^data:image\/(png|jpeg|jpg|webp)/i.exec(src)?.[1]
  const fromPath = /\.(png|jpe?g|webp)(?:[?#]|$)/i.exec(src)?.[1]
  const ext = (fromData ?? fromPath ?? 'webp').toLowerCase()
  return ext === 'jpeg' ? 'jpg' : ext
}

/** A diagram's caption with the source its figures come from. */
function diagramSource(
  attrs: DiagramAttrs,
  sources: BlogSource[]
): BlogSource | null {
  if (!attrs.sourceId) return null
  const source = sources.find(s => s.id === attrs.sourceId)
  return source?.url && isSafeHref(source.url) ? source : null
}

const answeredFaq = (blog: BlogContent) =>
  blog.faq.filter(item => item.question.trim() && item.answer.trim())

const keywordsOf = (blog: BlogContent) =>
  [blog.primaryKeyword, ...blog.keywords].map(k => k.trim()).filter(Boolean)

const hasText = (nodes?: BlogInline[]) =>
  (nodes ?? []).some(n => n.type === 'text' && n.text.trim())

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

export type HtmlOptions = {
  newTab?: boolean
  /** The brand colour diagrams are drawn in. */
  diagramColor?: string
  /** For a diagram's source link. */
  sources?: BlogSource[]
}

/** What rendering one document carries along: the options, and figures so far. */
type HtmlContext = HtmlOptions & { figures: { count: number } }

const contextOf = (opts: HtmlOptions | HtmlContext): HtmlContext =>
  'figures' in opts ? opts : { ...opts, figures: { count: 0 } }

const linkAttrs = (href: string, opts: HtmlOptions) =>
  `href="${escapeHtml(href)}" rel="noopener noreferrer"${opts.newTab ? ' target="_blank"' : ''}`

function inlineToHtml(
  nodes: BlogInline[] | undefined,
  opts: HtmlContext
): string {
  return (nodes ?? [])
    .map(node => {
      if (node.type === 'hardBreak') return '<br>'
      let html = escapeHtml(node.text)
      const marks = node.marks ?? []
      if (marks.some(m => m.type === 'italic')) html = `<em>${html}</em>`
      if (marks.some(m => m.type === 'bold')) html = `<strong>${html}</strong>`
      const link = marks.find(m => m.type === 'link')
      if (link?.type === 'link' && isSafeHref(link.attrs.href)) {
        html = `<a ${linkAttrs(link.attrs.href, opts)}>${html}</a>`
      }
      return html
    })
    .join('')
}

/** A cell's content: a single paragraph sits in the cell itself, as in a list item. */
function cellContentHtml(cell: BlogTableCell, opts: HtmlContext): string {
  const [first, ...rest] = cell.content
  if (first?.type === 'paragraph' && rest.length === 0) {
    return inlineToHtml(first.content, opts)
  }
  return cell.content.map(b => blockToHtml(b, opts)).join('')
}

const spanAttrs = (cell: BlogTableCell) =>
  `${cell.attrs?.colspan ? ` colspan="${cell.attrs.colspan}"` : ''}${
    cell.attrs?.rowspan ? ` rowspan="${cell.attrs.rowspan}"` : ''
  }`

/**
 * A table in a wrapper that scrolls on narrow screens; a first row of header
 * cells becomes the head, and a header cell in a body row heads its row.
 */
function tableToHtml(table: BlogTable, opts: HtmlContext): string {
  const [first, ...rest] = table.content
  const headRow =
    first && first.content.every(cell => cell.type === 'tableHeader')
      ? first
      : null
  const bodyRows = headRow ? rest : table.content
  const head = headRow
    ? `<thead><tr>${headRow.content
        .map(
          cell =>
            `<th scope="col"${spanAttrs(cell)}>${cellContentHtml(cell, opts)}</th>`
        )
        .join('')}</tr></thead>`
    : ''
  const body = bodyRows
    .map(
      row =>
        `<tr>${row.content
          .map(cell =>
            cell.type === 'tableHeader'
              ? `<th scope="row"${spanAttrs(cell)}>${cellContentHtml(cell, opts)}</th>`
              : `<td${spanAttrs(cell)}>${cellContentHtml(cell, opts)}</td>`
          )
          .join('')}</tr>`
    )
    .join('')
  return `<div class="table-wrap"><table>${head}${body ? `<tbody>${body}</tbody>` : ''}</table></div>`
}

function diagramToHtml(attrs: DiagramAttrs, opts: HtmlContext): string {
  opts.figures.count++
  const svg = renderDiagramSvg(attrs, {
    color: opts.diagramColor,
    idPrefix: `figure-${opts.figures.count}`
  })
  const source = diagramSource(attrs, opts.sources ?? [])
  const caption = [
    attrs.caption ? escapeHtml(attrs.caption) : '',
    source
      ? `Source: <a ${linkAttrs(source.url!, opts)}>${escapeHtml(formatReference(source).title)}</a>.`
      : ''
  ]
    .filter(Boolean)
    .join(' ')
  return `<figure class="diagram">${svg}${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`
}

function listItemToHtml(item: BlogListItem, opts: HtmlContext): string {
  const [first, ...rest] = item.content
  // A list item's first paragraph sits in the <li> itself, as CMS editors
  // and email clients expect.
  const lead =
    first?.type === 'paragraph'
      ? inlineToHtml(first.content, opts)
      : first
        ? blockToHtml(first, opts)
        : ''
  return `<li>${lead}${rest.map(b => blockToHtml(b, opts)).join('')}</li>`
}

function blockToHtml(block: BlogBlock, opts: HtmlContext): string {
  switch (block.type) {
    case 'paragraph':
      return hasText(block.content)
        ? `<p>${inlineToHtml(block.content, opts)}</p>`
        : ''
    case 'heading':
      return hasText(block.content)
        ? `<h${block.attrs.level}>${inlineToHtml(block.content, opts)}</h${block.attrs.level}>`
        : ''
    case 'bulletList':
      return `<ul>${block.content.map(i => listItemToHtml(i, opts)).join('')}</ul>`
    case 'orderedList': {
      const start = block.attrs?.start
      return `<ol${start !== undefined && start !== 1 ? ` start="${start}"` : ''}>${block.content
        .map(i => listItemToHtml(i, opts))
        .join('')}</ol>`
    }
    case 'blockquote':
      return `<blockquote>${block.content.map(b => blockToHtml(b, opts)).join('')}</blockquote>`
    case 'horizontalRule':
      return '<hr>'
    case 'table':
      return tableToHtml(block, opts)
    case 'callout': {
      const label = CALLOUT_LABELS[block.attrs.variant]
      return `<aside class="callout callout-${block.attrs.variant}"><p class="callout-label"><strong>${escapeHtml(label)}</strong></p>${block.content
        .map(b => blockToHtml(b, opts))
        .join('')}</aside>`
    }
    case 'diagram':
      return diagramToHtml(block.attrs, opts)
  }
}

export function docToHtml(doc: BlogDoc, opts: HtmlOptions = {}): string {
  const context = contextOf(opts)
  return doc.content.map(block => blockToHtml(block, context)).join('')
}

/** The featured image as a figure, with its alt text and caption. */
function featuredImageHtml(blog: BlogContent): string {
  const image = blog.featuredImage
  if (!image?.src) return ''
  const caption = image.caption.trim()
  return `<figure class="featured"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}">${
    caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
  }</figure>`
}

/**
 * The article as a reader sees it: the title in its header, the featured
 * image, the body, the FAQ and the references that support it.
 */
export function blogArticleHtml(
  blog: BlogContent,
  opts: HtmlOptions = {}
): string {
  const context = contextOf({ ...opts, sources: opts.sources ?? blog.sources })
  const parts: string[] = []
  if (blog.title.trim())
    parts.push(`<header><h1>${escapeHtml(blog.title)}</h1></header>`)
  parts.push(featuredImageHtml(blog))
  parts.push(docToHtml(blog.content, context))
  const faq = answeredFaq(blog)
  if (faq.length > 0) {
    parts.push(
      `<section class="faq" id="faq"><h2>${FAQ_HEADING}</h2>${faq
        .map(
          item =>
            `<h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p>`
        )
        .join('')}</section>`
    )
  }
  const references = referenceList(blog)
  if (references.length > 0) {
    parts.push(
      `<section class="references" id="references"><h2>${REFERENCES_HEADING}</h2><ol>${references
        .map(
          (s, i) =>
            `<li id="ref-${i + 1}"><a ${linkAttrs(s.url!, opts)}>${escapeHtml(formatReference(s).title)}</a>${escapeHtml(referenceTail(s))}</li>`
        )
        .join('')}</ol></section>`
    )
  }
  return parts.join('')
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/**
 * Text as Markdown shows it, never as markup: HTML in the text (a sentence
 * about the <title> tag) is kept as text, as is text that reads like an
 * entity; Markdown's own characters are backslash-escaped.
 */
const escapeMarkdown = (text: string) =>
  text
    .replace(/&(?=#?[a-zA-Z0-9]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/([\\`*_[\]])/g, '\\$1')

/** Characters at the start of a line that would turn it into a heading, quote or list. */
const escapeLineStart = (line: string) =>
  line
    .replace(/^(\s*)([#>])/, '$1\\$2')
    .replace(/^(\s*)([-+])(\s)/, '$1\\$2$3')
    .replace(/^(\s*)(\d+)\.(\s)/, '$1$2\\.$3')

const markdownUrl = (url: string) =>
  url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')

/** `**`/`_` must touch words, so a node's outer spaces go outside them. */
function wrapMarkdown(text: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!
  return match[2] ? `${match[1]}${marker}${match[2]}${marker}${match[3]}` : text
}

function inlineToMarkdown(nodes: BlogInline[] | undefined): string {
  return (nodes ?? [])
    .map(node => {
      if (node.type === 'hardBreak') return '\\\n'
      let md = escapeMarkdown(node.text)
      const marks = node.marks ?? []
      if (marks.some(m => m.type === 'italic')) md = wrapMarkdown(md, '_')
      if (marks.some(m => m.type === 'bold')) md = wrapMarkdown(md, '**')
      const link = marks.find(m => m.type === 'link')
      if (link?.type === 'link' && isSafeHref(link.attrs.href)) {
        md = `[${md}](${markdownUrl(link.attrs.href)})`
      }
      return md
    })
    .join('')
}

const indentLines = (text: string, indent: string) =>
  text
    .split('\n')
    .map(line => (line ? indent + line : line))
    .join('\n')

/** What Markdown of one blog carries along: its figure files and sources. */
type MarkdownContext = {
  sources: BlogSource[]
  /** Diagram file names in document order. */
  diagramFiles: string[]
  figures: { count: number }
}

const NO_FIGURES: MarkdownContext = {
  sources: [],
  diagramFiles: [],
  figures: { count: 0 }
}

/** A table cell's words on one line, with the pipes that would end it escaped. */
const markdownCell = (cell: BlogTableCell) =>
  cell.content
    .map(block =>
      block.type === 'paragraph'
        ? inlineToMarkdown(block.content)
        : blockToMarkdown(block, NO_FIGURES)
    )
    .filter(Boolean)
    .join(' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()

/** A GitHub-flavoured table: the first row is the header, as Markdown needs one. */
function tableToMarkdown(table: BlogTable): string {
  const rows = table.content.map(row => {
    const cells: string[] = []
    for (const cell of row.content) {
      cells.push(markdownCell(cell))
      // Markdown has no merged cells: a wide cell leaves the cells it spans empty.
      for (let i = 1; i < (cell.attrs?.colspan ?? 1); i++) cells.push('')
    }
    return cells
  })
  const width = Math.max(...rows.map(row => row.length))
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] || ' ').join(' | ')} |`
  const [head = [], ...body] = rows
  return [
    line(head),
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...body.map(line)
  ].join('\n')
}

function diagramToMarkdown(attrs: DiagramAttrs, context: MarkdownContext): string {
  const name =
    context.diagramFiles[context.figures.count] ??
    `figure-${context.figures.count + 1}.png`
  context.figures.count++
  const alt = escapeMarkdown(attrs.alt || diagramDescription(attrs))
  const source = diagramSource(attrs, context.sources)
  const caption = [
    attrs.caption ? escapeMarkdown(attrs.caption) : '',
    source
      ? `Source: [${escapeMarkdown(formatReference(source).title)}](${markdownUrl(source.url!)}).`
      : ''
  ]
    .filter(Boolean)
    .join(' ')
  return `![${alt}](${name})${caption ? `\n\n_${caption}_` : ''}`
}

function listToMarkdown(
  items: BlogListItem[],
  marker: (index: number) => string
): string {
  return items
    .map((item, index) => {
      const prefix = marker(index)
      const [first, ...rest] = item.content
      const lead =
        first?.type === 'paragraph'
          ? inlineToMarkdown(first.content)
          : first
            ? blockToMarkdown(first, NO_FIGURES)
            : ''
      const nested = rest
        .map(b => blockToMarkdown(b, NO_FIGURES))
        .filter(Boolean)
        .map(md => indentLines(md, ' '.repeat(prefix.length)))
      return [`${prefix}${lead}`, ...nested].join('\n')
    })
    .join('\n')
}

const quoteLines = (md: string) =>
  md
    .split('\n')
    .map(line => (line ? `> ${line}` : '>'))
    .join('\n')

function blockToMarkdown(block: BlogBlock, context: MarkdownContext): string {
  switch (block.type) {
    case 'paragraph':
      return hasText(block.content)
        ? escapeLineStart(inlineToMarkdown(block.content))
        : ''
    case 'heading':
      return hasText(block.content)
        ? `${'#'.repeat(block.attrs.level)} ${inlineToMarkdown(block.content)}`
        : ''
    case 'bulletList':
      return listToMarkdown(block.content, () => '- ')
    case 'orderedList': {
      const start = block.attrs?.start ?? 1
      return listToMarkdown(block.content, index => `${start + index}. `)
    }
    case 'blockquote':
      return quoteLines(
        block.content
          .map(b => blockToMarkdown(b, context))
          .filter(Boolean)
          .join('\n\n')
      )
    case 'horizontalRule':
      return '---'
    case 'table':
      return tableToMarkdown(block)
    case 'callout':
      return quoteLines(
        [
          `**${CALLOUT_LABELS[block.attrs.variant]}**`,
          ...block.content.map(b => blockToMarkdown(b, context))
        ]
          .filter(Boolean)
          .join('\n\n')
      )
    case 'diagram':
      return diagramToMarkdown(block.attrs, context)
  }
}

/** A YAML double-quoted value: JSON's string syntax is valid YAML. */
const frontMatterValue = (value: string) =>
  JSON.stringify(value.replace(/\s+/g, ' ').trim())

export function blogToMarkdown(
  blog: BlogContent,
  opts: { frontMatter?: boolean } = {}
): string {
  const files = figureFiles(blog)
  const featuredFile = files.find(file => file.kind === 'featured')
  const context: MarkdownContext = {
    sources: blog.sources,
    diagramFiles: files.filter(f => f.kind === 'diagram').map(f => f.name),
    figures: { count: 0 }
  }
  const parts: string[] = []
  if (opts.frontMatter !== false) {
    parts.push(
      [
        '---',
        `title: ${frontMatterValue(blog.title)}`,
        `meta_title: ${frontMatterValue(blog.metaTitle)}`,
        `meta_description: ${frontMatterValue(blog.metaDescription)}`,
        `slug: ${frontMatterValue(blog.slug)}`,
        ...(blog.searchIntent
          ? [`search_intent: ${frontMatterValue(blog.searchIntent)}`]
          : []),
        ...(featuredFile && blog.featuredImage
          ? [
              `image: ${frontMatterValue(featuredFile.name)}`,
              `image_alt: ${frontMatterValue(blog.featuredImage.alt)}`
            ]
          : []),
        `keywords: [${keywordsOf(blog).map(frontMatterValue).join(', ')}]`,
        '---'
      ].join('\n')
    )
  }
  if (blog.title.trim())
    parts.push(`# ${escapeMarkdown(blog.title.replace(/\s+/g, ' ').trim())}`)
  if (featuredFile && blog.featuredImage) {
    parts.push(`![${escapeMarkdown(blog.featuredImage.alt)}](${featuredFile.name})`)
    if (blog.featuredImage.caption.trim())
      parts.push(`_${escapeMarkdown(blog.featuredImage.caption.trim())}_`)
  }
  parts.push(
    ...blog.content.content
      .map(block => blockToMarkdown(block, context))
      .filter(Boolean)
  )
  const faq = answeredFaq(blog)
  if (faq.length > 0) {
    parts.push(`## ${FAQ_HEADING}`)
    for (const item of faq) {
      parts.push(
        `### ${escapeMarkdown(item.question.trim())}`,
        escapeLineStart(escapeMarkdown(item.answer.trim()))
      )
    }
  }
  const references = referenceList(blog)
  if (references.length > 0) {
    parts.push(
      `## ${REFERENCES_HEADING}`,
      references
        .map(
          (s, i) =>
            `${i + 1}. [${escapeMarkdown(formatReference(s).title)}](${markdownUrl(s.url!)})${escapeMarkdown(referenceTail(s))}`
        )
        .join('\n')
    )
  }
  return `${parts.join('\n\n')}\n`
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

function inlineToText(nodes: BlogInline[] | undefined): string {
  return (nodes ?? [])
    .map(node => {
      if (node.type === 'hardBreak') return '\n'
      const link = node.marks?.find(m => m.type === 'link')
      if (link?.type !== 'link' || !isSafeHref(link.attrs.href))
        return node.text
      const href = link.attrs.href.replace(/^mailto:/i, '')
      return node.text.trim() === href ? node.text : `${node.text} (${href})`
    })
    .join('')
}

function listToText(
  items: BlogListItem[],
  marker: (index: number) => string
): string {
  return items
    .map((item, index) => {
      const prefix = marker(index)
      const [first, ...rest] = item.content
      const lead =
        first?.type === 'paragraph'
          ? inlineToText(first.content)
          : first
            ? blockToText(first)
            : ''
      const nested = rest
        .map(b => blockToText(b))
        .filter(Boolean)
        .map(text => indentLines(text, ' '.repeat(prefix.length)))
      return [`${prefix}${lead}`, ...nested].join('\n')
    })
    .join('\n')
}

function blockToText(block: BlogBlock, figures = { count: 0 }): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return hasText(block.content) ? inlineToText(block.content) : ''
    case 'table':
      return block.content
        .map(row =>
          row.content
            .map(cell =>
              cell.content
                .map(b => blockToText(b))
                .filter(Boolean)
                .join(' ')
                .replace(/\s*\n\s*/g, ' ')
            )
            .join(' | ')
        )
        .join('\n')
    case 'callout':
      return [
        `${CALLOUT_LABELS[block.attrs.variant]}:`,
        ...block.content.map(b => blockToText(b))
      ]
        .filter(Boolean)
        .join('\n')
    case 'diagram': {
      figures.count++
      const d = block.attrs
      return [
        `[Figure ${figures.count}: ${d.title || d.alt || 'Diagram'}]`,
        diagramDescription({ ...d, title: '' }),
        d.caption
      ]
        .filter(Boolean)
        .join('\n')
    }
    case 'bulletList':
      return listToText(block.content, () => '- ')
    case 'orderedList': {
      const start = block.attrs?.start ?? 1
      return listToText(block.content, index => `${start + index}. `)
    }
    case 'blockquote':
      return block.content
        .map(b => blockToText(b))
        .filter(Boolean)
        .join('\n\n')
        .split('\n')
        .map(line => (line ? `> ${line}` : '>'))
        .join('\n')
    case 'horizontalRule':
      return '---'
  }
}

export function blogToText(blog: BlogContent): string {
  const parts: string[] = []
  const figures = { count: 0 }
  if (blog.title.trim()) parts.push(blog.title.trim())
  if (blog.featuredImage?.src)
    parts.push(`[Featured image: ${blog.featuredImage.alt.trim() || 'no description'}]`)
  parts.push(
    ...blog.content.content
      .map(block => blockToText(block, figures))
      .filter(Boolean)
  )
  const faq = answeredFaq(blog)
  if (faq.length > 0) {
    parts.push(
      FAQ_HEADING,
      ...faq.map(item => `${item.question.trim()}\n${item.answer.trim()}`)
    )
  }
  const references = referenceList(blog)
  if (references.length > 0) {
    parts.push(
      REFERENCES_HEADING,
      references
        .map(
          (s, i) =>
            `${i + 1}. ${formatReference(s).title}${referenceTail(s)} ${s.url}`
        )
        .join('\n')
    )
  }
  return `${parts.join('\n\n')}\n`
}

// ---------------------------------------------------------------------------
// Standalone page
// ---------------------------------------------------------------------------

/**
 * What a page knows beyond the blog itself: who wrote and publishes it, when,
 * where it lives once published, and where its image can be fetched from.
 */
export type BlogPageMeta = {
  siteName?: string
  author?: { name: string; url?: string; type: 'Organization' | 'Person' }
  /** The published page, when the blog is marked published with its link. */
  publishedUrl?: string | null
  datePublished?: string | null
  dateModified?: string | null
  /** The featured image's public address; a data URL cannot go in metadata. */
  featuredImageUrl?: string | null
  diagramColor?: string
}

/** An address another site can fetch: http(s) only, never a data URL. */
const isPublicUrl = (url: string | null | undefined): url is string =>
  Boolean(url && /^https?:\/\//i.test(url) && isSafeHref(url))

/**
 * schema.org data for search engines: the post (BlogPosting) or article
 * (Article) with its author, publisher, dates, image and the works it cites,
 * and an FAQPage only when the FAQ is on the same page (`faqVisible`):
 * marking up questions a reader cannot see is against search engines' rules.
 */
export function blogJsonLd(
  blog: BlogContent,
  meta: BlogPageMeta = {},
  options: { faqVisible: boolean } = { faqVisible: true }
): object[] {
  const keywords = keywordsOf(blog)
  const faq = options.faqVisible ? answeredFaq(blog) : []
  const references = referenceList(blog)
  const organization = (who: NonNullable<BlogPageMeta['author']>) => ({
    '@type': who.type,
    name: who.name,
    ...(who.url && isPublicUrl(who.url) && { url: who.url })
  })
  const publishedUrl = isPublicUrl(meta.publishedUrl) ? meta.publishedUrl : null
  const main = {
    '@context': 'https://schema.org',
    '@type': BLOG_KIND_DEFAULTS[blog.kind].schemaType,
    headline: blog.title.trim().slice(0, 110),
    ...(blog.metaDescription.trim() && {
      description: blog.metaDescription.trim()
    }),
    ...(isPublicUrl(meta.featuredImageUrl) && {
      image: [meta.featuredImageUrl]
    }),
    ...(meta.author && { author: organization(meta.author) }),
    ...(meta.author && {
      publisher: organization({
        name: meta.siteName || meta.author.name,
        url: meta.author.url,
        type: 'Organization'
      })
    }),
    ...(meta.datePublished && { datePublished: meta.datePublished }),
    ...(meta.dateModified && { dateModified: meta.dateModified }),
    ...(publishedUrl && {
      mainEntityOfPage: { '@type': 'WebPage', '@id': publishedUrl },
      url: publishedUrl
    }),
    ...(keywords.length > 0 && { keywords: keywords.join(', ') }),
    wordCount: blogWordCount(blog.content, faq),
    inLanguage: 'en',
    ...(references.length > 0 && {
      citation: references.map(s => ({
        '@type': 'CreativeWork',
        name: formatReference(s).title,
        url: s.url
      }))
    })
  }
  if (faq.length === 0) return [main]
  return [
    main,
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(item => ({
        '@type': 'Question',
        name: item.question.trim(),
        acceptedAnswer: { '@type': 'Answer', text: item.answer.trim() }
      }))
    }
  ]
}

/** JSON safe inside a <script> element: no character can close it. */
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')

/** The structured data alone, for a CMS's custom code field. */
export function blogJsonLdScript(blog: BlogContent, meta: BlogPageMeta = {}): string {
  return `<script type="application/ld+json">${scriptJson(
    blogJsonLd(blog, meta, { faqVisible: answeredFaq(blog).length > 0 })
  )}</script>`
}

const PAGE_STYLE = `*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:#fff;color:#1f2328;font:17px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
main{padding:40px 20px}
article{max-width:720px;margin:0 auto}
h1{font-size:2.1em;line-height:1.2;margin:0 0 .6em}
h2{font-size:1.45em;line-height:1.3;margin:1.8em 0 .5em}
h3{font-size:1.15em;line-height:1.35;margin:1.4em 0 .4em}
p,ul,ol{margin:0 0 1em}
a{color:#0b57d0}
img,svg{max-width:100%;height:auto}
figure{margin:1.6em 0}
figcaption{margin-top:.5em;font-size:.85em;color:#57606a}
.featured img{display:block;width:100%;border-radius:12px}
.diagram svg{display:block;border:1px solid #d0d7de;border-radius:12px}
blockquote{margin:1.2em 0;padding-left:1em;border-left:3px solid #d0d7de;color:#57606a}
.callout{margin:1.4em 0;padding:14px 18px;border:1px solid #d0d7de;border-radius:10px;background:#f6f8fa}
.callout>:last-child{margin-bottom:0}
.callout-label{margin:0 0 .4em;font-size:.8em;letter-spacing:.04em;text-transform:uppercase;color:#57606a}
.callout-example{background:#fff8e6;border-color:#f0d58c}
.callout-takeaways{background:#eef6ff;border-color:#b6d4fe}
.callout-tip{background:#ecfdf3;border-color:#a6e3bf}
.callout-warning{background:#fff1f0;border-color:#f5b5ae}
.table-wrap{overflow-x:auto;margin:1.4em 0}
table{border-collapse:collapse;width:100%;font-size:.92em}
th,td{border:1px solid #d0d7de;padding:8px 10px;text-align:left;vertical-align:top}
thead th{background:#f6f8fa}
.references ol{font-size:.9em}
@media (max-width:600px){body{font-size:16px}main{padding:24px 16px}h1{font-size:1.75em}}`

/**
 * A complete, responsive HTML page: meta, canonical and social tags,
 * structured data and the article, images embedded as given. The canonical
 * address and og:url appear only when the published page is known, and the
 * social image only when it has a public address.
 */
export function blogToStandaloneHtml(
  blog: BlogContent,
  meta: BlogPageMeta = {}
): string {
  const keywords = keywordsOf(blog)
  const title = (blog.metaTitle || blog.title).trim()
  const description = blog.metaDescription.trim()
  const publishedUrl = isPublicUrl(meta.publishedUrl) ? meta.publishedUrl : null
  const image = isPublicUrl(meta.featuredImageUrl) ? meta.featuredImageUrl : null
  const tag = (attr: 'name' | 'property', key: string, value: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(value)}">`
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    ...(description ? [tag('name', 'description', description)] : []),
    ...(keywords.length > 0 ? [tag('name', 'keywords', keywords.join(', '))] : []),
    ...(publishedUrl ? [`<link rel="canonical" href="${escapeHtml(publishedUrl)}">`] : []),
    tag('property', 'og:type', 'article'),
    tag('property', 'og:title', title),
    ...(description ? [tag('property', 'og:description', description)] : []),
    ...(publishedUrl ? [tag('property', 'og:url', publishedUrl)] : []),
    ...(meta.siteName ? [tag('property', 'og:site_name', meta.siteName)] : []),
    ...(image
      ? [
          tag('property', 'og:image', image),
          ...(blog.featuredImage?.alt ? [tag('property', 'og:image:alt', blog.featuredImage.alt)] : [])
        ]
      : []),
    ...(meta.datePublished ? [tag('property', 'article:published_time', meta.datePublished)] : []),
    ...(meta.dateModified ? [tag('property', 'article:modified_time', meta.dateModified)] : []),
    tag('name', 'twitter:card', image ? 'summary_large_image' : 'summary'),
    `<script type="application/ld+json">${scriptJson(
      blogJsonLd(blog, meta, { faqVisible: answeredFaq(blog).length > 0 })
    )}</script>`,
    `<style>${PAGE_STYLE}</style>`
  ]
  return `<!doctype html>
<html lang="en">
<head>
${head.join('\n')}
</head>
<body>
<main><article>
${blogArticleHtml(blog, { diagramColor: meta.diagramColor })}
</article></main>
</body>
</html>
`
}

/** A download's file name: the slug, else the title's, else "blog". */
export function blogFileName(
  blog: BlogContent,
  ext: 'md' | 'html' | 'txt'
): string {
  return `${slugify(blog.slug) || slugify(blog.title) || 'blog'}.${ext}`
}
