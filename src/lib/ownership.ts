import { accountsTable, ideasTable, runsTable } from '@/db/schema'
import { and, eq, getTableColumns } from 'drizzle-orm'
import type { IdentityDb } from './identity-write'
import { isUuid } from './ids'

/**
 * Which rows a signed-in user may touch. Every identity (accounts row) has an
 * owner, user_id; everything else belongs to an identity, so it is the
 * user's when its identity is. Identities with no owner (made before sign-in
 * existed) belong to nobody and are never returned.
 *
 * Each lookup returns undefined both for a row that does not exist and for
 * one that belongs to someone else, so callers answer both the same way and
 * reveal nothing about other users' data. Malformed ids are undefined too,
 * rather than a Postgres error.
 *
 * Takes the database as an argument so tests can run it against any
 * connection; account-guard.ts wraps it for actions.
 */

/** Rows of identities owned by `userId`. */
export const ownedByUser = (userId: string) => eq(accountsTable.userId, userId)

export async function findOwnedAccount(
  database: IdentityDb,
  userId: string,
  accountId: unknown
) {
  if (!isUuid(accountId)) return undefined
  const [account] = await database
    .select()
    .from(accountsTable)
    .where(and(eq(accountsTable.id, accountId), ownedByUser(userId)))
    .limit(1)
  return account
}

/** A run of the user's identity. */
export async function findOwnedRun(
  database: IdentityDb,
  userId: string,
  runId: unknown
) {
  if (!isUuid(runId)) return undefined
  const [run] = await database
    .select({
      id: runsTable.id,
      accountId: runsTable.accountId
    })
    .from(runsTable)
    .innerJoin(accountsTable, eq(accountsTable.id, runsTable.accountId))
    .where(and(eq(runsTable.id, runId), ownedByUser(userId)))
    .limit(1)
  return run
}

/** An idea of the user's identity. */
export async function findOwnedIdea(
  database: IdentityDb,
  userId: string,
  ideaId: unknown
) {
  if (!isUuid(ideaId)) return undefined
  const [row] = await database
    .select({ idea: getTableColumns(ideasTable) })
    .from(ideasTable)
    .innerJoin(accountsTable, eq(accountsTable.id, ideasTable.accountId))
    .where(and(eq(ideasTable.id, ideaId), ownedByUser(userId)))
    .limit(1)
  return row?.idea
}
