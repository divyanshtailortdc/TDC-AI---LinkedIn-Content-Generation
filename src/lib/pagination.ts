/**
 * How many ideas or posts a list page loads at once. The rest come in as the
 * person asks for them, so a long history does not slow every visit.
 */
export const PAGE_SIZE = 100

/**
 * Splits rows fetched with `limit(PAGE_SIZE + 1)` into the page and a cursor.
 * The extra row only says there is more; the cursor is the id of the page's
 * last row, the point the next page continues from.
 */
export function pageOf<T extends { id: string }>(
  rows: T[],
  size = PAGE_SIZE
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= size) return { items: rows, nextCursor: null }
  const items = rows.slice(0, size)
  return { items, nextCursor: items[items.length - 1]!.id }
}
