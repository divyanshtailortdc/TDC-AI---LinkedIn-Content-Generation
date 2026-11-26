import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  ONBOARDING_STEP_KEYS,
  onboardingProgress,
  stepForPath,
  type OnboardingFacts,
  type OnboardingStepKey
} from '../src/lib/onboarding/progress'

/** A user who has just signed up: nothing saved yet. */
const NEW_USER: OnboardingFacts = {
  hasIdentity: false,
  hasVoice: false,
  knowledgeDocs: 0,
  goals: 0,
  hasBrandTheme: false,
  publishingAvailable: true,
  buffer: 'none',
  channels: [],
  latestRun: null,
  ideas: { total: 0, proposed: 0, approved: 0, drafting: 0 },
  posts: { total: 0, approved: 0, awaitingReviewId: null, approvedId: null },
  publication: null,
  published: false,
  firstPublishedAt: null,
  skipped: [],
  confirmed: []
}

/** Just after "Create identity": the identity and its default preferences exist. */
const NEW_IDENTITY: OnboardingFacts = { ...NEW_USER, hasIdentity: true }

/** Everything before publishing is set up and confirmed. */
const SET_UP: OnboardingFacts = {
  ...NEW_IDENTITY,
  hasVoice: true,
  knowledgeDocs: 1,
  goals: 1,
  hasBrandTheme: true,
  buffer: 'connected',
  channels: [
    {
      platform: 'linkedin',
      name: 'Asha Rao',
      status: 'connected',
      canPublish: true
    }
  ],
  confirmed: ['preferences', 'channels']
}

const statusOf = (facts: OnboardingFacts, key: OnboardingStepKey) =>
  onboardingProgress(facts).steps.find(s => s.key === key)!.status

const stepOf = (facts: OnboardingFacts, key: OnboardingStepKey) =>
  onboardingProgress(facts).steps.find(s => s.key === key)!

