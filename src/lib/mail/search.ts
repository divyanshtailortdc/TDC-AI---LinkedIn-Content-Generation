/** Most words an inbox search uses; the rest are ignored. */
const MAX_TERMS = 8

/**
 * A search box's text as a prefix tsquery for `to_tsquery('simple', …)`, so
 * "news acme" finds "Newsletter from acme.com". Only letters, digits and the
 * joiners of addresses and domains (. @ _ -) survive, which leaves none of
 * tsquery's operators: user input can never be read as query syntax. Null
 * when nothing searchable is left.
 */
export function inboxSearchQuery(input: string): string | null {
  const terms =
    input
      .toLowerCase()
      .match(/[\p{L}\p{M}\p{N}]+(?:[.@_-][\p{L}\p{M}\p{N}]+)*/gu)
      ?.filter(term => term.length <= 100)
      .slice(0, MAX_TERMS) ?? []
  return terms.length > 0 ? terms.map(term => `${term}:*`).join(' & ') : null
}
