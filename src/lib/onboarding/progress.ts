import { BRAND_THEME_PATH } from '@/lib/brand/theme-path'
import { IDENTITY_PATH } from '@/lib/identity-path'
import type { PlatformId } from '@/lib/platforms'
import type {
  ConnectionStatus,
  PublicationStatus
} from '@/lib/publishing/status'
import { ACTIVE_RUN_STATUSES } from '@/lib/run-status'
import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'

/**
 * The guided journey from signing up to the first published post, worked out
 * from what is actually saved (src/lib/onboarding/facts.ts) rather than from
 * which pages were visited. So it resumes by itself, on any device: whatever
 * was saved last time is already done. Pure, so the dashboard checklist, the
 * guide bar and the tests all read the same rules.
 */

export const ONBOARDING_STEP_KEYS = [
  'profile',
  'voice',
  'knowledge',
  'goals',
  'preferences',
  'brandTheme',
  'buffer',
  'channels',
  'ideas',
  'post',
  'review',
  'publish'
] as const
export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number]

export const isOnboardingStepKey = (
  value: unknown
): value is OnboardingStepKey =>
  typeof value === 'string' &&
  (ONBOARDING_STEP_KEYS as readonly string[]).includes(value)

/** Steps that can be left for later; skipping them still counts as finished. */
export const SKIPPABLE_STEPS: ReadonlySet<OnboardingStepKey> = new Set([
  'knowledge',
  'brandTheme'
])

/**
 * Steps whose defaults exist before the user has looked at them (preferences
 * are saved with the identity; connecting Buffer picks a channel per network),
 * so they are done only once the user saves or confirms them.
 */
export const CONFIRMABLE_STEPS: ReadonlySet<OnboardingStepKey> = new Set([
  'preferences',
  'channels'
])

export type ChannelFact = {
  platform: PlatformId
  /** The account posts go out as; null when none is picked. */
  name: string | null
  status: ConnectionStatus | null
  canPublish: boolean
}

/** What is saved for the user and their active identity. */
export type OnboardingFacts = {
  hasIdentity: boolean
  hasVoice: boolean
  knowledgeDocs: number
  goals: number
  hasBrandTheme: boolean
  /** Buffer can be connected on this server (BUFFER_CLIENT_ID is set). */
  publishingAvailable: boolean
  /** The user's Buffer connection (one per user, for every identity). */
  buffer: 'connected' | 'expired' | 'none'
  /** One per platform the identity posts on that publishes through Buffer. */
  channels: ChannelFact[]
  latestRun: { id: string; status: string; error: string | null } | null
  ideas: { total: number; proposed: number; approved: number; drafting: number }
  posts: {
    total: number
    approved: number
    /** The newest post waiting for review. */
    awaitingReviewId: string | null
    /** The newest approved post not yet out. */
    approvedId: string | null
  }
  /** The newest publication of the identity's posts. */
  publication: {
    draftId: string
    status: PublicationStatus
    scheduledFor: string | null
    error: string | null
  } | null
  /** A post is out on its platform, or was marked posted by hand. */
  published: boolean
  /** When the first one went out (ISO); null before. */
  firstPublishedAt: string | null
  skipped: string[]
  confirmed: string[]
}

/**
 * - done / skipped: finished.
 * - todo: the user has something to do.
 * - working: the app is busy (a run, a draft, a scheduled post); nothing to do but wait.
 * - attention: it went wrong (a failed run or publish, Buffer expired).
 * - blocked: an earlier step has to be finished first.
 * - unavailable: does not apply (publishing is not set up on this server).
 */
export type OnboardingStepStatus =
  | 'done'
  | 'skipped'
  | 'todo'
  | 'working'
  | 'attention'
  | 'blocked'
  | 'unavailable'

export type OnboardingStepState = {
  key: OnboardingStepKey
  status: OnboardingStepStatus
  /** Where the work for the step is done. */
  href: string
  /** A detail of where it stands, such as the error that stopped it. */
  note?: string
}

