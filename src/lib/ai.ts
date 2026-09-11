import { createAnthropic } from '@ai-sdk/anthropic'
import { env } from '~/env'

/**
 * Anthropic AI client via Vercel AI SDK.
 * Use this to create model instances for content generation.
 *
 * @example
 * import { anthropic, defaultModel } from '~/lib/ai'
 * import { generateText } from 'ai'
 *
 * const { text } = await generateText({
 *   model: anthropic(defaultModel),
 *   prompt: 'Write a LinkedIn post about...',
 * })
 */
export const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY
})

/**
 * Default Claude model for content generation.
 * Change here to switch the project-wide default.
 */
export const defaultModel = 'claude-3-5-sonnet-20241022'

/**
 * Fast model for lightweight tasks (idea scoring, classification).
 */
export const fastModel = 'claude-3-haiku-20240307'
