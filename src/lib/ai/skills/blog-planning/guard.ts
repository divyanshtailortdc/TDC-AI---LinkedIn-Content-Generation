import { normalizeKeywords } from '@/lib/blogs/input'
import {
  CTA_KINDS,
  isSearchIntent,
  PLAN_ELEMENTS,
  PRODUCT_ROLES,
  type BlogPlan,
  type CtaKind,
  type InternalLinkPick,
  type PlanElement,
  type ProductRole
} from '@/lib/blogs/types'
import { normalizeUrlForCompare } from '@/lib/urls'
import type { BlogPlanDraft } from './schema'

/**
 * A plan made safe to write from: only sources the pool has, only link
 * pages that were offered, a call-to-action link only from the allowed ones,
 * the brief's own keywords kept, the FAQ only when it was asked for, and
 * every text trimmed to a sensible size.
 */

const MAX_SECTIONS = 12
const MAX_POINTS = 6
const MAX_FAQ = 8
const MAX_LINKS = 6
const MAX_NOTES = 8

const text = (value: unknown, max = 500) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max).trim() : ''

const texts = (values: unknown, max: number, each = 300) =>
  (Array.isArray(values) ? values : [])
    .map(value => text(value, each))
    .filter(Boolean)
    .slice(0, max)

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  typeof value === 'string' && (list as readonly string[]).includes(value)
    ? (value as T)
    : fallback

/**
 * A keyword the plan chose is something people type into search: at most six
 * words. A longer one is the topic restated, which the piece never uses; the
 * writer then chooses. The author's own keywords are always kept.
 */
const MAX_KEYWORD_WORDS = 6
const isSearchPhrase = (keyword: string) => {
  const words = keyword.trim().split(/\s+/).filter(Boolean).length
  return words > 0 && words <= MAX_KEYWORD_WORDS
}

export function cleanPlan(
  raw: BlogPlanDraft,
  input: {
    sourceIds: string[]
    candidateUrls: string[]
    allowedLinks: string[]
    faqWanted: boolean
    /** The brief's primary keyword; empty when the plan chooses it. */
    keyword: string
    briefKeywords: string[]
  }
): BlogPlan {
  const known = new Set(input.sourceIds)
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map(section => ({
      heading: text(section?.heading, 160).replace(/^#+\s*/, ''),
      purpose: text(section?.purpose, 300),
      points: texts(section?.points, MAX_POINTS),
      sourceIds: Array.from(
        new Set(texts(section?.sourceIds, 20, 12).filter(id => known.has(id)))
      ),
      element: oneOf<PlanElement>(PLAN_ELEMENTS, section?.element, 'none'),
      elementNote: text(section?.elementNote, 300)
    }))
    .filter(section => section.heading)
    .slice(0, MAX_SECTIONS)

  const candidates = new Map(
    input.candidateUrls.map(url => [normalizeUrlForCompare(url), url])
  )
  const seen = new Set<string>()
  const internalLinks: InternalLinkPick[] = []
  for (const link of Array.isArray(raw.internalLinks) ? raw.internalLinks : []) {
    const url = candidates.get(normalizeUrlForCompare(text(link?.url, 2000)))
    const anchor = text(link?.anchor, 80)
    if (!url || !anchor || seen.has(url)) continue
    seen.add(url)
    const index = Number(link?.sectionIndex)
    internalLinks.push({
      url,
      anchor,
      sectionIndex: Number.isInteger(index)
        ? Math.min(Math.max(index, 0), sections.length)
        : 0,
      reason: text(link?.reason, 200)
    })
    if (internalLinks.length >= MAX_LINKS) break
  }

  const allowed = new Map(
    input.allowedLinks.map(url => [normalizeUrlForCompare(url), url])
  )
  const ctaUrl = allowed.get(normalizeUrlForCompare(text(raw.ctaUrl, 2000))) ?? null
  const chosen = text(raw.primaryKeyword, 80)
  const primaryKeyword = text(input.keyword, 80) || (isSearchPhrase(chosen) ? chosen : '')

  return {
    searchIntent: isSearchIntent(raw.searchIntent) ? raw.searchIntent : 'informational',
    primaryKeyword,
    secondaryKeywords: normalizeKeywords([
      ...input.briefKeywords,
      ...(Array.isArray(raw.secondaryKeywords) ? raw.secondaryKeywords : []).filter(
        keyword => typeof keyword === 'string' && isSearchPhrase(keyword)
      )
    ]).filter(keyword => keyword.toLowerCase() !== primaryKeyword.toLowerCase()),
    readerNeed: text(raw.readerNeed, 300),
    angle: text(raw.angle),
    originality: text(raw.originality),
    workingTitle: text(raw.workingTitle, 160),
    sections,
    takeaways: raw.takeaways === true,
    faq: input.faqWanted ? texts(raw.faq, MAX_FAQ) : [],
    product: {
      role: oneOf<ProductRole>(PRODUCT_ROLES, raw.productRole, 'none'),
      where: text(raw.productWhere, 300),
      note: text(raw.productNote, 300)
    },
    cta: {
      kind: oneOf<CtaKind>(CTA_KINDS, raw.ctaKind, 'none'),
      text: text(raw.ctaText, 300),
      url: ctaUrl
    },
    featuredImage: {
      concept: text(raw.imageConcept),
      alt: text(raw.imageAlt, 300),
      style: raw.imageStyle === 'illustration' ? 'illustration' : 'photo'
    },
    internalLinks,
    gaps: texts(raw.gaps, MAX_NOTES),
    cautions: texts(raw.cautions, MAX_NOTES)
  }
}

/** A plan worth writing from: an angle and at least two sections. */
export function isUsablePlan(plan: BlogPlan): boolean {
  return Boolean(plan.angle) && plan.sections.length >= 2
}
