import type { FetchFn } from './oauth'
import type { PublicationErrorCode } from './status'

/**
 * The LinkedIn REST calls publishing makes: upload an image, create the post,
 * add the first comment. Each failure says whether it is safe to try again.
 *
 * Creating a post is not idempotent, and member tokens cannot read posts back
 * (r_member_social is restricted), so a request that may have reached
 * LinkedIn can never be checked. Those failures are `unknown_outcome` and are
 * never retried by themselves. Only failures where LinkedIn certainly created
 * nothing are `retryable`.
 */

const API_BASE = 'https://api.linkedin.com/rest'
const REQUEST_TIMEOUT_MS = 30_000

export class LinkedInApiError extends Error {
  /** LinkedIn certainly made nothing: trying again cannot duplicate. */
  readonly retryable: boolean

  constructor(
    message: string,
    readonly code: PublicationErrorCode,
    readonly status?: number
  ) {
    super(message)
    this.name = 'LinkedInApiError'
    this.retryable = code === 'rate_limited' || code === 'linkedin_unavailable'
  }
}

/**
 * The post's image cannot be used: unreadable, of a type LinkedIn does not
 * take, or too large. Trying again cannot help; the message is for the user.
 */
export class PostImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PostImageError'
  }
}

/** What a request sends. Only the image is safe to send twice: it publishes nothing. */
type Sending = 'post' | 'image' | 'comment'
const NOUNS: Record<Sending, string> = {
  post: 'the post',
  image: 'the image',
  comment: 'the comment'
}

export type ApiContext = {
  accessToken: string
  apiVersion: string
  fetchFn?: FetchFn
}

const headers = (ctx: ApiContext) => ({
  Authorization: `Bearer ${ctx.accessToken}`,
  'LinkedIn-Version': ctx.apiVersion,
  'X-Restli-Protocol-Version': '2.0.0',
  'Content-Type': 'application/json'
})

// Errors raised before anything was sent: no connection was made. A reset
// or timeout is not here: it can come after LinkedIn read the request.
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])

/**
 * A failed fetch: a DNS or refused connection never reached LinkedIn; a
 * timeout or a dropped connection might have.
 */
function networkError(err: unknown, what: Sending): LinkedInApiError {
  const code = (err as { cause?: { code?: string } })?.cause?.code
  const notSent = code !== undefined && NOT_SENT_CODES.has(code)
  if (notSent || what === 'image') {
    return new LinkedInApiError(
      'LinkedIn could not be reached. It will be tried again.',
      'linkedin_unavailable'
    )
  }
  return new LinkedInApiError(
    `The connection to LinkedIn was lost and ${NOUNS[what]} may still have gone through: check your profile before trying again.`,
    'unknown_outcome'
  )
}

async function errorMessageOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    message?: unknown
  } | null
  return typeof body?.message === 'string'
    ? body.message.slice(0, 300)
    : res.statusText
}

/**
 * An HTTP error. A 500, 502 or 504 on the post or the comment might have
 * created it. The image upload publishes nothing, so every server error
 * there is retryable.
 */
async function httpError(
  res: Response,
  what: Sending
): Promise<LinkedInApiError> {
  const detail = await errorMessageOf(res)
  const status = res.status
  if (status === 401) {
    return new LinkedInApiError(
      'LinkedIn no longer accepts this connection. Reconnect LinkedIn in Settings.',
      'reauth_required',
      status
    )
  }
  if (status === 403) {
    return new LinkedInApiError(
      'LinkedIn refused: the connection lacks permission to publish. Reconnect LinkedIn and allow posting.',
      'missing_permission',
      status
    )
  }
  if (status === 429) {
    return new LinkedInApiError(
      'LinkedIn is limiting requests right now. It will be tried again.',
      'rate_limited',
      status
    )
  }
  // 503: not processed. 409: LinkedIn's "write conflict, retry the request".
  if (status === 503 || status === 409 || (status >= 500 && what === 'image')) {
    return new LinkedInApiError(
      'LinkedIn is unavailable right now. It will be tried again.',
      'linkedin_unavailable',
      status
    )
  }
  if (status >= 500) {
    return new LinkedInApiError(
      `LinkedIn answered with an error (${status}) and ${NOUNS[what]} may still have gone through: check your profile before trying again.`,
      'unknown_outcome',
      status
    )
  }
  return new LinkedInApiError(
    `LinkedIn rejected ${NOUNS[what]}: ${detail}`,
    'rejected_by_linkedin',
    status
  )
}