describe('onboarding progress', () => {
  it('lists every step of the journey, in order', () => {
    assert.deepEqual(
      onboardingProgress(NEW_USER).steps.map(s => s.key),
      [...ONBOARDING_STEP_KEYS]
    )
    assert.deepEqual(
      [...ONBOARDING_STEP_KEYS],
      [
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
      ]
    )
  })

  it('starts a new user on creating their identity, with everything after it waiting', () => {
    const progress = onboardingProgress(NEW_USER)
    assert.equal(progress.current, 'profile')
    assert.equal(progress.completed, 0)
    assert.equal(progress.total, 12)
    assert.equal(progress.complete, false)
    assert.equal(statusOf(NEW_USER, 'profile'), 'todo')
    for (const step of progress.steps.slice(1)) {
      assert.equal(step.status, 'blocked', step.key)
    }
  })

  it('does not count the preferences saved with a new identity as done', () => {
    // Creating an identity inserts its preferences row with defaults.
    assert.equal(statusOf(NEW_IDENTITY, 'preferences'), 'todo')
    assert.equal(
      statusOf({ ...NEW_IDENTITY, confirmed: ['preferences'] }, 'preferences'),
      'done'
    )
  })

  it('moves on to the voice once the identity exists', () => {
    const progress = onboardingProgress(NEW_IDENTITY)
    assert.equal(statusOf(NEW_IDENTITY, 'profile'), 'done')
    assert.equal(progress.current, 'voice')
    assert.equal(progress.completed, 1)
  })

  it('points at the first unfinished step when steps were done out of order', () => {
    const facts = { ...NEW_IDENTITY, goals: 2, hasBrandTheme: true }
    assert.equal(onboardingProgress(facts).current, 'voice')
    assert.equal(onboardingProgress(facts).completed, 3)
  })

  it('counts a skipped optional step as finished, but not as done', () => {
    const facts = { ...NEW_IDENTITY, hasVoice: true, skipped: ['knowledge'] }
    assert.equal(statusOf(facts, 'knowledge'), 'skipped')
    assert.equal(onboardingProgress(facts).current, 'goals')
    assert.equal(onboardingProgress(facts).completed, 3)
    // Adding a source later turns the skip into done.
    assert.equal(statusOf({ ...facts, knowledgeDocs: 1 }, 'knowledge'), 'done')
  })

  it('ignores a skip on a step that cannot be skipped', () => {
    const facts = { ...NEW_IDENTITY, skipped: ['voice', 'goals'] }
    assert.equal(statusOf(facts, 'voice'), 'todo')
    assert.equal(statusOf(facts, 'goals'), 'todo')
  })

  it('leaves out Buffer and channels when publishing is not set up on the server', () => {
    const facts = {
      ...SET_UP,
      publishingAvailable: false,
      buffer: 'none' as const
    }
    assert.equal(statusOf(facts, 'buffer'), 'unavailable')
    assert.equal(statusOf(facts, 'channels'), 'unavailable')
    assert.equal(onboardingProgress(facts).total, 10)
  })

  it('asks to reconnect an expired Buffer connection', () => {
    const facts = { ...SET_UP, buffer: 'expired' as const }
    assert.equal(statusOf(facts, 'buffer'), 'attention')
    assert.equal(onboardingProgress(facts).current, 'buffer')
    assert.equal(statusOf(facts, 'channels'), 'blocked')
  })

  it('needs the user to confirm the channel Buffer picked automatically', () => {
    const autoPicked = { ...SET_UP, confirmed: ['preferences'] }
    assert.equal(statusOf(autoPicked, 'channels'), 'todo')
    assert.equal(onboardingProgress(autoPicked).current, 'channels')
    assert.equal(statusOf(SET_UP, 'channels'), 'done')
  })

  it('does not take a confirmation for channels that can no longer publish', () => {
    const facts: OnboardingFacts = {
      ...SET_UP,
      channels: [
        {
          platform: 'linkedin',
          name: 'Asha Rao',
          status: 'expired',
          canPublish: false
        }
      ]
    }
    assert.equal(statusOf(facts, 'channels'), 'todo')
  })

  it('has no channel step for an identity none of whose platforms Buffer publishes', () => {
    const facts = { ...SET_UP, channels: [] }
    assert.equal(statusOf(facts, 'channels'), 'unavailable')
  })

  it('follows a run while it generates ideas, and links to it', () => {
    const facts: OnboardingFacts = {
      ...SET_UP,
      latestRun: { id: 'run-1', status: 'researching', error: null }
    }
    const step = stepOf(facts, 'ideas')
    assert.equal(step.status, 'working')
    assert.equal(step.href, '/runs/run-1')
    assert.equal(onboardingProgress(facts).current, 'ideas')
  })

  it('reports a failed run with its error, so it can be tried again', () => {
    const facts: OnboardingFacts = {
      ...SET_UP,
      latestRun: { id: 'run-1', status: 'failed', error: 'AI budget exhausted' }
    }
    const step = stepOf(facts, 'ideas')
    assert.equal(step.status, 'attention')
    assert.equal(step.note, 'AI budget exhausted')
    assert.equal(step.href, '/goals')
  })

  it('counts ideas as generated once any exist', () => {
    const facts: OnboardingFacts = {
      ...SET_UP,
      latestRun: { id: 'run-1', status: 'awaiting_idea_approval', error: null },
      ideas: { total: 5, proposed: 5, approved: 0, drafting: 0 }
    }
    assert.equal(statusOf(facts, 'ideas'), 'done')
    assert.equal(onboardingProgress(facts).current, 'post')
    assert.equal(stepOf(facts, 'post').href, '/ideas')
  })

  it('shows a post being written while an idea is drafting', () => {
    const facts: OnboardingFacts = {
      ...SET_UP,
      ideas: { total: 5, proposed: 4, approved: 0, drafting: 1 }
    }
    assert.equal(statusOf(facts, 'post'), 'working')
  })

  it('sends the review step to the post waiting for review', () => {
    const facts: OnboardingFacts = {
      ...SET_UP,
      ideas: { total: 5, proposed: 4, approved: 0, drafting: 0 },
      posts: {
        total: 1,
        approved: 0,
        awaitingReviewId: 'post-1',
        approvedId: null
      }
    }
    assert.equal(statusOf(facts, 'post'), 'done')
    assert.equal(onboardingProgress(facts).current, 'review')
    assert.equal(stepOf(facts, 'review').href, '/posts/post-1')
    assert.equal(statusOf(facts, 'publish'), 'blocked')
  })

  it('sends the publish step to the approved post', () => {
    const facts: OnboardingFacts = {
      ...SET_UP,
      ideas: { total: 5, proposed: 4, approved: 0, drafting: 0 },
      posts: {
        total: 1,
        approved: 1,
        awaitingReviewId: null,
        approvedId: 'post-1'
      }
    }
    assert.equal(statusOf(facts, 'review'), 'done')
    assert.equal(onboardingProgress(facts).current, 'publish')
    assert.equal(stepOf(facts, 'publish').status, 'todo')
    assert.equal(stepOf(facts, 'publish').href, '/posts/post-1')
  })

  it('waits on a scheduled post, and asks for attention when publishing failed', () => {
    const base: OnboardingFacts = {
      ...SET_UP,
      ideas: { total: 5, proposed: 4, approved: 0, drafting: 0 },
      posts: {
        total: 1,
        approved: 1,
        awaitingReviewId: null,
        approvedId: 'post-1'
      }
    }
    const scheduled: OnboardingFacts = {
      ...base,
      publication: {
        draftId: 'post-1',
        status: 'scheduled',
        scheduledFor: '2026-11-24T09:00:00.000Z',
        error: null
      }
    }
    assert.equal(statusOf(scheduled, 'publish'), 'working')
    assert.equal(onboardingProgress(scheduled).complete, false)
    const failed: OnboardingFacts = {
      ...base,
      publication: {
        draftId: 'post-1',
        status: 'failed',
        scheduledFor: null,
        error: 'Buffer refused the post.'
      }
    }
    assert.equal(statusOf(failed, 'publish'), 'attention')
    assert.equal(stepOf(failed, 'publish').note, 'Buffer refused the post.')
  })

  it('is complete once the first post is published', () => {
    const facts: OnboardingFacts = {
      ...SET_UP,
      ideas: { total: 5, proposed: 4, approved: 0, drafting: 0 },
      posts: {
        total: 1,
        approved: 1,
        awaitingReviewId: null,
        approvedId: 'post-1'
      },
      published: true
    }
    const progress = onboardingProgress(facts)
    assert.equal(progress.complete, true)
    assert.equal(progress.current, null)
    assert.equal(progress.completed, progress.total)
  })

  it('treats an identity that has already published as onboarded, whatever it skipped', () => {
    // Identities set up before the guide existed never confirmed anything.
    const facts: OnboardingFacts = {
      ...NEW_IDENTITY,
      goals: 1,
      posts: {
        total: 3,
        approved: 3,
        awaitingReviewId: null,
        approvedId: 'post-3'
      },
      published: true
    }
    assert.equal(onboardingProgress(facts).complete, true)
  })
})

