import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import {
  isReviewerChosenSource,
  reviewerSourceLabel
} from '../src/lib/media/media-source'
import { replaceActiveMedia } from '../src/lib/media/replace-media'
import { getUserFacingRelevance } from '../src/lib/media/relevance-label'

describe('images the reviewer chose', () => {
  it('are recognised by where they came from', () => {
    for (const source of ['user_prompt', 'reviewer_search', 'reviewer_url']) {
      assert.equal(isReviewerChosenSource(source), true, source)
      assert.ok(reviewerSourceLabel(source))
    }
    assert.equal(isReviewerChosenSource(undefined), false)
    assert.equal(isReviewerChosenSource('pipeline'), false)
    assert.equal(reviewerSourceLabel(undefined), null)
  })

  it('an image that was never scored reads as "Not relevant" if the verdict is applied', () => {
    // The reason such images skip the verdict: with no score it can only fail.
    assert.equal(getUserFacingRelevance({ relevanceScore: undefined }).level, 'Not relevant')
  })
})

// Runs against the local development database; every row it makes is removed.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]

describe('supplying an image does not rewrite the media history', { skip: !url }, () => {
  const client = postgres(url!, { max: 2, prepare: false })
  const database = drizzle(client, { schema })
  const handle = `qa-media-${Date.now().toString(36)}`
  let draftId = ''

  before(async () => {
    const [account] = await database
      .insert(schema.accountsTable)
      .values({ name: 'QA Media', accountType: 'personal', handle, headline: 'QA', bio: 'QA', industry: 'Finance' })
      .returning()
    const [draft] = await database
      .insert(schema.postDraftsTable)
      .values({
        accountId: account!.id,
        hook: 'h',
        originalHook: 'h',
        body: 'b',
        originalBody: 'b',
        format: 'thought_leadership',
        charCount: 3
      } as never)
      .returning()
    draftId = draft!.id
    // Three versions: two set aside, one active, the active one scored and labelled.
    const base = { draftId, mode: 'stock', altText: 'old alt', promptOrQuery: 'old query' }
    await database.insert(schema.postMediaTable).values([
      { ...base, version: 1, status: 'superseded', imageUrl: 'https://img.example.com/1.jpg', metadata: { relevanceScore: 91, source: 'pipeline' } },
      { ...base, version: 2, status: 'rejected', imageUrl: 'https://img.example.com/2.jpg', metadata: { relevanceScore: 40 } },
      {
        ...base,
        version: 3,
        status: 'active',
        imageUrl: 'https://img.example.com/3.jpg',
        metadata: { relevanceScore: 88, relevanceExplanation: 'matches', mediaBrief: { primaryConcept: 'old concept' }, width: 800, height: 600 }
      }
    ])
  })
  after(async () => {
    await client`delete from accounts where handle = ${handle}`
    await client.end()
  })

  const rows = () =>
    database
      .select()
      .from(schema.postMediaTable)
      .where(eq(schema.postMediaTable.draftId, draftId))

  it('adds one new active version and sets the current one aside', async () => {
    const before = await rows()
    const created = await replaceActiveMedia(database, {
      draftId,
      mode: 'stock',
      imageUrl: 'https://img.example.com/mine.jpg',
      altText: 'my alt',
      source: 'reviewer_url'
    })
    const after = await rows()

    assert.equal(after.length, before.length + 1)
    assert.equal(created.version, 4)
    assert.equal(created.status, 'active')
    assert.equal(after.filter(r => r.status === 'active').length, 1)
    assert.equal(created.imageUrl, 'https://img.example.com/mine.jpg')
  })

  it('leaves every earlier version exactly as it was (apart from the one set aside)', async () => {
    const all = await rows()
    const byVersion = (v: number) => all.find(r => r.version === v)!
    assert.equal(byVersion(1).imageUrl, 'https://img.example.com/1.jpg')
    assert.equal(byVersion(1).status, 'superseded')
    assert.equal(byVersion(2).imageUrl, 'https://img.example.com/2.jpg')
    assert.equal(byVersion(2).status, 'rejected')
    // The old active image is still there, kept, with its own labels.
    assert.equal(byVersion(3).imageUrl, 'https://img.example.com/3.jpg')
    assert.equal(byVersion(3).status, 'superseded')
    assert.equal((byVersion(3).metadata as any).relevanceScore, 88)
  })

  it('the new version carries none of the old image\'s labels', async () => {
    const latest = (await rows()).find(r => r.version === 4)!
    const meta = latest.metadata as Record<string, unknown>
    assert.equal(meta.source, 'reviewer_url')
    for (const stale of ['relevanceScore', 'relevanceExplanation', 'mediaBrief', 'width', 'height']) {
      assert.ok(!(stale in meta), `${stale} should not carry over`)
    }
    assert.equal(latest.altText, 'my alt')
    assert.equal(latest.previousMediaId, (await rows()).find(r => r.version === 3)!.id)
  })

  it('the old update (by draft id) rewrote every version at once', async () => {
    const [account] = await database
      .insert(schema.accountsTable)
      .values({ name: 'QA Media 2', accountType: 'personal', handle: `${handle}-old`, headline: 'QA', bio: 'QA', industry: 'Finance' })
      .returning()
    const [draft] = await database
      .insert(schema.postDraftsTable)
      .values({ accountId: account!.id, hook: 'h', originalHook: 'h', body: 'b', originalBody: 'b', format: 'thought_leadership', charCount: 3 } as never)
      .returning()
    await database.insert(schema.postMediaTable).values([
      { draftId: draft!.id, mode: 'stock', version: 1, status: 'superseded', imageUrl: 'https://img.example.com/a.jpg', metadata: { relevanceScore: 90 } },
      { draftId: draft!.id, mode: 'stock', version: 2, status: 'active', imageUrl: 'https://img.example.com/b.jpg', metadata: { relevanceScore: 80 } }
    ])
    await database
      .update(schema.postMediaTable)
      .set({ imageUrl: 'https://img.example.com/mine.jpg' })
      .where(eq(schema.postMediaTable.draftId, draft!.id))
    const after = await database.select().from(schema.postMediaTable).where(eq(schema.postMediaTable.draftId, draft!.id))
    assert.ok(after.every(r => r.imageUrl === 'https://img.example.com/mine.jpg'))
    assert.deepEqual(after.map(r => (r.metadata as any).relevanceScore).sort(), [80, 90]) // old labels kept
  })
})

