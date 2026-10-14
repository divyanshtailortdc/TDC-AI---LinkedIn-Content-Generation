import 'server-only'

import { runSkill, SkillError } from '../../run-skill'
import { addUsage, EMPTY_USAGE, type CallUsage } from '../../usage'
import { clamp, guardMediaBrief, normalizeOverlay } from './guard'
import { buildPrompt, buildRetryPrompt, INSTRUCTIONS } from './prompt'
import {
  MediaBriefSchema,
  type DeriveMediaBriefInput,
  type DeriveMediaBriefResult,
  type MediaBrief
} from './schema'

export type * from './schema'

/**
 * Skill: a finished post in, an image brief (concept, overlay text, prompt
 * for the image model, alt text) out.
 *
 * This replaced ~2,500 lines of keyword matching that hardcoded one customer's
 * domain: it defaulted every topic to "B2B Operational Strategy" and listed
 * "supply chain", "logistics" and "warehouse management" as permanently
 * unrelated concepts, so an account in those fields could never get a relevant
 * image. What survives in ./guard is a thin, domain-neutral check for the
 * things that are wrong regardless of subject: invented brands, real faces,
 * fake numbers, and overlays too dense to read on a phone.
 */
export async function deriveMediaBrief(
  input: DeriveMediaBriefInput
): Promise<DeriveMediaBriefResult> {
  let usage: CallUsage = EMPTY_USAGE

  const attempt = async (prompt: string) => {
    try {
      const result = await runSkill({
        stage: 'media_brief',
        instructions: INSTRUCTIONS,
        prompt,
        schema: MediaBriefSchema
      })
      usage = addUsage(usage, result.usage)
      return result.output
    } catch (err) {
      // The tokens were generated and billed before validation rejected them.
      if (err instanceof SkillError) usage = addUsage(usage, err.usage)
      throw err
    }
  }

  const toBrief = (
    output: NonNullable<Awaited<ReturnType<typeof attempt>>>,
    avoidConcepts: string[]
  ): MediaBrief => ({
    postTopic: output.postTopic,
    coreThesis: output.coreThesis,
    readerTakeaway: output.readerTakeaway,
    primaryConcept: output.primaryConcept,
    visualMetaphor: output.visualMetaphor,
    visualType: output.visualType,
    textOverlay: normalizeOverlay(output.textOverlay),
    avoidConcepts,
    whyItFits: output.whyItFits
  })

  try {
    let output = await attempt(buildPrompt(input))
    if (!output) return { derived: null, guard: null, usage }

    let brief = toBrief(output, [])
    let guard = guardMediaBrief(
      brief,
      output.imagePrompt,
      input.postText,
      input.accountName
    )

    // One corrective pass. Beyond that the cost outweighs the benefit.
    if (!guard.isAcceptable) {
      const retry = await attempt(
        buildRetryPrompt(input, guard.issues.join(' '))
      )
      if (retry) {
        const retryBrief = toBrief(retry, [brief.primaryConcept])
        const retryGuard = guardMediaBrief(
          retryBrief,
          retry.imagePrompt,
          input.postText,
          input.accountName
        )
        if (retryGuard.relevanceScore > guard.relevanceScore) {
          output = retry
          brief = retryBrief
          guard = retryGuard
        }
      }
    }

    return {
      derived: {
        brief,
        imagePrompt: output.imagePrompt,
        altText: clamp(output.altText, 300)
      },
      guard,
      usage
    }
  } catch (err) {
    if (!(err instanceof SkillError && err.reason === 'not_configured')) {
      console.warn('Media brief generation failed:', err)
    }
    return { derived: null, guard: null, usage }
  }
}
