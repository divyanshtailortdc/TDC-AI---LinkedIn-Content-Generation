import 'server-only'

import { db } from '@/db'
import { AsyncLocalStorage } from 'node:async_hooks'
import { env } from '~/env'
import {
  accountOwnerIn,
  recordUsageIn,
  spentInWindowIn,
  type SpendCharge
} from './spend-ledger'
import { SPEND_LIMIT_WINDOW_DAYS, type AiSpendSource } from './spend-sources'
import type { CallUsage } from './usage'

/**
 * Every paid model call is recorded in the usage ledger (ai_usage) and
 * checked first against its user's spending limit (AI_SPEND_LIMIT_USD over
 * any 30 days), by the few functions every call goes through: runSkill, the
 * research agent, embedValues and the image renderer.
 *
 * They do not know who the work is for. The code that starts the work does,
 * and says so once with withAiSpend: the run worker, the drafting queue, the
 * newsletter reader, and each action or route that calls AI. Every call
 * awaited inside it, however deep, is charged to that scope.
 *
 * A call made outside any scope is still recorded, as 'unscoped' and charged
 * to no one, so no limit covers it; a warning names its stage so the caller
 * can be found and given a scope.
 *
 * The limit is checked before each call and the call recorded after it, so
 * calls already under way when it is reached still finish: it can be passed
 * by about the cost of the calls running at that moment.
 */

const charges = new AsyncLocalStorage<SpendCharge>()

const UNSCOPED: SpendCharge = {
  source: 'unscoped',
  userId: null,
  accountId: null,
  runId: null
}

/**
 * Runs `work` with every model call in it charged to this scope. Give the
 * identity when the work is for one (its owner is looked up), and the
 * signed-in user when it is not (AI setup before the identity exists).
 * Shared work with neither, such as embedding every workspace's stories, is
 * recorded under its source and limited for no one. An inner scope replaces
 * an outer one for the calls inside it.
 */
export async function withAiSpend<T>(
  scope: {
    source: AiSpendSource
    accountId?: string | null
    /** Looked up from accountId when not given. */
    userId?: string | null
    runId?: string | null
  },
  work: () => Promise<T>
): Promise<T> {
  const accountId = scope.accountId ?? null
  const userId =
    scope.userId !== undefined
      ? scope.userId
      : accountId
        ? await accountOwnerIn(db, accountId)
        : null
  return charges.run(
    { source: scope.source, userId, accountId, runId: scope.runId ?? null },
    work
  )
}

const usd = (value: number) => `$${value.toFixed(2)}`

/** A model call refused because its user has spent their limit. */
export class AiSpendLimitError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly limitUsd: number
  ) {
    super(
      `AI spending limit reached: ${usd(spentUsd)} of ${usd(limitUsd)} used over the last ${SPEND_LIMIT_WINDOW_DAYS} days, across all your identities. New AI work can start again as older spending leaves that window, or an admin can raise AI_SPEND_LIMIT_USD.`
    )
    this.name = 'AiSpendLimitError'
  }
}

/**
 * Throws AiSpendLimitError when the current scope's user has spent their
 * limit. Outside a scope, or for shared work, there is no one to limit. A
 * check the database cannot answer lets the call through: the limit guards
 * cost, and failing every AI feature on it would be worse.
 */
export async function assertWithinAiSpendLimit(): Promise<void> {
  const charge = charges.getStore()
  if (!charge) return
  let spent: number | null
  try {
    spent = await spentInWindowIn(db, charge)
  } catch (err) {
    console.error('Could not check the AI spending limit:', err)
    return
  }
  if (spent !== null && spent >= env.AI_SPEND_LIMIT_USD) {
    throw new AiSpendLimitError(spent, env.AI_SPEND_LIMIT_USD)
  }
}

const warnedUnscoped = new Set<string>()

/**
 * Records a billed call against the current scope. Never throws: losing a
 * line of accounting must not fail the work it paid for.
 */
export async function recordAiSpend(call: {
  stage: string
  modelId: string
  usage: CallUsage
}): Promise<void> {
  if (call.usage.calls === 0) return
  let charge = charges.getStore()
  if (!charge) {
    if (!warnedUnscoped.has(call.stage)) {
      warnedUnscoped.add(call.stage)
      console.warn(
        `A ${call.stage} model call ran outside withAiSpend: it is recorded as unscoped and no spending limit covers it.`
      )
    }
    charge = UNSCOPED
  }
  try {
    await recordUsageIn(db, charge, call)
  } catch (err) {
    console.error(
      `Could not record the spend of a ${call.stage} model call:`,
      err
    )
  }
}
