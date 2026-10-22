import 'server-only'

import {
  mergeRefinedBlueprint,
  type Blueprint
} from '@/lib/media/canvas/blueprint'
import { runSkill, SkillError } from '../../run-skill'
import { addUsage, EMPTY_USAGE, type CallUsage } from '../../usage'
import { BlueprintSchema } from './schema'

/**
 * Skill: a second look at an image rebuilt from a reference. The art director
 * sees the reference and the first render side by side and corrects the
 * blueprint's geometry and styling: a box measured a little off, a circle
 * read as a square, a white card that should be outlined. The words are
 * meant to differ and are never changed (see mergeRefinedBlueprint).
 */

const INSTRUCTIONS =
  'You are a meticulous designer checking a rebuild of a reference design. You compare the two images element by element and correct the rebuild\'s blueprint until its structure matches the reference: the same elements, at the same positions and sizes, with the same shapes, fills, outlines, shadows, alignment, spacing and text sizes.'

export function buildRefinePrompt(blueprint: Blueprint): string {
  return `The first attached image is a reference design. The second is our rebuild of it, drawn from the blueprint below with different words and the brand's colours. Boxes are percentages of the image's width and height; the rebuild may be a different shape, so compare positions as proportions of each image.

Correct the blueprint so the rebuild matches the reference's structure as closely as possible:
- positions, sizes and the spacing between elements;
- shapes: a circle stays a circle, a pill a pill, square corners stay square;
- fills: which elements are solid, dark, tinted, white, outlined or bare, and which cast a shadow;
- alignment, text sizes (textSize) and weights;
- arrows and connector lines;
- clashes: wherever the rebuild's words are cut off, run under an icon or card, crowd another element or touch the image's edge, change the boxes so every word has room and nothing overlaps, keeping elements that line up in the reference lined up.

Rules:
- Return every block, in the same order, with the same role, text and detail.
- When the reference has an element the rebuild is missing, add it after the existing blocks, only as a panel, shape, divider or icon.
- Colours and wording are meant to differ: do not try to match them.

BLUEPRINT
${JSON.stringify(blueprint)}`
}

export interface RefineBlueprintResult {
  /** The corrected blueprint; null when the check failed, so the first stands. */
  blueprint: Blueprint | null
  usage: CallUsage
}

export async function refineBlueprint(
  input: {
    blueprint: Blueprint
    reference: { data: Uint8Array; mediaType: string }
    rendered: { data: Uint8Array; mediaType: string }
  },
  options: { abortSignal?: AbortSignal } = {}
): Promise<RefineBlueprintResult> {
  try {
    const result = await runSkill({
      stage: 'media_brief',
      instructions: INSTRUCTIONS,
      prompt: buildRefinePrompt(input.blueprint),
      images: [input.reference, input.rendered],
      schema: BlueprintSchema,
      abortSignal: options.abortSignal
    })
    return {
      blueprint: mergeRefinedBlueprint(input.blueprint, result.output as Blueprint),
      usage: addUsage(EMPTY_USAGE, result.usage)
    }
  } catch (err) {
    if (!options.abortSignal?.aborted) {
      console.warn('Blueprint refinement failed; keeping the first design:', err)
    }
    return {
      blueprint: null,
      usage: err instanceof SkillError ? addUsage(EMPTY_USAGE, err.usage) : EMPTY_USAGE
    }
  }
}
