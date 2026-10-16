import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import {
  claimIdeaForDrafting,
  DRAFTING_CLAIM_TTL_MS,
  markIdeaDrafted,
  releaseDraftingClaim
} from '../src/lib/ai/pipeline/drafting-claim'

// Runs against the local development database; every row it makes is removed.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]
const handle = `qa-draft-${Date.now().toString(36)}`

describe('an idea is drafted into one post', { skip: !url }, () => {
  const client = postgres(url!, { max: 4, prepare: false })
  const database = drizzle(client, { schema })
  let accountId = ''

  const newIdea = async (status = 'approved') => {
    const [idea] = await database
      .insert(schema.ideasTable)
      .values({ accountId, hook: 'QA hook', status })
      .returning()
    return idea!.id
  }
  const statusOf = async (ideaId: string) => {
    const [row] = await database
      .select({ status: schema.ideasTable.status })
      .from(schema.ideasTable)
      .where(eq(schema.ideasTable.id, ideaId))
    return row?.status
  }
  /** What drafting-run saves: the idea marked drafted, then its post. */
  const savePost = (ideaId: string) =>
    database.transaction(async tx => {
      await markIdeaDrafted(tx, ideaId)
      await tx.insert(schema.postDraftsTable).values({
        accountId,
        ideaId,
        hook: 'QA hook',
        body: 'QA body',
        originalHook: 'QA hook',
        originalBody: 'QA body'
      })
    })
  const postsFor = async (ideaId: string) =>
    database
      .select({ id: schema.postDraftsTable.id })
      .from(schema.postDraftsTable)
      .where(eq(schema.postDraftsTable.ideaId, ideaId))

  before(async () => {
    await client`delete from accounts where handle like 'qa-draft-%'`
    const [account] = await database
      .insert(schema.accountsTable)
      .values({
        name: 'QA Draft',
        accountType: 'personal',
        handle,
        headline: 'QA',
        bio: 'QA',
        industry: 'Finance'
      })
      .returning()
    accountId = account!.id
  })
  after(async () => {
    await client`delete from accounts where handle like 'qa-draft-%'`
    await client.end()
  })

  it('lets only one of two concurrent requests claim an idea', async () => {
    const ideaId = await newIdea()
    const claims = await Promise.all([
      claimIdeaForDrafting(database, ideaId),
      claimIdeaForDrafting(database, ideaId)
    ])
    assert.deepStrictEqual(claims.sort(), [false, true])
    assert.strictEqual(await statusOf(ideaId), 'drafting')
  })

  it('does not claim an idea that is drafted, rejected or not yet approved', async () => {
    for (const status of ['drafted', 'rejected', 'proposed']) {
      const ideaId = await newIdea(status)
      assert.strictEqual(await claimIdeaForDrafting(database, ideaId), false)
      assert.strictEqual(await statusOf(ideaId), status)
    }
  })

  it('hands a failed draft back so it can be drafted again', async () => {
    const ideaId = await newIdea()
    assert.strictEqual(await claimIdeaForDrafting(database, ideaId), true)
    await releaseDraftingClaim(database, ideaId)
    assert.strictEqual(await statusOf(ideaId), 'approved')
    assert.strictEqual(await claimIdeaForDrafting(database, ideaId), true)
  })

  it('takes over a claim left by a request that died', async () => {
    const ideaId = await newIdea()
    const longAgo = new Date(Date.now() - DRAFTING_CLAIM_TTL_MS - 60_000)
    assert.strictEqual(await claimIdeaForDrafting(database, ideaId, longAgo), true)
    assert.strictEqual(await claimIdeaForDrafting(database, ideaId), true)
  })

  it('saves one post when two saves for the same idea race', async () => {
    const ideaId = await newIdea()
    await claimIdeaForDrafting(database, ideaId)
    const results = await Promise.allSettled([savePost(ideaId), savePost(ideaId)])
    assert.deepStrictEqual(
      results.map(r => r.status).sort(),
      ['fulfilled', 'rejected']
    )
    assert.strictEqual((await postsFor(ideaId)).length, 1)
    assert.strictEqual(await statusOf(ideaId), 'drafted')
    // A failure after the save leaves the idea drafted.
    await releaseDraftingClaim(database, ideaId)
    assert.strictEqual(await statusOf(ideaId), 'drafted')
  })

  it('saves no post for an idea that was not claimed', async () => {
    const ideaId = await newIdea()
    await assert.rejects(savePost(ideaId))
    assert.strictEqual((await postsFor(ideaId)).length, 0)
    assert.strictEqual(await statusOf(ideaId), 'approved')
  })
})
