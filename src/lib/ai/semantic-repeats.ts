import { cosineSimilarity, embedMany } from 'ai'

/**
 * Ideas that repeat an earlier one in other words. A model asked for fresh
 * ideas rewords an old one ("The delivery fee shows up like a plot twist",
 * then "…like an uninvited guest"): the word-overlap check (../novelty) scores
 * such a pair at 0.05, far under its 0.35 bar. Compared by meaning
 * (embeddings of title and thesis) the pair scores 0.88, while the closest
 * genuinely different ideas of the same account score 0.75 at most; the bar
 * sits between them. Measured on a real account's 28 ideas (2026-11-13).
 *
 * No `server-only` import, and the AI client is loaded only when used, so
 * tests can run the pure part.
 */

/** At or above this cosine similarity two ideas are the same idea. */
export const REPEAT_SIMILARITY = 0.82

const EMBED_TIMEOUT_MS = 30_000

/** What is compared: the idea's title and its thesis. */
export const ideaMeaningText = (idea: {
  title?: string | null
  thesis?: string | null
}) => [idea.title, idea.thesis].filter(Boolean).join('. ')

export type RepeatOf =
  | { kind: 'earlier'; index: number; similarity: number }
  | { kind: 'batch'; index: number; similarity: number }

/**
 * For each candidate (in order of priority, best first), what it repeats:
 * an earlier idea, or a better candidate already kept from this batch; null
 * when it is new. Pure.
 */
export function findRepeats(
  candidates: number[][],
  earlier: number[][],
  threshold = REPEAT_SIMILARITY
): Array<RepeatOf | null> {
  const kept: number[] = []
  return candidates.map((vector, i) => {
    let best: RepeatOf | null = null
    for (let index = 0; index < earlier.length; index++) {
      const similarity = cosineSimilarity(vector, earlier[index]!)
      if (
        similarity >= threshold &&
        (best === null || similarity > best.similarity)
      ) {
        best = { kind: 'earlier', index, similarity }
      }
    }
    for (const index of kept) {
      const similarity = cosineSimilarity(vector, candidates[index]!)
      if (
        similarity >= threshold &&
        (best === null || similarity > best.similarity)
      ) {
        best = { kind: 'batch', index, similarity }
      }
    }
    if (best === null) kept.push(i)
    return best
  })
}

/**
 * Drops the ideas that repeat an earlier idea, or a better idea of the same
 * batch, in other words. `priority` orders the batch (higher kept first).
 * Without an embedding model, or when the call fails, nothing is dropped:
 * the check is a backstop and never costs a run its ideas.
 */
export async function dropSemanticRepeats<
  T extends { title: string; thesis?: string | null; goalId?: string | null }
>(
  ideas: T[],
  earlier: Array<{ title: string; thesis?: string | null }>,
  options: { priority?: (idea: T) => number; abortSignal?: AbortSignal } = {}
): Promise<{
  kept: T[]
  dropped: Array<{ title: string; reason: string; goalId?: string }>
}> {
  if (ideas.length === 0) return { kept: ideas, dropped: [] }
  const { getEmbeddingModel } = await import('~/lib/ai')
  const handle = getEmbeddingModel()
  if (!handle) return { kept: ideas, dropped: [] }

  const priority = options.priority ?? (() => 0)
  const order = ideas
    .map((_, i) => i)
    .sort((a, b) => priority(ideas[b]!) - priority(ideas[a]!))
  try {
    const timeout = AbortSignal.timeout(EMBED_TIMEOUT_MS)
    const { embeddings } = await embedMany({
      model: handle.model,
      values: [
        ...order.map(i => ideaMeaningText(ideas[i]!)),
        ...earlier.map(ideaMeaningText)
      ],
      abortSignal: options.abortSignal
        ? AbortSignal.any([timeout, options.abortSignal])
        : timeout
    })
    const repeats = findRepeats(
      embeddings.slice(0, order.length),
      embeddings.slice(order.length)
    )

    const dropped = new Map<number, string>()
    repeats.forEach((repeat, rank) => {
      if (!repeat) return
      const of =
        repeat.kind === 'earlier'
          ? `"${earlier[repeat.index]!.title}" from an earlier run`
          : `"${ideas[order[repeat.index]!]!.title}" in this batch`
      dropped.set(
        order[rank]!,
        `Repeats ${of} in other words (${Math.round(repeat.similarity * 100)}% alike in meaning).`
      )
    })
    return {
      kept: ideas.filter((_, i) => !dropped.has(i)),
      dropped: [...dropped.entries()].map(([i, reason]) => ({
        title: ideas[i]!.title,
        reason,
        ...(ideas[i]!.goalId ? { goalId: ideas[i]!.goalId! } : {})
      }))
    }
  } catch (err) {
    if (options.abortSignal?.aborted) throw err
    console.warn(
      'The repeat check by meaning could not run; no idea was dropped by it:',
      err
    )
    return { kept: ideas, dropped: [] }
  }
}
