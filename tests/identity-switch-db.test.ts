import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, beforeEach, describe, it } from 'node:test'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import { loadReviewHistory } from '../src/lib/ai/review-history'
import {
  IdentitySwitchBlockedError,
  switchIdentityData,
  switchPreview,
  type SwitchPlan
} from '../src/lib/identity-switch'

// Runs against the local development database. Everything it makes hangs off
// one test user, removed at the end (accounts cascade from it).
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]
const tag = `qa-switch-${Date.now().toString(36)}`

const tdcPlan = (over: Partial<SwitchPlan> = {}): SwitchPlan => ({
  profile: {
    name: 'TDCCommerce',
    company: '',
    description: 'TDCCommerce builds and runs online stores for D2C brands.',
    targetAudience: 'D2C founders selling online',
    offerings: 'Store builds\nMarketplace management',
    industry: 'E-commerce services',
    websiteUrl: 'https://tdccommerce.com'
  },
  profileLinks: { linkedin: 'https://www.linkedin.com/company/tdccommerce' },
  otherLink: null,
  voice: { tone: 'authoritative', perspective: 'we', emojiPolicy: 'minimal' },
  guardrails: { banned_topics: ['Competitor pricing'], compliance_notes: '' },
  channels: { linkedin: { style: 'professional' } },
  goal: {
    title: 'Win D2C store builds',
    objective: 'leads',
    keyMessage: 'A store that sells needs more than a theme.',
    desiredAction: 'Book a call',
    targetUrl: 'https://tdccommerce.com/contact',
    linkStrategy: 'first_comment',
    platforms: []
  },
  removeKnowledgeIds: [],
  resetBrandTheme: true,
  ...over
})

