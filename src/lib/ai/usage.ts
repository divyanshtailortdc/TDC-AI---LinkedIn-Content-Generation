/**
 * Token and cost accounting for every paid model call.
 *
 * Kept free of the gateway client and env so it can be unit tested.
 *
 * Cost comes from the AI Gateway's billed figure (`providerMetadata.gateway.cost`)
 * whenever it is present. The rate-table estimate is only a fallback for direct
 * Anthropic calls, and it prices cached input correctly: an earlier version
 * billed every input token at full price, which overstated drafts (whose cached
 * prefix reads at a tenth of the price) and understated cache writes.
 */

import { defaultModel } from '../models'

export interface CallUsage {
  calls: number
  /** All input tokens, cached and uncached. */
  inputTokens: number
  noCacheInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** All output tokens, including thinking. */
  outputTokens: number
  /** Thinking tokens. Billed as output, never shown to the reader. */
  reasoningTokens: number
  totalTokens: number
  costUsd: number
  /** Calls whose cost is the gateway's billed amount. */
  billedCalls: number
  /** Calls whose cost had to be estimated from the rate table. */
  estimatedCalls: number
}

export const EMPTY_USAGE: CallUsage = Object.freeze({
  calls: 0,
  inputTokens: 0,
  noCacheInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  billedCalls: 0,
  estimatedCalls: 0
}) as CallUsage

/**
 * Anthropic list prices per million tokens. `cacheRead` overrides the default
 * cache-read multiplier for models priced differently.
 */
const MODEL_RATES: Record<
  string,
  { input: number; output: number; cacheRead?: number }
> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.05 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.05 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 }
}

/** Cache reads cost 0.1x input; 5-minute cache writes cost 1.25x input. */
const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 1.25

function num(value: unknown): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : Number(value)
  return Number.isFinite(n) ? n : 0
}

function rateFor(modelId: string) {
  const key = modelId.replace(/^anthropic\//, '')
  // A model missing from the table is priced as the one the app uses.
  return MODEL_RATES[key] || MODEL_RATES[defaultModel]!
}

/** Rate-table estimate, pricing cached input at its real multipliers. */
export function estimateCostUsd(
  modelId: string,
  usage: Pick<
    CallUsage,
    'noCacheInputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'outputTokens'
  >
): number {
  const rate = rateFor(modelId)
  const perToken = (tokens: number, price: number) => (tokens / 1_000_000) * price

  return (
    perToken(usage.noCacheInputTokens, rate.input) +
    perToken(
      usage.cacheReadTokens,
      rate.input * (rate.cacheRead ?? CACHE_READ_MULTIPLIER)
    ) +
    perToken(usage.cacheWriteTokens, rate.input * CACHE_WRITE_MULTIPLIER) +
    perToken(usage.outputTokens, rate.output)
  )
}

/** The gateway's billed cost for a call, or null when it did not report one. */
export function readGatewayCost(providerMetadata: unknown): number | null {
  const gateway = (providerMetadata as { gateway?: { cost?: unknown } } | undefined)
    ?.gateway
  if (gateway?.cost === undefined || gateway.cost === null) return null
  const cost = num(gateway.cost)
  return Number.isFinite(cost) ? cost : null
}

/** Normalizes one `generateText` result into accounting fields. */
export function readCallUsage(
  result: { usage?: unknown; providerMetadata?: unknown },
  modelId: string
): CallUsage {
  const u = result.usage as
    | {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
        inputTokenDetails?: {
          noCacheTokens?: number
          cacheReadTokens?: number
          cacheWriteTokens?: number
        }
        outputTokenDetails?: { reasoningTokens?: number }
      }
    | undefined

  const anthropicUsage = (
    result.providerMetadata as
      | { anthropic?: { usage?: { output_tokens_details?: { thinking_tokens?: number } } } }
      | undefined
  )?.anthropic?.usage

  const inputTokens = num(u?.inputTokens)
  const cacheReadTokens = num(u?.inputTokenDetails?.cacheReadTokens)
  const cacheWriteTokens = num(u?.inputTokenDetails?.cacheWriteTokens)
  const noCacheInputTokens =
    u?.inputTokenDetails?.noCacheTokens !== undefined
      ? num(u.inputTokenDetails.noCacheTokens)
      : Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
  const outputTokens = num(u?.outputTokens)
  const reasoningTokens = Math.max(
    num(u?.outputTokenDetails?.reasoningTokens),
    num(anthropicUsage?.output_tokens_details?.thinking_tokens)
  )

  const billed = readGatewayCost(result.providerMetadata)
  const costUsd =
    billed ??
    estimateCostUsd(modelId, {
      noCacheInputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      outputTokens
    })

  return {
    calls: 1,
    inputTokens,
    noCacheInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    totalTokens: num(u?.totalTokens) || inputTokens + outputTokens,
    costUsd,
    billedCalls: billed === null ? 0 : 1,
    estimatedCalls: billed === null ? 1 : 0
  }
}

/** Cost of one image generation, when the gateway reported it. */
export function readImageCost(result: { providerMetadata?: unknown }): CallUsage {
  const billed = readGatewayCost(result.providerMetadata)
  return {
    ...EMPTY_USAGE,
    calls: 1,
    costUsd: billed ?? 0,
    billedCalls: billed === null ? 0 : 1,
    // An image with no reported cost is counted, but not priced: there is no
    // published rate table here to estimate from.
    estimatedCalls: billed === null ? 1 : 0
  }
}

export function addUsage(...parts: Array<Partial<CallUsage> | null | undefined>): CallUsage {
  const total: CallUsage = { ...EMPTY_USAGE }
  for (const part of parts) {
    if (!part) continue
    for (const key of Object.keys(EMPTY_USAGE) as Array<keyof CallUsage>) {
      total[key] += num(part[key])
    }
  }
  return total
}

/** Share of input tokens served from cache, 0-1. */
export function cacheHitRate(usage: Pick<CallUsage, 'inputTokens' | 'cacheReadTokens'>): number {
  return usage.inputTokens > 0 ? usage.cacheReadTokens / usage.inputTokens : 0
}
