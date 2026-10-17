import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { and, desc, eq, lt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import { olderThan } from '../src/lib/db-pagination'
import {
  LOAD_BATCH_SIZE,
  loadPage,
  pageNumbers,
  pageOf,
  paginate,
  parsePage
} from '../src/lib/pagination'
import {
  parseStatusFilter,
  statusFilterCounts
} from '../src/app/(app)/ideas/status-filter'

/** A list of `total` numbered rows, recording each offset it was asked for. */
function fakeList(total: number) {
  const offsets: number[] = []
  const items = Array.from({ length: total }, (_, i) => i + 1)
  return {
    offsets,
    count: async () => total,
    rows: async (offset: number, limit: number) => {
      offsets.push(offset)
      return items.slice(offset, offset + limit)
    }
  }
}

describe('parsePage', () => {
  it('reads a whole page number', () => {
    assert.equal(parsePage('3'), 3)
    assert.equal(parsePage(['2', '5']), 2)
  })

  it('falls back to the first page for anything else', () => {
    for (const value of [undefined, '', '0', '-1', '1.5', 'abc', '2abc', '1e3', '99999999999999999999']) {
      assert.equal(parsePage(value), 1, String(value))
    }
  })
})

describe('loadPage', () => {
  it('returns the page asked for and where it sits in the list', async () => {
    const list = fakeList(45)
    const { rows, pageInfo } = await loadPage({ page: 2, pageSize: 20, ...list })
    assert.deepEqual(rows, Array.from({ length: 20 }, (_, i) => i + 21))
    assert.deepEqual(pageInfo, { page: 2, pageCount: 3, total: 45, pageSize: 20 })
    assert.deepEqual(list.offsets, [20])
  })

  it('shows the last page for a page past the end', async () => {
    const list = fakeList(45)
    const { rows, pageInfo } = await loadPage({ page: 9, pageSize: 20, ...list })
    assert.deepEqual(rows, [41, 42, 43, 44, 45])
    assert.equal(pageInfo.page, 3)
    assert.deepEqual(list.offsets, [160, 40])
  })

  it('treats an empty list as one empty page', async () => {
    const list = fakeList(0)
    const { rows, pageInfo } = await loadPage({ page: 4, pageSize: 20, ...list })
    assert.deepEqual(rows, [])
    assert.deepEqual(pageInfo, { page: 1, pageCount: 1, total: 0, pageSize: 20 })
  })

  it('fills the last page exactly when the total divides evenly', async () => {
    const { pageInfo } = await loadPage({ page: 2, pageSize: 20, ...fakeList(40) })
    assert.equal(pageInfo.pageCount, 2)
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1)

  it('slices the page asked for', () => {
    const { rows, pageInfo } = paginate(items, 2, 10)
    assert.deepEqual(rows, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
    assert.deepEqual(pageInfo, { page: 2, pageCount: 3, total: 23, pageSize: 10 })
  })

  it('shows the last page for one past the end, as after a search or deletion', () => {
    const { rows, pageInfo } = paginate(items, 7, 10)
    assert.deepEqual(rows, [21, 22, 23])
    assert.equal(pageInfo.page, 3)
    assert.equal(paginate(items.slice(0, 10), 2, 10).pageInfo.page, 1)
  })

  it('treats an empty list, or a page below 1, as page 1', () => {
    assert.deepEqual(paginate([], 3, 10), {
      rows: [],
      pageInfo: { page: 1, pageCount: 1, total: 0, pageSize: 10 }
    })
    assert.deepEqual(paginate(items, 0, 10).rows, items.slice(0, 10))
  })
})

describe('pageNumbers', () => {
  it('lists every page when there are seven or fewer', () => {
    assert.deepEqual(pageNumbers(1, 1), [1])
    assert.deepEqual(pageNumbers(2, 2), [1, 2])
    assert.deepEqual(pageNumbers(4, 7), [1, 2, 3, 4, 5, 6, 7])
  })

  it('keeps the first, last and neighbouring pages, with gaps between', () => {
    assert.deepEqual(pageNumbers(1, 20), [1, 2, 3, 4, 5, null, 20])
    assert.deepEqual(pageNumbers(4, 20), [1, 2, 3, 4, 5, null, 20])
    assert.deepEqual(pageNumbers(5, 20), [1, null, 4, 5, 6, null, 20])
    assert.deepEqual(pageNumbers(16, 20), [1, null, 15, 16, 17, null, 20])
    assert.deepEqual(pageNumbers(17, 20), [1, null, 16, 17, 18, 19, 20])
    assert.deepEqual(pageNumbers(20, 20), [1, null, 16, 17, 18, 19, 20])
  })

  it('always shows seven slots past seven pages, including the current page', () => {
    for (const pageCount of [8, 9, 12, 50]) {
      for (let page = 1; page <= pageCount; page++) {
        const slots = pageNumbers(page, pageCount)
        assert.equal(slots.length, 7, `${page}/${pageCount}`)
        assert.ok(slots.includes(page), `${page}/${pageCount}`)
        assert.equal(slots[0], 1)
        assert.equal(slots[6], pageCount)
        // A gap always stands for at least one hidden page.
        slots.forEach((n, i) => {
          if (n === null) assert.ok((slots[i + 1] as number) - (slots[i - 1] as number) > 1)
        })
      }
    }
  })
})

describe('ideas status filter', () => {
  it('reads a known status and falls back to all', () => {
    assert.equal(parseStatusFilter('approved'), 'approved')
    assert.equal(parseStatusFilter(['rejected']), 'rejected')
    assert.equal(parseStatusFilter('drafted'), 'all')
    assert.equal(parseStatusFilter(undefined), 'all')
  })

  it('counts drafting and drafted ideas only under all', () => {
    assert.deepEqual(
      statusFilterCounts([
        { status: 'proposed', n: 4 },
        { status: 'approved', n: 2 },
        { status: 'drafting', n: 1 },
        { status: 'drafted', n: 7 }
      ]),
      { proposed: 4, approved: 2, rejected: 0, all: 14 }
    )
  })
})

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

  it('batches are a sensible size', () => {
    assert.ok(LOAD_BATCH_SIZE >= 20 && LOAD_BATCH_SIZE <= 500)
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
