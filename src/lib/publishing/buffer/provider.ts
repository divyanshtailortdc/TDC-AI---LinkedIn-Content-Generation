import { countChars, FORMATS, type FormatId } from '@/lib/formats'
import { PLATFORMS, type PlatformSpec } from '@/lib/platforms'
import { PlatformApiError, PostImageError } from '../errors'
import {
  createMediaToken,
  isPrivateOrigin,
  type MediaVariant,
  mediaUrl,
  slideSubject,
  videoMediaUrl,
  videoSubject
} from '../media-token'
import {
  BUFFER_SERVICES,
  type BufferPlatformId,
  PUBLISHABLE_FORMATS
} from '../platform'
import type {
  BufferConfig,
  CreatedPost,
  PostCheck,
  PostVideo,
  ProviderContext,
  PublishingProvider
} from '../provider'
import {
  type BufferContext,
  type BufferPostState,
  createPost,
  getPost
} from './api'
import {
  BUFFER_PUBLISH_SCOPE,
  BufferOAuthError,
  refreshAccessToken
} from './oauth'

/**
 * X, Threads, Facebook and Instagram as publishing providers, through Buffer (./api),
 * one provider per network from the same code. Each user authorizes their
 * own Buffer account once, through Buffer's consent screen (./oauth,
 * /api/integrations/buffer), and picks the channel each network publishes to
 * (./connection). The connection's account id is that Buffer channel; the
 * app holds no X or Meta token. Connections made before that hold their own
 * Buffer token or pasted API key, and keep publishing with it.
 *
 *   x          An X thread, and the reply under a post, go out as one Buffer
 *              post whose thread holds every post in order.
 *   threads    A Threads post; its reply goes out with it the same way.
 *   facebook   A Facebook Page post; its first comment goes out with it.
 *   instagram  A feed post: the caption with its image, which Instagram
 *              requires (sent as a JPEG within Instagram's aspect ratios);
 *              or a Reel: the caption with its video.
 *   facebook   …and a Facebook Reel the same way.
 *   youtube    A Short: the video with its title and description.
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
  /** Publishes video posts (Reels, Shorts), at most this large. */
  video?: { maxBytes: number }
  /** The network's own createPost metadata; `video` for a Reel or a Short. */
  metadata?: (post: { comment?: string; video?: PostVideo }) => Record<string, unknown>
  /** Most images in one post, when the network takes a carousel. */
  maxCarouselImages?: number
  /** A post's link from its id, for posts published before Buffer gave links. */
  postUrl?: (postId: string) => string | null
}

