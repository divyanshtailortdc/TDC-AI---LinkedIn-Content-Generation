import type { LintFinding } from '@/lib/lint/run-linter'
import {
  blogWordCount,
  countWords,
  docLinks,
  docOutline,
  docParagraphs,
  docText,
  slugify,
  type BlogDoc
} from './doc'
import {
  BLOG_LENGTH_SPECS,
  type BlogLength,
  type FaqItem,
  type SearchIntent
} from './types'

/**
 * The SEO checklist: pure, so the editor runs it live on every change and the
 * server stores the same findings. Each check passes as an `info` finding or
 * fails as a `warning` (an `error` only for an empty title or meta field), in
 * the `LintFinding` shape posts use. Keyword checks are skipped when the blog
 * has no primary keyword.
 */

export type SeoInput = {
  title: string
  metaTitle: string
  metaDescription: string
  slug: string
  primaryKeyword: string
  keywords: string[]
  content: BlogDoc
  faq: FaqItem[]
  length: BlogLength
  /** The FAQ was asked for; without it, an empty FAQ is fine. */
  faqWanted: boolean
  /** Web research was used, so facts should link to their sources. */
  researchUsed: boolean
  /** Absent: not checked (callers from before intent existed). */
  searchIntent?: SearchIntent | ''
  /** The featured image's alt text; null when there is none; absent: not checked. */
  featuredImage?: { alt: string } | null
  /** The identity's own hosts; given, the piece should link one of their pages. */
  internalLinkHosts?: string[]
}

const TITLE = { min: 20, max: 70 }
const META_TITLE = { min: 30, max: 60 }
const META_DESCRIPTION = { min: 120, max: 160 }
const SLUG_MAX = 75
const MAX_DENSITY_PCT = 2.5
const INTRO_WORDS = 100
const MAX_PARAGRAPH_WORDS = 150
const FAQ_COUNT = { min: 3, max: 8 }
/**
 * Length is advice, not a target: depth sets it. Only a piece under this
 * share of its length's words (likely thin) or over the next (likely
 * padded) is flagged.
 */
const LENGTH_FLOOR = 0.6
const LENGTH_CEILING = 1.3
const MAX_FAQ_ANSWER_WORDS = 100

const LETTER = '[\\p{L}\\p{M}\\p{N}]'
/** Lowercase words of letters and digits in any script, one space apart. */
const normalize = (text: string) =>
  text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Small words a writer puts between a keyword's words without changing the
 * search ("B2B eCommerce and ERP" for "B2B eCommerce ERP"); search engines
 * read these as the same phrase.
 */
const JOINING_WORDS = ['and', 'or', 'for', 'of', 'the', 'a', 'an', 'to', 'in', 'on', 'with', 'your', 'vs', 'versus']
const JOINER = `(?: (?:${JOINING_WORDS.join('|')})){0,2}`

/**
 * The keyword as a whole phrase, its last word optionally plural, with up to
 * two joining words between its words.
 */
function keywordPattern(keyword: string, flags: string): RegExp | null {
  const phrase = normalize(keyword)
  if (!phrase) return null
  const body = phrase
    .split(' ')
    .map(escapeRegex)
    .join(`${JOINER} `)
  return new RegExp(
    `(?<!${LETTER})${body}(?:e?s)?(?!${LETTER})`,
    `u${flags}`
  )
}

export function containsKeyword(text: string, keyword: string): boolean {
  const pattern = keywordPattern(keyword, '')
  return pattern !== null && pattern.test(normalize(text))
}

export function keywordCount(text: string, keyword: string): number {
  const pattern = keywordPattern(keyword, 'g')
  return pattern ? (normalize(text).match(pattern) ?? []).length : 0
}

/** Characters as a reader counts them (code points, not UTF-16 units). */
const length = (text: string) => Array.from(text.trim()).length

/** Lowercase words of any script joined by single hyphens. */
const SLUG_FORMAT =
  /^[\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]+)*$/u

