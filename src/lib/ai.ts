import { createAnthropic } from '@ai-sdk/anthropic'
import { createGateway, type EmbeddingModel, type LanguageModel } from 'ai'
import { env } from '~/env'
import { defaultModel, fastModel } from './models'

export { defaultModel, fastModel }

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

/** The gateway namespaces models by provider; the direct client does not. */
function toGatewayModelId(modelId: string): string {
  return modelId.includes('/') ? modelId : `anthropic/${modelId}`
}

export type AIStage =
  | 'ideation'
  | 'drafting'
  | 'media_brief'
  | 'voice_analysis'
  | 'identity_setup'
  | 'extraction'
  | 'research'

/**
 * Effort is the first quality/cost lever. Ideation and drafting carry the
 * output quality, so they run high; extraction is mechanical.
 */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * Only the provider options this pipeline sets. The provider's full option type
 * includes non-JSON-serializable members that `providerOptions` rejects.
 */
export type StageProviderOptions = {
  anthropic: {
    thinking?: { type: 'adaptive' }
    effort?: Effort
    structuredOutputMode?: 'outputFormat' | 'jsonTool' | 'auto'
  }
}

const STAGE_SETTINGS: Record<AIStage, { model: string; effort: Effort }> = {
  ideation: { model: defaultModel, effort: 'high' },
  drafting: { model: defaultModel, effort: 'high' },
  media_brief: { model: defaultModel, effort: 'medium' },
  voice_analysis: { model: defaultModel, effort: 'medium' },
  // Interactive: the user waits on this, so it trades depth for speed.
  identity_setup: { model: defaultModel, effort: 'low' },
  extraction: { model: fastModel, effort: 'low' },
  // The research agent: several short steps choosing searches and pages.
  research: { model: defaultModel, effort: 'medium' }
}

export interface LanguageModelHandle {
  model: LanguageModel
  providerName: string
  modelId: string
  providerOptions: StageProviderOptions
}

/**
 * Returns an active model for a pipeline stage, or null when no key is set.
 * Callers must handle null rather than assuming AI is available.
 */
export function getLanguageModel(
  stage: AIStage = 'drafting',
  overrideModelId?: string
): LanguageModelHandle | null {
  const settings = STAGE_SETTINGS[stage]
  const modelId = overrideModelId || settings.model

  // Haiku 4.5 predates adaptive thinking and rejects `effort`.
  const supportsAdaptiveThinking = !modelId.includes('haiku')

  const providerOptions: StageProviderOptions = {
    anthropic: {
      // Pin native structured output. Under 'auto' the provider sometimes falls
      // back to a tool call and returns the object wrapped in `{parameters:{...}}`,
      // which then fails schema validation.
      structuredOutputMode: 'outputFormat',
      ...(supportsAdaptiveThinking
        ? { thinking: { type: 'adaptive' as const }, effort: settings.effort }
        : {})
    }
  }

  if (gatewayClient) {
    const gatewayId = toGatewayModelId(modelId)
    return {
      model: gatewayClient(gatewayId),
      providerName: 'Vercel AI Gateway',
      modelId: gatewayId,
      providerOptions
    }
  }

  if (anthropicClient) {
    return {
      model: anthropicClient(modelId),
      providerName: 'Anthropic Direct',
      modelId,
      providerOptions
    }
  }

  return null
}

/**
 * Knowledge-base embeddings. Anthropic has no embedding endpoint, so this is
 * only reachable through the gateway. Changing the model means changing
 * `EMBEDDING_DIMENSIONS` in the schema and re-embedding every document.
 */
export const EMBEDDING_MODEL_ID = 'openai/text-embedding-3-small'

export interface EmbeddingModelHandle {
  model: EmbeddingModel
  modelId: string
}

/** Returns the embedding model, or null when no gateway key is set. */
export function getEmbeddingModel(): EmbeddingModelHandle | null {
  if (!gatewayClient) return null
  return {
    model: gatewayClient.embeddingModel(EMBEDDING_MODEL_ID),
    modelId: EMBEDDING_MODEL_ID
  }
}

/**
 * Marks a message part as a cacheable prefix. The per-account system block is
 * identical across every draft in a run, so caching it makes each post after
 * the first read that prefix at a fraction of the price.
 */
export const EPHEMERAL_CACHE = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
} as const

export { EMPTY_USAGE, type CallUsage } from './ai/usage'
