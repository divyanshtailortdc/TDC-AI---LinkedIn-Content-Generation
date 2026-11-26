'use server'

import { db } from '@/db'
import { getIdentity } from '@/lib/identity'
import { requireUser } from '@/lib/session'
import { z } from 'zod'
import { isOnboardingStepKey, type OnboardingStepKey } from './progress'
import {
  changeOnboarding,
  OnboardingChangeError,
  type OnboardingChange
} from './state'
import { loadOnboardingView, type OnboardingView } from './view'

/**
 * The guide's own buttons: skip an optional step (or take the skip back),
 * confirm the defaults of preferences or channels, hide or show the guide
 * bar. Always for the signed-in user's active identity; the step comes from
 * the browser, so it is checked here. Returns the progress as it now
 * stands, which the guide shows at once. No revalidatePath: nothing else on
 * the page depends on it.
 */

const stepKey = z.custom<OnboardingStepKey>(isOnboardingStepKey)
const ChangeSchema = z.union([
  z.object({ skip: stepKey }).strict(),
  z.object({ unskip: stepKey }).strict(),
  z.object({ confirm: stepKey }).strict(),
  z.object({ hidden: z.boolean() }).strict()
])

type Result = { ok: true; view: OnboardingView } | { ok: false; error: string }

export async function updateOnboarding(rawChange: unknown): Promise<Result> {
  const user = await requireUser()
  const identity = await getIdentity()
  if (!identity) return { ok: false, error: 'Create your identity first.' }
  const parsed = ChangeSchema.safeParse(rawChange)
  if (!parsed.success)
    return { ok: false, error: 'That step cannot be changed.' }
  const change = parsed.data as OnboardingChange

  try {
    if ('confirm' in change && change.confirm === 'channels') {
      // Confirming means posts have somewhere to go.
      const { facts } = await loadOnboardingView(user.id, identity)
      if (!facts.channels.some(c => c.canPublish)) {
        return {
          ok: false,
          error:
            'Pick a channel to publish to first: none of your networks has one yet.'
        }
      }
    }
    await changeOnboarding(db, identity.id, change)
    return { ok: true, view: await loadOnboardingView(user.id, identity) }
  } catch (err) {
    if (err instanceof OnboardingChangeError)
      return { ok: false, error: err.message }
    console.error('Could not update onboarding:', err)
    return { ok: false, error: 'Could not save that. Please try again.' }
  }
}
