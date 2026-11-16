import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import {
  claimProfileAnalysis,
  dropProfileAnalyses,
  finishProfileAnalysis
} from '../src/lib/profile-insights/claim'
import {
  ANALYSIS_STALE_MS,
  type ProfileInsights
} from '../src/lib/profile-insights/types'

// Runs against the local development database; every row it makes is removed.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]
const handle = `qa-insights-${Date.now().toString(36)}`

const insights: ProfileInsights = {
  summary: 'Food jokes.',
  themes: [{ name: 'Food moods', description: '' }],
  writingStyle: 'Lowercase one-liners.',
  tone: 'Cheeky.',
  captions: '',
  hashtags: ['#zomato'],
  hashtagUsage: '',
  visualIdentity: '',
  formats: []
}

describe('one analysis of a profile link at a time', { skip: !url }, () => {
  const client = postgres(url!, { max: 4, prepare: false })
  const database = drizzle(client, { schema })
  let accountId = ''
  const t = schema.platformInsightsTable
  const rowOf = async () => {
    const [row] = await database
      .select()
      .from(t)
      .where(and(eq(t.accountId, accountId), eq(t.platform, 'instagram')))
    return row
  }

  before(async () => {
    await client`delete from accounts where handle like 'qa-insights-%'`
    const [account] = await database
      .insert(schema.accountsTable)
      .values({
        name: 'QA Insights',
        accountType: 'company',
        handle,
        headline: 'QA',
        bio: 'QA',
        industry: 'Food'
      })
      .returning()
    accountId = account!.id
  })

  after(async () => {
    await client`delete from accounts where handle like 'qa-insights-%'`
    await client.end()
  })

  it('claims a new link once, and records how it ended', async () => {
    const claim = await claimProfileAnalysis(
      database,
      accountId,
      'instagram',
      'https://instagram.com/zomato'
    )
    assert.ok(claim)
    // Stored under the profile's own address.
    assert.strictEqual(claim.profileUrl, 'https://www.instagram.com/zomato/')
    // The same link again (another spelling, a second click) while it runs: nothing new.
    assert.strictEqual(
      await claimProfileAnalysis(
        database,
        accountId,
        'instagram',
        'https://www.instagram.com/zomato/'
      ),
      null
    )
    assert.strictEqual((await rowOf())?.status, 'analyzing')

    assert.ok(
      await finishProfileAnalysis(database, claim, {
        status: 'ready',
        error: null,
        insights,
        posts: [
          {
            url: 'https://www.instagram.com/p/A/',
            text: 'hi',
            kind: 'post',
            source: 'search',
            partial: true
          }
        ],
        sources: { search: 1 },
        analyzedAt: new Date(),
        editedAt: null
      })
    )
    const row = await rowOf()
    assert.strictEqual(row?.status, 'ready')
    assert.deepStrictEqual(row?.insights, insights)
    assert.strictEqual(row?.posts.length, 1)
  })

  it('keeps what it learned through a refresh that finds too little', async () => {
    const refresh = await claimProfileAnalysis(
      database,
      accountId,
      'instagram',
      'https://www.instagram.com/zomato/'
    )
    assert.ok(refresh)
    let row = await rowOf()
    assert.strictEqual(row?.status, 'analyzing')
    assert.deepStrictEqual(row?.insights, insights)

    await finishProfileAnalysis(database, refresh, {
      status: 'unavailable',
      error: 'Too few posts.'
    })
    row = await rowOf()
    assert.strictEqual(row?.status, 'unavailable')
    assert.strictEqual(row?.error, 'Too few posts.')
    assert.deepStrictEqual(row?.insights, insights)
    assert.strictEqual(row?.posts.length, 1)
  })

  it('starts over for another profile, and an older run cannot overwrite it', async () => {
    const first = await claimProfileAnalysis(
      database,
      accountId,
      'instagram',
      'https://www.instagram.com/zomato/'
    )
    assert.ok(first)
    // The link is changed while that runs: another account, nothing kept.
    const second = await claimProfileAnalysis(
      database,
      accountId,
      'instagram',
      'https://www.instagram.com/swiggyindia'
    )
    assert.ok(second)
    let row = await rowOf()
    assert.strictEqual(
      row?.profileUrl,
      'https://www.instagram.com/swiggyindia/'
    )
    assert.strictEqual(row?.insights, null)
    assert.deepStrictEqual(row?.posts, [])
    assert.strictEqual(row?.analyzedAt, null)

    // The first run ends late: it is no longer the row's.
    assert.strictEqual(
      await finishProfileAnalysis(database, first, {
        status: 'ready',
        error: null,
        insights
      }),
      false
    )
    row = await rowOf()
    assert.strictEqual(row?.status, 'analyzing')
    assert.strictEqual(row?.insights, null)
  })

  it('takes over an analysis that was cut off', async () => {
    // As if the server stopped mid-run long ago.
    await database
      .update(t)
      .set({ startedAt: new Date(Date.now() - ANALYSIS_STALE_MS - 60_000) })
      .where(and(eq(t.accountId, accountId), eq(t.platform, 'instagram')))
    const claim = await claimProfileAnalysis(
      database,
      accountId,
      'instagram',
      'https://www.instagram.com/swiggyindia/'
    )
    assert.ok(claim)
    assert.ok(Date.now() - claim.startedAt.getTime() < 60_000)
  })

  it('drops the analysis of a removed link', async () => {
    await dropProfileAnalyses(database, accountId, ['instagram'])
    assert.strictEqual(await rowOf(), undefined)
  })
})