export type OnboardingProgress = {
  steps: OnboardingStepState[]
  /** The step to work on next; null once the journey is complete. */
  current: OnboardingStepKey | null
  /** Steps finished (done or skipped), out of `total`. */
  completed: number
  /** Every step that applies. */
  total: number
  /** The first post is out. */
  complete: boolean
}

const FINISHED: ReadonlySet<OnboardingStepStatus> = new Set(['done', 'skipped'])

/** Where a step's work is done, when it does not depend on what is saved. */
const STEP_PATHS: Record<OnboardingStepKey, string> = {
  profile: IDENTITY_PATH,
  voice: `${IDENTITY_PATH}/voice`,
  knowledge: `${IDENTITY_PATH}/knowledge`,
  goals: '/goals',
  preferences: `${IDENTITY_PATH}/preferences`,
  brandTheme: BRAND_THEME_PATH,
  buffer: INTEGRATIONS_SETTINGS_PATH,
  channels: INTEGRATIONS_SETTINGS_PATH,
  ideas: '/goals',
  post: '/ideas',
  review: '/posts',
  publish: '/posts'
}

const isActiveRun = (status: string) =>
  (ACTIVE_RUN_STATUSES as readonly string[]).includes(status)

function stepState(
  key: OnboardingStepKey,
  facts: OnboardingFacts
): Omit<OnboardingStepState, 'key' | 'href'> & { href?: string } {
  const skipped = SKIPPABLE_STEPS.has(key) && facts.skipped.includes(key)
  const confirmed = CONFIRMABLE_STEPS.has(key) && facts.confirmed.includes(key)
  const doneOrSkip = (done: boolean) =>
    ({ status: done ? 'done' : skipped ? 'skipped' : 'todo' }) as const

  if (key === 'profile') return { status: facts.hasIdentity ? 'done' : 'todo' }
  if (!facts.hasIdentity) return { status: 'blocked' }

  switch (key) {
    case 'voice':
      return doneOrSkip(facts.hasVoice)
    case 'knowledge':
      return doneOrSkip(facts.knowledgeDocs > 0)
    case 'goals':
      return doneOrSkip(facts.goals > 0)
    case 'preferences':
      return doneOrSkip(confirmed)
    case 'brandTheme':
      return doneOrSkip(facts.hasBrandTheme)
    case 'buffer':
      if (!facts.publishingAvailable) return { status: 'unavailable' }
      if (facts.buffer === 'connected') return { status: 'done' }
      if (facts.buffer === 'expired') {
        return { status: 'attention', note: 'Buffer needs reconnecting.' }
      }
      return { status: 'todo' }
    case 'channels': {
      if (!facts.publishingAvailable || facts.channels.length === 0) {
        return { status: 'unavailable' }
      }
      if (facts.buffer !== 'connected') return { status: 'blocked' }
      const usable = facts.channels.some(c => c.canPublish)
      return { status: confirmed && usable ? 'done' : 'todo' }
    }
    case 'ideas': {
      if (facts.ideas.total > 0) return { status: 'done' }
      const run = facts.latestRun
      if (run && isActiveRun(run.status)) {
        return { status: 'working', href: `/runs/${run.id}` }
      }
      if (facts.goals === 0) return { status: 'blocked' }
      if (run?.status === 'failed') {
        return { status: 'attention', note: run.error ?? undefined }
      }
      return { status: 'todo' }
    }
    case 'post':
      if (facts.posts.total > 0) return { status: 'done' }
      if (facts.ideas.drafting > 0) return { status: 'working' }
      if (facts.ideas.total === 0) return { status: 'blocked' }
      return { status: 'todo' }
    case 'review':
      if (facts.posts.approved > 0 || facts.published) return { status: 'done' }
      if (facts.posts.total === 0) return { status: 'blocked' }
      return {
        status: 'todo',
        href: facts.posts.awaitingReviewId
          ? `/posts/${facts.posts.awaitingReviewId}`
          : undefined
      }
    case 'publish': {
      if (facts.published) return { status: 'done' }
      const publication = facts.publication
      const href = publication
        ? `/posts/${publication.draftId}`
        : facts.posts.approvedId
          ? `/posts/${facts.posts.approvedId}`
          : undefined
      if (
        publication?.status === 'scheduled' ||
        publication?.status === 'publishing'
      ) {
        return { status: 'working', href }
      }
      if (publication?.status === 'failed') {
        return {
          status: 'attention',
          href,
          note: publication.error ?? undefined
        }
      }
      if (facts.posts.approved === 0) return { status: 'blocked' }
      return { status: 'todo', href }
    }
  }
  return { status: 'todo' }
}

