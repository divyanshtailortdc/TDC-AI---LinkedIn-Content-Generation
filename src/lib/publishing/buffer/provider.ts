import { countChars, FORMATS, type FormatId } from '@/lib/formats'
import { PLATFORMS, type PlatformSpec } from '@/lib/platforms'
import { PlatformApiError, PostImageError } from '../errors'
import {
  createMediaToken,
  isPrivateOrigin,
  type MediaVariant,
  mediaUrl,
  slideSubject
} from '../media-token'
import { type BufferPlatformId, PUBLISHABLE_FORMATS } from '../platform'
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
  listChannels,
  X_SERVICES
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
 * X, Threads, Facebook and Instagram as publishing providers, through Buffer (./api),
 * one provider per network from the same code. Each customer authorizes
 * their own Buffer account through Buffer's consent screen (the app client,
 * ./oauth), once per network, or, without one set up, pastes a Buffer API
 * key (testing). The connection's account id is the Buffer channel of their
 * account on that network; the app holds no X or Meta token.
 *
 *   x          An X thread, and the reply under a post, go out as one Buffer
 *              post whose thread holds every post in order.
 *   threads    A Threads post; its reply goes out with it the same way.
 *   facebook   A Facebook Page post; its first comment goes out with it.
 *   instagram  A feed post: the caption with its image, which Instagram
 *              requires (sent as a JPEG within Instagram's aspect ratios).
 *
 * Buffer answers createPost before the network has the post, so a post comes
 * back `pending` unless it is sent within the short wait below; the engine
 * then keeps it 'publishing' and follows it with checkPost until Buffer says
 * sent (with the post's link) or error.
 */

const MB = 1024 * 1024

/** What differs between the networks Buffer publishes to. */
type BufferNetwork = {
  platform: PlatformSpec
  /** Buffer's `service` names for this network's channels. */
  services: ReadonlySet<string>
  formats: FormatId[]
  maxPostLength: number
  measure: (text: string) => number
  /**
   * The largest image the network takes, checked before Buffer is called;
   * null when the link re-encodes it smaller anyway (Instagram).
   */
  maxImageBytes: number | null
  /** How the signed link serves the image (../media-token). */
  imageVariant?: MediaVariant
  threads?: boolean
  /** The network's key for a thread in Buffer's metadata (createPost). */
  threadKey?: 'twitter' | 'threads'
  commentInPost?: boolean
  requiresImage?: boolean
  /** The network's own createPost metadata. */
  metadata?: (post: { comment?: string }) => Record<string, unknown>
  /** Most images in one post, when the network takes a carousel. */
  maxCarouselImages?: number
}

const NETWORKS = {
  x: {
    platform: PLATFORMS.x,
    services: X_SERVICES,
    formats: PUBLISHABLE_FORMATS.x,
    // A thread, and the reply under a post, go out in one Buffer post.
    threads: true,
    threadKey: 'twitter',
    // A free X account's limit, as X counts it (a link 23, an emoji 2).
    maxPostLength: FORMATS['x.post'].limits.maxChars,
    measure: text => countChars(text, 'x_weighted'),
    maxImageBytes: 5 * MB
  },
  threads: {
    platform: PLATFORMS.threads,
    services: new Set(['threads']),
    formats: PUBLISHABLE_FORMATS.threads,
    // The reply under a post goes out with it, as a thread of two.
    threads: true,
    threadKey: 'threads',
    // Threads' limit, counted in UTF-16 units as Buffer does (an emoji 2).
    maxPostLength: FORMATS['threads.post'].limits.maxChars,
    measure: text => countChars(text, 'utf16'),
    maxImageBytes: 8 * MB,
    // Threads takes JPEG and PNG: a WebP goes as JPEG, as for Facebook.
    imageVariant: 'facebook'
  },
  facebook: {
    platform: PLATFORMS.facebook,
    services: new Set(['facebook']),
    formats: PUBLISHABLE_FORMATS.facebook,
    // Facebook's own limit; drafting aims far shorter (FORMATS).
    maxPostLength: 63_206,
    measure: text => countChars(text, 'utf16'),
    maxImageBytes: 10 * MB,
    imageVariant: 'facebook',
    commentInPost: true,
    // Several photos in one post, which Facebook shows as a grid.
    maxCarouselImages: FORMATS['facebook.post'].media.carousel!.maxSlides,
    metadata: ({ comment }) => ({
      facebook: { type: 'post', ...(comment && { firstComment: comment }) }
    })
  },
  instagram: {
    platform: PLATFORMS.instagram,
    services: new Set(['instagram']),
    formats: PUBLISHABLE_FORMATS.instagram,
    maxPostLength: FORMATS['instagram.caption'].limits.maxChars,
    measure: text => countChars(text, 'utf16'),
    maxImageBytes: null,
    imageVariant: 'instagram',
    requiresImage: true,
    // A carousel post: every slide in one post, swiped through.
    maxCarouselImages: FORMATS['instagram.caption'].media.carousel!.maxSlides,
    // A feed post, not a story or Reel. The caption's comment field is a
    // link-in-bio note for the author: never posted.
    metadata: () => ({ instagram: { type: 'post', shouldShareToFeed: true } })
  }
} satisfies Record<BufferPlatformId, BufferNetwork>

/** The channels of `platform` that the Buffer account behind `ctx` can post to. */
export const listPlatformChannels = (
  ctx: Omit<BufferContext, 'platformName'>,
  platform: BufferPlatformId
) =>
  listChannels(
    { ...ctx, platformName: NETWORKS[platform].platform.name },
    NETWORKS[platform].services
  )


/** How long Publish now waits for Buffer to send the post, looking every 2 s. */
const INLINE_WAIT_MS = 6000
const INLINE_CHECK_DELAY_MS = 2000

const contextOf = (
  ctx: ProviderContext<BufferConfig>,
  network: BufferNetwork
): BufferContext => ({
  apiKey: ctx.accessToken,
  apiUrl: ctx.config.apiUrl,
  fetchFn: ctx.fetchFn,
  platformName: network.platform.name
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

function bufferProvider(
  network: BufferNetwork
): PublishingProvider<BufferConfig> {
  const name = network.platform.name
  // Buffer would only answer "Image could not be read from its URL".
  const assertReachable = (ctx: ProviderContext<BufferConfig>) => {
    if (isPrivateOrigin(ctx.config.appUrl)) {
      throw new PostImageError(
        `Buffer cannot download this post's images from ${new URL(ctx.config.appUrl).origin}, which only this computer can reach. Set PUBLISHING_MEDIA_URL to a public address of the app (in local development, a tunnel), then try again.`
      )
    }
  }
  const buffer = (ctx: ProviderContext<BufferConfig>) =>
    contextOf(ctx, network)
  return {
    platform: network.platform,
    connectWith: config => (config.oauth ? 'oauth' : 'api_key'),
    via: 'Buffer',
    oauth: {
      authorizationUrl: (config, state, verifier) =>
        buildAuthorizationUrl(config.oauth!, state, verifier),
      exchangeCode: (config, code, verifier, fetchFn) =>
        exchangeCode(config.oauth!, code, verifier, fetchFn),
      // The first of the network's channels the account can post to; Settings
      // can switch it.
      account: async (config, accessToken, fetchFn) => {
        const channels = await listChannels(
          { apiKey: accessToken, apiUrl: config.apiUrl, fetchFn, platformName: name },
          network.services
        )
        const channel = channels.find(c => !c.isLocked)
        return channel
          ? { memberId: channel.id, name: channel.name, pictureUrl: channel.avatar }
          : null
      },
      callbackErrorResult,
      redirectUri: config => config.oauth?.redirectUri ?? ''
    },
    publishScope: BUFFER_PUBLISH_SCOPE,
    formats: network.formats,
    threads: network.threads,
    commentInPost: network.commentInPost,
    requiresImage: network.requiresImage,
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
    maxPostLength: network.maxPostLength,
    measure: network.measure,
    // Plain text: Buffer and the networks need no escaping.
    toApiText: text => text,
    // Posts are created on the Buffer channel.
    authorIdOf: channelId => channelId,

    // Buffer fetches the image itself, from a signed link to this app that
    // serves this post's image for a day (src/app/api/publishing-media).
    prepareImage: async (ctx, { draftId, image, now }) => {
      assertReachable(ctx)
      const max = network.maxImageBytes
      if (max !== null && image.bytes.length > max) {
        throw new PostImageError(
          `The post's image is larger than the ${max / MB} MB ${name} allows. Replace it with a smaller one.`
        )
      }
      return mediaUrl(
        ctx.config.appUrl,
        createMediaToken(ctx.config.encryptionKey, draftId, now.getTime()),
        network.imageVariant
      )
    },

    // A carousel: one signed link per slide, in order; Buffer fetches each.
    ...(network.maxCarouselImages
      ? {
          carousel: { delivery: 'images' as const, maxSlides: network.maxCarouselImages },
          prepareCarousel: async (ctx, { draftId, slides, now }) => {
            assertReachable(ctx)
            const max = network.maxImageBytes
            const big = slides.findIndex(s => max !== null && s.bytes.length > max)
            if (big !== -1) {
              throw new PostImageError(
                `Slide ${big + 1} is larger than the ${max! / MB} MB ${name} allows.`
              )
            }
            return slides.map(slide =>
              mediaUrl(
                ctx.config.appUrl,
                createMediaToken(
                  ctx.config.encryptionKey,
                  slideSubject(draftId, slide.id),
                  now.getTime()
                ),
                network.imageVariant
              )
            )
          }
        } satisfies Partial<PublishingProvider<BufferConfig>>
      : {}),

    createPost: async (ctx, post): Promise<CreatedPost> => {
      let state = await createPost(buffer(ctx), {
        channelId: post.authorId,
        text: post.text,
        replies: post.replies,
        threadKey: network.threadKey,
        image: post.image && { url: post.image.ref, altText: post.image.altText },
        images: post.carousel?.refs.map((url, i) => ({
          url,
          altText: post.carousel?.altTexts[i] ?? null
        })),
        metadata: network.metadata?.({ comment: post.comment })
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
        // Buffer gave up: the network did not publish it, so it is no unknown outcome.
        throw new PlatformApiError(
          state.error ?? `${name} did not take the post.`,
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
}

export const bufferXProvider = bufferProvider(NETWORKS.x)
export const bufferThreadsProvider = bufferProvider(NETWORKS.threads)
export const bufferFacebookProvider = bufferProvider(NETWORKS.facebook)
export const bufferInstagramProvider = bufferProvider(NETWORKS.instagram)
