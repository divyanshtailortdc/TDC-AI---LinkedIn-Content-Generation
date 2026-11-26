import type { LookReview, ReviewLookInput } from './schema'

export const INSTRUCTIONS =
  'You check AI-generated social media images before they are published. You read every letter exactly as it is drawn and compare it with the text that was asked for. Never assume text is correct because it was intended: image models misspell words, drop letters and invent lettering.'

export function buildPrompt(
  input: Omit<
    ReviewLookInput,
    'image' | 'mediaType' | 'examples' | 'abortSignal'
  > & {
    exampleCount: number
  }
): string {
  const text = input.text.length
    ? input.text.map(t => `- ${t.part}: "${t.text}"`).join('\n')
    : 'None: the image should carry no lettering at all.'
  return `Check the first attached image, made for the social media post below. The ${
    input.exampleCount === 1
      ? 'second image is an example'
      : `other ${input.exampleCount} images are examples`
  } of the account's own posts that it was meant to look like: same kind of image, layout, colours, typography and finish, with none of their words, numbers, people or products.

THE POST
"""
${input.postText.trim()}
"""

WHAT THE IMAGE WAS MEANT TO SHOW
${input.concept.trim()}

THE TEXT IT SHOULD CARRY, exactly
${text}

The account is ${input.accountName}; its own name is not a foreign mark.${
    input.logoCorner
      ? ` The brand's real logo was laid over the ${input.logoCorner} corner by code: it is expected, so do not list its lettering.`
      : ''
  }`
}

/** The problems a review found, in words for the reviewer; empty when none. */
export function lookIssues(review: LookReview): string[] {
  return [
    ...review.textErrors.map(e => `Text: ${e}`),
    ...review.extraText.map(t => `Unintended lettering: "${t}"`),
    ...review.inventedFacts.map(f => `Not in the post: ${f}`),
    ...review.foreignMarks.map(m => `Another brand's mark: ${m}`),
    ...review.copiedFromExamples.map(c => `Copied from an example: ${c}`),
    // Minor ones, which the check itself says are not worth another image, are left alone.
    ...(review.artifactsNoticeable === false
      ? []
      : review.artifacts.map(a => `Looks generated: ${a}`)),
    ...(review.matchesExamples
      ? []
      : ['It does not look like the example posts it was meant to follow.'])
  ]
}

/**
 * The problems that make an image wrong rather than imperfect: its words
 * are not the ones given, it states something the post does not, or it
 * shows another brand's mark. Read from lookIssues' wording.
 */
export function isBlockingLookIssue(issue: string): boolean {
  return ['Text: ', 'Not in the post: ', "Another brand's mark: "].some(p =>
    issue.startsWith(p)
  )
}

/** Plain instructions for the second attempt at an image the review found problems in. */
export function lookRetryLines(review: LookReview): string {
  const out: string[] = []
  if (review.textErrors.length || review.extraText.length) {
    out.push(
      'Set every text part exactly as given above, letter for letter, and add no other lettering anywhere: no words or numbers on screens, papers, signs, labels or packaging.'
    )
  }
  if (review.inventedFacts.length) {
    out.push(
      `Leave out these, which the post does not support: ${review.inventedFacts.join('; ')}.`
    )
  }
  if (review.foreignMarks.length) {
    out.push('Draw no logos, brand names, signatures or watermarks.')
  }
  if (review.copiedFromExamples.length) {
    out.push(
      `Take only the examples' look, not their content; leave out: ${review.copiedFromExamples.join('; ')}.`
    )
  }
  if (review.artifacts.length && review.artifactsNoticeable !== false) {
    out.push(
      'Every hand, face, object, icon and shape is correctly formed, with real proportions; nothing warped, melted, duplicated or merged.'
    )
  }
  if (!review.matchesExamples) {
    out.push(
      'Follow the attached examples more closely: the same kind of image, layout, background, colours, typography and finish.'
    )
  }
  return out.join(' ')
}
