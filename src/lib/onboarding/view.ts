import 'server-only'

import { db } from '@/db'
import type { Identity } from '@/lib/identity'
import {
  bufferConnectConfig,
  enabledBufferPlatforms
} from '@/lib/publishing/config'
import { loadOnboardingFacts } from './facts'
import {
  celebratesFirstPost,
  onboardingProgress,
  type OnboardingFacts,
  type OnboardingProgress
} from './progress'
import { markOnboardingComplete } from './state'

/** Everything the dashboard checklist shows. */
export type OnboardingView = {
  identity: { id: string; name: string } | null
  progress: OnboardingProgress
  /** For the step details: run status, channels, the scheduled time. */
  facts: OnboardingFacts
  /** The user put the guide away (the checklist's done card dismissed). */
  hidden: boolean
}

/** The onboarding of `userId`'s active identity (null: none yet). */
export async function loadOnboardingView(
  userId: string,
  identity: Pick<Identity, 'id' | 'name'> | null
): Promise<OnboardingView> {
  const { completedAt, hidden, ...facts } = await loadOnboardingFacts(db, {
    userId,
    accountId: identity?.id ?? null,
    publishingAvailable: bufferConnectConfig() !== null,
    bufferPlatforms: enabledBufferPlatforms()
  })
  const progress = onboardingProgress(facts)
  // Once complete, the guide only stays to say so, while that is news.
  const celebrating =
    progress.complete && celebratesFirstPost(facts.firstPublishedAt)
  const putAway = progress.complete && !celebrating && !hidden
  if (identity && progress.complete && (!completedAt || putAway)) {
    // A failure to write it must not break the page: the view does not
    // depend on it.
    await markOnboardingComplete(db, identity.id, { hide: putAway }).catch(
      err => console.error('Could not record onboarding completion:', err)
    )
  }
  return {
    identity: identity ? { id: identity.id, name: identity.name } : null,
    progress,
    facts,
    hidden: hidden || (progress.complete && !celebrating)
  }
}
