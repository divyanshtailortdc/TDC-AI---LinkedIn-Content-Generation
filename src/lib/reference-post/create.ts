import 'server-only'

import { db } from '@/db'
import { ideasTable } from '@/db/schema'
import { snapshotGoal } from '@/lib/ai/context-blocks'
import { loadGenerationContext } from '@/lib/ai/context'
import { ideaFromReferencePost } from '@/lib/ai/skills/reference-ideation'
import { platformsOf, supportsMediaFormat, type FormatId } from '@/lib/formats'
import { downloadReferenceImage } from './read'
import type { ReferencePost } from './types'

/**
 * Saves the idea for a post like a shared one, approved, aimed at the chosen
 * formats: the user asked for the post, so there is nothing to review
 * before it is written. The caller claims it for drafting.
 *
 * Model calls inside are charged to whatever spend scope the caller set
 * (withAiSpend).
 */
export async function createIdeaFromReference(input: {
  accountId: string
  reference: ReferencePost
  formats: FormatId[]
  /** Of those, the ones whose posts get an image ("Add an image"). */
  imageFormats: FormatId[]
}): Promise<{ ideaId: string; title: string }> {
  const { accountId, reference, formats, imageFormats } = input
  const platforms = platformsOf(formats)
  // Every active goal, newest first: the model picks the one it serves.
  const [ctx, image] = await Promise.all([
    loadGenerationContext(accountId),
    downloadReferenceImage(reference.imageUrl)
  ])
  const carouselPossible = formats.some(
    f => imageFormats.includes(f) && supportsMediaFormat(f, 'carousel')
  )
  const idea = await ideaFromReferencePost({
    ctx,
    reference,
    platforms,
    carouselPossible,
    image
  })
  const goal = idea.goalId ? ctx.selectedGoals.find(g => g.id === idea.goalId) ?? null : null

  // The visual direction, as ideation words it: "Carousel: …" makes the
  // post a carousel where its format takes one (plannedMediaFormat).
  const brief = idea.carousel
    ? `Carousel: ${idea.visualIdea || 'one point per slide, in the order the shared post makes them'}`
    : idea.visualIdea || undefined

  const [saved] = await db
    .insert(ideasTable)
    .values({
      accountId,
      runId: null,
      goalId: goal?.id ?? null,
      goalIds: goal ? [goal.id] : [],
      goalSnapshot: goal ? snapshotGoal(goal) : null,
      title: idea.title,
      thesis: idea.thesis || null,
      perspectiveAngle: idea.perspectiveAngle,
      hook: idea.hookConcept,
      angle: idea.angle || null,
      format: 'thought_leadership',
      whyNow: idea.whyNow || null,
      hookConcept: idea.hookConcept,
      coreArgument: idea.coreArgument || null,
      audienceTakeaway: idea.audienceTakeaway || null,
      supportingEvidence: idea.supportingEvidence,
      suggestedMedia: {
        mode: 'none',
        ...(brief ? { brief } : {}),
        imageFormats
      },
      status: 'approved',
      targetFormats: formats,
      formatFit: formats,
      reference: {
        ...reference,
        ...(idea.structure ? { structure: idea.structure } : {})
      }
    })
    .returning({ id: ideasTable.id, title: ideasTable.title })
  if (!saved) throw new Error('The idea could not be saved.')
  return { ideaId: saved.id, title: saved.title ?? idea.title }
}
