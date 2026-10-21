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
 * The hook is shown above the body, so a body that opens by repeating it
 * reads twice in the preview and is pasted twice into LinkedIn. Models do
 * this often, so the repeat is cut off here. Spacing and case are ignored
 * when comparing; a body that would be left empty is kept as it is.
 */
export function withoutRepeatedHook<T extends { hook: string; body: string }>(
  draft: T
): T {
  const words = draft.hook.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return draft
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // Ends on a whole word, so a hook ending "run" leaves "running" alone.
  const repeat = new RegExp(
    `^\\s*${escaped.join('\\s+')}(?![\\p{L}\\p{N}])`,
    'iu'
  )
  const match = draft.body.match(repeat)
  if (!match) return draft
  const rest = draft.body.slice(match[0].length).replace(/^\s+/, '')
  return rest ? { ...draft, body: rest } : draft
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
    // Every goal the post serves: their messages are the author's own words.
    ...(ctx.selectedGoals.length > 0 ? ctx.selectedGoals : [ctx.primaryGoal]).map(
      renderGoalBlock
    )
  ]
    .filter(Boolean)
    .join('\n')
}
