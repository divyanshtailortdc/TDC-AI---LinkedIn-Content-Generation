import type { KeyClaim } from './schema'

/**
 * A quote only grounds a claim if it genuinely appears in the source, so quotes
 * the model paraphrased are dropped rather than trusted.
 */
export function keepVerifiableClaims(
  claims: KeyClaim[],
  content: string
): KeyClaim[] {
  const haystack = content.toLowerCase().replace(/\s+/g, ' ')
  return claims.filter(c => {
    const quote = (c.quote || '').toLowerCase().replace(/\s+/g, ' ').trim()
    if (quote.length < 15) return false
    return haystack.includes(quote)
  })
}
