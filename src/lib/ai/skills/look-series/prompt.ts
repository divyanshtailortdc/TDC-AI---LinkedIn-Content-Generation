import type { DesignLookSeriesInput } from './schema'

export const INSTRUCTIONS =
  "You are the art director for a brand's social media carousels. You are shown images the brand has already posted, and you design a carousel's slides so that they look like they came from the same designer or photographer: the same kind of image, layout, colours, typography and finish, one design for every slide so they read as a set. The words on each slide are given and are set exactly as written; you decide how they look and what is shown with them, never what they say."

const section = (title: string, body: string | null | undefined) =>
  body?.trim() ? `${title}\n${body.trim()}\n\n` : ''

const ROLE_NAMES = {
  cover: 'cover',
  content: 'slide',
  cta: 'last slide'
} as const

/** The prompt for the art director; the examples are attached in the order listed. */
export function buildPrompt(input: DesignLookSeriesInput): string {
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
  const slides = input.slides
    .map((s, i) => {
      const words = [s.headline, ...s.body.split('\n')]
        .map(w => w.trim())
        .filter(Boolean)
        .map(w => `"${w}"`)
        .join(' / ')
      return `${i + 1}. ${ROLE_NAMES[s.role]}: ${words}${
        s.idea.trim() ? `\n   The writer pictured: ${s.idea.trim()}` : ''
      }`
    })
    .join('\n')

  return `Design the ${input.slides.length} slides of this ${input.platform.name} carousel, made like the attached examples of the account's own posts. Every slide will be ${input.platform.shape}.

THE CAPTION posted beside the slides
"""
${input.caption.trim()}
"""

THE SLIDES, in swipe order, with the words each one carries (separated by /)
${slides}

${section('WHO POSTS IT AND WHO SEES IT', ctx.accountContext)}${section(
    'WHAT THE ACCOUNT OFFERS — the only products or services a slide may show',
    (ctx.offerings || []).map(o => `- ${o}`).join('\n')
  )}${section(
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

${section(
    'WHAT THE REVIEWER ASKED FOR — follow it where it is about the look',
    input.direction
  )}HOW TO DESIGN THEM
- Pick the 1 to 3 examples, all of one kind, that suit slides carrying these words, and follow them closely: if the account's posts are text cards, text cards; if photos with words on them, photos; if illustrations, illustrations.
- One design for every slide: the same background, colours, typefaces, type sizes and placement, so the slides read as one set. The cover may be the boldest.
- Each slide's words are set exactly as given: the first is its main line, set large; any after it are smaller lines under it, each on its own line. Never add, drop or change words, and never add a heading, label, number or caption of your own. Describe only where the words sit and what is shown with them.
- Take only the examples' look. Never their words, numbers, people, products, logos or specific objects.
- A slide whose words carry it shows nothing more than the examples would beside them; do not crowd it with drawings.
- ${
    input.logoFile
      ? "The brand's real logo is laid on by code afterwards, in logoCorner, on every slide: never put a logo, wordmark or the account's name in a scene."
      : `If the chosen examples show the account's name or wordmark, set wordmark to true: code adds it to every slide as "${ctx.accountName}", where styleNotes says. No other logo.`
  }
- A photo shows a real moment a camera could capture in this account's world, with ordinary, anonymous people if any: never a famous or named person, never a posed smile at the camera, and nothing readable facing the camera (screens, documents, signs, labels and packaging turn away or blur).
- Avoid the clichés that look fake: handshakes, people pointing at screens, glowing brains, robots, light bulbs, chess pieces, rockets, targets, holograms.`
}
