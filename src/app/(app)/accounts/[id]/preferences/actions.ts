'use server'

import { db } from '@/db'
import { preferencesTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export type PillarConfig = {
  name: string
  description?: string
  weight_pct: number
  example_topics?: string[]
  preferred_formats?: string[]
}

export type PreferencesFullPayload = {
  pillars: PillarConfig[]
  formats: Array<{ format: string; weight: number }>
  cadence: {
    frequency: number // posts per week
    days_of_week: string[]
    time_of_day: string
    posts_per_run: number
    ideas_per_run: number
  }
  research_policy: {
    use_knowledge_base: boolean
    source_ids?: string[]
    use_web_search: boolean
    provider: string
    domain_mode: 'none' | 'allowed' | 'blocked'
    allowed_domains?: string[]
    blocked_domains?: string[]
    freshness_days: number
    max_searches_per_run: number
    require_citations: boolean
    min_citations_per_post: number
  }
  media_policy: {
    default_mode: 'ai_generated' | 'stock_search' | 'none'
    image_style_prompt: string
    aspect_ratio: '1:1' | '16:9' | '4:5'
    always_include_alt_text: boolean
  }
  post_constraints: {
    max_chars: number // max 3000
    target_chars: number // e.g. 1300
    hook_max_chars: number // 200 (the fold)
    hashtag_count: number
    emoji_level: 'none' | 'bullets_only' | 'liberal'
    link_placement: 'body' | 'first_comment'
    cta_required: boolean
    variants_per_post: number
  }
  guardrails: {
    banned_topics: string[]
    banned_words: string[]
    compliance_notes: string
  }
}

export async function savePreferences(accountId: string, payload: PreferencesFullPayload) {
  // Validate pillars sum to 100
  const totalWeight = payload.pillars.reduce((acc, p) => acc + (Number(p.weight_pct) || 0), 0)
  if (payload.pillars.length > 0 && totalWeight !== 100) {
    throw new Error(`Content pillar weights must sum to exactly 100%. Current sum: ${totalWeight}%`)
  }

  // Validate allowed_domains OR blocked_domains — never both
  if (
    payload.research_policy.domain_mode === 'allowed' &&
    payload.research_policy.blocked_domains?.length
  ) {
    throw new Error('Cannot specify both allowed and blocked domains. Choose one domain policy.')
  }

  // Pack the full structured preferences payload into pillars jsonb
  const jsonPayload = {
    pillars: payload.pillars,
    formats: payload.formats,
    cadence: payload.cadence,
    research_policy: payload.research_policy,
    media_policy: payload.media_policy,
    post_constraints: payload.post_constraints,
    guardrails: payload.guardrails,
  }

  const existing = await db
    .select()
    .from(preferencesTable)
    .where(eq(preferencesTable.accountId, accountId))

  if (existing.length > 0) {
    await db
      .update(preferencesTable)
      .set({
        postsPerWeek: payload.cadence.frequency || 3,
        pillars: jsonPayload as any,
        updatedAt: new Date(),
      })
      .where(eq(preferencesTable.accountId, accountId))
  } else {
    await db.insert(preferencesTable).values({
      accountId,
      postsPerWeek: payload.cadence.frequency || 3,
      pillars: jsonPayload as any,
    })
  }

  revalidatePath(`/accounts/${accountId}/preferences`)
  revalidatePath(`/accounts/${accountId}`)
  revalidatePath('/accounts')
  revalidatePath('/')
  return { success: true }
}
