import type { DeriveMediaBriefInput } from './schema'

export const INSTRUCTIONS =
  "You are an art director for professional social content. You design one image per post, and the image always argues the post's specific point rather than decorating it."

export function buildPrompt(input: DeriveMediaBriefInput): string {
  const evidence = (input.evidence || [])
    .slice(0, 6)
    .map(e => `- ${e.claim}`)
    .join('\n')

  return `Design the image that will accompany this LinkedIn post.

THE POST
"""
${input.postText}
"""

${input.thesis ? `THE ARGUMENT: ${input.thesis}\n` : ''}${
    evidence ? `FACTS THE POST RELIES ON:\n${evidence}\n` : ''
  }${
    input.accountContext
      ? `WHO POSTS IT AND WHO SEES IT\n${input.accountContext}\n`
      : ''
  }${
    input.direction?.trim()
      ? `VISUAL DIRECTION ALREADY CHOSEN FOR THIS POST — build on it unless it no longer fits the post above:\n${input.direction.trim()}\n`
      : ''
  }
The image ships at ${input.aspectRatio || '16:9'} and will be seen mostly on a phone, roughly the width of a thumb.

Requirements:
- The visual must express THIS post's specific argument. A generic office, handshake or glowing network says nothing.
- Use subjects, settings and objects these readers recognise from their own work. Do not default to abstract technology imagery unless the post is about technology.
- Any text in the image must be readable at feed size: one short headline, at most three short labels.
- Never render a statistic that is not stated in the post above.
- Never include a company logo, publication mark, watermark, or a recognisable real person.
${input.styleGuidance ? `- House style to follow: ${input.styleGuidance}` : ''}`
}

/** The same request, plus why the previous concept was rejected. */
export function buildRetryPrompt(
  input: DeriveMediaBriefInput,
  rejection: string
): string {
  return `${buildPrompt(input)}\n\nYour previous attempt was rejected:\n${rejection}\nProduce a different concept that resolves this.`
}