export function onboardingProgress(facts: OnboardingFacts): OnboardingProgress {
  const steps = ONBOARDING_STEP_KEYS.map(key => {
    const { href, ...state } = stepState(key, facts)
    return { key, href: href ?? STEP_PATHS[key], ...state }
  })
  const applies = steps.filter(s => s.status !== 'unavailable')
  // The first post going out is the point of it all: an identity that has
  // published (set up before this guide existed, say) is onboarded.
  const complete = facts.published
  const completed = complete
    ? applies.length
    : applies.filter(s => FINISHED.has(s.status)).length
  const current = complete
    ? null
    : (applies.find(s => !FINISHED.has(s.status))?.key ?? null)
  return { steps, current, completed, total: applies.length, complete }
}

/**
 * Which step a page is for. Some pages serve two steps (Settings →
 * Integrations: Buffer, then channels; Goals: goals, then starting a run;
 * a post's page: review, then publish): there, the current step if it is one
 * of them, else the first.
 */
const PAGE_STEPS: Array<{
  match: (path: string) => boolean
  steps: OnboardingStepKey[]
}> = [
  {
    match: p => p === IDENTITY_PATH || p === `${IDENTITY_PATH}/new`,
    steps: ['profile']
  },
  { match: p => p === `${IDENTITY_PATH}/voice`, steps: ['voice'] },
  { match: p => p === `${IDENTITY_PATH}/knowledge`, steps: ['knowledge'] },
  { match: p => p === `${IDENTITY_PATH}/preferences`, steps: ['preferences'] },
  { match: p => p === BRAND_THEME_PATH, steps: ['brandTheme'] },
  {
    match: p => p === INTEGRATIONS_SETTINGS_PATH,
    steps: ['buffer', 'channels']
  },
  { match: p => p === '/goals', steps: ['goals', 'ideas'] },
  {
    match: p =>
      p === `${IDENTITY_PATH}/runs` || p === '/runs' || p.startsWith('/runs/'),
    steps: ['ideas']
  },
  { match: p => p === '/ideas', steps: ['post'] },
  {
    match: p => p === '/posts' || p.startsWith('/posts/'),
    steps: ['review', 'publish']
  }
]

export function stepForPath(
  pathname: string,
  current: OnboardingStepKey | null = null
): OnboardingStepKey | null {
  const page = PAGE_STEPS.find(p => p.match(pathname))
  if (!page) return null
  return current && page.steps.includes(current) ? current : page.steps[0]!
}

/** How long the "your first post is out" message stays up by itself. */
const CELEBRATION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Whether to say the first post is out: only when it went out recently.
 * Identities that published before this guide existed are onboarded too,
 * and are not greeted on every page for something done long ago.
 */
export function celebratesFirstPost(
  firstPublishedAt: string | null,
  now: Date = new Date()
): boolean {
  if (!firstPublishedAt) return false
  const at = Date.parse(firstPublishedAt)
  return Number.isFinite(at) && now.getTime() - at < CELEBRATION_MS
}
