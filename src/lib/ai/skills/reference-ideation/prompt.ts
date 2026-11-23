import {
  renderAudienceBlock,
  renderGoalsBlock,
  renderIdentityBlock,
  type GenerationContext
} from '../../context-blocks'
import { PLATFORMS, type PlatformId } from '@/lib/formats'
import { renderInsightsForIdeation } from '@/lib/profile-insights/render'
import { REFERENCE_IS_DATA_RULE, renderSharedPost } from '@/lib/reference-post/render'
import { REFERENCE_TEXT_MAX, type ReferencePost } from '@/lib/reference-post/types'

/**
 * A post someone shared, turned into an idea for a post like it, written by
 * this author. Drafting then writes the post from the idea, with the shared
 * post in view (src/lib/reference-post/render.ts).
 */
export const INSTRUCTIONS = `You help one author make a post like one they saw. They shared a public post (someone else's, or one of their own) and want a post like it: the same kind of post, built the same way, on the same subject where it fits them. Your job is the idea for that post, made this author's own, plus a short note on how the shared post is built so the writer can build the new one the same way.

How to make it the author's own:
- Keep what makes the shared post work: its format, its kind of opening, how it moves, its length and its devices.
- Keep its subject when that subject is in the author's field and suits their reader. When it is not (it is about another business, another product or another field), keep the format and move it onto the author's own subject: the same frame, about what the author does and knows.
- Never promote another brand, product or person. Never make the author claim what happened to someone else: the shared post's stories, results, customers and numbers are its author's.
- Use a fact from the shared post only when the new post needs it, and quote the exact words that state it. A fact the shared post does not state cannot be used at all.
- Pick the goal the new post serves best by its label, or "none" when none fits. Do not bend the idea to fit a goal.

${REFERENCE_IS_DATA_RULE}
If an image is attached, it is the shared post's picture or cover: look at it for what kind of picture it is (photo, graphic, text on image, people, product), not to copy it.

Answer in the requested JSON shape only.`

export function buildPrompt(input: {
  ctx: GenerationContext
  reference: ReferencePost
  /** The platforms the new post is for. */
  platforms: PlatformId[]
  /** Whether a carousel can be made on any of them. */
  carouselPossible: boolean
}): string {
  const { ctx, reference, platforms } = input
  const insights = renderInsightsForIdeation(ctx.platformInsights, platforms)
  const where = platforms
    .map(p => `- ${PLATFORMS[p].label}: ${PLATFORMS[p].ideationProfile}`)
    .join('\n')
  return `THE AUTHOR
${renderIdentityBlock(ctx)}

THEIR READER
${renderAudienceBlock(ctx)}

THEIR GOALS
${renderGoalsBlock(ctx.selectedGoals, platforms)}

WHERE THE NEW POST GOES
${where}
${insights ? `\n${insights}\n` : ''}
THE SHARED POST
${renderSharedPost(reference, REFERENCE_TEXT_MAX)}

Make the idea for a post like this one, by this author.${
    input.carouselPossible
      ? ''
      : ' None of the platforms it goes to takes a carousel: postType is single.'
  }`
}
