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

/**
 * embedValues, but the same values with the same model are embedded once
 * however many callers ask, as a run's knowledge base and newsletter
 * retrieval both do with its goal texts. Keep one per run: a failure is
 * shared by everyone who asked for the same values.
 */
export function sharedEmbedder(): typeof embedValues {
  const made = new Map<string, Promise<Embedding[]>>()
  return (handle, values, options) => {
    const key = `${handle.modelId}\n${values.join('\u0000')}`
    let embeddings = made.get(key)
    if (!embeddings) {
      embeddings = embedValues(handle, values, options)
      made.set(key, embeddings)
    }
    return embeddings
  }
}
