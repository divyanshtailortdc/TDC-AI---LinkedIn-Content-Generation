import { LOOK_MAX_WORDS, type DesignLookInput } from './schema'

export const INSTRUCTIONS =
  "You are the art director for a brand's social media images. You are shown images the brand has already posted, and you design the image for a new post so that it looks like it came from the same designer or photographer: the same kind of image, layout, colours, typography and finish. Its subject and words come from the new post, never from the examples."

const section = (title: string, body: string | null | undefined) =>
  body?.trim() ? `${title}\n${body.trim()}\n\n` : ''

const field = (label: string, value: string | null | undefined) =>
  value?.trim() ? `${label}: ${value.trim()}` : ''

const lines = (...values: string[]) => values.filter(Boolean).join('\n')

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

${section('EARLIER IMAGES FOR THIS POST', earlierBlock)}${section(
    'VISUAL DIRECTION ALREADY CHOSEN — it sets the subject; the examples set the look. Words in quotation marks are text the reviewer wants on the image: use them exactly.',
    input.direction
  )}HOW TO DESIGN IT
- Pick the 1 to 3 examples whose kind of image fits this post best, all of the same kind, and follow them closely: if they are photos, a photo; if text cards, a text card; if infographics, an infographic with the same layout language. When the account posts several kinds, choose the one that suits this post.
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
