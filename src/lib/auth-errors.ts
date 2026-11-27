/**
 * Friendly messages for Better Auth errors: the `code` of a failed authClient
 * call, or the `?error=` a social sign-in redirects back with. Unknown codes
 * get the caller's fallback, never the raw server text.
 */
const MESSAGES: Record<string, string> = {
  BANNED_USER: 'This account has been suspended. Contact your administrator.',
  // Passkeys. A browser refusal comes back with the WebAuthn error's own
  // code (ERROR_*), not the plugin's PREVIOUSLY_REGISTERED and so on.
  AUTH_CANCELLED: 'Passkey sign-in was cancelled.',
  ERROR_CEREMONY_ABORTED: 'Adding the passkey was cancelled.',
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED:
    'This device already has a passkey for your account. Use another device or password manager to add a second one.',
  // Adding a passkey needs a sign-in from the last day.
  SESSION_NOT_FRESH:
    'For your security, sign out and sign in again before adding a passkey.',
  PASSKEY_NOT_FOUND:
    'That passkey is not registered here. Sign in another way, then add it again.',
  AUTHENTICATION_FAILED:
    'Passkey sign-in failed. Please try again or use another sign-in option.',
  CHALLENGE_NOT_FOUND: 'The passkey request expired. Please try again.',
  // Email and password.
  INVALID_EMAIL_OR_PASSWORD:
    'Incorrect email or password. If you signed up with Google, use Continue with Google.',
  INVALID_EMAIL: 'Enter a valid email address.',
  PASSWORD_TOO_SHORT: 'That password is too short.',
  PASSWORD_TOO_LONG: 'That password is too long.',
  USER_ALREADY_EXISTS:
    'An account with this email already exists. Sign in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'An account with this email already exists. Sign in instead.',
  // Social sign-in (snake_case, from the OAuth callback).
  email_not_found:
    'The provider did not share an email address for this account.',
  // The provider has not verified the email, so it is not joined to the
  // existing user with that address.
  // Also when that account was made with a password, whose email is never
  // confirmed (src/lib/auth.ts).
  account_not_linked:
    'An account with this email already exists. Sign in with its email and password instead.',
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
