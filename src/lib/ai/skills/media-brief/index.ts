import 'server-only'

import {
  cleanProviderMessage,
  isAuthFailureMessage
} from '@/lib/media/image-errors'
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
  input: DeriveMediaBriefInput,
  options: { abortSignal?: AbortSignal } = {}
): Promise<DeriveMediaBriefResult> {
  let usage: CallUsage = EMPTY_USAGE

  const attempt = async (prompt: string) => {
    try {
      const result = await runSkill({
        stage: 'media_brief',
        instructions: INSTRUCTIONS,
        prompt,
        // A reference image is looked at, not described: its layout and look
        // are what the brief carries over.
        images: input.referenceImage ? [input.referenceImage] : undefined,
        schema: MediaBriefSchema,
        abortSignal: options.abortSignal
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
    copy: {
      tagline: output.tagline,
      headline: output.headline,
      highlightWords: output.highlightWords,
      subheadline: output.subheadline
    },
    visual: {
      type: output.visualType,
      hub: output.hub,
      nodes: output.nodes,
      badges: output.badges,
      groups: output.groups,
      illustrationPrompt: output.illustrationPrompt
    },
    textOverlay: {
      headline: output.headline
    },
    avoidConcepts,
    whyItFits: output.whyItFits,
    howItDiffers: output.howItDiffers || undefined
  })

  const guardOptions = {
    // A reference image sets the visual form, so a new image from the same
    // reference may keep it; its subject must still change.
    previousVisualTypes: input.referenceImage
      ? []
      : (input.previousVersions || [])
          .map(v => v.visualType)
          .filter((t): t is string => Boolean(t)),
    extraSourceText: [input.goal?.keyMessage, input.goal?.desiredAction]
      .filter(Boolean)
      .join('\n')
  }

  try {
    let output = await attempt(buildPrompt(input))
    if (!output) {
      return {
        derived: null,
        guard: null,
        usage,
        error: 'The model returned no image brief.'
      }
    }

    let brief = toBrief(output, [])
    let guard = guardMediaBrief(
      brief,
      output.illustrationPrompt || '',
      input.postText,
      input.accountName,
      guardOptions
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
          retry.illustrationPrompt || '',
          input.postText,
          input.accountName,
          guardOptions
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
        copy: {
          tagline: output.tagline,
          headline: output.headline,
          highlightWords: output.highlightWords,
          subheadline: output.subheadline
        },
        visual: {
          type: output.visualType,
          hub: output.hub,
          nodes: output.nodes,
          badges: output.badges,
          groups: output.groups,
          illustrationPrompt: output.illustrationPrompt
        },
        altText: clamp(output.altText, 300)
      },
      guard,
      usage
    }
  } catch (err) {
    // A stop the reviewer asked for is not a failure worth logging.
    if (
      !options.abortSignal?.aborted &&
      !(err instanceof SkillError && err.reason === 'not_configured')
    ) {
      console.warn('Media brief generation failed:', err)
    }
    return {
      derived: null,
      guard: null,
      usage,
      error: describeBriefFailure(err)
    }
  }
}

/** Why no brief came back, in words a reviewer can act on. */
function describeBriefFailure(err: unknown): string {
  if (err instanceof SkillError) {
    switch (err.reason) {
      case 'not_configured':
        return 'No AI provider is configured. Add AI_GATEWAY_API_KEY (or ANTHROPIC_API_KEY) to design images.'
      case 'quota_exceeded':
        return 'The AI provider budget is used up, so the image could not be designed.'
      case 'timeout':
        return 'Designing the image took too long. Try again.'
    }
  }
  const message = cleanProviderMessage(err instanceof Error ? err.message : '')
  if (isAuthFailureMessage(message)) {
    return 'The AI Gateway rejected the API key, so the image could not be designed. Check AI_GATEWAY_API_KEY.'
  }
  return `The image could not be designed${message ? `: ${message}` : '.'}`
}
