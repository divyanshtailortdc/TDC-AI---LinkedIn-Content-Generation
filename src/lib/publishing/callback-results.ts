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
  failed: (name: string) => `${name} could not be connected. Please try again.`,
  not_configured: (name: string) =>
    `Publishing to ${name} is not set up on this server.`
} as const

export type CallbackResult = keyof typeof MESSAGES

export const isCallbackResult = (value: unknown): value is CallbackResult =>
  typeof value === 'string' && Object.hasOwn(MESSAGES, value)

/** The message for `result`, in `platformName`. */
const callbackMessage = (result: CallbackResult, platformName: string) =>
  MESSAGES[result](platformName)

/** Where they differ for connecting the Buffer account itself. */
const BUFFER_MESSAGES: Partial<Record<CallbackResult, string>> = {
  connected:
    'Buffer is connected and your channels are synced. Each network below publishes to the channel shown; change it any time.',
  missing_permission:
    'Buffer was not connected: permission to read your channels and create posts was not granted. Connect again and allow it.',
  failed:
    'Buffer could not be connected. The authorization may have expired or Buffer may be unavailable; please try again.'
}

/** The message for `result` on the Buffer card. */
export const bufferCallbackMessage = (result: CallbackResult) =>
  BUFFER_MESSAGES[result] ?? callbackMessage(result, 'Buffer')