const NETWORKS = {
  linkedin: {
    platform: PLATFORMS.linkedin,
    services: new Set(BUFFER_SERVICES.linkedin),
    formats: PUBLISHABLE_FORMATS.linkedin,
    // LinkedIn's limit, in UTF-16 units as the format counts it.
    maxPostLength: FORMATS['linkedin.post'].limits.maxChars,
    measure: text => countChars(text, 'utf16'),
    // Buffer's limit for an image on LinkedIn.
    maxImageBytes: 10 * MB,
    // JPEG and PNG as they are; a WebP goes as JPEG, as for Facebook.
    imageVariant: 'facebook',
    // No first comment: Buffer refuses metadata.linkedin.firstComment
    // without a paid plan ("LinkedIn first comment requires a paid plan"),
    // and the user chose to publish without one. The post's first comment
    // stays in the app, to add by hand.
    // Several images in one post (Buffer and LinkedIn take up to 20).
    maxCarouselImages: FORMATS['linkedin.post'].media.carousel!.maxSlides,
    // A video the user uploaded (Create from media). Buffer's limit for
    // LinkedIn is larger; uploads are capped well below it.
    video: { maxBytes: 1024 * MB },
    // Posts published straight to LinkedIn before Buffer have a post URN.
    postUrl: id =>
      id.startsWith('urn:li:')
        ? `https://www.linkedin.com/feed/update/${id}/`
        : null
  },
  x: {
    platform: PLATFORMS.x,
    services: new Set(BUFFER_SERVICES.x),
    formats: PUBLISHABLE_FORMATS.x,
    // A thread, and the reply under a post, go out in one Buffer post.
    threads: true,
    threadKey: 'twitter',
    // A free X account's limit, as X counts it (a link 23, an emoji 2).
    maxPostLength: FORMATS['x.post'].limits.maxChars,
    measure: text => countChars(text, 'x_weighted'),
    maxImageBytes: 5 * MB,
    // A video the user uploaded (Create from media): X takes up to 512 MB.
    video: { maxBytes: 512 * MB }
  },
  threads: {
    platform: PLATFORMS.threads,
    services: new Set(BUFFER_SERVICES.threads),
    formats: PUBLISHABLE_FORMATS.threads,
    // The reply under a post goes out with it, as a thread of two.
    threads: true,
    threadKey: 'threads',
    // Threads' limit, counted in UTF-16 units as Buffer does (an emoji 2).
    maxPostLength: FORMATS['threads.post'].limits.maxChars,
    measure: text => countChars(text, 'utf16'),
    maxImageBytes: 8 * MB,
    // Threads takes JPEG and PNG: a WebP goes as JPEG, as for Facebook.
    imageVariant: 'facebook',
    // A video the user uploaded (Create from media): Threads takes up to 1 GB.
    video: { maxBytes: 1024 * MB }
  },
  facebook: {
    platform: PLATFORMS.facebook,
    services: new Set(BUFFER_SERVICES.facebook),
    formats: PUBLISHABLE_FORMATS.facebook,
    // Facebook's own limit; drafting aims far shorter (FORMATS).
    maxPostLength: 63_206,
    measure: text => countChars(text, 'utf16'),
    maxImageBytes: 10 * MB,
    imageVariant: 'facebook',
    commentInPost: true,
    // Several photos in one post, which Facebook shows as a grid.
    maxCarouselImages: FORMATS['facebook.post'].media.carousel!.maxSlides,
    // A Reel: the caption with its video.
    video: { maxBytes: 1024 * MB },
    metadata: ({ comment, video }) => ({
      facebook: {
        type: video ? 'reel' : 'post',
        ...(comment && { firstComment: comment })
      }
    })
  },
  instagram: {
    platform: PLATFORMS.instagram,
    services: new Set(BUFFER_SERVICES.instagram),
    formats: PUBLISHABLE_FORMATS.instagram,
    maxPostLength: FORMATS['instagram.caption'].limits.maxChars,
    measure: text => countChars(text, 'utf16'),
    maxImageBytes: null,
    imageVariant: 'instagram',
    requiresImage: true,
    // A carousel post: every slide in one post, swiped through.
    maxCarouselImages: FORMATS['instagram.caption'].media.carousel!.maxSlides,
    // A Reel: the caption with its video (the Graph API takes up to 300 MB).
    video: { maxBytes: 300 * MB },
    // A feed post, or a Reel shared to the feed too. The caption's comment
    // field is a link-in-bio note for the author: never posted. A Reel the
    // app recorded is marked AI-generated, as when Reels were AI clips
    // (docs/SHORT_VIDEOS.md); one the user uploaded is not.
    metadata: ({ video }) => ({
      instagram: video
        ? {
            type: 'reel',
            shouldShareToFeed: true,
            isAiGenerated: video.aiGenerated !== false
          }
        : { type: 'post', shouldShareToFeed: true }
    })
  },
  youtube: {
    platform: PLATFORMS.youtube,
    services: new Set(BUFFER_SERVICES.youtube),
    formats: PUBLISHABLE_FORMATS.youtube,
    // The description's limit.
    maxPostLength: FORMATS['youtube.short'].limits.maxChars,
    measure: text => countChars(text, 'utf16'),
    maxImageBytes: null,
    video: { maxBytes: 1024 * MB },
    // A Short needs a title and a category: People & Blogs (22) suits a
    // brand's short. Not for children, and disclosed as AI-made unless the
    // user uploaded it.
    metadata: ({ video }) => ({
      youtube: {
        title: (video?.title || 'Short').slice(0, 100),
        categoryId: '22',
        madeForKids: false,
        isAiGenerated: video?.aiGenerated !== false
      }
    })
  }
} satisfies Record<BufferPlatformId, BufferNetwork>

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
        `Buffer cannot download this post's images or video from ${new URL(ctx.config.appUrl).origin}, which only this computer can reach. Set PUBLISHING_MEDIA_URL to a public address of the app (in local development, a tunnel), then try again.`
      )
    }
  }
  const buffer = (ctx: ProviderContext<BufferConfig>) =>
    contextOf(ctx, network)
  return {
    platform: network.platform,
    via: 'Buffer',
    publishScope: BUFFER_PUBLISH_SCOPE,
    formats: network.formats,
    threads: network.threads,
    commentInPost: network.commentInPost,
    requiresImage: network.requiresImage,
    video: network.video,
    // For connections that hold their own Buffer token (made before Buffer
    // had one connection per user). Single-use refresh tokens: connection.ts
    // refreshes under a row lock.
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
      // Buffer downloads the video from a signed link to this app (which
      // answers HEAD, unlike the bucket's own GET-only signed link).
      let videoUrl: string | null = null
      if (post.video) {
        assertReachable(ctx)
        const max = network.video?.maxBytes
        if (!max) {
          throw new PostImageError(`${name} video posts cannot be published from here.`)
        }
        if (post.video.byteSize !== null && post.video.byteSize > max) {
          throw new PostImageError(
            `The video is larger than the ${max / MB} MB ${name} allows.`
          )
        }
        videoUrl = videoMediaUrl(
          ctx.config.appUrl,
          createMediaToken(ctx.config.encryptionKey, videoSubject(post.video.id))
        )
      }
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
        video: videoUrl ? { url: videoUrl, title: post.video?.title } : undefined,
        metadata: network.metadata?.({ comment: post.comment, video: post.video })
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
    postUrl: network.postUrl ?? (() => null)
  }
}

export const bufferLinkedInProvider = bufferProvider(NETWORKS.linkedin)
export const bufferXProvider = bufferProvider(NETWORKS.x)
export const bufferThreadsProvider = bufferProvider(NETWORKS.threads)
export const bufferFacebookProvider = bufferProvider(NETWORKS.facebook)
export const bufferInstagramProvider = bufferProvider(NETWORKS.instagram)
export const bufferYouTubeProvider = bufferProvider(NETWORKS.youtube)
