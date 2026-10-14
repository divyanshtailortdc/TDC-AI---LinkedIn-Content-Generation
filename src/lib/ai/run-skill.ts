import 'server-only'

import { EPHEMERAL_CACHE, getLanguageModel, type AIStage } from '@/lib/ai'
import { generateText, NoObjectGeneratedError, Output } from 'ai'
import type { z } from 'zod'
import { parseJsonLoosely } from './parse-json'
import { EMPTY_USAGE, readCallUsage, type CallUsage } from './usage'

/**
 * The one way a skill calls a model: a single request with structured output.
 *
 * A skill (see ./skills) owns its instructions, prompt, output schema and
 * guard; this owns the plumbing they all shared: picking the stage's model,
 * prompt caching, timeouts, salvaging an answer that missed the schema, and
 * reading token usage. No tools and no loop; that is what ./agents is for.
 */

export type SkillResult<T> = {
  output: T
  usage: CallUsage
  modelId: string
  /** "Vercel AI Gateway" or "Anthropic Direct", for display. */
  providerName: string
}

export type SkillFailure = 'not_configured' | 'timeout' | 'failed'

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

  constructor(
    message: string,
    readonly reason: SkillFailure,
    details: { usage?: CallUsage; text?: string; modelUsed?: string } = {}
  ) {
    super(message)
    this.name = 'SkillError'
    this.usage = details.usage ?? EMPTY_USAGE
    this.text = details.text
    this.modelUsed = details.modelUsed
  }
}

export async function runSkill<S extends z.ZodType>(opts: {
  stage: AIStage
  instructions: string
  /**
   * Marks the instructions as a cacheable prefix. Worth it when the same
   * instructions are sent several times in a row, as drafting does per run.
   */
  cacheInstructions?: boolean
  prompt: string
  schema: S
  /** Omit for no limit: the long pipeline stages run without one. */
  timeoutMs?: number
  /** Omit for the SDK default. */
  maxRetries?: number
}): Promise<SkillResult<z.infer<S>>> {
  const handle = getLanguageModel(opts.stage)
  if (!handle) {
    throw new SkillError(
      'No AI provider configured. Add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY.',
      'not_configured'
    )
  }

  const modelUsed = `${handle.providerName} (${handle.modelId})`

  try {
    const result = await generateText({
      model: handle.model,
      providerOptions: handle.providerOptions,
      instructions: opts.cacheInstructions
        ? [
            {
              role: 'system',
              content: opts.instructions,
              providerOptions: EPHEMERAL_CACHE
            }
          ]
        : opts.instructions,
      prompt: opts.prompt,
      output: Output.object({ schema: opts.schema }),
      ...(opts.timeoutMs
        ? { abortSignal: AbortSignal.timeout(opts.timeoutMs) }
        : {}),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {})
    })
    return {
      output: result.output as z.infer<S>,
      usage: readCallUsage(result, handle.modelId),
      modelId: handle.modelId,
      providerName: handle.providerName
    }
  } catch (error) {
    // The model answered but not in the exact shape: keep it if it validates.
    // Those tokens were billed either way.
    if (NoObjectGeneratedError.isInstance(error)) {
      const usage = readCallUsage({ usage: error.usage }, handle.modelId)
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
    const timedOut =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new SkillError(
      error instanceof Error ? error.message : 'The model call failed.',
      timedOut ? 'timeout' : 'failed',
      { modelUsed }
    )
  }
}
