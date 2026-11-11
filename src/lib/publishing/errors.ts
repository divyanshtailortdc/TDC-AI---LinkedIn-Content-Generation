import type { PublicationErrorCode } from './status'

/**
 * The errors every publishing provider throws, so the engine can tell what
 * happened without knowing which platform it was talking to. No imports
 * beyond types, so tests can use them.
 */

/** The platform (or the service in front of it) refused or failed a request. */
export class PlatformApiError extends Error {
  /** The platform certainly made nothing: trying again cannot duplicate. */
  readonly retryable: boolean

  constructor(
    message: string,
    readonly code: PublicationErrorCode,
    readonly status?: number
  ) {
    super(message)
    this.name = 'PlatformApiError'
    this.retryable = code === 'rate_limited' || code === 'platform_unavailable'
  }
}

/**
 * The post's image cannot be used: unreadable, of a type the platform does
 * not take, or too large. Trying again cannot help; the message is for the user.
 */
export class PostImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PostImageError'
  }
}

/**
 * A provider refused an OAuth token or account request; `status` is its
 * HTTP status (400 or 401 on a refresh: the grant is gone, connect again).
 */
export class PlatformOAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'PlatformOAuthError'
  }
}
