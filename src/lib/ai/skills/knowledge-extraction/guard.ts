import type { KeyClaim } from './schema'

/** A number as written: 40, 2.5, 1,200, 1,200.50. */
const NUMBER = /\d+(?:[.,]\d+)*/g

/**
 * The numbers a text states, thousands separators dropped so "1,200" and
 * "1200" are one number. Whole numbers only: "5" is not in "25".
 */
function numbersIn(text: string): Set<string> {
  return new Set(
    (text.match(NUMBER) ?? []).map(n => n.replace(/,(?=\d{3}(?!\d))/g, ''))
  )
}

/**
 * A quote only grounds a claim if it genuinely appears in the source, so quotes
 * the model paraphrased are dropped rather than trusted. The claim is the
 * model's own sentence and is what later counts as verified, so every number
 * in it must also be in its quote: a figure misread from the quote ("41%"
 * for "14%", "2023" for "2024") drops the claim.
 */
export function keepVerifiableClaims(
  claims: KeyClaim[],
  content: string
): KeyClaim[] {
  const haystack = content.toLowerCase().replace(/\s+/g, ' ')
  return claims.filter(c => {
    const quote = (c.quote || '').toLowerCase().replace(/\s+/g, ' ').trim()
    if (quote.length < 15) return false
    if (!haystack.includes(quote)) return false
    const stated = numbersIn(quote)
    return [...numbersIn(c.claim || '')].every(n => stated.has(n))
  })
}
