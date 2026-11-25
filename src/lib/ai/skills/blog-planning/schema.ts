import {
  CTA_KINDS,
  PLAN_ELEMENTS,
  PRODUCT_ROLES,
  SEARCH_INTENTS
} from '@/lib/blogs/types'
import { z } from 'zod'

/**
 * A blog's plan as the model returns it: decided before any prose, so the
 * writer builds on an angle, a structure and a claim-to-source map instead
 * of improvising them. Flat where it can be (product, CTA and image are
 * fields, not objects), so every provider's structured output accepts it.
 */
export const BlogPlanSchema = z.object({
  searchIntent: z
    .enum(SEARCH_INTENTS)
    .describe(
      'What the person searching the primary keyword wants: to learn (informational), to weigh options before buying (commercial), to act now (transactional), to reach a known page (navigational)'
    ),
  readerNeed: z
    .string()
    .describe('The question or job the reader arrives with, in one sentence'),
  angle: z
    .string()
    .describe('The specific take this piece argues or shows, in one or two sentences'),
  originality: z
    .string()
    .describe(
      'What this piece adds that typical articles on the topic do not: a decision rule, a worked example, a comparison, data put together, a backed contrarian point'
    ),
  primaryKeyword: z
    .string()
    .describe('The primary keyword given, or the phrase this reader would search'),
  secondaryKeywords: z
    .array(z.string())
    .describe('2-6 related phrases this reader also searches'),
  workingTitle: z.string().describe('A specific working title with the primary keyword'),
  takeaways: z
    .boolean()
    .describe('Open with a key-takeaways box (long or analytical pieces, case studies)'),
  sections: z
    .array(
      z.object({
        heading: z.string().describe('The H2: what the section covers, in plain words'),
        purpose: z.string().describe('What the section does for the reader'),
        points: z.array(z.string()).describe('The points it makes, in order'),
        sourceIds: z
          .array(z.string())
          .describe('The ids of the sources its facts come from (S1, K2…)'),
        element: z
          .enum(PLAN_ELEMENTS)
          .describe('At most one element, only where it carries information; else none'),
        elementNote: z.string().describe('What the element shows; empty for none')
      })
    )
    .describe('The outline, in order; the last section closes the piece'),
  faq: z
    .array(z.string())
    .describe('FAQ questions when the FAQ is asked for; else empty'),
  productRole: z
    .enum(PRODUCT_ROLES)
    .describe("How much the piece says about the author's own products"),
  productWhere: z.string().describe('Where the products come in; empty for none'),
  productNote: z
    .string()
    .describe('What it says about them, and from which source; empty for none'),
  ctaKind: z.enum(CTA_KINDS).describe("The call to action's kind"),
  ctaText: z.string().describe('The call to action, in the closing section'),
  ctaUrl: z.string().describe('One of the links the call to action may use, or empty'),
  imageConcept: z
    .string()
    .describe('An editorial picture for the top of the page, with no text in it'),
  imageAlt: z.string().describe('Alt text: what the picture shows, in one sentence'),
  imageStyle: z.enum(['photo', 'illustration']),
  internalLinks: z
    .array(
      z.object({
        url: z.string().describe('A page from the list, exactly as given'),
        anchor: z.string().describe('The words that carry the link, as they read in a sentence'),
        sectionIndex: z
          .number()
          .describe('Where it goes: 0 the introduction, 1 the first section…'),
        reason: z.string().describe('Why a reader of that section wants this page')
      })
    )
    .describe('2-5 pages from the list a reader would want next'),
  gaps: z
    .array(z.string())
    .describe('Facts the piece would want that no source supports: never stated'),
  cautions: z
    .array(z.string())
    .describe('Sources that disagree, dated or narrow data, snippet-only figures')
})

export type BlogPlanDraft = z.infer<typeof BlogPlanSchema>
