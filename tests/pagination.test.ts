import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  loadPage,
  pageNumbers,
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