describe('switching an identity to another company', { skip: !url }, () => {
  const client = postgres(url!, { max: 2, prepare: false, onnotice: () => {} })
  const db = drizzle(client, { schema })
  let userId = ''
  let accountId = ''
  let zomatoDocId = ''
  let ownDocId = ''

  /** A Zomato identity with something in every table a switch touches. */
  async function seedZomato() {
    const [account] = await db
      .insert(schema.accountsTable)
      .values({
        userId,
        name: 'Zomato',
        accountType: 'company',
        handle: 'instagram-com-zomato',
        headline: 'Food delivery',
        bio: 'Zomato is India’s food delivery app.',
        company: 'Eternal Limited',
        industry: 'Food delivery',
        websiteUrl: 'https://www.zomato.com',
        linkedinUrl: 'https://www.instagram.com/zomato/',
        profileLinks: {
          instagram: 'https://www.instagram.com/zomato/',
          x: 'https://x.com/zomato'
        }
      })
      .returning()
    accountId = account!.id
    const old = new Date(Date.now() - 60_000)
    await db.insert(schema.offeringsTable).values([
      { accountId, name: 'Food delivery', description: 'Food delivery', createdAt: old },
      { accountId, name: 'Zomato Gold', description: 'Membership' }
    ])
    await db.insert(schema.audiencesTable).values([
      { accountId, name: 'Hungry urban Indians', createdAt: old },
      { accountId, name: 'Restaurant partners' }
    ])
    await db.insert(schema.voiceConfigsTable).values({
      accountId,
      tone: 'witty',
      emojiPolicy: 'liberal',
      derivedStyleRubric: 'Open with a late-night craving.',
      rawSamplesText: 'Order now 🍟'
    })
    await db.insert(schema.samplePostsTable).values({
      accountId,
      content: 'Fries at 2am? Say less.',
      platform: 'instagram'
    })
    await db.insert(schema.preferencesTable).values({
      accountId,
      enabledFormats: ['instagram.caption', 'linkedin.post'],
      // Saved notes hold a learned style too (cleanChannelSettings), though
      // the column's type predates it.
      channelSettings: {
        instagram: {
          style: 'fun',
          tone: 'Shout-outs to delivery partners',
          audience: 'Food meme scrollers',
          rubric: 'Hinglish one-liners'
        }
      } as Record<string, { audience?: string; tone?: string; style?: string }>,
      guardrails: { banned_topics: ['Swiggy'], compliance_notes: 'FSSAI' }
    })
    const [goalA, goalB] = await db
      .insert(schema.goalsTable)
      .values([
        { accountId, title: 'Make Zomato the craving app', keyMessage: 'Cravings' },
        { accountId, title: 'Celebrate delivery partners', keyMessage: 'Riders' }
      ])
      .returning()
    await db.insert(schema.schedulesTable).values({
      accountId,
      dayGoals: { '1': [goalA!.id], '3': [goalB!.id] }
    })
    const [zomatoDoc, ownDoc] = await db
      .insert(schema.knowledgeDocumentsTable)
      .values([
        {
          accountId,
          title: 'Zomato - India’s #1 Food delivery app',
          sourceType: 'url',
          sourceUrl: 'https://www.zomato.com',
          content: 'Order food online'
        },
        {
          accountId,
          title: 'Our pricing notes',
          sourceType: 'text',
          content: 'Written by hand'
        }
      ])
      .returning()
    zomatoDocId = zomatoDoc!.id
    ownDocId = ownDoc!.id
    await db.insert(schema.documentChunksTable).values({
      documentId: zomatoDocId,
      accountId,
      chunkIndex: 0,
      content: 'Order food online',
      embedding: Array(schema.EMBEDDING_DIMENSIONS).fill(0.01),
      embeddingModel: 'test'
    })
    const [run] = await db
      .insert(schema.runsTable)
      .values({ accountId, status: 'awaiting_idea_approval' })
      .returning()
    await db.insert(schema.ideasTable).values([
      { accountId, runId: run!.id, hook: 'Fries again', status: 'proposed' },
      { accountId, runId: run!.id, hook: 'Rider stories', status: 'approved' },
      { accountId, runId: run!.id, hook: 'Already posted', status: 'drafted' }
    ])
    await db.insert(schema.postDraftsTable).values({
      accountId,
      hook: 'Fries at 2am',
      body: 'Body',
      originalHook: 'Fries at 2am',
      originalBody: 'Body'
    })
    await db.insert(schema.platformInsightsTable).values({
      accountId,
      platform: 'instagram',
      profileUrl: 'https://www.instagram.com/zomato/',
      status: 'ready'
    })
    await db.insert(schema.brandThemesTable).values({
      accountId,
      primaryColor: '#e23744',
      footerText: 'zomato.com'
    })
    const newsletter = (name: string, status: string) => ({
      accountId,
      name,
      publisher: name,
      description: 'Food news',
      category: 'industry' as const,
      relevanceScore: 90,
      websiteUrl: `https://${name}.example`,
      signupUrl: `https://${name}.example/signup`,
      signupUrlKey: `${name}.example/signup`,
      status: status as 'discovered'
    })
    await db
      .insert(schema.newslettersTable)
      .values([newsletter('foodbrief', 'discovered'), newsletter('dineout', 'subscribed')])
    await db.insert(schema.platformConnectionsTable).values({
      userId,
      accountId,
      platform: 'instagram',
      memberId: `${tag}-ig`,
      name: 'zomato',
      autoPublish: true
    })
  }

  before(async () => {
    const [user] = await db
      .insert(schema.authUsersTable)
      .values({ name: 'QA Switch', email: `${tag}@example.test` })
      .returning()
    userId = user!.id
  })
  beforeEach(async () => {
    await db.delete(schema.accountsTable).where(eq(schema.accountsTable.userId, userId))
    await seedZomato()
  })
  after(async () => {
    await db.delete(schema.authUsersTable).where(eq(schema.authUsersTable.id, userId))
    await client.end()
  })

  it('previews what the switch would retire', async () => {
    const preview = await switchPreview(db, accountId)
    assert.equal(preview.knowledgeDocs.length, 2)
    assert.equal(preview.openIdeas, 2)
    assert.deepEqual(preview.activeGoals.sort(), [
      'Celebrate delivery partners',
      'Make Zomato the craving app'
    ])
    assert.equal(preview.samplePosts, 1)
    assert.equal(preview.learnedStyle, true)
    assert.deepEqual(preview.insights, [
      { platform: 'instagram', profileUrl: 'https://www.instagram.com/zomato/' }
    ])
    assert.deepEqual(preview.brandTheme, { logo: false, footerText: 'zomato.com', colors: true })
    assert.equal(preview.untouchedNewsletters, 1)
    assert.equal(preview.followedNewsletters, 1)
    assert.equal(preview.posts, 1)
    assert.deepEqual(preview.connections, [
      { platform: 'instagram', name: 'zomato', autoPublish: true }
    ])
    assert.equal(preview.extraOfferings, 1)
    assert.equal(preview.extraAudiences, 1)
    assert.equal(preview.blocked, null)
  })

  it('replaces every part of the identity and retires the old company’s data', async () => {
    const started = Date.now()
    const summary = await switchIdentityData(
      db,
      accountId,
      tdcPlan({ removeKnowledgeIds: [zomatoDocId] })
    )

    const [account] = await db
      .select()
      .from(schema.accountsTable)
      .where(eq(schema.accountsTable.id, accountId))
    assert.equal(account!.name, 'TDCCommerce')
    assert.equal(account!.company, null)
    assert.equal(account!.bio, tdcPlan().profile.description)
    assert.equal(account!.industry, 'E-commerce services')
    assert.equal(account!.websiteUrl, 'https://tdccommerce.com')
    // Only the new company's links: Zomato's Instagram and X are gone.
    assert.deepEqual(account!.profileLinks, {
      linkedin: 'https://www.linkedin.com/company/tdccommerce'
    })
    assert.equal(account!.linkedinUrl, 'https://www.linkedin.com/company/tdccommerce')
    assert.equal(account!.handle, 'tdccommerce')
    assert.equal(account!.headline, 'E-commerce services')
    const since = account!.contextSince?.getTime() ?? 0
    assert.ok(Math.abs(since - started) < 60_000, 'context_since is the switch time')
    assert.equal(account!.contextIdentity, null)
    assert.deepEqual(summary.linksRemoved.sort(), [
      'https://www.instagram.com/zomato/',
      'https://x.com/zomato'
    ])

    const offerings = await db
      .select()
      .from(schema.offeringsTable)
      .where(eq(schema.offeringsTable.accountId, accountId))
    assert.deepEqual(
      offerings.filter(o => o.isActive).map(o => o.description),
      ['Store builds\nMarketplace management']
    )
    assert.equal(offerings.length, 2, 'the old offering is kept, switched off')
    const audiences = await db
      .select()
      .from(schema.audiencesTable)
      .where(eq(schema.audiencesTable.accountId, accountId))
    assert.deepEqual(audiences.map(a => a.name), ['D2C founders selling online'])

    const [voice] = await db
      .select()
      .from(schema.voiceConfigsTable)
      .where(eq(schema.voiceConfigsTable.accountId, accountId))
    assert.equal(voice!.tone, 'authoritative')
    assert.equal(voice!.perspective, 'we')
    assert.equal(voice!.emojiPolicy, 'minimal')
    // Not suggested: the default, not Zomato's.
    assert.equal(voice!.hashtagPolicy, '0-3, end of post')
    assert.equal(voice!.derivedStyleRubric, null)
    assert.equal(voice!.rawSamplesText, null)
    const samples = await db
      .select()
      .from(schema.samplePostsTable)
      .where(eq(schema.samplePostsTable.accountId, accountId))
    assert.deepEqual(samples.map(s => s.isActive), [false])

    const [prefs] = await db
      .select()
      .from(schema.preferencesTable)
      .where(eq(schema.preferencesTable.accountId, accountId))
    assert.deepEqual(prefs!.enabledFormats, ['instagram.caption', 'linkedin.post'])
    assert.deepEqual(prefs!.channelSettings, { linkedin: { style: 'professional' } })
    assert.deepEqual(prefs!.guardrails, {
      banned_topics: ['Competitor pricing'],
      compliance_notes: ''
    })

    const goals = await db
      .select()
      .from(schema.goalsTable)
      .where(eq(schema.goalsTable.accountId, accountId))
    assert.deepEqual(
      goals.filter(g => g.isActive).map(g => g.title),
      ['Win D2C store builds']
    )
    assert.equal(goals.length, 3, 'old goals are kept, paused')
    assert.equal(summary.goal, 'created')
    assert.equal(summary.goalsPaused, 2)
    const [schedule] = await db
      .select()
      .from(schema.schedulesTable)
      .where(eq(schema.schedulesTable.accountId, accountId))
    assert.equal(schedule!.dayGoals, null)

    const docs = await db
      .select({ id: schema.knowledgeDocumentsTable.id })
      .from(schema.knowledgeDocumentsTable)
      .where(eq(schema.knowledgeDocumentsTable.accountId, accountId))
    assert.deepEqual(docs.map(d => d.id), [ownDocId], 'only the picked document goes')
    const chunks = await db
      .select()
      .from(schema.documentChunksTable)
      .where(eq(schema.documentChunksTable.accountId, accountId))
    assert.equal(chunks.length, 0, 'its embeddings go with it')

    const ideas = await db
      .select({ hook: schema.ideasTable.hook, status: schema.ideasTable.status })
      .from(schema.ideasTable)
      .where(eq(schema.ideasTable.accountId, accountId))
    assert.deepEqual(
      Object.fromEntries(ideas.map(i => [i.hook, i.status])),
      { 'Fries again': 'rejected', 'Rider stories': 'rejected', 'Already posted': 'drafted' }
    )
    const feedback = await db
      .select()
      .from(schema.feedbackTable)
      .where(eq(schema.feedbackTable.accountId, accountId))
    assert.equal(feedback.length, 0)
    const [run] = await db
      .select({ status: schema.runsTable.status })
      .from(schema.runsTable)
      .where(eq(schema.runsTable.accountId, accountId))
    assert.equal(run!.status, 'completed')

    const posts = await db
      .select()
      .from(schema.postDraftsTable)
      .where(eq(schema.postDraftsTable.accountId, accountId))
    assert.equal(posts.length, 1, 'posts are kept')

    const insights = await db
      .select()
      .from(schema.platformInsightsTable)
      .where(eq(schema.platformInsightsTable.accountId, accountId))
    assert.equal(insights.length, 0)
    const brand = await db
      .select()
      .from(schema.brandThemesTable)
      .where(eq(schema.brandThemesTable.accountId, accountId))
    assert.equal(brand.length, 0)
    const newsletters = await db
      .select({ name: schema.newslettersTable.name })
      .from(schema.newslettersTable)
      .where(eq(schema.newslettersTable.accountId, accountId))
    assert.deepEqual(newsletters.map(n => n.name), ['dineout'])
    const [connection] = await db
      .select()
      .from(schema.platformConnectionsTable)
      .where(eq(schema.platformConnectionsTable.accountId, accountId))
    assert.equal(connection!.autoPublish, false, 'still connected, but posts nothing by itself')
    assert.deepEqual(summary.autoPublishOff, [{ platform: 'instagram', name: 'zomato' }])

    assert.equal(summary.ideasRejected, 2)
    assert.equal(summary.knowledgeRemoved, 1)
    assert.equal(summary.samplePostsRetired, 1)
    assert.equal(summary.insightsCleared, 1)
    assert.deepEqual(summary.insightsKept, [])
    assert.equal(summary.newslettersRemoved, 1)
    assert.equal(summary.brandThemeReset, true)
    assert.equal(summary.offeringsRetired, 1)
    assert.equal(summary.audiencesRemoved, 1)
  })

  it('leaves the old company’s posts, ideas and rejections out of prompt history', async () => {
    await db.insert(schema.feedbackTable).values({
      accountId,
      verdict: 'rejected',
      reasonText: 'Too much about fries'
    })
    const before = await loadReviewHistory(db, accountId)
    assert.equal((before.otherDrafts?.length ?? 0) + before.drafts.length, 1)
    assert.equal(before.ideas.length, 3)
    assert.deepEqual(before.rejectionReasons, ['Too much about fries'])

    await switchIdentityData(db, accountId, tdcPlan())
    assert.deepEqual(await loadReviewHistory(db, accountId), {
      drafts: [],
      otherDrafts: [],
      ideas: [],
      rejectionReasons: []
    })

    await db.insert(schema.ideasTable).values({ accountId, hook: 'Store launch checklist' })
    const afterSwitch = await loadReviewHistory(db, accountId)
    assert.deepEqual(afterSwitch.ideas.map(i => i.title), ['Store launch checklist'])
  })

  it('brings back the goal with the same title when switching back', async () => {
    await switchIdentityData(db, accountId, tdcPlan())
    const summary = await switchIdentityData(
      db,
      accountId,
      tdcPlan({
        profile: { ...tdcPlan().profile, name: 'Zomato', websiteUrl: 'https://www.zomato.com' },
        goal: { ...tdcPlan().goal!, title: 'make zomato the craving app' }
      })
    )
    assert.equal(summary.goal, 'reactivated')
    const active = await db
      .select({ title: schema.goalsTable.title })
      .from(schema.goalsTable)
      .where(
        and(eq(schema.goalsTable.accountId, accountId), eq(schema.goalsTable.isActive, true))
      )
    assert.deepEqual(active.map(g => g.title), ['make zomato the craving app'])
  })

  it('keeps what was learned from a profile the identity keeps', async () => {
    // The link was saved by hand for the new company before the switch.
    const summary = await switchIdentityData(
      db,
      accountId,
      tdcPlan({ profileLinks: { instagram: 'https://instagram.com/zomato' } })
    )
    assert.deepEqual(summary.insightsKept, ['instagram'])
    assert.equal(summary.insightsCleared, 0)
    const insights = await db
      .select()
      .from(schema.platformInsightsTable)
      .where(eq(schema.platformInsightsTable.accountId, accountId))
    assert.equal(insights.length, 1)
  })

  it('keeps the brand theme unless asked to reset it', async () => {
    await switchIdentityData(db, accountId, tdcPlan({ resetBrandTheme: false }))
    const brand = await db
      .select()
      .from(schema.brandThemesTable)
      .where(eq(schema.brandThemesTable.accountId, accountId))
    assert.equal(brand.length, 1)
  })

  it('changes nothing while a run is working', async () => {
    await db
      .update(schema.runsTable)
      .set({ status: 'researching' })
      .where(eq(schema.runsTable.accountId, accountId))
    await assert.rejects(
      switchIdentityData(db, accountId, tdcPlan()),
      IdentitySwitchBlockedError
    )
    const [account] = await db
      .select()
      .from(schema.accountsTable)
      .where(eq(schema.accountsTable.id, accountId))
    assert.equal(account!.name, 'Zomato')
    assert.equal((await switchPreview(db, accountId)).blocked !== null, true)
  })

  it('changes nothing when a write fails part way', async () => {
    // Postgres rejects NUL in text: the goal insert fails after the account,
    // voice, preferences and goal pausing have already run.
    await assert.rejects(
      switchIdentityData(
        db,
        accountId,
        tdcPlan({
          removeKnowledgeIds: [zomatoDocId],
          goal: { ...tdcPlan().goal!, keyMessage: 'bad\u0000text' }
        })
      )
    )
    const [account] = await db
      .select()
      .from(schema.accountsTable)
      .where(eq(schema.accountsTable.id, accountId))
    assert.equal(account!.name, 'Zomato')
    assert.deepEqual(account!.profileLinks, {
      instagram: 'https://www.instagram.com/zomato/',
      x: 'https://x.com/zomato'
    })
    const preview = await switchPreview(db, accountId)
    assert.equal(preview.activeGoals.length, 2)
    assert.equal(preview.knowledgeDocs.length, 2)
    assert.equal(preview.openIdeas, 2)
    assert.equal(preview.insights.length, 1)
  })
})
