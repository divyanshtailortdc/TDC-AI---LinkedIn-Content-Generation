import { z } from 'zod'
import { ICON_NAMES } from '@/lib/media/canvas/icon-names'
import {
  CANVAS_LAYOUTS,
  type CanvasLayout,
  type CanvasNode,
  type DiagramForm
} from '@/lib/media/canvas/spec'
import type { CallUsage } from '../../usage'

/** What fills the image's right side: one of the diagram forms, or an illustration. */
export type VisualType = DiagramForm | 'illustration'

export const VISUAL_TYPES = [
  'hub_spoke',
  'flow',
  'stack',
  'cards',
  'comparison',
  'illustration'
] as const satisfies readonly VisualType[]

export interface TextOverlaySpec {
  headline: string
  /** Only on briefs written before the canvas layout. */
  supportingPoints?: string[]
  footer?: string
}

/** The words on the image's text side. */
export interface CanvasCopySpec {
  tagline: string
  headline: string
  highlightWords: string[]
  subheadline: string
}

/** The diagram or illustration visual. */
export interface VisualSpec {
  type: VisualType
  /** The centre of a hub-and-spoke diagram. */
  hub: CanvasNode | null
  /** The diagram's nodes, or the badges over an illustration. */
  nodes: CanvasNode[]
  /** Outer badges (e.g. AI agents, chat pills, automated checks). */
  badges?: CanvasNode[]
  /** A comparison's two column titles. */
  groups: string[]
  /** What the image model draws, for an illustration; empty for a diagram. */
  illustrationPrompt: string
}

export interface MediaBrief {
  /** What the post is about, in the post's own words. */
  postTopic: string
  coreThesis: string
  readerTakeaway: string
  /** The single visual idea the image expresses. */
  primaryConcept: string
  visualMetaphor: string
  layout?: CanvasLayout
  visualType: VisualType
  copy?: CanvasCopySpec
  visual?: VisualSpec
  /** The headline, kept for the review screen and older readers. */
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

const NodeSchema = z.object({
  label: z
    .string()
    .describe(
      'One to three words, the name of the thing (e.g. "Order sync", "Field sales"). Never a sentence.'
    ),
  icon: z
    .enum(ICON_NAMES)
    .describe('The listed icon that best shows the thing.'),
  detail: z
    .string()
    .default('')
    .describe(
      'Optional second line, up to 6 words, saying what it does. Empty when the label says enough.'
    )
})

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
      "The single idea the image puts across: the post's specific point, never a generic business theme."
    ),
  visualMetaphor: z
    .string()
    .describe(
      'How the right-hand visual shows that idea: what sits where and how the parts relate.'
    ),
  tagline: z
    .string()
    .describe(
      'The small category line above the headline: 2 to 4 words naming the kind of post or its theme (e.g. "Event announcement", "Integration guide"). No sentence, no full stop.'
    ),
  headline: z
    .string()
    .describe(
      "The headline, 4 to 9 words: the post's point as a reader would say it. Plain words, no hashtags or emoji."
    ),
  highlightWords: z
    .array(z.string())
    .describe(
      'Two or three words or short phrases copied exactly from the headline, set in the accent colour: the ones that carry the point.'
    ),
  subheadline: z
    .string()
    .describe(
      'One sentence under the headline, at most 18 words, adding the why or the how. No claims the post does not make.'
    ),
  layout: z
    .enum(CANVAS_LAYOUTS)
    .default('split_left')
    .describe(
      'The canvas composition layout: "split_left" (text left, visual right), "split_right" (visual left, text right), "top_bottom" (wide headline top, horizontal visual/flow stage bottom), or "centered_hero" (elevated central card with headline and feature cards). Vary layouts across posts so consecutive feed images do not look identical.'
    ),
  visualType: z
    .enum(VISUAL_TYPES)
    .describe('What fills the visual area; follow the rules in the request.'),
  hub: NodeSchema.nullable().describe(
    'For hub_spoke only: the thing at the centre that the nodes connect to. Null for every other type.'
  ),
  nodes: z
    .array(NodeSchema)
    .describe(
      "The labelled parts of the diagram, in reading order; for an illustration, 2 or 3 badges naming what it shows. Each comes from the post's own content."
    ),
  badges: z
    .array(NodeSchema)
    .default([])
    .describe(
      'Optional 2 to 3 outer accent badges (e.g. AI agents, chat pills, automated checks) that connect to satellite nodes.'
    ),
  groups: z
    .array(z.string())
    .default([])
    .describe(
      'For comparison only: the two column titles, 1 to 3 words each (e.g. "Before", "After"). The nodes list the left column first, then the right, the same number in each. Empty otherwise.'
    ),
  illustrationPrompt: z
    .string()
    .default('')
    .describe(
      'For illustration only: what the image model draws, as a flat vector illustration on a plain white background. Name objects by their look, never by words printed on them. Never ask for text, labels, logos or people\'s hands. Empty for a diagram.'
    ),
  altText: z
    .string()
    .describe(
      'Plain description of the whole image for screen readers, the headline included, ideally under 300 characters.'
    ),
  whyItFits: z
    .string()
    .describe('One sentence on how this visual carries the post argument.'),
  howItDiffers: z
    .string()
    .default('')
    .describe(
      'When earlier images for this post are listed, one sentence on how this one differs from them; otherwise empty.'
    )
})

export type MediaBriefOutput = z.infer<typeof MediaBriefSchema>

/** An image this post already had, so a new one can be told apart from it. */
export interface PriorVisual {
  concept: string
  visualType?: string
  layout?: string
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

/** The design being changed, when the reviewer asks for an edit. */
export interface CurrentDesign {
  layout?: CanvasLayout
  copy: CanvasCopySpec
  visual: VisualSpec
  /** What the reviewer wants changed, in their words. */
  change: string
}

export interface DeriveMediaBriefInput {
  postText: string
  thesis?: string | null
  hook?: string | null
  evidence?: EvidenceSource[]
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
  /** The visual types the brand theme allows; all of them when unset. */
  allowedTypes?: readonly VisualType[]
  /** Earlier images for this post, newest first; a new one must differ from them. */
  previousVersions?: PriorVisual[]
  /** What the reviewer said about the image being replaced. */
  rejectionReason?: string
  /**
   * An image the reviewer attached to guide the look. The art director sees
   * it as it is; the subject still comes from the post.
   */
  referenceImage?: { data: Uint8Array; mediaType: string }
  /** Set for an edit: the design as it is, and the change asked for. */
  current?: CurrentDesign
}

export interface DerivedMediaBrief {
  brief: MediaBrief
  layout: CanvasLayout
  copy: CanvasCopySpec
  visual: VisualSpec
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
