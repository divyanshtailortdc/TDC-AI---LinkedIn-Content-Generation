import type { FormatId } from '@/lib/formats'
import type { PlatformSpec } from '@/lib/platforms'
import type { BufferOAuthConfig } from './buffer/oauth'
import {
  bufferFacebookProvider,
  bufferInstagramProvider,
  bufferThreadsProvider,
  bufferXProvider
} from './buffer/provider'
import type { CallbackResult } from './callback-results'
import { linkedInProvider } from './linkedin/provider'
import type { LinkedInAppConfig, MemberInfo, TokenSet } from './linkedin/oauth'
import { canPublishTo, type PublishingPlatformId } from './platform'

/**
 * The publishing providers, one per platform the app publishes to, behind
 * one shape. The engine, connections and settings look a provider up by a
 * post's (or a connection's) platform and never import a provider's own
 * modules, so adding a platform adds a provider here rather than changing them.
 *
 *   linkedin   LinkedIn's REST API, connected through LinkedIn's OAuth (./linkedin)
 *   x          X through Buffer's API, connected through Buffer's OAuth (an
 *              app client), or with a Buffer API key for testing (./buffer)
 *   threads    A Threads account through Buffer, connected the same way
 *   facebook   A Facebook Page through Buffer, likewise
 *   instagram  An Instagram professional account through Buffer, likewise
 *
 * No `server-only` import, so tests can run what uses it.
 */

export type FetchFn = typeof fetch

/** What every provider's config holds: the key tokens are encrypted with. */
export type BaseConfig = { encryptionKey: Buffer }

/**
 * X, Facebook or Instagram through Buffer: where Buffer's API is, and where
 * it fetches images from.
 */
export type BufferConfig = BaseConfig & {
  /**
   * The app client customers authorize through Buffer's consent screen; null
   * without one, when each user pastes a Buffer API key instead (testing).
   */
  oauth: BufferOAuthConfig | null
  apiUrl: string
  /** The app's public origin, for the signed image links Buffer fetches. */
  appUrl: string
  /** How long Publish now waits for Buffer to send the post (default 6 s; tests 0). */
  inlineWaitMs?: number
}

export type PlatformConfig = LinkedInAppConfig | BufferConfig

/** The config of each platform publishing is set up for. */
export type PublishConfigs = {
  linkedin?: LinkedInAppConfig
  x?: BufferConfig
  threads?: BufferConfig
  facebook?: BufferConfig
  instagram?: BufferConfig
}

/** What a provider call runs with: the user's decrypted credential and the platform's config. */
export type ProviderContext<C extends BaseConfig = PlatformConfig> = {
  accessToken: string
  config: C
  fetchFn?: FetchFn
}

/**
 * What a connection is saved with: OAuth tokens, or an API key (which does
 * not run out, so it has no expiry and no refresh token).
 */
export type Credentials = Omit<TokenSet, 'accessTokenExpiresAt'> & {
  accessTokenExpiresAt: Date | null
}

/** The account a connection publishes as. */
export type AccountInfo = MemberInfo

/**
 * A platform's OAuth flow, for the connect and callback routes
 * (/api/integrations/{platform}/connect, /callback).
 */
export type OAuthFlow<C extends BaseConfig> = {
  /** The consent screen, with the state and the PKCE verifier's challenge. */
  authorizationUrl: (config: C, state: string, codeVerifier: string) => string
  exchangeCode: (
    config: C,
    code: string,
    codeVerifier: string,
    fetchFn?: FetchFn
  ) => Promise<TokenSet>
  /** The account to publish as; null when there is none (no X channel in Buffer). */
  account: (
    config: C,
    accessToken: string,
    fetchFn?: FetchFn
  ) => Promise<AccountInfo | null>
  /** The provider's `error` on the callback, as an outcome. */
  callbackErrorResult: (error: string) => CallbackResult
  /** The redirect URI registered with the provider. */
  redirectUri: (config: C) => string
}

export type PostImage = {
  bytes: Buffer
  mediaType: string
  altText: string | null
}

/** One drawn slide of a carousel post, in swipe order. */
export type PostSlideImage = PostImage & { id: string }

export type CreatedPost = {
  /** The platform's id for the post (for X, Buffer's). */
  postId: string
  /** Its link, when the platform gives one; otherwise postUrl(postId). */
  url: string | null
  /**
   * Handed on but not out yet (Buffer sends it to X after answering):
   * checkPost follows it until it is published or failed.
   */
  pending: boolean
  publishedAt: Date | null
}

export type PostCheck = {
  state: 'published' | 'pending' | 'failed'
  url: string | null
  publishedAt: Date | null
  /** Why it failed, for the user. */
  error: string | null
}

