import 'server-only'

import { db } from '@/db'
import { findOwnedAccount, findOwnedIdea, findOwnedRun } from './ownership'

/**
 * Guards for Server Actions that act on an identity, run or idea named by the
 * client. Each takes the signed-in user's id (from requireUser(), never from
 * the request) and checks the row belongs to them before anything reads or
 * changes it.
 *
 * A row that does not exist and one that belongs to someone else both throw
 * the same NotFoundError, so ids cannot be probed.
 */

export class NotFoundError extends Error {
  constructor(resource: 'Identity' | 'Run' | 'Idea') {
    super(`${resource} not found`)
    this.name = 'NotFoundError'
  }
}

/** The user's identity with this id. */
export async function requireOwnedAccount(userId: string, accountId: unknown) {
  const account = await findOwnedAccount(db, userId, accountId)
  if (!account) throw new NotFoundError('Identity')
  return account
}

/** A run of the user's identity. */
export async function requireOwnedRun(userId: string, runId: unknown) {
  const run = await findOwnedRun(db, userId, runId)
  if (!run) throw new NotFoundError('Run')
  return run
}

/** An idea of the user's identity. */
export async function requireOwnedIdea(userId: string, ideaId: unknown) {
  const idea = await findOwnedIdea(db, userId, ideaId)
  if (!idea) throw new NotFoundError('Idea')
  return idea
}
