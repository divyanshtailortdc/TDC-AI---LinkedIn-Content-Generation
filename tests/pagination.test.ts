import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { and, desc, eq, lt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import { olderThan } from '../src/lib/db-pagination'
import { PAGE_SIZE, pageOf } from '../src/lib/pagination'

describe('pageOf', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id${i}` }))

  it('a short list is one page with no cursor', () => {
    assert.deepEqual(pageOf(rows(3), 5), { items: rows(3), nextCursor: null })
    assert.deepEqual(pageOf(rows(5), 5), { items: rows(5), nextCursor: null })
  })

  it('one row over the size means more: the page is cut and the cursor is its last id', () => {
    const page = pageOf(rows(6), 5)
    assert.equal(page.items.length, 5)
    assert.equal(page.nextCursor, 'id4')
  })

  it('an empty list is fine', () => {
    assert.deepEqual(pageOf([], 5), { items: [], nextCursor: null })
  })

  it('pages are a sensible size', () => {
    assert.ok(PAGE_SIZE >= 20 && PAGE_SIZE <= 500)
  })
})

// Runs against the local development database; every row it makes is removed.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]

describe('paging through ideas', { skip: !url }, () => {
  const client = postgres(url!, { max: 2, prepare: false })
  const database = drizzle(client, { schema })
  const handle = `qa-page-${Date.now().toString(36)}`
  let accountId = ''
  const expected: string[] = []

  const page = async (cursorId: string | null, size: number) => {
    const rows = await database
      .select({ id: schema.ideasTable.id })
      .from(schema.ideasTable)
      .where(
        and(
          eq(schema.ideasTable.accountId, accountId),
          cursorId
            ? olderThan(schema.ideasTable, schema.ideasTable.createdAt, schema.ideasTable.id, cursorId)
            : undefined
        )
      )
      .orderBy(desc(schema.ideasTable.createdAt), desc(schema.ideasTable.id))
      .limit(size + 1)
    return pageOf(rows, size)
  }

  before(async () => {
    const [account] = await database
      .insert(schema.accountsTable)
      .values({ name: 'QA Page', accountType: 'personal', handle, headline: 'QA', bio: 'QA', industry: 'Finance' })
      .returning()
    accountId = account!.id
    // Timestamps that differ only below a millisecond, and some that are equal:
    // the cases a cursor built from a JavaScript Date would get wrong.
    const stamps = [
      '2026-03-01 10:00:00.123900',
      '2026-03-01 10:00:00.123500',
      '2026-03-01 10:00:00.123100',
      '2026-03-01 10:00:00.123100',
      '2026-03-01 10:00:00.123100',
      '2026-03-01 09:00:00.000000',
      '2026-02-01 09:00:00.000000',
      '2026-01-01 09:00:00.000000',
      '2026-01-01 09:00:00.000000'
    ]
    for (const [i, stamp] of stamps.entries()) {
      await client`insert into ideas (account_id, title, thesis, hook, angle, status, created_at)
                   values (${accountId}, ${'idea ' + i}, 't', 'h', 'a', 'proposed', ${stamp})`
    }
    const all = await database
      .select({ id: schema.ideasTable.id })
      .from(schema.ideasTable)
      .where(eq(schema.ideasTable.accountId, accountId))
      .orderBy(desc(schema.ideasTable.createdAt), desc(schema.ideasTable.id))
    expected.push(...all.map(r => r.id))
  })
  after(async () => {
    await client`delete from accounts where handle = ${handle}`
    await client.end()
  })

  for (const size of [2, 3, 4, 100]) {
    it(`every idea appears exactly once across pages of ${size}`, async () => {
      const seen: string[] = []
      let cursor: string | null = null
      for (let guard = 0; guard < 20; guard++) {
        const { items, nextCursor } = await page(cursor, size)
        seen.push(...items.map(i => i.id))
        if (!nextCursor) break
        cursor = nextCursor
      }
      assert.deepEqual(seen, expected)
    })
  }

  it('a cursor rounded to milliseconds (the obvious way) skips ideas', async () => {
    const firstPage = await page(null, 2)
    const last = await client`select created_at from ideas where id = ${firstPage.nextCursor!}`
    const rounded = new Date(last[0]!.created_at) // JavaScript keeps milliseconds only
    const rest = await database
      .select({ id: schema.ideasTable.id })
      .from(schema.ideasTable)
      .where(and(eq(schema.ideasTable.accountId, accountId), lt(schema.ideasTable.createdAt, rounded)))
      .orderBy(desc(schema.ideasTable.createdAt), desc(schema.ideasTable.id))
    const seen = [...firstPage.items.map(i => i.id), ...rest.map(r => r.id)]
    assert.ok(seen.length < expected.length, 'rows created in the same millisecond were dropped')
  })

  it('the account listing can use the new index', async () => {
    // With so few rows the planner prefers a scan; forcing it off shows the
    // index matches the query's filter and order.
    const plan = await client.begin(async tx => {
      await tx`set local enable_seqscan = off`
      return tx`explain select id from ideas where account_id = ${accountId} order by created_at desc, id desc limit 101`
    })
    assert.match(JSON.stringify(plan), /ideas_account_created_idx/)
  })
})
