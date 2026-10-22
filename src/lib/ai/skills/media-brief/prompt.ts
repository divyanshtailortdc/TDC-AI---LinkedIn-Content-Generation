import { ICON_NAMES } from '@/lib/media/canvas/icon-names'
import { NODE_LIMITS } from '@/lib/media/canvas/spec'
import {
  VISUAL_TYPES,
  type DeriveMediaBriefInput,
  type VisualType
} from './schema'

export const INSTRUCTIONS =
  "You are an art director for high-performing B2B LinkedIn content. You create visually diverse, stunning branded canvas graphics. Every post must feel fresh and unique in a user's LinkedIn feed rather than repeating the same layout template. You choose the ideal layout format (split_left, split_right, top_bottom, or centered_hero) and visual form to express the post's core message with crisp typographical hierarchy, brand colours, and clean vector diagrams."

const section = (title: string, body: string | null | undefined) =>
  body?.trim() ? `${title}\n${body.trim()}\n\n` : ''

const field = (label: string, value: string | null | undefined) =>
  value?.trim() ? `${label}: ${value.trim()}` : ''

const lines = (...values: string[]) => values.filter(Boolean).join('\n')

const words = (type: string) => type.replace(/_/g, ' ')

const TYPE_GUIDE: Record<VisualType, string> = {
  hub_spoke: `hub_spoke: one thing at the centre (hub) connected to ${NODE_LIMITS.hub_spoke.min}-${NODE_LIMITS.hub_spoke.max} things around it. For a platform and what it connects, a team and who it serves, an event and what happens there.`,
  flow: `flow: ${NODE_LIMITS.flow.min}-${NODE_LIMITS.flow.max} steps in order, top to bottom or left to right. For a process, a journey, how something gets from A to B.`,
  stack: `stack: ${NODE_LIMITS.stack.min}-${NODE_LIMITS.stack.max} layers, the top first, each resting on the one below. For an architecture, a set of foundations, what builds on what.`,
  cards: `cards: ${NODE_LIMITS.cards.min}-${NODE_LIMITS.cards.max} separate points side by side, each with a short detail. For key takeaways, reasons, features of an offer.`,
  comparison: `comparison: two columns (groups) with the same number of rows each, 2-4. For before and after, old way and new way, a choice between two options.`,
  illustration:
    'illustration: a flat vector illustration from the image model, with 2-3 labelled badges laid over it. For a story, a scene, a moment or a feeling that a diagram would flatten.'
}

/**
 * With a reference, the art director copies its structure into a blueprint
 * the canvas draws block by block; the layout and visual fields stay as the
 * fallback when the blueprint cannot be drawn.
 */
const REFERENCE_GUIDE = `The reference is the design to rebuild, not inspiration. Scan it and copy its structure into "blueprint": one block for every element it has, decorative shapes, rings, lines and standalone icons included, at the same position and size, measured from each element's outer edges as percentages of its width and height, to the nearest 0.5. Keep exactly:
- its count of cards, stats, pills, list lines, icons and shapes, and the spacing between them;
- each element's shape: a circle stays a circle, a pill a pill, square corners stay square;
- which elements are solid, dark, tinted, white, outlined or bare, and which cast a shadow;
- its alignment, how big each text is (textSize) and how heavy (weight);
- its arrows and connector lines.
Then fill every block with this post's content. Take none of its objects, wording, numbers or logos. Its colours map onto the brand's: "primary" its strongest colour, "accent" a second strong one, "dark" near-black or navy, "soft" pale tints, "surface" white boxes, "outline" boxes drawn only as an outline.
- Its main title is the headline block, the small label above it the tagline block, and its sentence under the title the text block; their words come from tagline, headline and subheadline. Leave highlightWords empty unless the reference sets some of its title's words in another colour.
- Any other short text (a step number, a caption, a name) is a label block with its own words.
- When its whole background is a colour other than white or light grey, the first block is a panel covering the whole image in that tone.
- backgroundPattern is the texture its background has: "plain" when it is flat.
- Where it has a logo or a website, put a logo or footer block there.
- Keep each block's words about as long as the reference's, so they fit the same box.
- A block's box holds only its own element: a box of words ends where the next element begins, never running under it, unless the words sit inside that element; and no box of words reaches the image's edge.
- A stat block shows a figure this post states, with its caption in detail when the caption sits under it; a caption set beside the figure is a label block of its own.
- A stat's figure must appear in this post. When the post has fewer figures than the reference has stats, make the rest cards.
- A photo, illustration, screenshot or device area is an image block ("circle" for a round avatar): write illustrationPrompt for what goes in the first one.
- Follow the reference even when an earlier image had a similar structure; only the words and subject must differ.
- Still fill layout, visualType and nodes: they are drawn if the blueprint cannot be.`

