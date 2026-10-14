'use server'

import { db } from '@/db'
import {
  preferencesTable,
  type ContentPillar,
  type Guardrails,
  type PostConstraints
} from '@/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export type PillarConfig = ContentPillar

/**
 * Emoji, hashtags and banned words live in Voice, and link placement on each
 * goal beside its link; nothing here repeats them.
 */
export type PreferencesPayload = {
  pillars: PillarConfig[]
  ideasPerRun: number
  post_constraints: PostConstraints
  guardrails: Guardrails
}

const MIN_IDEAS_PER_RUN = 3
const MAX_IDEAS_PER_RUN = 12

/**
 * Rescales pillar weights to sum to exactly 100 (largest remainder), so users
 * set relative importance instead of doing arithmetic. All-zero weights split
 * evenly.
 */
function normalizePillarWeights(pillars: PillarConfig[]): PillarConfig[] {
  const named = pillars
    .map(p => ({
      name: p.name.trim(),
      weight_pct: Math.max(0, Number(p.weight_pct) || 0),
      example_topics: (p.example_topics || [])
        .map(t => t.trim())
        .filter(Boolean)
    }))
    .filter(p => p.name.length > 0)
  if (named.length === 0) return []

  const total = named.reduce((sum, p) => sum + p.weight_pct, 0)
  const exact = named.map(p =>
    total > 0 ? (p.weight_pct / total) * 100 : 100 / named.length
  )
  const rounded = exact.map(Math.floor)
  let remaining = 100 - rounded.reduce((a, b) => a + b, 0)
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)
  for (let i = 0; remaining > 0; i++, remaining--) {
    rounded[order[i % order.length]!.index]! += 1
  }

  return named.map((p, i) => ({ ...p, weight_pct: rounded[i]! }))
}

function validate(payload: PreferencesPayload) {
  const ideas = Number(payload.ideasPerRun)
  if (!Number.isInteger(ideas) || ideas < MIN_IDEAS_PER_RUN || ideas > MAX_IDEAS_PER_RUN) {
    throw new Error(
      `Ideas per run must be between ${MIN_IDEAS_PER_RUN} and ${MAX_IDEAS_PER_RUN}.`
    )
  }
}

export async function savePreferences(
  accountId: string,
  payload: PreferencesPayload
) {
  validate(payload)

  const columns = {
    pillars: normalizePillarWeights(payload.pillars),
    ideasPerRun: Number(payload.ideasPerRun),
    postConstraints: {
      cta_required: Boolean(payload.post_constraints.cta_required)
    },
    guardrails: {
      banned_topics: payload.guardrails.banned_topics,
      compliance_notes: payload.guardrails.compliance_notes.trim()
    },
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
