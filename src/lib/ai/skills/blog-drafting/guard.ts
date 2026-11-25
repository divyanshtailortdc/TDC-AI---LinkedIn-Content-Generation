import {
  docFromDraft,
  docLinks,
  draftBlocksToNodes,
  inlineFromMarkup,
  inlineText,
  slugify,
  type BlogBlock,
  type BlogDoc
} from '@/lib/blogs/doc'
import { normalizeKeywords } from '@/lib/blogs/input'
import {
  isSearchIntent,
  type BlogPlan,
  type BlogSource,
  type FaqItem,
  type SearchIntent
} from '@/lib/blogs/types'
import { normalizeUrlForCompare } from '@/lib/urls'
import type { GenerationContext } from '../../context-blocks'
import type { BlogDraft, BlogSectionDraft } from './schema'

/** Questions kept from the model's FAQ, at most. */
const MAX_FAQ = 8

const collapse = (text: string | undefined | null) =>
  (text ?? '').replace(/\s+/g, ' ').trim()

/** Model text as plain words: a link keeps its words, bold and italic their text. */
const plainText = (text: string | undefined | null) =>
  collapse(inlineText(inlineFromMarkup(collapse(text), null).nodes))
const unique = <T>(values: T[]) => Array.from(new Set(values))

/**
 * Links a blog may carry besides its sources, as posts allow: the goal's
 * page, the identity's website and its offerings' pages.
 */
export function ownLinksOf(ctx: GenerationContext): string[] {
  return unique(
    [
      ctx.primaryGoal?.targetUrl,
      ctx.account.websiteUrl,
      ...ctx.offerings.map(o => o.url)
    ]
      .map(url => url?.trim())
      .filter((url): url is string => Boolean(url))
  )
}

/** The same page as one of `allowed`, ignoring scheme, www and tracking. */
export function isAllowedLink(url: string, allowed: string[]): boolean {
  const target = normalizeUrlForCompare(url)
  return allowed.some(link => normalizeUrlForCompare(link) === target)
}

const removedFlag = (url: string) =>
  `Removed a link to ${url} that was not among the sources.`

/** The sources a text relies on: the ids it named, and the ones it links to. */
function markCited(
  sources: BlogSource[],
  usedIds: string[],
  doc: BlogDoc
): BlogSource[] {
  const used = new Set(usedIds)
  const linked = new Set(docLinks(doc).map(normalizeUrlForCompare))
  return sources.map(source => ({
    ...source,
    cited:
      source.cited ||
      used.has(source.id) ||
      (source.url !== null && linked.has(normalizeUrlForCompare(source.url)))
  }))
}

export type CleanBlog = {
  title: string
  slug: string
  metaTitle: string
  metaDescription: string
  primaryKeyword: string
  keywords: string[]
  searchIntent: SearchIntent | ''
  doc: BlogDoc
  faq: FaqItem[]
  /** The pool with the sources this blog relies on marked as cited. */
  sources: BlogSource[]
  /** What the guard changed, for the author to know. */
  flags: string[]
}

/**
 * A drafted blog made safe to store: links only to its sources, the
 * identity's own pages and the plan's internal links (any other becomes plain
 * text and is flagged), a clean slug, the brief's keyword kept, secondary
 * keywords deduplicated, the FAQ capped (or emptied when it was not asked
 * for), and diagrams that did not hold together left out and flagged.
 */
export function cleanBlogDraft(
  draft: BlogDraft,
  input: {
    sources: BlogSource[]
    ownLinks: string[]
    faqWanted: boolean
    /** The brief's primary keyword; empty when the model chose one. */
    keyword: string
    /** Secondary keywords the user chose: kept, ahead of the model's own. */
    briefKeywords?: string[]
    /** The plan it was written from: its internal links are allowed. */
    plan?: BlogPlan | null
  }
): CleanBlog {
  const allowed = [
    ...input.sources.flatMap(source => (source.url ? [source.url] : [])),
    ...input.ownLinks,
    ...(input.plan?.internalLinks ?? []).map(link => link.url)
  ]
  const { doc, removedLinks, dropped } = docFromDraft(draft, url =>
    isAllowedLink(url, allowed)
  )
  const primaryKeyword =
    collapse(input.keyword) || collapse(draft.primaryKeyword)
  const keywords = normalizeKeywords([
    ...(input.briefKeywords ?? []),
    ...(draft.secondaryKeywords ?? [])
  ]).filter(keyword => keyword.toLowerCase() !== primaryKeyword.toLowerCase())
  const faq = input.faqWanted
    ? (draft.faq ?? [])
        // The FAQ is plain text: Markdown left in it would show as typed.
        .map(item => ({
          question: plainText(item.question),
          answer: plainText(item.answer)
        }))
        .filter(item => item.question && item.answer)
        .slice(0, MAX_FAQ)
    : []
  return {
    title: collapse(draft.title),
    slug: slugify(draft.slug ?? '') || slugify(primaryKeyword || draft.title),
    metaTitle: collapse(draft.metaTitle),
    metaDescription: collapse(draft.metaDescription),
    primaryKeyword,
    keywords,
    searchIntent: isSearchIntent(draft.searchIntent)
      ? draft.searchIntent
      : (input.plan?.searchIntent ?? ''),
    doc,
    faq,
    sources: markCited(input.sources, draft.sourcesUsed ?? [], doc),
    flags: [...unique(removedLinks).map(removedFlag), ...dropped]
  }
}

/**
 * A rewritten section as blocks for replaceSection: its H2 first (the old
 * heading when the model left it empty), links checked as for a whole blog.
 */
export function cleanSectionDraft(
  section: BlogSectionDraft,
  input: {
    sources: BlogSource[]
    ownLinks: string[]
    fallbackHeading: string
    /** Internal links the blog suggests, allowed as in the whole piece. */
    extraLinks?: string[]
  }
): { blocks: BlogBlock[]; sources: BlogSource[]; flags: string[] } {
  const allowed = [
    ...input.sources.flatMap(source => (source.url ? [source.url] : [])),
    ...input.ownLinks,
    ...(input.extraLinks ?? [])
  ]
  const heading =
    collapse((section.heading ?? '').replace(/^\s*#+\s*/, '')) ||
    input.fallbackHeading
  const { nodes, removedLinks, dropped } = draftBlocksToNodes(
    section.blocks ?? [],
    url => isAllowedLink(url, allowed)
  )
  const blocks: BlogBlock[] = [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: heading }]
    },
    ...nodes
  ]
  return {
    blocks,
    sources: markCited(input.sources, section.sourcesUsed ?? [], {
      type: 'doc',
      content: blocks
    }),
    flags: [...unique(removedLinks).map(removedFlag), ...dropped]
  }
}

/** A block that says something: text, list items, example paragraphs or table rows. */
const hasContent = (block: BlogDraft['sections'][number]['blocks'][number]) =>
  Boolean(collapse(block.text)) ||
  (block.items ?? []).some(item => collapse(item)) ||
  (block.paragraphs ?? []).some(paragraph => collapse(paragraph)) ||
  (block.rows ?? []).some(row => row.some(cell => collapse(cell)))

/** Every part a blog cannot go without. */
export function isCompleteBlogDraft(draft: BlogDraft): boolean {
  const hasSection = (draft.sections ?? []).some(
    section =>
      collapse(section.heading) && (section.blocks ?? []).some(hasContent)
  )
  return (
    Boolean(collapse(draft.title)) &&
    (draft.introduction ?? []).some(paragraph => collapse(paragraph)) &&
    hasSection &&
    Boolean(collapse(draft.metaTitle)) &&
    Boolean(collapse(draft.metaDescription))
  )
}
