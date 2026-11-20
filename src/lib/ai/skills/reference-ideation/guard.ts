import type { Goal, Idea } from '@/db/schema'
import { goalLabel } from '../../context-blocks'
import { describeReference } from '@/lib/reference-post/render'
import type { ReferencePost } from '@/lib/reference-post/types'
import type { ReferenceIdeaOutput } from './schema'

/**
 * Checks the model's idea for a shared post before it is saved: every field
 * trimmed and cut to a sane length, the goal one of the author's, and a fact
 * kept only when its quote is really in the shared post. Pure.
 */

export type ReferenceIdea = {
  title: string
  thesis: string
  angle: string
  perspectiveAngle: string
  hookConcept: string
  coreArgument: string
  audienceTakeaway: string
  whyNow: string
  goalId: string | null
  carousel: boolean
  visualIdea: string
  structure: string
  supportingEvidence: NonNullable<Idea['supportingEvidence']>
}

/** Thrown when the answer has nothing to write a post from. */
export class EmptyReferenceIdeaError extends Error {}

const clean = (value: unknown, max: number) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** Letters and digits only, lower case: a quote matches across punctuation, emoji and spacing. */
const letters = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '')

/** At most this many facts from the shared post: a post like it needs few. */
const MAX_FACTS = 5

export function cleanReferenceIdea(
  output: ReferenceIdeaOutput,
  options: {
    reference: ReferencePost
    /** The goals the prompt listed, in its order (G1 first). */
    goals: Pick<Goal, 'id'>[]
    carouselPossible: boolean
  }
): ReferenceIdea {
  const { reference } = options
  const title = clean(output.title, 200)
  const hookConcept = clean(output.hookConcept, 600)
  const thesis = clean(output.thesis, 1000)
  if (!title && !hookConcept && !thesis) {
    throw new EmptyReferenceIdeaError('The idea for this post came back empty.')
  }

  const label = clean(output.goal, 10).toUpperCase()
  const goalIndex = options.goals.findIndex((_, i) => goalLabel(i) === label)
  const goalId = goalIndex >= 0 ? options.goals[goalIndex]!.id : null

  const source = letters(reference.text)
  const sourceTitle = describeReference(reference)
  const seen = new Set<string>()
  const supportingEvidence: ReferenceIdea['supportingEvidence'] = []
  for (const fact of Array.isArray(output.facts) ? output.facts : []) {
    const claim = clean(fact?.claim, 400)
    const quote = clean(fact?.quote, 500)
    const key = letters(quote)
    // A quote must be the shared post's own words, long enough to mean something.
    if (!claim || key.length < 8 || !source.includes(key) || seen.has(key)) continue
    seen.add(key)
    supportingEvidence.push({
      claim,
      quote,
      factType: 'sourced',
      sourceUrl: reference.url,
      sourceTitle,
      confidence: 0.7
    })
    if (supportingEvidence.length >= MAX_FACTS) break
  }

  return {
    title: title || clean(hookConcept || thesis, 120),
    thesis,
    angle: clean(output.angle, 600),
    perspectiveAngle: clean(output.perspectiveAngle, 100) || 'practitioner_lesson',
    hookConcept: hookConcept || title,
    coreArgument: clean(output.coreArgument, 1500),
    audienceTakeaway: clean(output.audienceTakeaway, 600),
    whyNow: clean(output.whyNow, 600),
    goalId,
    carousel:
      options.carouselPossible &&
      (output.postType === 'carousel' || reference.kind === 'carousel'),
    visualIdea: clean(output.visualIdea, 600),
    structure: clean(output.structure, 600),
    supportingEvidence
  }
}
