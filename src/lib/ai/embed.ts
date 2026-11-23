import 'server-only'

import type { EmbeddingModelHandle } from '@/lib/ai'
import { embedMany, type Embedding } from 'ai'
import { assertWithinAiSpendLimit, recordAiSpend } from './spend'
import { readEmbeddingUsage } from './usage'

/**
 * The one way to embed text: checks the spending limit first (throwing
 * AiSpendLimitError), then records what the request cost in the usage
 * ledger (see ./spend).
 */
export async function embedValues(
  handle: EmbeddingModelHandle,
  values: string[],
  options: { abortSignal?: AbortSignal; maxParallelCalls?: number } = {}
): Promise<Embedding[]> {
  await assertWithinAiSpendLimit()
  const result = await embedMany({
    model: handle.model,
    values,
    ...options
  })
  await recordAiSpend({
    stage: 'embedding',
    modelId: handle.modelId,
    usage: readEmbeddingUsage(result, handle.modelId)
  })
  return result.embeddings
}
