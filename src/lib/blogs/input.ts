import { z } from 'zod'
import {
  BLOG_DESTINATION_IDS,
  DEFAULT_BLOG_DESTINATION,
  type BlogDestinationId
} from './destinations'
import { sanitizeDoc, slugify, type BlogDoc } from './doc'
import {
  BLOG_KINDS,
  BLOG_LENGTHS,
  BLOG_LIMITS,
  BLOG_STYLES,
  isSearchIntent,
  type BlogBrief,
  type BlogKind,
  type FaqItem,
  type SearchIntent
} from './types'

/**
 * What the browser may send for blogs, validated and normalized. A server
 * action's arguments come from the browser whatever their types say, so every
 * action parses its input here first. Pure: the form can use the same rules.
 */

const collapse = (value: string) => value.replace(/\s+/g, ' ').trim()

const INSTRUCTIONS_TOO_LONG = 'Keep the instructions under 1,000 characters.'
const CASE_DETAILS_NEEDED =
  'Describe the real case: who, the problem, what was done and the results.'
/** Shorter than this, a case description cannot hold who, what and the result. */
const CASE_DETAILS_MIN = 40
const BAD_URL = 'Enter a web address that starts with http:// or https://.'
const BAD_DESTINATION = 'Choose where the blog is published.'
const BAD_DATE = 'Enter the date it was published.'
const FUTURE_DATE = 'The publication date can’t be in the future.'
const EARLY_DATE = 'Enter a publication date from 2000 on.'

/**
 * How far ahead of the server's clock a publication date may be: the
 * browser sends the moment it means, and a day east of the server can
 * already be tomorrow there.
 */
const DATE_SLACK_MS = 24 * 60 * 60 * 1000
const EARLIEST_PUBLICATION = Date.UTC(2000, 0, 1)

/**
 * Keywords as they are kept: trimmed, single-spaced, at most 80 characters
 * each, without repeats (ignoring case), in the order given, at most `max`.
 */
export function normalizeKeywords(
  list: unknown[],
  max: number = BLOG_LIMITS.secondaryKeywords
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const keyword = collapse(raw).slice(0, BLOG_LIMITS.keyword).trim()
    const key = keyword.toLowerCase()
    if (!keyword || seen.has(key)) continue
    seen.add(key)
    out.push(keyword)
    if (out.length >= max) break
  }
  return out
}

export const BlogBriefSchema = z
  .object({
    topic: z
      .string({ message: 'Enter a topic.' })
      .transform(collapse)
      .pipe(
        z
          .string()
          .min(1, 'Enter a topic.')
          .max(BLOG_LIMITS.topic, 'Keep the topic under 300 characters.')
      ),
    primaryKeyword: z
      .string()
      .default('')
      .transform(collapse)
      .pipe(
        z
          .string()
          .max(BLOG_LIMITS.keyword, 'Keep the keyword under 80 characters.')
      ),
    secondaryKeywords: z
      .array(z.unknown())
      .default([])
      .transform(list => normalizeKeywords(list)),
    length: z.enum(BLOG_LENGTHS, { message: 'Choose a length.' }),
    style: z.enum(BLOG_STYLES, { message: 'Choose a writing style.' }),
    audience: z
      .object({
        audienceId: z.string().uuid().nullable().default(null),
        note: z
          .string()
          .default('')
          .transform(collapse)
          .pipe(
            z
              .string()
              .max(
                BLOG_LIMITS.audienceNote,
                'Keep the reader description under 300 characters.'
              )
          )
      })
      .default({ audienceId: null, note: '' }),
    research: z.boolean().default(true),
    knowledge: z.boolean().default(true),
    faq: z.boolean().default(true),
    instructions: z
      .string()
      .default('')
      .transform(value => value.trim())
      .pipe(z.string().max(BLOG_LIMITS.instructions, INSTRUCTIONS_TOO_LONG)),
    caseDetails: z
      .string()
      .default('')
      .transform(value => value.trim())
      .pipe(
        z
          .string()
          .max(
            BLOG_LIMITS.caseDetails,
            'Keep the case details under 3,000 characters.'
          )
      )
  })
  // A case study is written only from a real case the user describes.
  .superRefine((brief, ctx) => {
    if (
      brief.style === 'case_study' &&
      brief.caseDetails.length < CASE_DETAILS_MIN
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['caseDetails'],
        message: CASE_DETAILS_NEEDED
      })
    }
  })
  .transform((brief): BlogBrief => ({
    ...brief,
    // The primary keyword is not also a secondary one.
    secondaryKeywords: brief.secondaryKeywords.filter(
      k => k.toLowerCase() !== brief.primaryKeyword.toLowerCase()
    )
  }))

