import type { Idea } from '@/db/schema'
import {
  imageStyleLabel,
  isPictureStyle,
  type ImageStyle
} from '@/lib/brand/theme'
import {
  CONTENT_LAYOUTS,
  MAX_DRAFT_PICTURES,
  SLIDE_TEXT,
  type SlideContent
} from '@/lib/carousel/types'
import {
  carouselSpecOf,
  FORMATS,
  isCasualStyle,
  PLATFORMS,
  type FormatId
} from '@/lib/formats'
import { ICON_NAMES } from '@/lib/media/canvas/icon-names'
import { imagePromptFieldGuide } from '@/lib/media/style-prompt'
import {
  describeCta,
  renderAudienceBlock,
  renderGoalBlock,
  renderGuardrailsBlock,
  renderIdentityBlock,
  renderVoiceBlock,
  styleFor,
  type GenerationContext
} from '../../context-blocks'
import { CASUAL_TRUTH_RULES } from '../shared/casual-rules'
import { TRUTH_RULES } from '../shared/truth-rules'
import { buildIdeaBlock } from '../variant-drafting/prompt'

/**
 * The slide writer's prompt. Its instructions (who the author is, how a
 * carousel works, every rule) are the same for every carousel of one
 * identity in one style, so the second and later carousels read them from
 * cache; the request names the idea, the platform and the caption.
 */

/** How each platform shows a carousel, so the slides are written for it. */
function platformCarousel(formatId: FormatId): string {
  const spec = carouselSpecOf(formatId)
  const label = PLATFORMS[FORMATS[formatId].platform].label
  if (spec?.delivery === 'document') {
    return `${label} shows this carousel as a document: one page at a time, the reader clicking or swiping through. The cover is the only page seen in the feed, so it must earn the click on its own. Professional readers save carousels that teach something they can use.`
  }
  if (FORMATS[formatId].platform === 'facebook') {
    return `${label} shows these slides as photos in one post, the first ones as a grid in the feed. Each slide must make sense on its own, and the cover must read even as a small tile.`
  }
  return `${label} shows the cover in the feed and the rest one swipe at a time. The cover stops the scroll; each slide earns the next swipe; people save carousels that teach something.`
}

export function buildSlidesInstructions(
  ctx: GenerationContext,
  imageStyle: ImageStyle
): string {
  const casual = isCasualStyle(styleFor(ctx, ctx.platform?.id ?? 'linkedin'))
  const guardrails = renderGuardrailsBlock(ctx)
  const pictures = isPictureStyle(imageStyle)
  return `You design the slides of carousel posts for one specific author: what each slide says and how it looks. The caption posted beside the carousel is written separately and given to you; the slides never repeat it. You write in the author's voice, and you never invent facts.

AUTHOR
${renderIdentityBlock(ctx)}

READER
${renderAudienceBlock(ctx)}

VOICE
${renderVoiceBlock(ctx)}
${guardrails ? `\nGUARDRAILS\n${guardrails}\n` : ''}
TRUTH RULES
${casual ? CASUAL_TRUTH_RULES : TRUTH_RULES}

HOW A CAROUSEL WORKS
- Slide 1 is the cover (role cover, layout cover): the carousel's promise in a headline of at most 8 words, the reason to swipe. Its body is empty or one short line under it.
- Every slide between is one point (role content): one step, one reason, one example or one figure. A headline of at most 8 words and a body of one or two short sentences, at most 30 words. Never two points on one slide.
- The last slide is the call to action (role cta, layout cta): the ask in the headline, and in the body one short line on what the reader gets from doing it.
- The slides together carry the substance: the steps, points and evidence. The caption carries the context, the story and the hashtags. Do not write the caption's sentences on the slides, and do not put the whole post on them.
- Read in order, the slides tell one connected argument, each picking up where the last stopped.
- Plain words. No emoji, hashtags, links or markdown on any slide: they cannot be clicked or drawn. Do not number the slides or write "swipe" on them; the design adds the slide number and an arrow.

LAYOUTS FOR CONTENT SLIDES
- statement: one point, headline large with the body under it. The default.
- icon: the same, under an icon; set icon to one of: ${ICON_NAMES.join(', ')}.
- stat: one figure, very large, with what it means. Only for a figure the evidence states; set stat to that figure exactly as written there (e.g. "43%"), never a figure of your own.
- list: two to four short points of at most six words each, one per line in the body, under the headline.
- quote: the body is a short quote from the evidence, word for word; the headline says who said it or why it matters.
- photo: a picture across the top half with the text under it, for a point best shown as a real scene.
Vary the layouts so no two slides in a row look the same, and pick each for what its point is.

DESIGN
- emphasis: one or two words of the headline that carry its meaning, set in the accent colour.
- imagePrompt: for every slide, the picture it would show, in the ${imageStyleLabel(imageStyle)} style. ${imagePromptFieldGuide(pictures ? imageStyle : 'photorealistic')} One to three sentences. Keep anything readable out of the picture: no paperwork, invoices, receipts, screens, whiteboards, signs, labels or packaging facing the camera, which an image model fills with fake lettering. Tell the point with people, hands at work, objects and places, seen so that no surface shows writing.
- picture: ${
    pictures
      ? `true for the cover, and for at most ${MAX_DRAFT_PICTURES - 1} photo slide whose point is best shown as a real scene; false for every other slide. The other slides are drawn in the brand's colours.`
      : 'false for every slide: this brand draws its slides in its colours, with no pictures.'
  }
