import type { ReviewImageInput } from './schema'

export const INSTRUCTIONS =
  'You check AI-generated images before they are published with a LinkedIn post. You read every letter exactly as it is drawn and report problems plainly. Never assume text is correct because it was intended: image models misspell words and invent lettering.'

export function buildPrompt(
  input: Omit<ReviewImageInput, 'image' | 'mediaType' | 'abortSignal'>
): string {
  const headline = input.headline.trim()
  const reference = input.reference
    ? `

REFERENCE IMAGE
The second attached image is a reference the reviewer chose. The first image was meant to take only its arrangement and drawing style, and to show none of its objects, props, devices, icons, people or wording.${
        input.brand?.trim()
          ? ' Its colours were to be replaced by the brand colours above.'
          : ''
      } Check only the first image against the rules; the reference is for comparison.`
    : ''
  return `Check the ${input.reference ? 'first ' : ''}attached image, generated for the LinkedIn post below.

THE POST
"""
${input.postText.trim()}
"""

WHAT THE IMAGE WAS MEANT TO SHOW
${input.concept.trim()}

LETTERING ALLOWED
${
  headline
    ? `Only the headline "${headline}", spelled exactly like that. Any other lettering is unintended.`
    : 'None. Any lettering at all is unintended.'
}

BRAND
${input.brand?.trim() || 'No brand colours were set.'}${reference}

${
  input.logoCorner
    ? `The brand's real logo has been laid over the ${input.logoCorner} corner. That logo is expected: do not list its lettering as unintended text or as a brand mark. Say whether it overlaps or hides part of the headline, a face or a key object. Any other logo, emblem, wordmark, brand or company name drawn anywhere else is a defect, however plausible it looks.`
    : "The brand's real logo is added by code after this check, so any logo, emblem, wordmark, brand or company name already drawn in the image is a defect, however plausible it looks."
}

Transcribe all the text you can see, letter by letter.`
}
