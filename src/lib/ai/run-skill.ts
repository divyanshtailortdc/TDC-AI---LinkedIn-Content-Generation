import 'server-only'

import { EPHEMERAL_CACHE, getLanguageModel, type AIStage } from '@/lib/ai'
import { generateText, NoObjectGeneratedError, Output, RetryError } from 'ai'
import type { z } from 'zod'
import { parseJsonLoosely } from './parse-json'
import {
  AiSpendLimitError,
  assertWithinAiSpendLimit,
  recordAiSpend
} from './spend'
import { EMPTY_USAGE, readCallUsage, type CallUsage } from './usage'

/**
 * The one way a skill calls a model: a single request with structured output.
 *
 * A skill (see ./skills) owns its instructions, prompt, output schema and
 * guard; this owns the plumbing they all shared: picking the stage's model,
 * prompt caching, timeouts, salvaging an answer that missed the schema,
 * reading token usage, and the spending limit and usage ledger (./spend).
 * No tools and no loop; that is what ./agents is for.
 */

export type SkillResult<T> = {
  output: T
  usage: CallUsage
  modelId: string
  /** "Vercel AI Gateway" or "Anthropic Direct", for display. */
  providerName: string
}

/**
 * quota_exceeded: the provider's own budget (the gateway key's limit) is used
 * up, for every user. spend_limit: this user reached the app's limit
 * (AI_SPEND_LIMIT_USD); the message says so, and can be shown as it is.
 * Neither is retried soon: see isBusyError.
 */
export type SkillFailure =
  'not_configured' | 'timeout' | 'quota_exceeded' | 'spend_limit' | 'failed'

export class SkillError extends Error {
  /** Tokens billed before the failure, so run totals stay true. */
  readonly usage: CallUsage
  /**
   * The model's raw answer when it missed the schema, for skills whose guard
   * can still salvage parts of it field by field.
   */
  readonly text?: string
  /** "Provider (model)", when a model was reached. */
  readonly modelUsed?: string
  /**
   * For 'failed': the provider was rate-limited, overloaded, down or out of
   * reach, so the same call may well succeed later (isTransientError).
   */
  readonly transient: boolean

  constructor(
    message: string,
    readonly reason: SkillFailure,
    details: {
      usage?: CallUsage
      text?: string
      modelUsed?: string
      transient?: boolean
    } = {}
  ) {
    super(message)
    this.name = 'SkillError'
    this.usage = details.usage ?? EMPTY_USAGE
    this.text = details.text
    this.modelUsed = details.modelUsed
    this.transient = details.transient ?? false
  }
}

/**
 * A provider failure that may pass: rate-limited (429), overloaded or down
 * (5xx), a request timeout (408) or the network. The SDK retries these
 * itself a little first; what is left is worth trying again later.
 */
export function isTransientError(error: unknown): boolean {
  const cause = RetryError.isInstance(error) ? error.lastError : error
  const { statusCode, isRetryable } = (cause ?? {}) as {
    statusCode?: unknown
    isRetryable?: unknown
  }
  if (isRetryable === true) return true
  return (
    typeof statusCode === 'number' &&
    (statusCode === 408 || statusCode === 429 || statusCode >= 500)
  )
}

/**
 * A model call that may succeed if made again later: it timed out, the
 * budget ran out, or the provider was busy or out of reach. A user's own
 * spending limit is not: it frees up over days, so work that can do without
 * the model (a newsletter's links as its stories) should do so now.
 */
export function isBusyError(error: unknown): error is SkillError {
  return (
    error instanceof SkillError &&
    (error.reason === 'timeout' ||
      error.reason === 'quota_exceeded' ||
      error.transient)
  )
}

/**
 * The gateway answers 402 once the key's spend limit is reached. It throws its
 * own error classes (not `APICallError`), so the status code is read directly.
 */
function isQuotaError(error: unknown): boolean {
  const cause = RetryError.isInstance(error) ? error.lastError : error
  const status = (cause as { statusCode?: unknown } | null)?.statusCode
  return status === 402
}

