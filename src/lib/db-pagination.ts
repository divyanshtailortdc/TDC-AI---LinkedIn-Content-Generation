import { sql, type AnyColumn, type SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'

/**
 * Rows older than the row with `cursorId`, for a list ordered newest first
 * (`created_at desc, id desc`). The row's own timestamp is read in the database
 * rather than passed from the browser, so it keeps full precision: a timestamp
 * rounded to milliseconds would skip rows created within the same millisecond.
 */
export function olderThan(
  table: PgTable,
  createdAt: AnyColumn,
  id: AnyColumn,
  cursorId: string
): SQL {
  return sql`(${createdAt}, ${id}) < (select ${createdAt}, ${id} from ${table} where ${id} = ${cursorId})`
}
