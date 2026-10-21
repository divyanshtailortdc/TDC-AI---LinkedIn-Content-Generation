import type { Idea } from '@/db/schema'
import {
  renderMediaContext,
  type GenerationContext
} from '~/lib/ai/context-blocks'
import type {
  DeriveMediaBriefInput,
  EvidenceSource
} from '~/lib/ai/skills/media-brief/schema'
import { renderBrandForArtDirector } from '~/lib/brand/prompt'
import { DEFAULT_BRAND_THEME } from '~/lib/brand/theme'

/**
 * What the art director knows about a post besides its text: the goal it
 * serves, the approved idea, the facts and knowledge behind it, what the
 * account sells, who reads it and the brand theme. Pure, so tests build it
 * from fixture contexts; every image path (drafting, review) uses it.
 */

export type MediaBriefContext = Pick<
  DeriveMediaBriefInput,
  | 'thesis'
  | 'evidence'
  | 'accountName'
  | 'accountContext'
  | 'goal'
  | 'idea'
  | 'knowledge'
  | 'offerings'
  | 'brand'
>

export type MediaIdeaRecord = Pick<
  Idea,
  | 'title'
  | 'angle'
  | 'hookConcept'
  | 'thesis'
  | 'coreArgument'
  | 'audienceTakeaway'
  | 'supportingEvidence'
>

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

export function buildMediaBriefContext(
  ctx: GenerationContext,
  idea: MediaIdeaRecord | null
): MediaBriefContext {
  const brand = ctx.brand ?? DEFAULT_BRAND_THEME
  const evidence = (idea?.supportingEvidence || []) as Array<
    EvidenceSource & { sourceId?: string }
  >

  // Only the documents this post's facts were drawn from: the whole
  // knowledge base would pull the image toward whatever it covers most.
  const citedIds = new Set(evidence.map(e => e.sourceId).filter(Boolean))
  const citedTitles = new Set(evidence.map(e => e.sourceTitle).filter(Boolean))
  const knowledge = ctx.knowledgeDocs
    .filter(
      d => d.summary?.trim() && (citedIds.has(d.id) || citedTitles.has(d.title))
    )
    .slice(0, 3)
    .map(d => `${d.title}: ${clip(d.summary!, 400)}`)

  const offerings = ctx.offerings.slice(0, 6).map(o => {
    const details = o.description?.trim()
    const parts = [
      o.name,
      o.tagline,
      details && details !== o.name.trim() ? details : null
    ]
    return clip(parts.filter(Boolean).join(' — '), 240)
  })

  const goal = ctx.primaryGoal
  return {
    thesis: idea?.thesis || idea?.coreArgument || idea?.title || null,
    evidence,
    accountName: ctx.account.name,
    accountContext: renderMediaContext(ctx),
    goal: goal
      ? {
          title: goal.title,
          objective: goal.objective,
          keyMessage: goal.keyMessage,
          desiredAction: goal.desiredAction
        }
      : null,
    idea: idea
      ? {
          title: idea.title,
          angle: idea.angle,
          hookConcept: idea.hookConcept,
          coreArgument: idea.coreArgument,
          audienceTakeaway: idea.audienceTakeaway
        }
      : null,
    knowledge,
    offerings,
    brand: renderBrandForArtDirector(brand)
  }
}
