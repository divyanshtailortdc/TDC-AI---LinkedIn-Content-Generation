import { PLATFORMS } from '@/lib/platforms'
import type { ProviderContext, PublishingProvider } from '../provider'
import { PUBLISHABLE_FORMATS } from '../platform'
import {
  addComment,
  type ApiContext,
  createPost,
  deletePost,
  postUrl,
  uploadDocument,
  uploadImage
} from './api'
import {
  COMMENTARY_MAX_LENGTH,
  toLittleText,
  visibleLength
} from './commentary'
import {
  buildAuthorizationUrl,
  callbackErrorResult,
  exchangeCode,
  fetchMemberInfo,
  type LinkedInAppConfig,
  personUrn,
  PUBLISH_SCOPE,
  refreshAccessToken
} from './oauth'

/**
 * LinkedIn as a publishing provider: the functions in ./api, ./commentary and
 * ./oauth, unchanged, under the shape every provider has (../provider.ts).
 */

const api = (ctx: ProviderContext<LinkedInAppConfig>): ApiContext => ({
  accessToken: ctx.accessToken,
  apiVersion: ctx.config.apiVersion,
  fetchFn: ctx.fetchFn
})

export const linkedInProvider: PublishingProvider<LinkedInAppConfig> = {
  platform: PLATFORMS.linkedin,
  connectWith: () => 'oauth',
  // LinkedIn's consent screen; it takes no PKCE from a server app.
  oauth: {
    authorizationUrl: (config, state) => buildAuthorizationUrl(config, state),
    exchangeCode: (config, code, _verifier, fetchFn) =>
      exchangeCode(config, code, fetchFn),
    account: (_config, accessToken, fetchFn) =>
      fetchMemberInfo(accessToken, fetchFn),
    callbackErrorResult,
    redirectUri: config => config.redirectUri
  },
  publishScope: PUBLISH_SCOPE,
  formats: PUBLISHABLE_FORMATS.linkedin,
  maxPostLength: COMMENTARY_MAX_LENGTH,
  measure: visibleLength,
  toApiText: toLittleText,
  authorIdOf: personUrn,
  prepareImage: (ctx, { authorId, image }) =>
    uploadImage(api(ctx), authorId, image),
  // A carousel is a document post: the slides as one PDF, a page each,
  // which LinkedIn shows page by page in the feed.
  carousel: { delivery: 'document', maxSlides: 20 },
  prepareCarousel: async (ctx, { authorId, slides, title }) => {
    const { slidesToPdf } = await import('@/lib/media/carousel/export')
    const pdf = await slidesToPdf(
      slides.map(s => ({ bytes: s.bytes, mediaType: s.mediaType })),
      title
    )
    return [await uploadDocument(api(ctx), authorId, pdf)]
  },
  createPost: async (ctx, post) => ({
    postId: await createPost(api(ctx), {
      authorUrn: post.authorId,
      commentary: post.text,
      image: post.image
        ? { urn: post.image.ref, altText: post.image.altText }
        : undefined,
      document: post.carousel?.refs[0]
        ? { urn: post.carousel.refs[0], title: post.carousel.title }
        : undefined
    }),
    url: null,
    pending: false,
    publishedAt: null
  }),
  addComment: (ctx, postId, authorId, text) =>
    addComment(api(ctx), postId, authorId, text),
  deletePost: (ctx, postId) => deletePost(api(ctx), postId),
  postUrl,
  refreshAccessToken
}
