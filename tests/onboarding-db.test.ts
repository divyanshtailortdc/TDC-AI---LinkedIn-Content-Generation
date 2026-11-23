import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import { loadOnboardingFacts } from '../src/lib/onboarding/facts'
import { onboardingProgress } from '../src/lib/onboarding/progress'
import {
  changeOnboarding,
  markOnboardingComplete,
  OnboardingChangeError
} from '../src/lib/onboarding/state'

// Runs against the local development database. Everything it makes hangs off
// two test users, removed at the end (identities cascade from them).
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]
const tag = `qa-onboarding-${Date.now().toString(36)}`

describe('onboarding facts from saved data', { skip: !url }, () => {
  const client = postgres(url!, { max: 2, prepare: false, onnotice: () => {} })
  const db = drizzle(client, { schema })
  let userId = ''
  let otherUserId = ''
  let accountId = ''

  const facts = (
    overrides: { accountId?: string | null; publishingAvailable?: boolean } = {}
  ) =>
    loadOnboardingFacts(db, {
      userId,
      accountId:
        overrides.accountId === undefined ? accountId : overrides.accountId,
      publishingAvailable: overrides.publishingAvailable ?? true,
      bufferPlatforms: ['linkedin', 'x', 'instagram']
    })

  before(async () => {
    const [user] = await db
      .insert(schema.authUsersTable)
      .values({ name: 'Onboarding QA', email: `${tag}@example.test` })
      .returning()
    const [other] = await db
      .insert(schema.authUsersTable)
      .values({ name: 'Other QA', email: `${tag}-other@example.test` })
      .returning()
    userId = user!.id
    otherUserId = other!.id
    // As "Create identity" saves it: the identity and its preferences.
    const [account] = await db
      .insert(schema.accountsTable)
      .values({ userId, name: 'Asha Rao', handle: 'asha', headline: 'Founder' })
      .returning()
    accountId = account!.id
    await db
      .insert(schema.preferencesTable)
      .values({
        accountId,
        enabledFormats: ['linkedin.post', 'instagram.caption']
      })
  })

  after(async () => {
    await db
      .delete(schema.authUsersTable)
      .where(eq(schema.authUsersTable.id, userId))
    await db
      .delete(schema.authUsersTable)
      .where(eq(schema.authUsersTable.id, otherUserId))
    await client.end()
  })

  it('has no identity for a user who just signed up', async () => {
    const f = await facts({ accountId: null })
    assert.equal(f.hasIdentity, false)
    assert.equal(onboardingProgress(f).current, 'profile')
  })

  it('does not count the preferences saved with the identity as done', async () => {
    const f = await facts()
    assert.equal(f.hasIdentity, true)
    const progress = onboardingProgress(f)
    assert.equal(progress.current, 'voice')
    assert.equal(
      progress.steps.find(s => s.key === 'preferences')!.status,
      'todo'
    )
  })

  it('reads each setup step from the table it saves to', async () => {
    await db.insert(schema.voiceConfigsTable).values({ accountId })
    await db
      .insert(schema.goalsTable)
      .values({ accountId, title: 'Win store builds' })
    await db.insert(schema.brandThemesTable).values({ accountId })
    const f = await facts()
    assert.equal(f.hasVoice, true)
    assert.equal(f.goals, 1)
    assert.equal(f.hasBrandTheme, true)
    assert.equal(f.knowledgeDocs, 0)
  })

  it('keeps a skip once, and takes it back', async () => {
    await changeOnboarding(db, accountId, { skip: 'knowledge' })
    await changeOnboarding(db, accountId, { skip: 'knowledge' })
    assert.deepEqual((await facts()).skipped, ['knowledge'])
    await changeOnboarding(db, accountId, { unskip: 'knowledge' })
    assert.deepEqual((await facts()).skipped, [])
    await changeOnboarding(db, accountId, { skip: 'knowledge' })
  })

  it('refuses to skip or confirm steps that need real data', async () => {
    await assert.rejects(
      changeOnboarding(db, accountId, { skip: 'goals' }),
      OnboardingChangeError
    )
    await assert.rejects(
      changeOnboarding(db, accountId, { confirm: 'voice' }),
      OnboardingChangeError
    )
  })

  it('keeps both of two confirmations made at the same time', async () => {
    await Promise.all([
      changeOnboarding(db, accountId, { confirm: 'preferences' }),
      changeOnboarding(db, accountId, { confirm: 'channels' })
    ])
    assert.deepEqual((await facts()).confirmed.sort(), [
      'channels',
      'preferences'
    ])
  })

  it('reads the Buffer connection of the user, and the channel of each platform', async () => {
    let f = await facts()
    assert.equal(f.buffer, 'none')
    // LinkedIn and Instagram publish through Buffer; neither has a channel yet.
    assert.deepEqual(
      f.channels.map(c => [c.platform, c.canPublish]),
      [
        ['linkedin', false],
        ['instagram', false]
      ]
    )
    const [buffer] = await db
      .insert(schema.bufferConnectionsTable)
      .values({ userId, bufferAccountId: `${tag}-buffer`, status: 'connected' })
      .returning()
    await db.insert(schema.platformConnectionsTable).values({
      userId,
      accountId,
      platform: 'linkedin',
      memberId: 'channel-1',
      name: 'Asha Rao',
      status: 'connected',
      scopes: ['posts:write'],
      bufferConnectionId: buffer!.id
    })
    f = await facts()
    assert.equal(f.buffer, 'connected')
    assert.deepEqual(f.channels[0], {
      platform: 'linkedin',
      name: 'Asha Rao',
      status: 'connected',
      canPublish: true
    })
    assert.equal(
      onboardingProgress(f).steps.find(s => s.key === 'channels')!.status,
      'done'
    )
  })

  it("never reads another user's Buffer connection", async () => {
    await db
      .insert(schema.bufferConnectionsTable)
      .values({
        userId: otherUserId,
        bufferAccountId: `${tag}-other`,
        status: 'expired'
      })
    assert.equal((await facts()).buffer, 'connected')
  })

  it('follows the newest run, its ideas and the posts made from them', async () => {
    const [run] = await db
      .insert(schema.runsTable)
      .values({ accountId, status: 'researching' })
      .returning()
    let f = await facts()
    assert.deepEqual(f.latestRun, {
      id: run!.id,
      status: 'researching',
      error: null
    })
    assert.equal(onboardingProgress(f).current, 'ideas')

    await db.insert(schema.ideasTable).values([
      { accountId, runId: run!.id, hook: 'One', status: 'proposed' },
      { accountId, runId: run!.id, hook: 'Two', status: 'drafting' },
      { accountId, runId: run!.id, hook: 'Three', status: 'rejected' }
    ])
    f = await facts()
    assert.deepEqual(f.ideas, {
      total: 3,
      proposed: 1,
      approved: 0,
      drafting: 1
    })
    assert.equal(onboardingProgress(f).current, 'post')

    const [post] = await db
      .insert(schema.postDraftsTable)
      .values({
        accountId,
        hook: 'Hook',
        body: 'Body',
        originalHook: 'Hook',
        originalBody: 'Body',
        status: 'awaiting_review'
      })
      .returning()
    f = await facts()
    assert.equal(f.posts.awaitingReviewId, post!.id)
    assert.equal(onboardingProgress(f).current, 'review')

    await db
      .update(schema.postDraftsTable)
      .set({ status: 'approved', approvedAt: new Date() })
      .where(eq(schema.postDraftsTable.id, post!.id))
    f = await facts()
    assert.equal(f.posts.approvedId, post!.id)
    assert.equal(f.posts.awaitingReviewId, null)
    assert.equal(onboardingProgress(f).current, 'publish')
  })

  it('completes once a publication of the post is published', async () => {
    const [post] = await db
      .select({ id: schema.postDraftsTable.id })
      .from(schema.postDraftsTable)
      .where(eq(schema.postDraftsTable.accountId, accountId))
    const now = new Date()
    const [publication] = await db
      .insert(schema.publicationsTable)
      .values({
        userId,
        accountId,
        draftId: post!.id,
        platform: 'linkedin',
        trigger: 'manual',
        status: 'scheduled',
        scheduledAt: now,
        nextAttemptAt: now
      })
      .returning()
    let f = await facts()
    assert.equal(f.publication?.status, 'scheduled')
    assert.equal(f.published, false)
    assert.equal(f.firstPublishedAt, null)
    assert.equal(
      onboardingProgress(f).steps.find(s => s.key === 'publish')!.status,
      'working'
    )

    await db
      .update(schema.publicationsTable)
      .set({ status: 'published', publishedAt: now })
      .where(eq(schema.publicationsTable.id, publication!.id))
    f = await facts()
    assert.equal(f.published, true)
    assert.equal(f.firstPublishedAt, now.toISOString())
    assert.equal(onboardingProgress(f).complete, true)
  })

  it('records the completion once, and hides and shows the guide', async () => {
    await markOnboardingComplete(db, accountId)
    const first = (await facts()).completedAt
    assert.ok(first)
    await markOnboardingComplete(db, accountId)
    assert.equal((await facts()).completedAt?.getTime(), first.getTime())

    await changeOnboarding(db, accountId, { hidden: true })
    assert.equal((await facts()).hidden, true)
    await changeOnboarding(db, accountId, { hidden: false })
    assert.equal((await facts()).hidden, false)
  })

  it('reads nothing more for an identity whose guide is finished and put away', async () => {
    await changeOnboarding(db, accountId, { hidden: true })
    // Everything the steps saved is still there, but none of it is read:
    // the guide is done with this identity.
    const f = await facts()
    assert.equal(f.hidden, true)
    assert.equal(f.published, true)
    assert.equal(onboardingProgress(f).complete, true)
    assert.equal(f.goals, 0, 'the step tables were not read')
  })

  it('puts the guide away by itself once an identity is complete and the news is old', async () => {
    await changeOnboarding(db, accountId, { hidden: false })
    await markOnboardingComplete(db, accountId, { hide: true })
    assert.equal((await facts()).hidden, true)
  })
})
