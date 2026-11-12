/**
 * How a connect callback ended, as Settings → Integrations says it. The
 * callback redirects with the key (and the platform); nothing the provider
 * sent is ever echoed back to the page.
 */
const MESSAGES = {
  connected: (name: string) =>
    `${name} is connected. You can publish approved ${name} posts from Posts.`,
  cancelled: (name: string) =>
    `${name} was not connected: authorization was cancelled.`,
  state_error: (name: string) =>
    `${name} was not connected: the request could not be verified. Please try again.`,
  missing_permission: (name: string) =>
    `${name} was not connected: permission to publish posts was not granted. Connect again and allow it.`,
  no_account: (name: string) =>
    `No ${name} account is connected in your Buffer account. Connect ${name} in Buffer as a channel, then connect again here.`,
  failed: (name: string) => `${name} could not be connected. Please try again.`,
  not_configured: (name: string) =>
    `Publishing to ${name} is not set up on this server.`,
  no_identity: (name: string) =>
    `${name} was not connected: set up an identity first. Each identity connects its own accounts.`
} as const

export type CallbackResult = keyof typeof MESSAGES

export const isCallbackResult = (value: unknown): value is CallbackResult =>
  typeof value === 'string' && Object.hasOwn(MESSAGES, value)

/** The message for `result`, in `platformName`. */
export const callbackMessage = (result: CallbackResult, platformName: string) =>
  MESSAGES[result](platformName)
