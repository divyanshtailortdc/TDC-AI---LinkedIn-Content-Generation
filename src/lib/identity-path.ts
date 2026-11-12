/**
 * Where a user without an identity sets one up, and where it is edited later.
 * Its own module so client components can use it; src/lib/identity.ts is
 * server-only.
 */
export const IDENTITY_PATH = '/identity'

/** Where a user who already has an identity creates another. */
export const NEW_IDENTITY_PATH = `${IDENTITY_PATH}/new`