export function buildPrompt(input: DeriveMediaBriefInput): string {
  const evidence = (input.evidence || [])
    .slice(0, 6)
    .map(e => `- ${e.claim}${e.sourceTitle ? ` (${e.sourceTitle})` : ''}`)
    .join('\n')

  const goal = input.goal
    ? lines(
        field('Goal', input.goal.title),
        field('Objective', input.goal.objective),
        field('The one message to land', input.goal.keyMessage),
        field('What the reader should do', input.goal.desiredAction)
      )
    : ''

  const idea = input.idea
    ? lines(
        field('Idea', input.idea.title),
        field('Angle', input.idea.angle),
        field('Hook concept', input.idea.hookConcept),
        field('Argument', input.idea.coreArgument),
        field('Reader takeaway', input.idea.audienceTakeaway)
      )
    : ''

  const allowed = input.allowedTypes?.length ? input.allowedTypes : VISUAL_TYPES
  const earlier = input.current ? [] : (input.previousVersions || []).slice(0, 5)
  const lastType = earlier[0]?.visualType
  const lastLayout = earlier[0]?.layout
  // A diagram form only counts as "used" when another one could be picked.
  const mustChangeType =
    lastType && allowed.length > 1 && (allowed as readonly string[]).includes(lastType)
  const earlierBlock = earlier.length
    ? `${earlier
        .map(
          (v, i) =>
            `- ${i === 0 ? 'Most recent' : 'Earlier'}${v.visualType ? ` (${words(v.visualType)}${v.layout ? `, ${words(v.layout)} layout` : ''})` : ''}: ${v.concept.trim()}${v.metaphor ? ` — ${v.metaphor.trim()}` : ''}`
        )
        .join('\n')}\nThe new image must be a different idea and layout format, not a variation: a different headline, different nodes${
        mustChangeType ? `, and a visual type other than ${words(lastType!)}` : ''
      }${
        lastLayout ? `, and a layout format other than ${words(lastLayout)} to maintain visual diversity in the feed` : ''
      }${
        allowed.length === 1 && allowed[0] === 'illustration'
          ? ', and an illustration of a different subject'
          : ''
      }.${input.rejectionReason?.trim() ? `\nThe reviewer said about the last one: "${input.rejectionReason.trim()}".` : ''}`
    : ''

  const current = input.current
    ? `${JSON.stringify(
        {
          layout: input.current.layout,
          tagline: input.current.copy.tagline,
          headline: input.current.copy.headline,
          highlightWords: input.current.copy.highlightWords,
          subheadline: input.current.copy.subheadline,
          visualType: input.current.visual.type,
          hub: input.current.visual.hub,
          nodes: input.current.visual.nodes,
          groups: input.current.visual.groups,
          illustrationPrompt: input.current.visual.illustrationPrompt
        },
        null,
        2
      )}
The reviewer asked for this change: "${input.current.change.trim()}"
Apply only that change and return everything else exactly as it is, word for word. Keep illustrationPrompt identical unless the change is about the illustration itself: an unchanged prompt reuses the illustration already drawn.`
    : ''

  return `Design the image that will accompany this LinkedIn post.

THE POST
"""
${input.postText}
"""

${section('THE ARGUMENT', input.thesis)}${section(
    "WHAT THE POST IS FOR — the image supports this where the post does; the post's own point comes first",
    goal
  )}${section('THE APPROVED IDEA BEHIND THE POST', idea)}${section(
    'FACTS THE POST RELIES ON',
    evidence
  )}${section(
    'FROM THE KNOWLEDGE BASE THESE FACTS CAME FROM',
    (input.knowledge || []).map(k => `- ${k}`).join('\n')
  )}${section(
    'WHAT THE ACCOUNT ACTUALLY OFFERS — the only products or services the image may name',
    (input.offerings || []).map(o => `- ${o}`).join('\n')
  )}${section('WHO POSTS IT AND WHO SEES IT', input.accountContext)}${section(
    'BRAND THEME',
    input.brand
  )}${section(
    'REFERENCE IMAGE (attached) — the reviewer wants the new image built like it',
    input.referenceImage ? REFERENCE_GUIDE : ''
  )}${section('EARLIER IMAGES FOR THIS POST', earlierBlock)}${section(
    'VISUAL DIRECTION ALREADY CHOSEN FOR THIS POST — build on it unless it no longer fits the post above. Words in quotation marks are text the reviewer wants on the image: use them exactly, as the headline unless they say otherwise.',
    input.direction
  )}${section('THE CURRENT DESIGN — this is an edit', current)}THE LAYOUT (fixed, drawn by code)
Choose one layout that best fits the post's structure to ensure diverse aesthetics across the feed:
- top_bottom: Headline, tagline and logo across the top; a wide horizontal stage across the bottom. RECOMMENDED for multi-step sequences ("flow" with 3-5 steps laid out horizontally with arrows), 3-4 side-by-side cards, or wide comparisons. This breaks feed monotony and creates an expansive, modern visual.
- centered_hero: An elevated central manifesto/brief card with the headline, subheadline, and 2-3 key takeaway cards inside. BEST for opinion posts, bold thesis statements, event/conference announcements, or punchy single-claim posts.
- split_right: Visual on the left, text column on the right. Inverts the traditional split to provide alternating rhythm in the LinkedIn feed.
- split_left (default): Left: the brand logo, then the tagline, the headline with its highlighted words in the accent colour, the subheadline, and the website at the bottom. Right: the visual, on a light background with a subtle dot or grid pattern.

FEED DIVERSITY RULE:
Never generate all images in the same format. If earlier images exist, pick a different layout format! For sequential steps, use top_bottom. For announcements or manifesto claims, use centered_hero.

VISUAL TYPES you may use:
${allowed.map(t => `- ${TYPE_GUIDE[t]}`).join('\n')}
${
  allowed.length === 1
    ? "The reviewer chose this visual type: use it, and shape the post's point to fit it."
    : "Pick the one whose shape matches how the post's point is built."
}

ICONS for nodes and the hub: ${ICON_NAMES.join(', ')}.

Requirements:
- Every word must come from this post's own content: its people, systems, steps, places and outcomes, named as the post names them. Someone who has read the post should recognise it in the image at a glance.
- No generic business, AI or technology filler (synergy, innovation, digital transformation, growth) unless the post is literally about that.
- Never state a statistic, date, venue, price or offer that the post and goal above do not state. Product and service names only from the post or the offerings above.
- Labels are 1-3 words and say what the thing is; details are at most 6 words.
- An illustration is a clean flat vector scene with a plain white background. It shows objects and simple shapes, never text, labels, logos, screens full of words, real people's faces, hands, desks, coffee cups or anything photographic.`
}

/** The same request, plus why the previous concept was rejected. */
export function buildRetryPrompt(
  input: DeriveMediaBriefInput,
  rejection: string
): string {
  return `${buildPrompt(input)}\n\nYour previous attempt was rejected:\n${rejection}\nProduce a design that resolves this.`
}
