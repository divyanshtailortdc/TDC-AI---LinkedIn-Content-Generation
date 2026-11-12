/**
 * The cookie naming the identity a user is working on, when they own more
 * than one (src/lib/identity.ts). It holds an identity id, which is checked
 * against the signed-in user on every read, so a stale or forged value only
 * falls back to the user's oldest identity.
 */
export const ACTIVE_IDENTITY_COOKIE = 'active-identity'

/** A year: the choice lasts until the user switches again. */
export const ACTIVE_IDENTITY_MAX_AGE = 60 * 60 * 24 * 365
