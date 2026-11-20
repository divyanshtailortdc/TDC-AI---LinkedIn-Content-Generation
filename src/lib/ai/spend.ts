import 'server-only'

import { db } from '@/db'
import { AsyncLocalStorage } from 'node:async_hooks'
import { env } from '~/env'
import {
  accountOwnerIn,
  reachedSpendLimit,
  recordUsageIn,
  spendCountersIn,
  type ReachedSpendLimit,
  type SpendCharge,
  type SpendLimits
} from './spend-ledger'
import {
  DAILY_LIMIT_WINDOW_HOURS,
  INBOX_SHARE_OF_USER_LIMITS,
  SPEND_LIMIT_WINDOW_DAYS,
  type AiSpendSource
} from './spend-sources'
import type { CallUsage } from './usage'

/**
 * Every paid model call is recorded in the usage ledger (ai_usage) and
 * checked first against its spending limits, by the few functions every
 * call goes through: runSkill, the research agent, embedValues and the
 * image renderer. The limits (spendLimits below):
 *
 * - per user, across every identity they own: AI_SPEND_LIMIT_USD over any
 *   30 days, and AI_DAILY_SPEND_LIMIT_USD over any 24 hours, so a burst
 *   cannot use up the month in a day;
 * - per identity, for work started by received email (source 'inbox'),
 *   which anyone who knows the address can send: AI_INBOX_DAILY_LIMIT_USD
 *   over any 24 hours. Inbox work also stops at INBOX_SHARE_OF_USER_LIMITS
 *   of the user's limits, so a flood of email never locks its owner out.
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
    /** The post the work is for, so its calls show on that post. */
    draftId?: string | null
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
    {
      source: scope.source,
      userId,
      accountId,
      runId: scope.runId ?? null,
      draftId: scope.draftId ?? null
    },
    work
  )
}

/**
 * Runs `work` inside the current scope with its calls also tagged with the
 * post they are for: drafting writes several posts of one idea in one scope,
 * and each post's own calls should show on it. Outside a scope, `work` runs
 * as it is (its calls are recorded unscoped, as before).
 */
export function withDraftSpend<T>(draftId: string, work: () => Promise<T>): Promise<T> {
  const charge = charges.getStore()
  return charge ? charges.run({ ...charge, draftId }, work) : work()
}

const usd = (value: number) => `$${value.toFixed(2)}`

/** The limits as configured. */
export function spendLimits(): SpendLimits {
  return {
    windowUsd: env.AI_SPEND_LIMIT_USD,
    dayUsd: env.AI_DAILY_SPEND_LIMIT_USD,
    inboxDayUsd: env.AI_INBOX_DAILY_LIMIT_USD
  }
}

/** What the user is told when a limit refuses a call. */
function limitMessage(source: AiSpendSource, reached: ReachedSpendLimit) {
  const spent = `${usd(reached.spentUsd)} of ${usd(reached.limitUsd)}`
  const day = `the last ${DAILY_LIMIT_WINDOW_HOURS} hours`
  if (reached.kind === 'inbox_day') {
    return `This identity's inbox has used ${spent} of AI over ${day}, its daily limit. Received newsletters are still read, without AI summaries, until that spending leaves the ${DAILY_LIMIT_WINDOW_HOURS} hours; an admin can raise AI_INBOX_DAILY_LIMIT_USD.`
  }
  const period =
    reached.kind === 'window' ? `the last ${SPEND_LIMIT_WINDOW_DAYS} days` : day
  if (source === 'inbox') {
    const share = Math.round(INBOX_SHARE_OF_USER_LIMITS * 100)
    return `Received newsletters are read without AI summaries once ${share}% of a spending limit is used, so the rest is kept for work you start: ${spent} used over ${period}.`
  }
  const [name, variable] =
    reached.kind === 'window'
      ? ['AI spending limit', 'AI_SPEND_LIMIT_USD']
      : ['Daily AI spending limit', 'AI_DAILY_SPEND_LIMIT_USD']
  return `${name} reached: ${spent} used over ${period}, across all your identities. New AI work can start again as older spending leaves that window, or an admin can raise ${variable}.`
}

/** A model call refused because one of its spending limits is reached. */
export class AiSpendLimitError extends Error {
  readonly kind: ReachedSpendLimit['kind']
  readonly spentUsd: number
  readonly limitUsd: number

  constructor(source: AiSpendSource, reached: ReachedSpendLimit) {
    super(limitMessage(source, reached))
    this.name = 'AiSpendLimitError'
    this.kind = reached.kind
    this.spentUsd = reached.spentUsd
    this.limitUsd = reached.limitUsd
  }
}

/**
 * Throws AiSpendLimitError when one of the current scope's limits is
 * reached. Outside a scope, or for shared work, there is no one to limit. A
 * check the database cannot answer lets the call through: the limits guard
 * cost, and failing every AI feature on them would be worse.
 */
export async function assertWithinAiSpendLimit(): Promise<void> {
  const charge = charges.getStore()
  if (!charge) return
  let counters
  try {
    counters = await spendCountersIn(db, charge)
  } catch (err) {
    console.error('Could not check the AI spending limits:', err)
    return
  }
  if (!counters) return
  const reached = reachedSpendLimit(charge.source, counters, spendLimits())
  if (reached) throw new AiSpendLimitError(charge.source, reached)
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