const firstError = (error: z.ZodError) =>
  error.issues[0]?.message || 'Check the form and try again.'

const optionalId = z
  .string()
  .uuid()
  .nullable()
  .optional()
  .transform(value => value ?? null)

const CreateBlogSchema = z.object({
  requestId: z
    .string({ message: 'Reload the page and try again.' })
    .uuid('Reload the page and try again.'),
  kind: z.enum(BLOG_KINDS, { message: 'Choose a blog post or an article.' }),
  ideaId: optionalId,
  goalId: optionalId,
  brief: BlogBriefSchema
})

export type CreateBlogInput = {
  requestId: string
  kind: BlogKind
  ideaId: string | null
  goalId: string | null
  brief: BlogBrief
}

export function parseCreateInput(
  raw: unknown
): { ok: true; value: CreateBlogInput } | { ok: false; error: string } {
  const result = CreateBlogSchema.safeParse(raw)
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: firstError(result.error) }
}

/** What a save writes: the text the user can change in the editor. */
export type BlogEdit = {
  title: string
  slug: string
  metaTitle: string
  metaDescription: string
  primaryKeyword: string
  keywords: string[]
  searchIntent: SearchIntent | ''
  content: BlogDoc
  faq: FaqItem[]
  /** The featured image's alt text and caption (kept only when it has one). */
  featuredAlt: string
  featuredCaption: string
}

const SaveBlogSchema = z.object({
  lockVersion: z.number().int().positive(),
  title: z
    .string()
    .max(BLOG_LIMITS.title, 'Keep the title under 200 characters.'),
  slug: z.string().max(BLOG_LIMITS.slug, 'Keep the slug under 120 characters.'),
  metaTitle: z
    .string()
    .max(BLOG_LIMITS.metaTitle, 'Keep the meta title under 200 characters.'),
  metaDescription: z
    .string()
    .max(
      BLOG_LIMITS.metaDescription,
      'Keep the meta description under 500 characters.'
    ),
  primaryKeyword: z
    .string()
    .max(BLOG_LIMITS.keyword, 'Keep the keyword under 80 characters.'),
  keywords: z.array(z.unknown()).max(50),
  searchIntent: z.unknown().optional(),
  featuredAlt: z
    .string()
    .max(BLOG_LIMITS.altText, 'Keep the alt text under 300 characters.')
    .default(''),
  featuredCaption: z
    .string()
    .max(BLOG_LIMITS.caption, 'Keep the caption under 300 characters.')
    .default(''),
  content: z.unknown(),
  faq: z
    .array(
      z.object({
        question: z
          .string()
          .max(
            BLOG_LIMITS.faqQuestion,
            'Keep each question under 300 characters.'
          ),
        answer: z
          .string()
          .max(
            BLOG_LIMITS.faqAnswer,
            'Keep each answer under 2,000 characters.'
          )
      })
    )
    .max(BLOG_LIMITS.faqItems, 'Keep the FAQ to 12 questions.')
})

