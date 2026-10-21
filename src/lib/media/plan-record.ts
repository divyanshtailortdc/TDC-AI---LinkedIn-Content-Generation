import type { PriorVisual } from '~/lib/ai/skills/media-brief/schema'
import type { MediaPlanResult } from './index'

/**
 * How a media plan is stored and read back. Pure, so drafting and the review
 * screen save the same shape and tests can check it.
 */

/** A post_media row whose image could not be made; it carries only the reason. */
export const FAILED_MEDIA_STATUS = 'failed'

/** The metadata a generated or found image is saved with. */
export function mediaPlanMetadata(
  plan: MediaPlanResult,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    sourcePageUrl: plan.sourcePageUrl,
    fallbackApplied: false,
    visualType: plan.visualType,
    relevanceScore: plan.relevanceScore,
    relevanceExplanation: plan.relevanceExplanation,
    alignedConcepts: plan.alignedConcepts,
    textOverlay: plan.textOverlay,
    mediaBrief: plan.mediaBrief,
    issues: plan.issues,
    modelId: plan.modelId,
    width: plan.width,
    height: plan.height,
    seed: plan.seed,
    logo: plan.logo,
    review: plan.review,
    usedReference: plan.usedReference,
    usage: plan.usage,
    ...extra
  }
}

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

/**
 * A post's earlier images, newest first, as the brief needs them to design
 * something different. Failed attempts were never seen, so they do not count.
 */
export function priorVisualsOf(
  rows: Array<{
    status: string
    version: number
    promptOrQuery: string | null
    metadata: Record<string, any> | null
  }>,
  limit = 5
): PriorVisual[] {
  return [...rows]
    .filter(r => r.status !== FAILED_MEDIA_STATUS)
    .sort((a, b) => b.version - a.version)
    .map(r => {
      const brief = r.metadata?.mediaBrief
      if (brief?.primaryConcept) {
        return {
          concept: clip(String(brief.primaryConcept), 300),
          visualType: brief.visualType || r.metadata?.visualType,
          metaphor: brief.visualMetaphor
            ? clip(String(brief.visualMetaphor), 300)
            : undefined
        }
      }
      // A reviewer's own prompt or search describes the image well enough.
      return r.promptOrQuery?.trim()
        ? { concept: clip(r.promptOrQuery, 300) }
        : null
    })
    .filter((v): v is PriorVisual => v !== null)
    .slice(0, limit)
}
