'use server'

import { db } from '@/db'
import {
  preferencesTable,
  type CadencePolicy,
  type ContentPillar,
  type Guardrails,
  type MediaPolicy,
  type PostConstraints,
  type ResearchPolicy
} from '@/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export type PillarConfig = ContentPillar

export type PreferencesFullPayload = {
  pillars: PillarConfig[]
  formats: Array<{ format: string; weight: number }>
  cadence: CadencePolicy
  research_policy: ResearchPolicy
  media_policy: MediaPolicy
  post_constraints: PostConstraints
  guardrails: Guardrails
}

const LINKEDIN_MAX_CHARS = 3000

/**
 * The form historically used `stock_search` while the media pipeline matches
 * `stock`, which silently turned every stock request into an AI generation.
 */
function normalizeMediaMode(mode: string): MediaPolicy['default_mode'] {
  if (mode === 'stock' || mode === 'stock_search') return 'stock'
  if (mode === 'none') return 'none'
  return 'ai_generated'
}

function validate(payload: PreferencesFullPayload) {
  const totalWeight = payload.pillars.reduce(
    (acc, p) => acc + (Number(p.weight_pct) || 0),
    0
  )
  if (payload.pillars.length > 0 && totalWeight !== 100) {
    throw new Error(
      `Content pillar weights must sum to exactly 100%. Current sum: ${totalWeight}%`
    )
  }

  const research = payload.research_policy
  if (research.domain_mode === 'allowed' && research.blocked_domains?.length) {
    throw new Error(
      'Cannot specify both allowed and blocked domains. Choose one domain policy.'
    )
  }
  if (research.domain_mode === 'blocked' && research.allowed_domains?.length) {
    throw new Error(
      'Cannot specify both allowed and blocked domains. Choose one domain policy.'
    )
  }

  const c = payload.post_constraints
  if (c.max_chars > LINKEDIN_MAX_CHARS) {
    throw new Error(
      `LinkedIn caps a post at ${LINKEDIN_MAX_CHARS} characters. Lower the maximum length.`
    )
  }
  if (c.target_chars > c.max_chars) {
    throw new Error(
      'Target length cannot exceed the maximum length for a post.'
    )
  }
  if (c.hook_max_chars > c.target_chars) {
    throw new Error('The hook cannot be longer than the whole post.')
  }
}

export async function savePreferences(
  accountId: string,
  payload: PreferencesFullPayload
) {
  validate(payload)

  const columns = {
    postsPerWeek: payload.cadence.frequency || 3,
    pillars: payload.pillars,
    formats: payload.formats,
    cadence: payload.cadence,
    researchPolicy: {
      ...payload.research_policy,
      // Only one list is ever meaningful; persisting both re-creates the conflict.
      allowed_domains:
        payload.research_policy.domain_mode === 'allowed'
          ? payload.research_policy.allowed_domains || []
          : [],
      blocked_domains:
        payload.research_policy.domain_mode === 'blocked'
          ? payload.research_policy.blocked_domains || []
          : []
    },
    mediaPolicy: {
      ...payload.media_policy,
      default_mode: normalizeMediaMode(payload.media_policy.default_mode)
    },
    postConstraints: payload.post_constraints,
    guardrails: payload.guardrails,
    updatedAt: new Date()
  }

  const existing = await db
    .select({ id: preferencesTable.id })
    .from(preferencesTable)
    .where(eq(preferencesTable.accountId, accountId))

  if (existing.length > 0) {
    await db
      .update(preferencesTable)
      .set(columns)
      .where(eq(preferencesTable.accountId, accountId))
  } else {
    await db.insert(preferencesTable).values({ accountId, ...columns })
  }

  revalidatePath(`/accounts/${accountId}/preferences`)
  revalidatePath(`/accounts/${accountId}`)
  revalidatePath('/accounts')
  revalidatePath('/')
  return { success: true }
}