export type PublishingProvider<C extends BaseConfig = PlatformConfig> = {
  platform: PlatformSpec
  /**
   * How a user connects it in Settings → Integrations with this config: a
   * consent screen (`oauth`, through /api/integrations/{platform}/connect),
   * or a key pasted there.
   */
  connectWith: (config: C) => 'oauth' | 'api_key'
  /** The OAuth flow, when the platform has one. */
  oauth?: OAuthFlow<C>
  /** The service posts go through, when not the platform's own API ("Buffer"). */
  via?: string
  /** The scope a grant needs to publish; null when there are no scopes. */
  publishScope: string | null
  /** The formats (src/lib/formats) it can publish: PUBLISHABLE_FORMATS. */
  formats: FormatId[]
  /**
   * Publishes a thread in one request: createPost takes the posts after the
   * first, and the first comment, as `replies`, each a reply to the one
   * before (X through Buffer). Without it, the comment goes through addComment.
   */
  threads?: boolean
  /**
   * The first comment goes out with the post itself: createPost takes it as
   * `comment` (Facebook through Buffer), instead of through addComment.
   */
  commentInPost?: boolean
  /** The platform refuses a post without an image (Instagram). */
  requiresImage?: boolean
  /**
   * How it publishes a carousel, when it does: one PDF document shown page
   * by page (LinkedIn), or several images in one post (Instagram, Facebook
   * through Buffer), at most `maxSlides`.
   */
  carousel?: { delivery: 'document' | 'images'; maxSlides: number }
  /**
   * Readies a carousel's slides and returns what createPost attaches as
   * `carousel.refs`: the uploaded document's URN, or one link per slide.
   * Publishes nothing, so a failure here is safe to retry.
   */
  prepareCarousel?: (
    ctx: ProviderContext<C>,
    input: {
      authorId: string
      draftId: string
      slides: PostSlideImage[]
      /** The carousel's title: a document post shows it (its cover's headline). */
      title: string
      now: Date
    }
  ) => Promise<string[]>
  /** The longest post the platform takes, as `measure` counts. */
  maxPostLength: number
  measure: (text: string) => number
  /** The post's text in the API's format. */
  toApiText: (text: string) => string
  /** The id posts go out as, from the connection's account id. */
  authorIdOf: (accountId: string) => string
  /**
   * Readies the post's image and returns what createPost attaches. Publishes
   * nothing, so a failure here is safe to retry.
   */
  prepareImage: (
    ctx: ProviderContext<C>,
    input: { authorId: string; draftId: string; image: PostImage; now: Date }
  ) => Promise<string>
  /** Creates the post. Not idempotent: see the engine on what a failure means. */
  createPost: (
    ctx: ProviderContext<C>,
    post: {
      authorId: string
      text: string
      /** Only for a provider with `threads`; the image goes on the first post. */
      replies?: string[]
      /** Only for a provider with `commentInPost`. */
      comment?: string
      image?: { ref: string; altText: string | null }
      /** Only for a provider with `carousel`: what prepareCarousel returned. */
      carousel?: { refs: string[]; title: string; altTexts: Array<string | null> }
    }
  ) => Promise<CreatedPost>
  /** Where a `pending` post stands; only for providers that return one. */
  checkPost?: (ctx: ProviderContext<C>, postId: string) => Promise<PostCheck>
  /** Adds the first comment; absent when the platform's posts carry none. */
  addComment?: (
    ctx: ProviderContext<C>,
    postId: string,
    authorId: string,
    text: string
  ) => Promise<string | null>
  /** Deletes a published post; absent when the API cannot. */
  deletePost?: (ctx: ProviderContext<C>, postId: string) => Promise<void>
  /** Where a post can be opened, from its id; null when the id is not enough. */
  postUrl: (postId: string) => string | null
  /** Renews an access token (OAuth providers whose app was granted refresh). */
  refreshAccessToken?: (
    config: C,
    refreshToken: string,
    fetchFn?: FetchFn,
    now?: number
  ) => Promise<TokenSet>
}

const PROVIDERS: Record<PublishingPlatformId, PublishingProvider<any>> = {
  linkedin: linkedInProvider,
  x: bufferXProvider,
  threads: bufferThreadsProvider,
  facebook: bufferFacebookProvider,
  instagram: bufferInstagramProvider
}

/** The provider for `platform`; throws for one that has none. */
export function providerFor(platform: string): PublishingProvider<any> {
  if (!canPublishTo(platform)) {
    throw new Error(`No publishing provider for platform "${platform}".`)
  }
  return PROVIDERS[platform]
}

export {
  type LinkedInAppConfig as PublishingAppConfig,
  parseScopes,
  type TokenSet
} from './linkedin/oauth'
export { PlatformApiError, PlatformOAuthError, PostImageError } from './errors'
