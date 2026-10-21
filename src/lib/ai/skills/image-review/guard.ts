import type { ImageReview, ImageReviewVerdict } from './schema'

/** Below this the image is not about the post, whatever else is right with it. */
const MIN_RELEVANCE = 55

const quoteList = (items: string[]) =>
  items
    .slice(0, 4)
    .map(t => `"${t.trim()}"`)
    .join(', ')

/**
 * Turns the model's observations into a verdict. The model only reports what
 * it sees; which of those things block an image is decided here, the same way
 * for every account.
 */
export function judgeImageReview(
  review: ImageReview,
  options: { headline: string; brandGiven: boolean; referenceGiven?: boolean }
): ImageReviewVerdict {
  const issues: string[] = []
  const brandMarks = review.brandMarks.map(m => m.trim()).filter(Boolean)
  const stray = review.unintendedText.map(t => t.trim()).filter(Boolean)
  const unsupported = review.unsupportedDetails
    .map(d => d.trim())
    .filter(Boolean)

  if (brandMarks.length > 0) {
    issues.push(
      `Draws a logo or brand name of its own: ${quoteList(brandMarks)}.`
    )
  }
  if (stray.length > 0) {
    issues.push(`Has stray or misspelt lettering: ${quoteList(stray)}.`)
  }
  if (review.logoCoversContent) {
    const covered = (review.logoCovers || []).map(c => c.trim()).filter(Boolean)
    issues.push(
      covered.length > 0
        ? `The logo covers part of the image: ${covered.slice(0, 3).join('; ')}.`
        : 'The logo covers part of the image.'
    )
  }
  if (options.headline.trim() && !review.headlineCorrect) {
    issues.push(
      `The headline is not spelled as intended ("${options.headline.trim()}").`
    )
  }
  if (unsupported.length > 0) {
    issues.push(
      `Shows details the post does not support: ${unsupported.slice(0, 3).join('; ')}.`
    )
  }
  if (review.genericStock) {
    issues.push(
      "Looks like a generic stock image rather than this post's point."
    )
  }
  if (!review.conveysPost || review.relevanceScore < MIN_RELEVANCE) {
    issues.push("Does not carry this post's specific point.")
  }
  if (options.referenceGiven && review.copiesReference) {
    issues.push(
      "Repeats the reference image's own objects instead of showing this post's subject in its layout."
    )
  }
  if (options.brandGiven && options.referenceGiven && review.keepsReferenceColors) {
    issues.push("Keeps the reference image's colours instead of the brand's.")
  } else if (options.brandGiven && !review.followsBrand) {
    issues.push("Does not follow the brand's colours or style.")
  }

  return {
    passed: issues.length === 0,
    issues,
    relevanceScore: Math.max(
      0,
      Math.min(100, Math.round(review.relevanceScore))
    ),
    summary: review.summary.trim()
  }
}

/**
 * What to tell the image model on its second attempt, as plain positive
 * rules. The misspelt words are never quoted back: put in the prompt, the
 * model tends to draw them again.
 */
export function retryInstructions(
  review: ImageReview,
  options: { headline: string; logoCorner?: string }
): string {
  const lines: string[] = []
  const headline = options.headline.trim()
  if (
    review.unintendedText.some(t => t.trim()) ||
    (headline && !review.headlineCorrect)
  ) {
    lines.push(
      headline
        ? `Spell the headline exactly as given and draw no other lettering anywhere: every document, book, folder, screen, sign, sticky note, badge and label is blank or shows plain grey lines.`
        : 'Draw no lettering anywhere: every document, book, folder, screen, sign, sticky note, badge and label is blank or shows plain grey lines.'
    )
  }
  if (review.brandMarks.some(m => m.trim())) {
    lines.push('Show no logos, emblems, wordmarks or brand names anywhere.')
  }
  if (review.logoCoversContent && options.logoCorner) {
    lines.push(
      `Keep the ${options.logoCorner} corner completely empty and place the headline and every object well away from it.`
    )
  }
  if (review.unsupportedDetails.some(d => d.trim())) {
    lines.push(
      'Show only what the scene above describes; add no charts, figures, product screens or extra details.'
    )
  }
  if (review.copiesReference) {
    lines.push(
      'Use the reference image only for where things sit and for the drawing style: none of its objects, props, devices or icons appear.'
    )
  }
  if (review.keepsReferenceColors || !review.followsBrand) {
    lines.push(
      'Use only the brand colours given above, with a white or very light grey background and grey or near-black neutrals.'
    )
  }
  if (review.genericStock || !review.conveysPost) {
    lines.push(
      'Make the scene unmistakably the specific situation described above, not a generic business scene.'
    )
  }
  return lines.join(' ')
}
