/**
 * Prompt-cache markers, kept free of env and the gateway client so they can
 * be unit tested. `src/lib/ai.ts` re-exports EPHEMERAL_CACHE.
 *
 * A cache breakpoint makes everything before it (tools, system, messages) a
 * prefix the next request can read at a fraction of the input price: on
 * Sonnet 5.5 a cache read costs 0.05x input and a 5-minute write 1.25x, so a
 * prefix sent twice within five minutes already costs less than uncached.
 * The minimum cacheable prefix on Sonnet 5.5 and Haiku 5.5 is 512 tokens;
 * shorter ones are sent without error and simply not cached.
 */

/**
 * Marks a message part as a cacheable prefix. The per-account system block is
 * identical across every draft in a run, so caching it makes each post after
 * the first read that prefix at a fraction of the price.
 */
export const EPHEMERAL_CACHE = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
} as const

/**
 * Instructions cut, word for word, where their part shared by more calls
 * ends: the text before `marker` and the text from it on, as two blocks for
 * runSkill, which marks each as a cache breakpoint. The model reads the same
 * words in the same order; the first block's cache entry also serves calls
 * that differ only after it (drafts of ideas with different goals). Without
 * the marker, the text is one block as before.
 */
export function splitForCache(text: string, marker: string): string[] {
  const at = text.indexOf(marker)
  return at > 0 ? [text.slice(0, at), text.slice(at)] : [text]
}

type WithProviderOptions = {
  providerOptions?: Record<string, Record<string, unknown> | undefined>
}

/**
 * The conversation with one cache breakpoint, on its newest message, and
 * none on the older ones. For an agent loop: each step re-sends the whole
 * conversation, so marking the newest message lets the next step read
 * everything up to it from the cache. The marker moves forward step by step
 * (the API looks back for the previous entry), and clearing the older ones
 * keeps the request within the API's four breakpoints. Markers are not part
 * of the cached content, so moving them never invalidates a prefix.
 */
export function withRollingCacheBreakpoint<M extends WithProviderOptions>(
  messages: readonly M[]
): M[] {
  return messages.map((message, index) => {
    const anthropic = message.providerOptions?.anthropic
    if (index < messages.length - 1) {
      if (!anthropic || !('cacheControl' in anthropic)) return message
      const { cacheControl: _dropped, ...rest } = anthropic
      return {
        ...message,
        providerOptions: { ...message.providerOptions, anthropic: rest }
      }
    }
    return {
      ...message,
      providerOptions: {
        ...message.providerOptions,
        anthropic: { ...anthropic, ...EPHEMERAL_CACHE.anthropic }
      }
    }
  })
}
