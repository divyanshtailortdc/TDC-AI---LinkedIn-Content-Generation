/**
 * Friendly messages for Better Auth errors: the `code` of a failed authClient
 * call, or the `?error=` a Google or LinkedIn sign-in redirects back with. Unknown codes
 * get the caller's fallback, never the raw server text.
 */
const MESSAGES: Record<string, string> = {
  BANNED_USER: 'This account has been suspended. Contact your administrator.',
  // Passkeys.
  AUTH_CANCELLED: 'Passkey sign-in was cancelled.',
  REGISTRATION_CANCELLED: 'Adding the passkey was cancelled.',
  PREVIOUSLY_REGISTERED: 'This passkey is already added to your account.',
  PASSKEY_NOT_FOUND:
    'That passkey is not registered here. Sign in with Google or LinkedIn, then add it again.',
  AUTHENTICATION_FAILED:
    'Passkey sign-in failed. Please try again or use Google or LinkedIn.',
  CHALLENGE_NOT_FOUND: 'The passkey request expired. Please try again.',
  // Google and LinkedIn sign-in (snake_case, from the OAuth callback).
  email_not_found:
    'The provider did not share an email address for this account.',
  // The provider has not verified the email, so it is not joined to the
  // existing user with that address.
  account_not_linked:
    'An account with this email already exists, but this provider has not verified the address. Sign in another way.',
  unable_to_create_user: 'We could not create your account. Please try again.',
  access_denied: 'Sign-in was cancelled.',
  banned: 'This account has been suspended. Contact your administrator.'
}

export const RATE_LIMITED_MESSAGE =
  'Too many attempts. Please wait a minute and try again.'

export function authErrorMessage(
  error: { code?: string; status?: number } | string | null | undefined,
  fallback: string
): string {
  if (!error) return fallback
  if (typeof error === 'string') return MESSAGES[error] ?? fallback
  if (error.status === 429) return RATE_LIMITED_MESSAGE
  return (error.code && MESSAGES[error.code]) || fallback
}
