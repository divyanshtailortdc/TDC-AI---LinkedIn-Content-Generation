/**
 * The words that ask the image model for a platform's shape, and the prompt
 * for an image made from an uploaded reference. Pure, so they are testable
 * without the image models.
 */

/** "a wide 1.91:1 landscape" for 2048x1072; the shapes the canvas draws at. */
export function shapeWords(size: { width: number; height: number }): string {
  const ratio = size.width / size.height
  return ratio > 1.85
    ? 'a wide 1.91:1 landscape'
    : ratio > 1.3
      ? 'a wide 16:9 landscape'
      : ratio > 0.9
        ? 'a square 1:1'
        : 'a tall 4:5 portrait'
}

/**
 * A new image made from an uploaded reference alone: its layout, composition
 * and style, with the reviewer's direction when there is one; never the post.
 * As in the edit prompt, the direction is quoted so the model reads it as an
 * instruction, not as lettering to draw.
 */
export function buildReferencePrompt(
  direction: string,
  target: { width: number; height: number }
): string {
  return [
    'Create a new image based on the provided reference image.',
    direction
      ? `Follow this direction: "${direction}". That quoted direction describes the image; it is not text to place in it.`
      : 'Recreate it as a clean, polished, high-quality image.',
    'Keep the reference’s layout, composition, structure and visual style, except where the direction changes them.',
    'Add new lettering only where the direction gives the exact words in quotation marks, and reproduce any text you keep from the reference with its original wording and spelling.',
    // The platform's shape, not the reference's: a landscape reference for an
    // Instagram post is rearranged into the portrait frame.
    `The output is ${shapeWords(target)} image. Arrange the reference’s elements to fill that frame naturally:`,
    'keep the main subject whole and undistorted, and never stretch or crop it.'
  ].join(' ')
}
