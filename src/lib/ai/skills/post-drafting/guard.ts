import type { Idea } from '@/db/schema'
import {
  renderAudienceBlock,
  renderGoalBlock,
  renderIdentityBlock,
  type GenerationContext
} from '../../context-blocks'
import type { DraftGenerationResult } from './schema'

/**
 * A draft without a hook or body is unusable, whatever else came back.
 * Platform rules (length, banned words, hashtags, citations) are the linter's
 * job in src/lib/lint, run by the drafting pipeline.
 */
export function isCompleteDraft(
  draft: DraftGenerationResult | null | undefined
): draft is DraftGenerationResult {
  return Boolean(draft?.hook?.trim() && draft?.body?.trim())
}

/**
 * Everything a draft's figures may come from: the idea's evidence, the idea
 * itself (its figures were checked at ideation, or typed by the reviewer at
 * the approval gate) and what the author saved about themselves. The linter
 * flags any figure that is in none of it.
 */
export function collectFigureSources(
  ctx: GenerationContext,
  idea: Pick<
    Idea,
    'title' | 'thesis' | 'hookConcept' | 'coreArgument' | 'whyNow' | 'supportingEvidence'
  >
): string {
  return [
    ...(idea.supportingEvidence || []).flatMap(e => [e.claim, e.quote || '']),
    idea.title || '',
    idea.thesis || '',
    idea.hookConcept || '',
    idea.coreArgument || '',
    idea.whyNow || '',
    renderIdentityBlock(ctx),
    renderAudienceBlock(ctx),
    renderGoalBlock(ctx.primaryGoal)
  ]
    .filter(Boolean)
    .join('\n')
}
