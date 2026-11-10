/**
 * The publishing provider for PUBLISHING_PLATFORM (./platform): its API
 * client, its OAuth flow and its text format, under platform-neutral names.
 * The engine, connections, routes and settings import these from here and
 * never from a provider's own module, so supporting another platform changes
 * this file (and, with more than one, a lookup by platform) rather than them.
 *
 * No `server-only` import, so tests can run what uses it.
 */

export {
  addComment,
  type ApiContext,
  type ArticleLink,
  createPost,
  deletePost,
  LinkedInApiError as PlatformApiError,
  PostImageError,
  postUrl,
  uploadImage
} from './linkedin/api'
export {
  COMMENTARY_MAX_LENGTH as MAX_POST_LENGTH,
  toLittleText as toApiText,
  visibleLength
} from './linkedin/commentary'
export {
  buildAuthorizationUrl,
  CALLBACK_RESULTS,
  callbackErrorResult,
  type CallbackResult,
  createOAuthState,
  exchangeCode,
  type FetchFn,
  fetchMemberInfo as fetchAccountInfo,
  type LinkedInAppConfig as PublishingAppConfig,
  LinkedInOAuthError as PlatformOAuthError,
  type MemberInfo as AccountInfo,
  parseScopes,
  personUrn as authorIdOf,
  PUBLISH_SCOPE,
  refreshAccessToken,
  STATE_TTL_MS,
  type TokenSet,
  verifyOAuthState
} from './linkedin/oauth'