const quoteList = (values: string[]) => values.map(v => `"${v}"`).join(', ')

export function runSeoChecks(input: SeoInput): LintFinding[] {
  const findings: LintFinding[] = []
  const pass = (rule: string, message: string) =>
    findings.push({ rule, severity: 'info', message, passed: true })
  const fail = (rule: string, severity: 'error' | 'warning', message: string) =>
    findings.push({ rule, severity, message, passed: false })

  const keyword = input.primaryKeyword.trim()
  const body = docText(input.content)
  const outline = docOutline(input.content)
  const title = input.title.trim()
  const metaTitle = input.metaTitle.trim()
  const metaDescription = input.metaDescription.trim()

  // Title and meta fields
  if (!title) fail('seo_title', 'error', 'Add a title.')
  else if (length(title) < TITLE.min || length(title) > TITLE.max) {
    fail(
      'seo_title',
      'warning',
      `The title is ${length(title)} characters; aim for ${TITLE.min}-${TITLE.max} so it is not cut off.`
    )
  } else pass('seo_title', `The title is ${length(title)} characters.`)

  if (!metaTitle) {
    fail(
      'seo_meta_title',
      'error',
      'Add a meta title (the title search results show).'
    )
  } else if (
    length(metaTitle) < META_TITLE.min ||
    length(metaTitle) > META_TITLE.max
  ) {
    fail(
      'seo_meta_title',
      'warning',
      `The meta title is ${length(metaTitle)} characters; search results show about 60. Aim for ${META_TITLE.min}-${META_TITLE.max}.`
    )
  } else
    pass('seo_meta_title', `The meta title is ${length(metaTitle)} characters.`)

  if (!metaDescription) {
    fail(
      'seo_meta_description',
      'error',
      'Add a meta description (the text under the title in search results).'
    )
  } else if (
    length(metaDescription) < META_DESCRIPTION.min ||
    length(metaDescription) > META_DESCRIPTION.max
  ) {
    fail(
      'seo_meta_description',
      'warning',
      `The meta description is ${length(metaDescription)} characters; aim for ${META_DESCRIPTION.min}-${META_DESCRIPTION.max}.`
    )
  } else {
    pass(
      'seo_meta_description',
      `The meta description is ${length(metaDescription)} characters.`
    )
  }

  // Slug
  const slug = input.slug.trim()
  const keywordWords = keyword
    ? slugify(keyword)
        .split('-')
        .filter(word => Array.from(word).length >= 3)
    : []
  const slugWords = slug.split('-')
  const missingFromSlug = keywordWords.filter(
    word =>
      !slugWords.some(
        part => part === word || part === `${word}s` || part === `${word}es`
      )
  )
  if (!slug) fail('seo_slug', 'warning', 'Add a URL slug.')
  else if (!SLUG_FORMAT.test(slug)) {
    fail(
      'seo_slug',
      'warning',
      'The slug should be lowercase words joined by hyphens.'
    )
  } else if (length(slug) > SLUG_MAX) {
    fail(
      'seo_slug',
      'warning',
      `The slug is ${length(slug)} characters; keep it under ${SLUG_MAX}.`
    )
  } else if (missingFromSlug.length > 0) {
    fail(
      'seo_slug',
      'warning',
      `The slug does not contain the keyword ("${slugify(keyword)}").`
    )
  } else pass('seo_slug', 'The slug is short and readable.')

  // Primary keyword
  if (keyword) {
    const uses = (rule: string, field: string, text: string) => {
      if (!text) return
      if (containsKeyword(text, keyword))
        pass(rule, `The ${field} uses the primary keyword.`)
      else
        fail(
          rule,
          'warning',
          `The ${field} does not use the primary keyword "${keyword}".`
        )
    }
    uses('seo_title_keyword', 'title', title)
    uses('seo_meta_title_keyword', 'meta title', metaTitle)
    uses('seo_meta_description_keyword', 'meta description', metaDescription)

    const intro = body.split(/\s+/).slice(0, INTRO_WORDS).join(' ')
    if (containsKeyword(intro, keyword)) {
      pass(
        'seo_keyword_intro',
        'The primary keyword is in the first 100 words.'
      )
    } else {
      fail(
        'seo_keyword_intro',
        'warning',
        'Use the primary keyword in the first 100 words.'
      )
    }

    if (outline.some(h => containsKeyword(h.text, keyword))) {
      pass('seo_keyword_heading', 'A heading uses the primary keyword.')
    } else {
      fail(
        'seo_keyword_heading',
        'warning',
        'Use the primary keyword in at least one heading.'
      )
    }

    const count = keywordCount(body, keyword)
    const words = countWords(body)
    const density = words > 0 ? (count / words) * 100 : 0
    if (count === 0) {
      fail(
        'seo_keyword_density',
        'warning',
        'The primary keyword does not appear in the text.'
      )
    } else if (density > MAX_DENSITY_PCT) {
      fail(
        'seo_keyword_density',
        'warning',
        `The primary keyword appears ${count} times (${density.toFixed(1)}% of words); over ${MAX_DENSITY_PCT}% reads as keyword stuffing.`
      )
    } else {
      pass('seo_keyword_density', `The primary keyword appears ${count} times.`)
    }
  }

  // Secondary keywords
  const secondary = input.keywords.map(k => k.trim()).filter(Boolean)
  if (secondary.length > 0) {
    const everything = [
      title,
      body,
      ...input.faq.flatMap(f => [f.question, f.answer])
    ].join('\n')
    const missing = secondary.filter(k => !containsKeyword(everything, k))
    if (missing.length > 0) {
      fail(
        'seo_secondary_keywords',
        'warning',
        `Not used yet: ${quoteList(missing)}.`
      )
    } else pass('seo_secondary_keywords', 'Every secondary keyword is used.')
  }

  // Structure
  const spec = BLOG_LENGTH_SPECS[input.length]
  const sections = outline.filter(h => h.level === 2).length
  if (sections < spec.minSections) {
    fail(
      'seo_sections',
      'warning',
      `Only ${sections} section heading${sections === 1 ? '' : 's'}; use at least ${spec.minSections} so readers can scan.`
    )
  } else pass('seo_sections', `${sections} section headings.`)

  if (outline[0]?.level === 3) {
    fail(
      'seo_heading_order',
      'warning',
      'A subheading (H3) comes before the first section heading (H2).'
    )
  } else pass('seo_heading_order', 'Headings are in order.')

  const named = outline.map(h => h.text).filter(Boolean)
  const duplicate = named.find(
    (text, i) =>
      named.findIndex(other => other.toLowerCase() === text.toLowerCase()) !== i
  )
  if (duplicate)
    fail(
      'seo_duplicate_headings',
      'warning',
      `Two headings read "${duplicate}".`
    )
  else pass('seo_duplicate_headings', 'Every heading is different.')

  if (outline.some(h => !h.text))
    fail('seo_empty_headings', 'warning', 'A heading is empty.')
  else pass('seo_empty_headings', 'No empty headings.')

  // Length and readability
  const total = blogWordCount(input.content, input.faq)
  if (total < spec.words * LENGTH_FLOOR) {
    fail(
      'seo_length',
      'warning',
      `${total} words: thin for a ${spec.label.toLowerCase()} piece (about ${spec.words}). Fine if it covers the topic; otherwise add depth, not padding.`
    )
  } else if (total > spec.words * LENGTH_CEILING) {
    fail(
      'seo_length',
      'warning',
      `${total} words: long for a ${spec.label.toLowerCase()} piece (about ${spec.words}). Cut what repeats.`
    )
  } else pass('seo_length', `${total} words.`)

  const longest = Math.max(0, ...docParagraphs(input.content).map(countWords))
  if (longest > MAX_PARAGRAPH_WORDS) {
    fail(
      'seo_paragraphs',
      'warning',
      `A paragraph runs ${longest} words; split paragraphs over ${MAX_PARAGRAPH_WORDS} words.`
    )
  } else pass('seo_paragraphs', 'Paragraphs are a readable length.')

  // FAQ
  if (input.faqWanted) {
    const answered = input.faq.filter(f => f.question.trim() && f.answer.trim())
    const longAnswer = Math.max(0, ...answered.map(f => countWords(f.answer)))
    if (answered.length < FAQ_COUNT.min || answered.length > FAQ_COUNT.max) {
      fail(
        'seo_faq',
        'warning',
        `${answered.length} question${answered.length === 1 ? '' : 's'} in the FAQ; aim for ${FAQ_COUNT.min}-${FAQ_COUNT.max}.`
      )
    } else if (longAnswer > MAX_FAQ_ANSWER_WORDS) {
      fail(
        'seo_faq',
        'warning',
        `An FAQ answer runs ${longAnswer} words; keep answers under ${MAX_FAQ_ANSWER_WORDS} words.`
      )
    } else pass('seo_faq', `${answered.length} questions in the FAQ.`)
  }

  // Search intent, images and internal links
  if (input.searchIntent !== undefined) {
    if (input.searchIntent) {
      pass('seo_intent', `Written for ${input.searchIntent} searches.`)
    } else {
      fail(
        'seo_intent',
        'warning',
        'Choose the search intent: what someone searching the keyword wants.'
      )
    }
  }
  if (input.featuredImage !== undefined) {
    if (!input.featuredImage) {
      fail('seo_featured_image', 'warning', 'Add a featured image.')
    } else if (!input.featuredImage.alt.trim()) {
      fail(
        'seo_featured_image',
        'warning',
        'Describe the featured image in its alt text.'
      )
    } else pass('seo_featured_image', 'The featured image has alt text.')
  }
  const diagrams = input.content.content.filter(block => block.type === 'diagram')
  if (diagrams.length > 0) {
    const missing = diagrams.filter(
      block => block.type === 'diagram' && !block.attrs.alt.trim()
    ).length
    if (missing > 0) {
      fail(
        'seo_figure_alt',
        'warning',
        `${missing} diagram${missing === 1 ? ' has' : 's have'} no alt text. Say what each shows.`
      )
    } else pass('seo_figure_alt', 'Every diagram has alt text.')
  }
  const hosts = (input.internalLinkHosts ?? [])
    .map(host => host.toLowerCase().replace(/^www\./, ''))
    .filter(Boolean)
  if (hosts.length > 0) {
    const internal = docLinks(input.content).filter(href => {
      try {
        return hosts.includes(new URL(href).hostname.toLowerCase().replace(/^www\./, ''))
      } catch {
        return false
      }
    }).length
    if (internal > 0) {
      pass('seo_internal_links', `${internal} link${internal === 1 ? '' : 's'} to your own site.`)
    } else {
      fail(
        'seo_internal_links',
        'warning',
        'Link to at least one page of your own site (see Links).'
      )
    }
  }

  // Citations
  if (input.researchUsed) {
    const linked = docLinks(input.content).some(href =>
      /^https?:\/\//i.test(href)
    )
    if (linked) pass('seo_citations', 'Facts link to their sources.')
    else {
      fail(
        'seo_citations',
        'warning',
        'No sources are linked. Link the facts to the sources they came from.'
      )
    }
  }

  return findings
}

export function seoSummary(findings: LintFinding[]): {
  passed: number
  total: number
} {
  return {
    passed: findings.filter(f => f.passed).length,
    total: findings.length
  }
}

/**
 * The site a search result shows for the identity's website address
 * ("https://www.tdccommerce.com" is tdccommerce.com), or null without a
 * usable one.
 */
export function searchResultHost(
  websiteUrl: string | null | undefined
): string | null {
  const raw = websiteUrl?.trim()
  if (!raw) return null
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
      .hostname.toLowerCase()
      .replace(/^www\./, '')
    return host.includes('.') ? host : null
  } catch {
    return null
  }
}
