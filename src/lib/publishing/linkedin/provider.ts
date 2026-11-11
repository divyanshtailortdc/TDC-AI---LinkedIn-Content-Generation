import { PLATFORMS } from '@/lib/platforms'
import type { ProviderContext, PublishingProvider } from '../provider'
import { PUBLISHABLE_FORMATS } from '../platform'
import {
  addComment,
  type ApiContext,
  createPost,
  deletePost,
  postUrl,
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
  // An article-link post goes out as LinkedIn's article card.
  linkCards: true,
  maxPostLength: COMMENTARY_MAX_LENGTH,
  measure: visibleLength,
  toApiText: toLittleText,
  authorIdOf: personUrn,
  prepareImage: (ctx, { authorId, image }) =>
    uploadImage(api(ctx), authorId, image),
  createPost: async (ctx, post) => ({
    postId: await createPost(api(ctx), {
      authorUrn: post.authorId,
      commentary: post.text,
      ...(post.link
        ? {
            article: {
              source: post.link.source,
              title: post.link.title,
              description: post.link.description,
              thumbnailUrn: post.link.thumbnailRef
            }
          }
        : {
            image: post.image
              ? { urn: post.image.ref, altText: post.image.altText }
              : undefined
          })
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
