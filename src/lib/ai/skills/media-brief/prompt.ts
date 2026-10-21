import { TEXT_RULE } from '@/lib/brand/prompt'
import type { DeriveMediaBriefInput } from './schema'

export const INSTRUCTIONS =
  "You are an art director for professional social content. You design one image per post, and the image always argues the post's specific point rather than decorating it."

const section = (title: string, body: string | null | undefined) =>
  body?.trim() ? `${title}\n${body.trim()}\n\n` : ''

const field = (label: string, value: string | null | undefined) =>
  value?.trim() ? `${label}: ${value.trim()}` : ''

const lines = (...values: string[]) => values.filter(Boolean).join('\n')

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

  const earlier = (input.previousVersions || []).slice(0, 5)
  // With a reference attached, the layout and look stay the reference's; the
  // new image changes what it shows.
  const mustChange = input.referenceImage
    ? 'a different central subject or scene, still in the layout and style of the reference image'
    : `a different central subject, a different composition${
        earlier[0]?.visualType
          ? `, and a visual form other than ${earlier[0].visualType.replace(/_/g, ' ')}`
          : ''
      }`
  const earlierBlock = earlier.length
    ? `${earlier
        .map(
          (v, i) =>
            `- ${i === 0 ? 'Most recent' : 'Earlier'}${v.visualType ? ` (${v.visualType.replace(/_/g, ' ')})` : ''}: ${v.concept.trim()}${v.metaphor ? ` — ${v.metaphor.trim()}` : ''}`
        )
        .join(
          '\n'
        )}\nThe new image must be a different idea, not a variation: ${mustChange}.${input.rejectionReason?.trim() ? `\nThe reviewer said about the last one: "${input.rejectionReason.trim()}".` : ''}`
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
    'WHAT THE ACCOUNT ACTUALLY OFFERS — the only products or services the image may show',
    (input.offerings || []).map(o => `- ${o}`).join('\n')
  )}${section('WHO POSTS IT AND WHO SEES IT', input.accountContext)}${section(
    'BRAND THEME — follow it',
    input.brand
  )}${section(
    'REFERENCE IMAGE (attached) — the reviewer chose it to guide the composition and style',
    input.referenceImage
      ? `Take its arrangement and its look, never its objects.
- Arrangement: where the main mass, the empty space and any headline sit, how much of the frame each takes, the framing and the camera angle. Fill those places with this post's own subject.
- Look: the medium (photo, illustration, 3D), line work, texture, lighting and level of detail.
- Nothing it shows may reappear: none of its objects, props, devices, icons, people, wording or logos, not even restyled. If it has a table on pillars, your image has no table and no pillars.
- ${
          input.brand?.trim()
            ? 'Colours: none of its colours, its background tint included. Name only the brand colours, white, light grey and near-black.'
            : 'Its colour mood may carry over.'
        }
In imagePrompt, describe the arrangement in abstract terms ("the main subject fills the right half, a low horizontal band on the left, headline top left"), then the new subject; the image model also sees the reference${input.brand?.trim() ? ', in greyscale' : ''}.`
      : ''
  )}${section('EARLIER IMAGES FOR THIS POST', earlierBlock)}${section(
    'VISUAL DIRECTION ALREADY CHOSEN FOR THIS POST — build on it unless it no longer fits the post above:',
    input.direction
  )}The image ships at ${input.aspectRatio || '16:9'} and will be seen mostly on a phone, roughly the width of a thumb.

Requirements:
- Show THIS post's specific point in the reader's own world: the people, objects, places and moments the post itself describes. Someone who has read the post should recognise it in the image at a glance.
- Never fall back on generic business, AI or technology imagery (handshakes, glowing brains, robots, circuit boards, network globes, data streams, people pointing at dashboards) unless the post is literally about that thing.
- Show only products, screens or features that the post or the offerings above describe, and nothing about them the post does not state. When the post is about software, show its effect on people's work rather than an invented interface.
- ${TEXT_RULE}
- Never render a statistic, date, venue, price or offer that the post and goal above do not state.
- Never include a logo, wordmark, brand name, publication mark, watermark or recognisable real person.${
    input.logoCorner
      ? ` The brand's own logo is added afterwards in the ${input.logoCorner} corner, so keep that corner calm and empty and put any headline on the other side.`
      : ''
  }`
}

/** The same request, plus why the previous concept was rejected. */
export function buildRetryPrompt(
  input: DeriveMediaBriefInput,
  rejection: string
): string {
  return `${buildPrompt(input)}\n\nYour previous attempt was rejected:\n${rejection}\nProduce a different concept that resolves this.`
}
