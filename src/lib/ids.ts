import { z } from 'zod'

/**
 * A row id from a URL, form or action. Postgres throws on a malformed uuid
 * rather than finding nothing, which turns a mistyped link into a 500, so ids
 * are checked against this before they reach a query.
 *
 * z.guid() checks the shape Postgres stores. z.uuid() also requires an RFC
 * version and variant digit, which Postgres does not, so seeded or imported
 * rows would look like they don't exist.
 */
export function idSchema(message = 'Invalid identifier') {
  return z.guid(message)
}

const anyId = idSchema()

export function isUuid(value: string): boolean {
  return anyId.safeParse(value).success
}