async function send(
  ctx: ApiContext,
  url: string,
  init: RequestInit,
  what: Sending
): Promise<Response> {
  let res: Response
  try {
    res = await (ctx.fetchFn ?? fetch)(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    throw networkError(err, what)
  }
  if (!res.ok) throw await httpError(res, what)
  return res
}

/** LinkedIn takes JPG, PNG and GIF; anything else is converted to PNG first. */
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif'])

/** Sharp's default pixel limit is ~268 MP; a post image needs far less. */
const MAX_INPUT_PIXELS = 40_000_000

async function toPng(bytes: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  try {
    return await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .png()
      .toBuffer()
  } catch {
    throw new PostImageError(
      "The post's image could not be converted for LinkedIn: it may be damaged or too large."
    )
  }
}

export async function uploadImage(
  ctx: ApiContext,
  ownerUrn: string,
  image: { bytes: Buffer; mediaType: string }
): Promise<string> {
  const bytes = ACCEPTED_IMAGE_TYPES.has(image.mediaType)
    ? image.bytes
    : await toPng(image.bytes)
  const init = await send(
    ctx,
    `${API_BASE}/images?action=initializeUpload`,
    {
      method: 'POST',
      headers: headers(ctx),
      body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } })
    },
    'image'
  )
  const body = (await init.json().catch(() => null)) as {
    value?: { uploadUrl?: string; image?: string }
  } | null
  const uploadUrl = body?.value?.uploadUrl
  const imageUrn = body?.value?.image
  if (!uploadUrl || !imageUrn || !uploadUrl.startsWith('https://')) {
    throw new LinkedInApiError(
      'LinkedIn did not accept the image upload.',
      'linkedin_unavailable'
    )
  }
  await send(
    ctx,
    uploadUrl,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
      body: new Uint8Array(bytes)
    },
    'image'
  )
  return imageUrn
}

export async function createPost(
  ctx: ApiContext,
  post: {
    authorUrn: string
    commentary: string
    image?: { urn: string; altText?: string | null }
  }
): Promise<string> {
  const res = await send(
    ctx,
    `${API_BASE}/posts`,
    {
      method: 'POST',
      headers: headers(ctx),
      body: JSON.stringify({
        author: post.authorUrn,
        commentary: post.commentary,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: []
        },
        ...(post.image && {
          content: {
            media: {
              id: post.image.urn,
              ...(post.image.altText && {
                altText: post.image.altText.slice(0, 4086)
              })
            }
          }
        }),
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false
      })
    },
    'post'
  )
  const urn = res.headers.get('x-restli-id')
  if (!urn) {
    // Created (2xx) but with no id to record: published, but unconfirmable.
    throw new LinkedInApiError(
      'LinkedIn accepted the post but did not return its id. Check your profile before trying again.',
      'unknown_outcome',
      res.status
    )
  }
  return urn
}

/** The first comment, under the author's own post. Plain text, not little format. */
export async function addComment(
  ctx: ApiContext,
  postUrn: string,
  actorUrn: string,
  text: string
): Promise<string | null> {
  const res = await send(
    ctx,
    `${API_BASE}/socialActions/${encodeURIComponent(postUrn)}/comments`,
    {
      method: 'POST',
      headers: headers(ctx),
      body: JSON.stringify({
        actor: actorUrn,
        object: postUrn,
        message: { text }
      })
    },
    'comment'
  )
  return res.headers.get('x-restli-id')
}

/** Where a published post can be opened. */
export const postUrl = (postUrn: string) =>
  `https://www.linkedin.com/feed/update/${postUrn}/`
