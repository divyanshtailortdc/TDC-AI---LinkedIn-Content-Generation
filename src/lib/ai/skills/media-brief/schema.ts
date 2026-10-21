import { z } from 'zod'
import type { CallUsage } from '../../usage'

export type VisualType =
  | 'framework'
  | 'comparison'
  | 'process'
  | 'decision_tree'
  | 'conceptual_illustration'
  | 'data_visual'
  | 'quote_card'
  | 'product_visual'
  | 'none'

export interface TextOverlaySpec {
  headline: string
  /** Only on briefs written before overlays were cut to one headline. */
  supportingPoints?: string[]
  footer?: string
}

export interface MediaBrief {
  /** What the post is about, in the post's own words. */
  postTopic: string
  coreThesis: string
  readerTakeaway: string
  /** The single visual idea the image should express. */
  primaryConcept: string
  visualMetaphor: string
  visualType: VisualType
  textOverlay: TextOverlaySpec
  avoidConcepts: string[]
  whyItFits: string
  /** How a regenerated concept differs from the earlier ones. */
  howItDiffers?: string
}

export interface EvidenceSource {
  claim: string
  quote?: string
  author?: string
  sourceTitle?: string
  sourceUrl?: string
  isFresh?: boolean
  verified?: boolean
}

export interface BriefGuardResult {
  relevanceScore: number
  isAcceptable: boolean
  issues: string[]
  alignedConcepts: string[]
  explanation: string
}

export const MediaBriefSchema = z.object({
  postTopic: z
    .string()
    .describe("The subject of the post, in the post's own vocabulary."),
  coreThesis: z
    .string()
    .describe('The argument the post makes, in one sentence.'),
  readerTakeaway: z
    .string()
    .describe('What the reader should do or believe after reading.'),
  primaryConcept: z
    .string()
    .describe(
      'The single visual idea the image expresses. Concrete and specific to this post, never a generic business scene.'
    ),
  visualMetaphor: z
    .string()
    .describe(
      'How that idea is shown: the composition, the elements, the relationship between them.'
    ),
  visualType: z
    .enum([
      'framework',
      'comparison',
      'process',
      'decision_tree',
      'conceptual_illustration',
      'data_visual',
      'quote_card',
      'product_visual'
    ])
    .describe('The form that best carries this particular argument.'),
  textOverlay: z
    .object({
      headline: z
        .string()
        .describe(
          'The one line of text the image may carry, up to 8 words, or empty for none. Follow the text rule in the request.'
        )
    })
    .describe(
      'The only lettering in the image. Image models misspell anything smaller.'
    ),
  imagePrompt: z
    .string()
    .describe(
      'The scene for the image model: subject, composition, setting, lighting, style and colours. If there is a headline, quote it exactly once in double quotes and say where it sits. Describe no other lettering, and name objects by how they look rather than by words that would be printed on them ("a thick binder", not "a binder labelled Catalog"). Never mention a logo: the brand rules are appended to this prompt automatically.'
    ),
  altText: z
    .string()
    .describe(
      'Plain description of the image for screen readers, ideally under 300 characters.'
    ),
  whyItFits: z
    .string()
    .describe('One sentence on how this visual carries the post argument.'),
  howItDiffers: z
    .string()
    .default('')
    .describe(
      'When earlier images for this post are listed, one sentence on how this concept differs from them; otherwise empty.'
    )
})

/** An image this post already had, so a new one can be told apart from it. */
export interface PriorVisual {
  concept: string
  visualType?: string
  metaphor?: string
}

/** The goal a post serves, as the art director needs it. */
export interface MediaGoal {
  title: string
  objective?: string | null
  keyMessage?: string | null
  desiredAction?: string | null
}

/** The approved idea a post was written from. */
export interface MediaIdea {
  title?: string | null
  angle?: string | null
  hookConcept?: string | null
  coreArgument?: string | null
  audienceTakeaway?: string | null
}

export interface DeriveMediaBriefInput {
  postText: string
  thesis?: string | null
  hook?: string | null
  evidence?: EvidenceSource[]
  aspectRatio?: '1:1' | '16:9' | '4:5'
  accountName?: string
  /** Who posts and who sees it, from renderMediaContext. */
  accountContext?: string
  /** Visual direction already chosen for this post: the reviewer's, or the approved idea's. */
  direction?: string
  goal?: MediaGoal | null
  idea?: MediaIdea | null
  /** Summaries of the knowledge documents the post's facts came from. */
  knowledge?: string[]
  /** What the account actually offers: the only products the image may show. */
  offerings?: string[]
  /** The brand theme as the art director reads it (renderBrandForArtDirector). */
  brand?: string
  /** Where the brand logo will be laid over the image, if it will. */
  logoCorner?: string
  /** Earlier images for this post, newest first; a new one must differ from them. */
  previousVersions?: PriorVisual[]
  /** What the reviewer said about the image being replaced. */
  rejectionReason?: string
  /**
   * An image the reviewer attached to guide the composition and style. The
   * art director sees it as it is; the subject still comes from the post.
   */
  referenceImage?: { data: Uint8Array; mediaType: string }
}

export interface DerivedMediaBrief {
  brief: MediaBrief
  imagePrompt: string
  altText: string
}

export interface DeriveMediaBriefResult {
  derived: DerivedMediaBrief | null
  guard: BriefGuardResult | null
  /** Every call made, including a failed one and the corrective retry. */
  usage: CallUsage
  /** Why no brief came back, when it did not. */
  error?: string
}