export function parseSaveInput(
  raw: unknown
):
  | { ok: true; lockVersion: number; edit: BlogEdit }
  | { ok: false; error: string } {
  const result = SaveBlogSchema.safeParse(raw)
  if (!result.success) return { ok: false, error: firstError(result.error) }
  const input = result.data
  const doc = sanitizeDoc(input.content)
  if (!doc.ok) return { ok: false, error: doc.error }
  return {
    ok: true,
    lockVersion: input.lockVersion,
    edit: {
      title: collapse(input.title),
      slug: slugify(input.slug),
      metaTitle: collapse(input.metaTitle),
      metaDescription: collapse(input.metaDescription),
      primaryKeyword: collapse(input.primaryKeyword),
      keywords: normalizeKeywords(input.keywords),
      searchIntent: isSearchIntent(input.searchIntent) ? input.searchIntent : '',
      content: doc.doc,
      featuredAlt: collapse(input.featuredAlt),
      featuredCaption: collapse(input.featuredCaption),
      // A question still being written is kept; a fully empty one is not.
      faq: input.faq
        .map(item => ({
          question: collapse(item.question),
          answer: item.answer.trim()
        }))
        .filter(item => item.question || item.answer)
    }
  }
}

/** What the user asked a regenerate or rewrite to change; blank is none. */
export function parseInstruction(
  raw: unknown
): { ok: true; instruction: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, instruction: null }
  if (typeof raw !== 'string')
    return { ok: false, error: 'The instruction could not be read.' }
  const instruction = raw.trim()
  if (instruction.length > BLOG_LIMITS.instructions) {
    return { ok: false, error: INSTRUCTIONS_TOO_LONG }
  }
  return { ok: true, instruction: instruction || null }
}

const PublishSchema = z.object({
  published: z.boolean(),
  url: z.string().max(BLOG_LIMITS.url, BAD_URL).nullable().optional(),
  destination: z
    .enum(BLOG_DESTINATION_IDS, { message: BAD_DESTINATION })
    .nullable()
    .optional(),
  // An ISO timestamp from the browser: the moment it was published.
  publishedAt: z.string().max(40, BAD_DATE).nullable().optional()
})

/**
 * Marking a blog published, with where it went (a CMS destination; the
 * identity's own website when not said), its live page and the moment it went
 * out (now when not said), or back to a draft, which keeps none of them.
 */
export function parsePublishInput(
  raw: unknown
):
  | {
      ok: true
      published: boolean
      url: string | null
      destination: BlogDestinationId | null
      publishedAt: Date | null
    }
  | { ok: false; error: string } {
  const result = PublishSchema.safeParse(raw)
  if (!result.success) return { ok: false, error: firstError(result.error) }
  if (!result.data.published) {
    return {
      ok: true,
      published: false,
      url: null,
      destination: null,
      publishedAt: null
    }
  }
  const url = result.data.url?.trim() || null
  if (url) {
    let valid = false
    try {
      const parsed = new URL(url)
      valid =
        /^https?:\/\//i.test(url) &&
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        !!parsed.hostname
    } catch {
      valid = false
    }
    if (!valid) return { ok: false, error: BAD_URL }
  }
  let publishedAt: Date | null = null
  const rawDate = result.data.publishedAt?.trim()
  if (rawDate) {
    const time = /^\d{4}-\d{2}-\d{2}T/.test(rawDate) ? Date.parse(rawDate) : NaN
    if (Number.isNaN(time)) return { ok: false, error: BAD_DATE }
    if (time > Date.now() + DATE_SLACK_MS) return { ok: false, error: FUTURE_DATE }
    if (time < EARLIEST_PUBLICATION) return { ok: false, error: EARLY_DATE }
    publishedAt = new Date(time)
  }
  return {
    ok: true,
    published: true,
    url,
    destination: result.data.destination ?? DEFAULT_BLOG_DESTINATION,
    publishedAt
  }
}

/**
 * A request id (a version 4 UUID) for the New blog form. crypto.randomUUID
 * exists only on secure pages, and the app can be opened over plain http
 * on a local network, so random bytes make one where it is missing.
 */
export function newRequestId(): string {
  const crypto = globalThis.crypto
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
