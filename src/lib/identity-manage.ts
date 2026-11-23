import {
  accountsTable,
  goalsTable,
  ideasTable,
  knowledgeDocumentsTable,
  platformConnectionsTable,
  postDraftsTable,
  publicationsTable,
  runsTable
} from '@/db/schema'
import { cancelPendingPublications } from '@/lib/publishing/publication-queries'
import { and, asc, eq, getTableName, isNull, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import { switchBlocker } from './identity-switch'
import type { IdentityDb } from './identity-write'
import { ownedByUser } from './ownership'

/**
 * The Identities page: every identity a user owns, with what each holds, and
 * deleting one for good.
 *
 * Deleting removes the accounts row, and everything that belongs to the
 * identity goes with it (their foreign keys cascade): profile, voice,
 * knowledge, goals, ideas, runs, posts and their publications, the schedule,
 * the brand theme, connected accounts and newsletters. Two things stay: its
 * inbound addresses, emptied, so the address is never given to anyone else,
 * and its AI spend (ai_usage), so deleting does not hand the spend back.
 * Posts already published stay on their platforms. The posts' files in
 * storage are the caller's to remove, by the ids this returns.
 *
 * Takes the database as an argument so it can run against any connection.
 */

/** `"table"."column"`: in a selected field drizzle leaves the table out. */
function qualified(table: PgTable, column: AnyPgColumn): SQL {
  return sql`${sql.identifier(getTableName(table))}.${sql.identifier(column.name)}`
}

/**
 * Rows of `table` that belong to the identity of the accounts row selected.
 * Unqualified columns in `where` are `table`'s, the innermost in scope.
 */
function countOf(
  table: PgTable & { accountId: AnyPgColumn },
  where?: SQL
): SQL<number> {
  return sql<number>`(select count(*)::int from ${table} where ${qualified(
    table,
    table.accountId
  )} = ${qualified(accountsTable, accountsTable.id)}${
    where ? sql` and ${where}` : sql``
  })`
}

/** One identity as the Identities page lists it. */
export type IdentityOverview = {
  id: string
  name: string
  handle: string
  accountType: string
  headline: string
  createdAt: Date
  posts: number
  /** Publications waiting for their time; deleting the identity calls them off. */
  scheduled: number
  /** Posts out on a platform; they stay there when the identity is deleted. */
  published: number
  ideas: number
  goals: number
  knowledge: number
  runs: number
  connections: number
}

/** The user's identities, oldest first (as the switcher lists them). */
export async function listIdentityOverviews(
  database: IdentityDb,
  userId: string
): Promise<IdentityOverview[]> {
  return database
    .select({
      id: accountsTable.id,
      name: accountsTable.name,
      handle: accountsTable.handle,
      accountType: accountsTable.accountType,
      headline: accountsTable.headline,
      createdAt: accountsTable.createdAt,
      posts: countOf(postDraftsTable),
      scheduled: countOf(
        publicationsTable,
        eq(publicationsTable.status, 'scheduled')
      ),
      published: countOf(
        publicationsTable,
        and(
          eq(publicationsTable.status, 'published'),
          isNull(publicationsTable.deletedAt)
        )
      ),
      ideas: countOf(ideasTable),
      goals: countOf(goalsTable),
      knowledge: countOf(knowledgeDocumentsTable),
      runs: countOf(runsTable),
      connections: countOf(platformConnectionsTable)
    })
    .from(accountsTable)
    .where(ownedByUser(userId))
    .orderBy(asc(accountsTable.createdAt), asc(accountsTable.id))
}

/** Why the identity cannot be deleted right now. */
export class IdentityDeleteBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityDeleteBlockedError'
  }
}

/**
 * Deletes one of the user's identities and everything in it, all or nothing.
 * Returns null when the user owns no such identity, else its name and the
 * ids of the posts that went with it (their files are still in storage).
 *
 * Refused (IdentityDeleteBlockedError) while a run or drafting works for it,
 * and while one of its posts is being sent. A scheduled post, or one a worker
 * claimed but has not sent, is called off first: the worker's mark before
 * sending then finds no row and stops. Pass `publishing: false` when
 * publishing is not set up on the server, as the rest of the app does.
 */
export async function deleteIdentityData(
  database: IdentityDb,
  userId: string,
  accountId: string,
  options: { publishing: boolean }
): Promise<{ name: string; draftIds: string[] } | null> {
  return database.transaction(async tx => {
    // Locks the row, so a switch or a profile save waits for the delete.
    const [account] = await tx
      .select({ id: accountsTable.id, name: accountsTable.name })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, accountId), ownedByUser(userId)))
      .for('update')
    if (!account) return null

    const blocked = await switchBlocker(tx, accountId, 'delete')
    if (blocked) throw new IdentityDeleteBlockedError(blocked)

    if (options.publishing) {
      await cancelPendingPublications(
        tx,
        { accountId },
        {
          message: 'Cancelled because the identity was deleted.',
          code: 'not_approved'
        },
        { includeUnsentInFlight: true }
      )
      // What is left in flight was already sent to the platform.
      const [sending] = await tx
        .select({ id: publicationsTable.id })
        .from(publicationsTable)
        .where(
          and(
            eq(publicationsTable.accountId, accountId),
            eq(publicationsTable.status, 'publishing')
          )
        )
        .limit(1)
      if (sending) {
        throw new IdentityDeleteBlockedError(
          'A post of this identity is being published right now. Try again in a moment.'
        )
      }
    }

    const drafts = await tx
      .select({ id: postDraftsTable.id })
      .from(postDraftsTable)
      .where(eq(postDraftsTable.accountId, accountId))
    await tx.delete(accountsTable).where(eq(accountsTable.id, accountId))
    return { name: account.name, draftIds: drafts.map(d => d.id) }
  })
}
