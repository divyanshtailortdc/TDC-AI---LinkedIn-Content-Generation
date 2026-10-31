import 'server-only'

import {
  renderAudienceBlock,
  renderIdentityBlock,
  type GenerationContext
} from '../../context'
import { runSkill } from '../../run-skill'
import {
  keepClassifiedNewsletters,
  keepValidQueries,
  type ClassifiedNewsletter,
  type VerifiedCandidate
} from './guard'
import {
  buildClassifyPrompt,
  buildQueryPrompt,
  CLASSIFY_INSTRUCTIONS,
  QUERY_INSTRUCTIONS
} from './prompt'
import { ClassificationModelSchema, SearchQueriesModelSchema } from './schema'

export type { ClassifiedNewsletter, VerifiedCandidate } from './guard'

/** The user is waiting on a button; past this, retrying beats waiting. */
const QUERY_TIMEOUT_MS = 45_000
const CLASSIFY_TIMEOUT_MS = 90_000

/** The identity and audience, as every model call in the app sees them. */
function renderProfile(ctx: GenerationContext): string {
  return `${renderIdentityBlock(ctx)}\n\n${renderAudienceBlock(ctx)}`
}

/** Skill: the profile in, searches that find newsletters for it out. */
export async function planNewsletterSearches(
  ctx: GenerationContext,
  region?: string
): Promise<string[]> {
  const { output } = await runSkill({
    stage: 'identity_setup',
    instructions: QUERY_INSTRUCTIONS,
    prompt: buildQueryPrompt({ profile: renderProfile(ctx), region }),
    schema: SearchQueriesModelSchema,
    timeoutMs: QUERY_TIMEOUT_MS,
    maxRetries: 1
  })
  return keepValidQueries(output)
}

/**
 * Skill: fetched candidate pages in, the real newsletters among them out,
 * categorized and scored against the profile.
 */
export async function classifyNewsletters(
  ctx: GenerationContext,
  candidates: VerifiedCandidate[]
): Promise<ClassifiedNewsletter[]> {
  if (candidates.length === 0) return []
  const { output } = await runSkill({
    stage: 'identity_setup',
    instructions: CLASSIFY_INSTRUCTIONS,
    prompt: buildClassifyPrompt({
      profile: renderProfile(ctx),
      candidates: candidates.map((c, i) => ({
        number: i + 1,
        url: c.signupUrl,
        title: c.title,
        siteName: c.siteName,
        description: c.description,
        excerpt: c.excerpt,
        signupEvidence: {
          form: 'an email signup field on the page',
          platform: 'hosted on a newsletter platform',
          page: 'a newsletter page; its form loads in the browser'
        }[c.signupEvidence]
      }))
    }),
    schema: ClassificationModelSchema,
    timeoutMs: CLASSIFY_TIMEOUT_MS,
    maxRetries: 1
  })
  return keepClassifiedNewsletters(output, candidates)
}
