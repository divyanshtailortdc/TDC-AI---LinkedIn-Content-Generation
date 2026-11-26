import { SEARCH_INTENTS } from '@/lib/blogs/types'
import { z } from 'zod'

/**
 * One block of a section. Flat rather than a union, so every provider's
 * structured output accepts it: each kind reads its own fields
 * (src/lib/blogs/doc.ts, DraftBlock).
 *
 * The order of the fields matters. Structured output writes properties in
 * the schema's order, so what says which kind of block it is (type, a box's
 * variant, a diagram's kind) comes first, then the fields that fill it in the
 * order a writer would give them. With the kind after the content, a box was
 * written with no text and a diagram with no steps.
 */
export const BlogBlockSchema = z.object({
  type: z
    .enum([
      'paragraph',
      'subheading',
      'bullets',
      'numbered',
      'quote',
      'table',
      'example',
      'callout',
      'diagram'
    ])
    .describe(
      'paragraph: text (2-5 sentences). subheading: text (an H3 inside the section). bullets / numbered: items, only where the content really is a list or steps. quote: text, a short quotation copied word for word from a source named around it. table: columns then rows, for two or more items compared on two or more attributes. example: title then paragraphs, a made-up scenario the page labels "Hypothetical example". callout: variant, then title and text (or items). diagram: diagram (its kind), title, items, then for a bar chart values and unit, then caption, alt and sourceId.'
    ),
  variant: z
    .enum(['tip', 'warning', 'note'])
    .optional()
    .describe("A callout's kind, written first"),
  diagram: z
    .enum(['flow', 'timeline', 'bar'])
    .optional()
    .describe("A diagram's kind, written first"),
  title: z
    .string()
    .optional()
    .describe("An example's or a callout's bold first line; a diagram's title"),
  text: z
    .string()
    .optional()
    .describe(
      'For paragraph, subheading, quote and callout. Plain prose with inline **bold**, *italic* and [text](url) only; links only to URLs given in the prompt.'
    ),
  paragraphs: z.array(z.string()).optional().describe("An example's paragraphs"),
  items: z
    .array(z.string())
    .optional()
    .describe(
      'For bullets and numbered: 3-7 items, each one complete line. For a callout: optional list items. For a diagram: the steps (flow), the dated entries "2019 — what happened" (timeline), or the bar labels (bar).'
    ),
  values: z
    .array(z.number())
    .optional()
    .describe("A bar chart's values, one per label, all from the one source in sourceId"),
  unit: z.string().optional().describe("A bar chart's unit, e.g. %, days"),
  columns: z.array(z.string()).optional().describe("A table's column headings"),
  rows: z
    .array(z.array(z.string()))
    .optional()
    .describe("A table's rows, one cell per column"),
  caption: z.string().optional().describe("A diagram's caption"),
  alt: z.string().optional().describe("A diagram's alt text: what it shows"),
  sourceId: z
    .string()
    .optional()
    .describe("The source (S1, K2…) a chart's, a table's or a quote's figures come from")
})

export const BlogDraftSchema = z.object({
  title: z
    .string()
    .describe(
      'The H1: specific, at most 70 characters (aim for 50-60), using the primary keyword naturally; no clickbait'
    ),
  slug: z
    .string()
    .describe('URL slug: 3-6 lowercase words from the primary keyword, joined by hyphens'),
  metaTitle: z
    .string()
    .describe('The title search results show: 30-60 characters, the primary keyword near the start'),
  metaDescription: z
    .string()
    .describe(
      'The text under the title in search results: 120-160 characters, with the primary keyword and a concrete reason to read'
    ),
  primaryKeyword: z
    .string()
    .describe('The primary keyword the piece targets: the one given, or the one you chose'),
  secondaryKeywords: z
    .array(z.string())
    .describe('2-6 related phrases the piece also uses naturally'),
  searchIntent: z
    .enum(SEARCH_INTENTS)
    .describe("The plan's search intent, or what the person searching the primary keyword wants"),
  keyTakeaways: z
    .array(z.string())
    .describe('3-5 points for a key-takeaways box after the introduction, when the plan asks for one; else empty'),
  introduction: z
    .array(z.string())
    .describe(
      '1-3 paragraphs that open on one concrete thing and use the primary keyword in the first 100 words'
    ),
  sections: z
    .array(
      z.object({
        heading: z
          .string()
          .describe(
            'The H2: the searched question when the plan gives one, else what the section covers in plain words; never "Conclusion"'
          ),
        lead: z
          .string()
          .describe(
            'The answer first: 1-3 sentences (about 30-70 words) that answer the heading directly and stand alone if quoted; names its subject, never "this"/"it" pointing back; inline [text](url) for a fact from a source'
          ),
        blocks: z.array(BlogBlockSchema)
      })
    )
    .describe(
      'The body: each section makes one distinct point under its own H2. The last section closes the piece with the next step and the call to action.'
    ),
  faq: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .describe(
      'Questions people search about this topic, each answered in 40-80 self-contained words that open with the direct answer; empty when the FAQ is not asked for'
    ),
  sourcesUsed: z
    .array(z.string())
    .default([])
    .describe('The ids of the sources the piece relies on, e.g. ["S1", "K2"]'),
  selfFlags: z
    .array(z.string())
    .default([])
    .describe('Any weakness or caveat the author should check')
})

export type BlogDraft = z.infer<typeof BlogDraftSchema>

/** One rewritten section: its H2, its blocks and the sources it relies on. */
export const BlogSectionSchema = z.object({
  heading: z
    .string()
    .describe('The section H2; keep it unless the author asked to change it'),
  lead: z
    .string()
    .describe(
      'The answer first: 1-3 sentences (about 30-70 words) that answer the heading directly and stand alone if quoted'
    ),
  blocks: z.array(BlogBlockSchema),
  sourcesUsed: z
    .array(z.string())
    .default([])
    .describe('The ids of the sources this section relies on')
})

export type BlogSectionDraft = z.infer<typeof BlogSectionSchema>

/** The sentences a fact check failed, rewritten: an empty replacement drops one. */
export const SentenceFixesSchema = z.object({
  fixes: z.array(
    z.object({
      id: z.string().describe('The problem id, e.g. F1'),
      replacement: z
        .string()
        .describe('The rewritten sentence or two; empty to drop the sentence')
    })
  )
})

export type SentenceFixes = z.infer<typeof SentenceFixesSchema>
