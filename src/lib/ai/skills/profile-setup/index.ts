import 'server-only'

import { parseJsonLoosely } from '../../parse-json'
import { runSkill, SkillError } from '../../run-skill'
import type { CallUsage } from '../../usage'
import { applyGuidance, sanitizeIdentitySetup } from './guard'
import {
  buildPrompt,
  INSTRUCTIONS,
  type ResearchFindings,
  type SetupSource
} from './prompt'
import {
  IdentitySetupModelSchema,
  type AnalysisGuidance,
  type IdentitySetupSuggestions
} from './schema'

/** The user is waiting on this; past it, retrying beats waiting. */
const MODEL_TIMEOUT_MS = 90_000

export type { SetupSource } from './prompt'

/**
 * Skill: the user's own description, plus any pages fetched for them, in;
 * suggested Profile, Voice, Goals, Preferences and Knowledge settings out.
 * Nothing is saved: the user reviews the suggestions first.
 */
export async function suggestSetup(input: {
  description: string
  sources: SetupSource[]
  /** URLs the user typed; the only links a suggestion may contain. */
  providedUrls: string[]
  /** Advanced analysis choices; they override the model's. */
  guidance?: AnalysisGuidance
  /** What web research verified, and what it could not. */
  research?: ResearchFindings
}): Promise<{
  suggestions: IdentitySetupSuggestions
  warnings: string[]
  usage: CallUsage
  modelUsed: string
}> {
  let raw: unknown
  let usage: CallUsage
  let modelUsed: string
  try {
    const result = await runSkill({
      stage: 'identity_setup',
      instructions: INSTRUCTIONS,
      prompt: buildPrompt(
        input.description,
        input.sources,
        input.guidance,
        input.research
      ),
      schema: IdentitySetupModelSchema,
      timeoutMs: MODEL_TIMEOUT_MS,
      // One retry for a transient failure; more would multiply the wait.
      maxRetries: 1
    })
    raw = result.output
    usage = result.usage
    modelUsed = `${result.providerName} (${result.modelId})`
  } catch (error) {
    // The guard reads entries one by one, so an answer that missed the strict
    // schema can still yield every field that is individually valid.
    const salvaged =
      error instanceof SkillError ? parseJsonLoosely(error.text) : null
    if (!salvaged) throw error
    raw = salvaged
    usage = (error as SkillError).usage
    modelUsed = (error as SkillError).modelUsed ?? ''
  }

  const sanitized = sanitizeIdentitySetup(raw, {
    description: input.description,
    providedUrls: input.providedUrls,
    fetchedSources: input.sources
      .filter(s => s.status.status === 'fetched' && s.content)
      .map(s => ({
        url: s.status.url,
        content: s.content!,
        title: s.status.title
      })),
    verifiedLinks: input.research?.verified,
    webSourceUrls: input.sources
      .filter(s => s.status.kind === 'web' && s.status.status === 'fetched')
      .map(s => s.status.url),
    researchNotes: input.research?.notes,
    // What the user chose in Advanced analysis is theirs, figures included.
    trustedText: Object.values(input.guidance ?? {})
      .filter((value): value is string => typeof value === 'string')
      .join('\n')
  })
  // The CTA link and every other Advanced choice are applied after the URL
  // checks, so they hold whatever the model returned.
  const suggestions = applyGuidance(sanitized.suggestions, input.guidance)
  // The user's own CTA link replaced the model's, so its warning would mislead.
  const warnings = input.guidance?.ctaUrl
    ? sanitized.warnings.filter(w => !w.startsWith('Goals → CTA link'))
    : sanitized.warnings
  return { suggestions, warnings, usage, modelUsed }
}
