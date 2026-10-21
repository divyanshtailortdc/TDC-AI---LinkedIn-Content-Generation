import { NoImageGeneratedError, RetryError } from 'ai'

/**
 * Why an image call failed, read from what the gateway threw. Kept apart from
 * ./index (which loads the model clients) so it can be tested on its own.
 */

/**
 * A provider's error text fit to show: the gateway colours its messages for a
 * terminal, and those escape codes reached the review screen verbatim.
 */
export function cleanProviderMessage(message: string, max = 180): string {
  const flat = message
    // Terminal colour codes.
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

/** The gateway says "Unauthenticated request" without always setting a status. */
export const isAuthFailureMessage = (message: string) =>
  /unauthenticated|invalid api key|api key is invalid|\b401\b/i.test(message)

function statusOf(err: unknown): number | undefined {
  const cause = RetryError.isInstance(err) ? err.lastError : err
  const status = (cause as { statusCode?: unknown } | null)?.statusCode
  return typeof status === 'number' ? status : undefined
}

/** A failure that every model would hit the same way: no point trying the next. */
export function isAccountFailure(err: unknown): boolean {
  const status = statusOf(err)
  return status === 401 || status === 402 || status === 403
}

/**
 * The reason an image call failed, in words a reviewer can act on. The raw
 * provider message is kept only when nothing more specific applies.
 */
export function describeImageFailure(err: unknown): string {
  const status = statusOf(err)
  const message = err instanceof Error ? err.message : String(err ?? '')
  if (status === 401 || status === 403 || isAuthFailureMessage(message)) {
    return 'the AI Gateway rejected the API key (check AI_GATEWAY_API_KEY)'
  }
  if (status === 402) return 'the AI Gateway credit or spend limit is used up'
  if (status === 429)
    return 'the image model is rate-limited right now; try again in a minute'
  if (/moderat|safety|content polic|nsfw|flagged/i.test(message)) {
    return "the image model's safety filter blocked this prompt"
  }
  if (
    err instanceof Error &&
    (err.name === 'TimeoutError' ||
      err.name === 'AbortError' ||
      /timed? ?out/i.test(message))
  ) {
    return 'the image model took too long to respond'
  }
  if (NoImageGeneratedError.isInstance(err))
    return 'the image model returned no image'
  return cleanProviderMessage(message) || 'the image request failed'
}
