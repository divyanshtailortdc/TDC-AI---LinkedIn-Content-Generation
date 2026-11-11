import { countChars, FORMATS } from '@/lib/formats'
import { PLATFORMS } from '@/lib/platforms'
import { PlatformApiError, PostImageError } from '../errors'
import { createMediaToken, mediaUrl } from '../media-token'
import { PUBLISHABLE_FORMATS } from '../platform'
import type {
  BufferConfig,
  CreatedPost,
  PostCheck,
  ProviderContext,
  PublishingProvider
} from '../provider'
import {
  type BufferContext,
  type BufferPostState,
  createPost,
  getPost,
  listXChannels
} from './api'
import {
  BUFFER_PUBLISH_SCOPE,
  buildAuthorizationUrl,
  BufferOAuthError,
  callbackErrorResult,
  exchangeCode,
  refreshAccessToken
} from './oauth'

/**
 * X as a publishing provider, through Buffer (./api). Each customer
 * authorizes their own Buffer account through Buffer's consent screen (the
 * app client, ./oauth), or, without one set up, pastes a Buffer API key
 * (testing). The connection's account id is the Buffer channel of their X
 * account; the app holds no X token.
 *
 * A thread, and the reply under a post, go out as one Buffer post whose
 * thread holds every post in order (./api createPost).
 *
 * Buffer answers createPost before X has the post, so a post comes back
 * `pending` unless it is sent within the short wait below; the engine then
 * keeps it 'publishing' and follows it with checkPost until Buffer says sent
 * (with the post's X link) or error.
 */

/** X takes images up to 5 MB. */
const X_MAX_IMAGE_BYTES = 5 * 1024 * 1024


/** How long Publish now waits for Buffer to send the post, looking every 2 s. */
const INLINE_WAIT_MS = 6000
const INLINE_CHECK_DELAY_MS = 2000

const buffer = (ctx: ProviderContext<BufferConfig>): BufferContext => ({
  apiKey: ctx.accessToken,
  apiUrl: ctx.config.apiUrl,
  fetchFn: ctx.fetchFn
})

const toCheck = (post: BufferPostState): PostCheck => ({
  state:
    post.state === 'sent'
      ? 'published'
      : post.state === 'error'
        ? 'failed'
        : 'pending',
  url: post.url,
  publishedAt: post.sentAt,
  error: post.error
})

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const bufferXProvider: PublishingProvider<BufferConfig> = {
  platform: PLATFORMS.x,
  connectWith: config => (config.oauth ? 'oauth' : 'api_key'),
  via: 'Buffer',
  oauth: {
    authorizationUrl: (config, state, verifier) =>
      buildAuthorizationUrl(config.oauth!, state, verifier),
    exchangeCode: (config, code, verifier, fetchFn) =>
      exchangeCode(config.oauth!, code, verifier, fetchFn),
    // The first X channel the account can post to; Settings can switch it.
    account: async (config, accessToken, fetchFn) => {
      const channels = await listXChannels({
        apiKey: accessToken,
        apiUrl: config.apiUrl,
        fetchFn
      })
      const channel = channels.find(c => !c.isLocked)
      return channel
        ? { memberId: channel.id, name: channel.name, pictureUrl: channel.avatar }
        : null
    },
    callbackErrorResult,
    redirectUri: config => config.oauth?.redirectUri ?? ''
  },
  publishScope: BUFFER_PUBLISH_SCOPE,
  formats: PUBLISHABLE_FORMATS.x,
  // A thread, and the reply under a post, go out in one Buffer post.
  threads: true,
  // Single-use refresh tokens: connection.ts refreshes under a row lock.
  refreshAccessToken: (config, refreshToken, fetchFn, now) => {
    if (!config.oauth) {
      // The app client was removed from the server: connect again.
      return Promise.reject(
        new BufferOAuthError('Buffer is no longer set up for this app.', 401)
      )
    }
    return refreshAccessToken(config.oauth, refreshToken, fetchFn, now)
  },
  // A free X account's limit, as X counts it (a link 23, an emoji 2).
  maxPostLength: FORMATS['x.post'].limits.maxChars,
  measure: text => countChars(text, 'x_weighted'),
  // Plain text: Buffer and X need no escaping.
  toApiText: text => text,
  // Posts are created on the Buffer channel.
  authorIdOf: channelId => channelId,

  // Buffer fetches the image itself, from a signed link to this app that
  // serves this post's image for a day (src/app/api/publishing-media).
  prepareImage: async (ctx, { draftId, image, now }) => {
    if (image.bytes.length > X_MAX_IMAGE_BYTES) {
      throw new PostImageError(
        "The post's image is larger than the 5 MB X allows. Replace it with a smaller one."
      )
    }
    return mediaUrl(
      ctx.config.appUrl,
      createMediaToken(ctx.config.encryptionKey, draftId, now.getTime())
    )
  },

  createPost: async (ctx, post): Promise<CreatedPost> => {
    let state = await createPost(buffer(ctx), {
      channelId: post.authorId,
      text: post.text,
      replies: post.replies,
      image: post.image && { url: post.image.ref, altText: post.image.altText }
    })
    // Usually sent within seconds: wait a little so Publish now can say so.
    // A failed look changes nothing; the engine follows a pending post.
    const checks = Math.floor(
      (ctx.config.inlineWaitMs ?? INLINE_WAIT_MS) / INLINE_CHECK_DELAY_MS
    )
    for (let i = 0; i < checks && state.state === 'pending'; i++) {
      await sleep(INLINE_CHECK_DELAY_MS)
      state = await getPost(buffer(ctx), state.id).catch(() => state)
    }
    if (state.state === 'error') {
      // Buffer gave up: X did not publish it, so it is no unknown outcome.
      throw new PlatformApiError(
        state.error ?? 'X did not take the post.',
        'rejected_by_platform'
      )
    }
    return {
      postId: state.id,
      url: state.url,
      pending: state.state === 'pending',
      publishedAt: state.sentAt
    }
  },

  checkPost: async (ctx, postId) => toCheck(await getPost(buffer(ctx), postId)),

  // Buffer's link to the post comes with it once sent; an id alone is not one.
  postUrl: () => null
}
