import { createAnthropic } from '@ai-sdk/anthropic'
import { createGateway } from 'ai'
import { env } from '~/env'

export const hasAIGateway = Boolean(
  env.AI_GATEWAY_API_KEY && env.AI_GATEWAY_API_KEY.trim().length > 0
)

export const hasAnthropicKey = Boolean(
  env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim().length > 0
)

export const isAICapable = hasAIGateway || hasAnthropicKey

export const gatewayClient = hasAIGateway
  ? createGateway({ apiKey: env.AI_GATEWAY_API_KEY })
  : null

export const anthropicClient = hasAnthropicKey
  ? createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null

// Backwards compatibility export
export const anthropic = anthropicClient || createAnthropic({ apiKey: 'dummy' })
export const defaultModel = 'claude-3-5-sonnet-20241022'
export const fastModel = 'claude-3-haiku-20240307'

/**
 * Returns an active AI LanguageModel instance.
 * Prioritizes Vercel AI Gateway when configured, or direct Anthropic.
 */
export function getLanguageModel(preferredModel?: string) {
  if (gatewayClient) {
    const modelId = preferredModel?.includes('/')
      ? preferredModel
      : preferredModel?.includes('opus')
        ? 'anthropic/claude-opus-5'
        : 'anthropic/claude-sonnet-4.5'

    return {
      model: gatewayClient(modelId),
      providerName: 'Vercel AI Gateway',
      modelId
    }
  }

  if (anthropicClient) {
    const modelId = preferredModel || defaultModel
    return {
      model: anthropicClient(modelId),
      providerName: 'Anthropic Direct',
      modelId
    }
  }

  return null
}
