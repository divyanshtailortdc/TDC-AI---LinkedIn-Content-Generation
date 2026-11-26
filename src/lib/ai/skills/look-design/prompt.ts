import type { RecentLookInput } from '@/lib/visual-examples/recent'
import { LOOK_MAX_WORDS, type DesignLookInput } from './schema'

export const INSTRUCTIONS =
  "You are the art director for a brand's social media images. You are shown images the brand has already posted, and you design the image for a new post so that it looks like it came from the same designer or photographer: the same kind of image, layout, colours, typography and finish. Its subject and words come from the new post, never from the examples."

const section = (title: string, body: string | null | undefined) =>
  body?.trim() ? `${title}\n${body.trim()}\n\n` : ''

const field = (label: string, value: string | null | undefined) =>
  value?.trim() ? `${label}: ${value.trim()}` : ''

const lines = (...values: string[]) => values.filter(Boolean).join('\n')

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`

const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`)

/** "1", "1 and 4", "1, 2 and 3". */
const numberList = (numbers: number[]) =>
  numbers.length <= 1
    ? numbers.join('')
    : `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`

/**
 * The looks of the account's latest images and carousels on this platform,
 * newest first, so the next one can differ. Empty without any. Shared with
 * the carousel's art director (look-series).
 */
export function recentLooksSection(
  platformName: string,
  recent: readonly RecentLookInput[] | undefined
): string {
  if (!recent?.length) return ''
  const entries = recent.map((r, i) => {
    const followed = r.examples.length
      ? ` that followed example${r.examples.length > 1 ? 's' : ''} ${numberList(r.examples)}`
      : ''
    const showed = r.concept ? ` It showed: ${sentence(clip(r.concept, 200))}` : ''
    return `${i + 1}. ${r.carousel ? 'A carousel' : 'An image'}${followed} (${r.kind}): ${sentence(clip(r.styleNotes, 320))}${showed}`
  })
  return `THE LATEST IMAGES MADE FOR THIS ACCOUNT'S ${platformName.toUpperCase()} POSTS, newest first (other posts, not this one)\n${entries.join('\n')}\n\n`
}

/**
 * The rule that keeps one post from looking like the last: another of the
 * account's kinds of image when one can carry it, else another layout.
 * Empty without recent looks. Shared with look-series.
 */
export function varietyRule(
  recent: readonly RecentLookInput[] | undefined,
  exampleCount: number,
  words: { made: string; carrier: string }
): string {
  if (!recent?.length) return ''
  return exampleCount > 1
    ? `\n- Vary the look from post to post, as a real feed does: ${words.made} must not look like the newest ones above. Do not follow the same examples as the newest one above, and prefer examples that neither of the two newest followed: another kind of image the account posts (a photo, an illustration, another card design) whenever it can carry ${words.carrier}. When only the kind they used suits it, change what the eye sees first: another background (a colour or texture from the examples' own palette), another layout and other imagery. Show another subject than they did.`
    : `\n- Vary the look from post to post, as a real feed does: keep the example's style, but make ${words.made} plainly different from the newest ones above: another background (a colour or texture from the example's own palette), another layout and other imagery, and another subject than they showed.`
}