- altText: what the slide shows and says, for someone who cannot see it.`
}

/** The request: this idea's carousel on this platform, beside this caption. */
export function buildSlidesPrompt(
  ctx: GenerationContext,
  idea: Idea,
  formatId: FormatId,
  caption: string,
  count: { min: number; max: number },
  instruction?: string | null
): string {
  const spec = FORMATS[formatId]
  return `Design the slides of the ${spec.label} carousel for this idea.

PLATFORM
${platformCarousel(formatId)}

${buildIdeaBlock(idea)}

GOAL THIS POST SERVES
${renderGoalBlock(ctx.primaryGoal)}

THE CAPTION posted beside the slides (do not repeat it on them):
"""
${caption.trim()}
"""

Write ${count.min} to ${count.max} slides in all: the cover, ${count.min - 2} to ${count.max - 2} content slides, then the call to action. Fewer, stronger slides beat filler.
The call to action slide: ${describeCta(ctx)}
Headlines at most ${SLIDE_TEXT.headline.soft} characters; bodies at most ${SLIDE_TEXT.body.soft}.${
    instruction?.trim()
      ? `\n\nWHAT THE REVIEWER WANTS — follow it, within the truth rules:\n${instruction.trim()}`
      : ''
  }`
}

const describeSlide = (slide: SlideContent, i: number) =>
  `${i + 1}. [${slide.role}, ${slide.design.layout}] ${slide.headline}${slide.body ? ` — ${slide.body.replace(/\n/g, ' / ')}` : ''}`

/** One slide written again, the rest of the carousel left as it is. */
export function buildSlidePrompt(
  ctx: GenerationContext,
  idea: Idea,
  formatId: FormatId,
  caption: string,
  slides: SlideContent[],
  index: number,
  instruction: string | null
): string {
  const slide = slides[index]!
  const layouts =
    slide.role === 'content'
      ? `one of ${CONTENT_LAYOUTS.join(', ')}`
      : slide.role
  return `Write slide ${index + 1} of this ${FORMATS[formatId].label} carousel again.

PLATFORM
${platformCarousel(formatId)}

${buildIdeaBlock(idea)}

GOAL THIS POST SERVES
${renderGoalBlock(ctx.primaryGoal)}

THE CAPTION posted beside the slides (do not repeat it on them):
"""
${caption.trim()}
"""

THE CAROUSEL AS IT STANDS
${slides.map(describeSlide).join('\n')}

Write slide ${index + 1} only. Its role stays ${slide.role}; its layout is ${layouts}. It must still follow on from slide ${index} and lead into slide ${index + 2 <= slides.length ? index + 2 : index + 1}, and say nothing another slide already says.${
    slide.role === 'cta' ? `\nThe call to action: ${describeCta(ctx)}` : ''
  }
${
  instruction?.trim()
    ? `WHAT THE REVIEWER WANTS CHANGED — follow it, within the truth rules:\n${instruction.trim()}`
    : 'The reviewer wants a different take: a different headline and a different way into the same point.'
}`
}
