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
          'Aim for 70 characters or fewer so it stays legible on a phone. May be empty for a purely visual image.'
        ),
      supportingPoints: z
        .array(z.string())
        .default([])
        .describe('Up to 3 labels, each around 40 characters or fewer.'),
      footer: z.string().optional().describe('Optional short caption.')
    })
    .describe('Any text rendered inside the image. Keep it sparse.'),
  imagePrompt: z
    .string()
    .describe(
      'The full text-to-image prompt. Describe the composition, style, palette and any text to render. Never ask for logos, brand marks, watermarks or recognisable real people.'
    ),
  altText: z
    .string()
    .describe(
      'Plain description of the image for screen readers, ideally under 300 characters.'
    ),
  whyItFits: z
    .string()
    .describe('One sentence on how this visual carries the post argument.')
})

export interface DeriveMediaBriefInput {
  postText: string
  thesis?: string | null
  hook?: string | null
  evidence?: EvidenceSource[]
  /** The account's configured house style for generated images. */
  styleGuidance?: string
  aspectRatio?: '1:1' | '16:9' | '4:5'
  accountName?: string
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
}