export async function runSkill<S extends z.ZodType>(opts: {
  stage: AIStage
  /**
   * One block, or several sent in order. Several blocks each get their own
   * cache breakpoint, so calls that share only the first block (drafting two
   * ideas for one author) still reuse it, and calls that share all of them
   * (two formats of one idea) reuse everything. At most three: the API takes
   * four breakpoints per request.
   */
  instructions: string | string[]
  /**
   * Marks the instructions as a cacheable prefix. Worth it when the same
   * instructions are sent several times in a row, as drafting does per run.
   */
  cacheInstructions?: boolean
  prompt: string
  /** Images the model should look at, sent after the prompt text. */
  images?: Array<{ data: Uint8Array; mediaType: string }>
  schema: S
  /** Omit for no limit: the long pipeline stages run without one. */
  timeoutMs?: number
  /** Omit for the SDK default. */
  maxRetries?: number
  /** Stops the call early, e.g. when the user cancels. */
  abortSignal?: AbortSignal
  /** Another model than the stage's, e.g. a fallback after it failed. */
  modelId?: string
}): Promise<SkillResult<z.infer<S>>> {
  const handle = getLanguageModel(opts.stage, opts.modelId)
  if (!handle) {
    throw new SkillError(
      'No AI provider configured. Add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY.',
      'not_configured'
    )
  }

  const modelUsed = `${handle.providerName} (${handle.modelId})`
  const blocks = (
    Array.isArray(opts.instructions) ? opts.instructions : [opts.instructions]
  ).slice(0, 3)

  try {
    await assertWithinAiSpendLimit()
  } catch (error) {
    if (error instanceof AiSpendLimitError) {
      throw new SkillError(error.message, 'spend_limit')
    }
    throw error
  }
  const record = (usage: CallUsage) =>
    recordAiSpend({ stage: opts.stage, modelId: handle.modelId, usage })

  try {
    const result = await generateText({
      model: handle.model,
      providerOptions: handle.providerOptions,
      instructions: opts.cacheInstructions
        ? blocks.map(content => ({
            role: 'system' as const,
            content,
            providerOptions: EPHEMERAL_CACHE
          }))
        : blocks.length === 1
          ? blocks[0]!
          : blocks.map(content => ({ role: 'system' as const, content })),
      prompt: opts.images?.length
        ? [
            {
              role: 'user' as const,
              content: [
                { type: 'text' as const, text: opts.prompt },
                ...opts.images.map(image => ({
                  type: 'file' as const,
                  mediaType: image.mediaType,
                  data: image.data
                }))
              ]
            }
          ]
        : opts.prompt,
      output: Output.object({ schema: opts.schema }),
      ...(opts.timeoutMs || opts.abortSignal
        ? {
            abortSignal: AbortSignal.any(
              [
                opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : null,
                opts.abortSignal ?? null
              ].filter((x): x is AbortSignal => x !== null)
            )
          }
        : {}),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {})
    })
    const usage = readCallUsage(result, handle.modelId)
    await record(usage)
    return {
      output: result.output as z.infer<S>,
      usage,
      modelId: handle.modelId,
      providerName: handle.providerName
    }
  } catch (error) {
    // The model answered but not in the exact shape: keep it if it validates.
    // Those tokens were billed either way.
    if (NoObjectGeneratedError.isInstance(error)) {
      const usage = readCallUsage({ usage: error.usage }, handle.modelId)
      await record(usage)
      const salvaged = opts.schema.safeParse(parseJsonLoosely(error.text))
      if (salvaged.success) {
        return {
          output: salvaged.data as z.infer<S>,
          usage,
          modelId: handle.modelId,
          providerName: handle.providerName
        }
      }
      throw new SkillError(error.message, 'failed', {
        usage,
        text: error.text,
        modelUsed
      })
    }
    if (isQuotaError(error)) {
      throw new SkillError(
        error instanceof Error ? error.message : 'AI budget exceeded.',
        'quota_exceeded',
        { modelUsed }
      )
    }
    const timedOut =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new SkillError(
      error instanceof Error ? error.message : 'The model call failed.',
      timedOut ? 'timeout' : 'failed',
      { modelUsed, transient: !timedOut && isTransientError(error) }
    )
  }
}
