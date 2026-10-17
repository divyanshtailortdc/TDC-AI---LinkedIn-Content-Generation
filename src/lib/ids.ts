import { z } from 'zod'

const uuid = z.string().uuid()

/**
 * Whether an id from the URL can be looked up. Postgres throws on a malformed
 * uuid rather than finding nothing, which turned a mistyped link into a 500,
 * so pages check this first and answer 404.
 */
export function isUuid(value: string): boolean {
  return uuid.safeParse(value).success
}