describe('the onboarding step a page belongs to', () => {
  it('matches each step to the page its work happens on', () => {
    assert.equal(stepForPath('/identity'), 'profile')
    assert.equal(stepForPath('/identity/new'), 'profile')
    assert.equal(stepForPath('/identity/voice'), 'voice')
    assert.equal(stepForPath('/identity/knowledge'), 'knowledge')
    assert.equal(stepForPath('/goals'), 'goals')
    assert.equal(stepForPath('/identity/preferences'), 'preferences')
    assert.equal(stepForPath('/brand'), 'brandTheme')
    assert.equal(stepForPath('/ideas'), 'post')
    assert.equal(stepForPath('/'), null)
  })

  it('resolves pages shared by two steps to the current one', () => {
    // Buffer and channel choice are both on Settings → Integrations.
    assert.equal(stepForPath('/settings/integrations', 'channels'), 'channels')
    assert.equal(stepForPath('/settings/integrations', 'buffer'), 'buffer')
    assert.equal(stepForPath('/settings/integrations', 'voice'), 'buffer')
    // A run is started from Goals, and followed on its own page.
    assert.equal(stepForPath('/goals', 'ideas'), 'ideas')
    assert.equal(stepForPath('/goals', 'voice'), 'goals')
    assert.equal(stepForPath('/runs/abc', 'ideas'), 'ideas')
    assert.equal(stepForPath('/identity/runs', 'ideas'), 'ideas')
    // A post's page is where it is reviewed, and published.
    assert.equal(stepForPath('/posts/abc', 'publish'), 'publish')
    assert.equal(stepForPath('/posts/abc', 'review'), 'review')
    assert.equal(stepForPath('/posts', 'goals'), 'review')
  })
})

describe('what the guide says about each step', () => {
  it('has instructions for every step, and a button for the optional and confirmable ones', async () => {
    const { STEP_CONTENT } = await import('../src/lib/onboarding/content')
    const { SKIPPABLE_STEPS, CONFIRMABLE_STEPS } =
      await import('../src/lib/onboarding/progress')
    for (const key of ONBOARDING_STEP_KEYS) {
      const content = STEP_CONTENT[key]
      assert.ok(
        content.title && content.summary && content.why && content.cta,
        key
      )
      assert.ok(content.how.length > 0, key)
      assert.equal(
        Boolean(content.skipLabel),
        SKIPPABLE_STEPS.has(key),
        `${key} skip`
      )
      assert.equal(
        Boolean(content.confirmLabel),
        CONFIRMABLE_STEPS.has(key),
        `${key} confirm`
      )
    }
  })

  it('puts every step in exactly one part of the checklist, in order', async () => {
    const { ONBOARDING_PHASES } = await import('../src/lib/onboarding/content')
    assert.deepEqual(
      ONBOARDING_PHASES.flatMap(phase => phase.steps),
      [...ONBOARDING_STEP_KEYS]
    )
  })
})

describe('celebrating the first post', () => {
  it('celebrates a first post published in the last few days', async () => {
    const { celebratesFirstPost } =
      await import('../src/lib/onboarding/progress')
    const now = new Date('2026-11-23T12:00:00Z')
    assert.equal(celebratesFirstPost('2026-11-23T11:00:00.000Z', now), true)
    assert.equal(celebratesFirstPost('2026-11-21T12:00:00.000Z', now), true)
  })

  it('does not greet identities that published long before the guide existed', async () => {
    const { celebratesFirstPost } =
      await import('../src/lib/onboarding/progress')
    const now = new Date('2026-11-23T12:00:00Z')
    assert.equal(celebratesFirstPost('2026-10-01T09:00:00.000Z', now), false)
    assert.equal(celebratesFirstPost(null, now), false)
  })
})
