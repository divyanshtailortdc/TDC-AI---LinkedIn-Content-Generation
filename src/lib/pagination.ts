/**
 * Paging for the app's lists. Lists that grow with every run (runs, ideas)
 * are paged on the server, with the page in a ?page= search param so it
 * survives a reload and Back steps through pages (see loadPage). Lists that
 * are searched or filtered in the browser (identities, knowledge, the posts
 * queue) are paged there (see paginate). The Posts page also loads its posts
 * in batches, older ones on request (see pageOf).
 */

/** How many rows a page of any list holds. */
export const PAGE_SIZE = 10

export type PageInfo = {
  page: number
  pageCount: number
  total: number
  pageSize: number
}

/** The page asked for by a ?page= param: a whole number from 1, else 1. */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || !/^\d+$/.test(raw)) return 1
  const page = Number(raw)
  return Number.isSafeInteger(page) && page >= 1 ? page : 1
}

/** Most page numbers a numbered pager shows, gaps included, so it fits a phone. */
const MAX_PAGE_SLOTS = 7

/**
 * The page numbers a numbered pager shows, with null for a gap ("…"). The
 * first and last pages and the ones beside the current page always show.
 * Past seven pages there are always seven slots, so the numbers don't shift
 * under the pointer as the current page moves.
 */
export function pageNumbers(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= MAX_PAGE_SLOTS) {
    return Array.from({ length: pageCount }, (_, i) => i + 1)
  }
  if (page <= 4) return [1, 2, 3, 4, 5, null, pageCount]
  if (page >= pageCount - 3) {
    return [1, null, ...Array.from({ length: 5 }, (_, i) => pageCount - 4 + i)]
  }
  return [1, null, page - 1, page, page + 1, null, pageCount]
}

/**
 * One page of a list already in the browser. A page past the end (the list
 * shrank, say after a search or a deletion) shows the last page.
 */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number
): { rows: T[]; pageInfo: PageInfo } {
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const shown = Math.min(Math.max(1, page), pageCount)
  return {
    rows: items.slice((shown - 1) * pageSize, shown * pageSize),
    pageInfo: { page: shown, pageCount, total, pageSize }
  }
}

/**
 * One page of rows and the total they come from. A page past the end (the
 * list shrank since the link was made, or the number was typed) shows the
 * last page rather than an empty one.
 *
 * `rows` runs alongside `count`, and runs again only when the page asked for
 * turns out to be past the end. Its query needs an order with a unique
 * tiebreaker (such as the id), or rows that tie can repeat or go missing
 * between pages.
 */
export async function loadPage<T>({
  page: requested,
  pageSize,
  count,
  rows
}: {
  page: number
  pageSize: number
  count: () => Promise<number>
  rows: (offset: number, limit: number) => Promise<T[]>
}): Promise<{ rows: T[]; pageInfo: PageInfo }> {
  const [total, asked] = await Promise.all([
    count(),
    rows((requested - 1) * pageSize, pageSize)
  ])
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requested, pageCount)
  return {
    rows: page === requested ? asked : await rows((page - 1) * pageSize, pageSize),
    pageInfo: { page, pageCount, total, pageSize }
  }
}

/**
 * How many posts the Posts page loads at once. The rest come in as the person
 * asks for them ("Load older posts"), so a long history does not slow every
 * visit. Its queue then shows these PAGE_SIZE at a time.
 */
export const LOAD_BATCH_SIZE = 100

/**
 * Splits rows fetched with `limit(LOAD_BATCH_SIZE + 1)` into the batch and a
 * cursor. The extra row only says there is more; the cursor is the id of the
 * batch's last row, the point the next batch continues from (see olderThan).
 */
export function pageOf<T extends { id: string }>(
  rows: T[],
  size = LOAD_BATCH_SIZE
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= size) return { items: rows, nextCursor: null }
  const items = rows.slice(0, size)
  return { items, nextCursor: items[items.length - 1]!.id }
}
