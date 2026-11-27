/**
 * The social sign-in providers the app can offer, in the order their buttons
 * show. Each is offered when its client id and secret are set (src/env.ts,
 * read in src/lib/auth.ts). Adding one that Better Auth supports: add it
 * here, its credentials to src/env.ts and src/lib/auth.ts, and its mark to
 * SocialSignInButton.
 *
 * Sign-in only: none of these is a platform posts are written for or
 * published to (src/lib/platforms, src/lib/publishing).
 */
export const SOCIAL_PROVIDER_IDS = ['google'] as const
export type SocialProvider = (typeof SOCIAL_PROVIDER_IDS)[number]

export const SOCIAL_PROVIDER_LABELS: Record<SocialProvider, string> = {
  google: 'Google'
}

/** Password rules for email sign-up, shared by the server and the form. */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128
