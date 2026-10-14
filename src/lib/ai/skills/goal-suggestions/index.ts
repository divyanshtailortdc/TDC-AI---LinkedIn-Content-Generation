import 'server-only'

import {
  renderAudienceBlock,
  renderIdentityBlock,
  type GenerationContext
} from '../../context'
import { runSkill } from '../../run-skill'
import { collectAllowedUrls, keepValidSuggestions } from './guard'
import { buildPrompt, INSTRUCTIONS } from './prompt'
import { GoalSuggestionsModelSchema, type GoalSuggestion } from './schema'

export type { GoalSuggestion } from './schema'

/** The user is waiting on a button; past this, retrying beats waiting. */
const MODEL_TIMEOUT_MS = 60_000

/** A problem the user can act on; its message is safe to show as is. */
export class GoalSuggestionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoalSuggestionError'
  }
}

/**
 * Skill: the account's saved profile (offerings, audience, pillars) in, a few
 * goals out. Nothing is written: the user picks one, it fills the New Goal
 * form, and only Save creates it.
 */
export async function suggestGoals(
  ctx: GenerationContext
): Promise<GoalSuggestion[]> {
  if (
    ctx.offerings.length === 0 &&
    ctx.audiences.length === 0 &&
    !ctx.account.bio
  ) {
    throw new GoalSuggestionError(
      'Add your offerings and audience to the profile first, so suggestions have something to build on.'
    )
  }

  // Links the user saved themselves; anything else the model writes is dropped.
  const allowedUrls = collectAllowedUrls({
    websiteUrl: ctx.account.websiteUrl,
    bio: ctx.account.bio,
    offerings: ctx.offerings
  })
  const existingGoals = ctx.goals.map(g => g.title.trim()).filter(Boolean)

  const { output } = await runSkill({
    stage: 'identity_setup',
    instructions: INSTRUCTIONS,
    prompt: buildPrompt({
      profile: `${renderIdentityBlock(ctx)}\n\n${renderAudienceBlock(ctx)}`,
      pillars: ctx.prefs.pillars.map(p => p.name).filter(Boolean),
      existingGoals,
      allowedUrls: [...allowedUrls.values()]
    }),
    schema: GoalSuggestionsModelSchema,
    timeoutMs: MODEL_TIMEOUT_MS,
    maxRetries: 1
  })

  return keepValidSuggestions(output, { allowedUrls, existingGoals })
}