/** The prompt for the art director; the examples are attached in the order listed. */
export function buildPrompt(input: DesignLookInput): string {
  const ctx = input.context
  const examples = input.examples
    .map(
      (e, i) =>
        `${i + 1}. ${e.uploaded ? 'Chosen by the account' : 'Posted'} on ${e.platformName}${
          e.samePlatform ? '' : ' (another platform)'
        }${e.aspect ? `, ${e.aspect}` : ''}`
    )
    .join('\n')
  const borrowed = input.examples.every(e => !e.samePlatform)

  const goal = ctx.goal
    ? lines(
        field('Goal', ctx.goal.title),
        field('The one message to land', ctx.goal.keyMessage),
        field('What the reader should do', ctx.goal.desiredAction)
      )
    : ''
  const idea = ctx.idea
    ? lines(
        field('Idea', ctx.idea.title),
        field('Angle', ctx.idea.angle),
        field('Reader takeaway', ctx.idea.audienceTakeaway)
      )
    : ''
  const earlier = (input.previousVersions || []).slice(0, 5)
  const earlierBlock = earlier.length
    ? `${earlier
        .map(
          (v, i) =>
            `- ${i === 0 ? 'Most recent' : 'Earlier'}: ${v.concept.trim()}`
        )
        .join(
          '\n'
        )}\nThe new image must show a different idea from these: another subject or scene, other words. It may follow other examples.${
        input.rejectionReason?.trim()
          ? `\nThe reviewer said about the last one: "${input.rejectionReason.trim()}".`
          : ''
      }`
    : ''

  return `Design the image for this ${input.platform.name} post, made like the attached examples of the account's own posts. It will be ${input.platform.shape}.

THE POST
"""
${input.postText.trim()}
"""

${section('THE ARGUMENT', ctx.thesis)}${section(
    'WHAT THE POST IS FOR',
    goal
  )}${section('THE APPROVED IDEA BEHIND THE POST', idea)}${section(
    'WHAT THE ACCOUNT OFFERS — the only products or services the image may name',
    (ctx.offerings || []).map(o => `- ${o}`).join('\n')
  )}${section('WHO POSTS IT AND WHO SEES IT', ctx.accountContext)}${section(
    "BRAND COLOURS SET IN THE APP — the examples' own colours come first; use these where the examples leave a choice",
    ctx.brand
  )}${section(
    `HOW THE ACCOUNT'S ${ctx.platformLook?.platform.toUpperCase() ?? ''} POSTS LOOK, AS ANALYSED EARLIER`,
    ctx.platformLook?.description
  )}EXAMPLES (attached, in this order)
${examples}${
    borrowed
      ? `\nNone was posted on ${input.platform.name}: follow them, adjusted to what works on ${input.platform.name}.`
      : ''
  }

${recentLooksSection(input.platform.name, input.recentLooks)}${section('EARLIER IMAGES FOR THIS POST', earlierBlock)}${section(
    'VISUAL DIRECTION ALREADY CHOSEN — it sets the subject; the examples set the look. Words in quotation marks are text the reviewer wants on the image: use them exactly.',
    input.direction
  )}HOW TO DESIGN IT
- Pick the 1 to 3 examples whose kind of image fits this post best, all of the same kind, and follow them closely: if they are photos, a photo; if text cards, a text card; if infographics, an infographic with the same layout language. When the account posts several kinds, choose the one that suits this post.${varietyRule(
    input.recentLooks,
    input.examples.length,
    { made: 'this image', carrier: 'this post' }
  )}
- Take only their look. Never their words, numbers, people, products, logos or specific objects: the subject and the words come from this post.
- The text: as much as the chosen examples carry and no more, at most ${LOOK_MAX_WORDS} words, in the language and voice of the post. Every word from this post, or plain words a reader of it would agree say the same thing. Never a statistic, price, date, place, name or offer the post does not state.
- ${
    input.logoFile
      ? "The brand's real logo is laid on by code afterwards, in logoCorner: never put a logo, wordmark or the account's name in the text for that corner."
      : `If the chosen examples carry a wordmark or the account's name, include it as a "wordmark" part that reads exactly "${ctx.accountName}"; no other logo.`
  }
- A photo shows a real moment a camera could capture in this account's world, with ordinary, anonymous people if any: never a famous or named person, never a posed smile at the camera, and nothing readable facing the camera (screens, documents, signs, labels and packaging turn away or blur) unless it is one of the text parts.
- Avoid the clichés that look fake: handshakes, people pointing at screens, glowing brains, robots, light bulbs, chess pieces, rockets, targets, holograms.`
}
