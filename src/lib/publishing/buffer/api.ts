import { PlatformApiError } from '../errors'
import type { PublicationErrorCode } from '../status'

/**
 * Buffer's GraphQL API (https://developers.buffer.com), which publishes X,
 * Facebook and Instagram posts for us: the user connects the account in
 * Buffer as a channel and authorizes the app on Buffer (or gives it a Buffer
 * API key), so the app never holds an X or Meta token or needs a developer
 * app there. Plain functions over a key and a `fetch`, so tests can run them
 * against a stub.
 *
 * Buffer answers HTTP 200 for most failures, with the reason in the body:
 * `errors[].extensions.code` for a refused request (UNAUTHORIZED, FORBIDDEN,
 * NOT_FOUND, RATE_LIMIT_EXCEEDED, UNEXPECTED), or a MutationError member
 * (`message`) for a refused mutation. A rate limit also comes as HTTP 429.
 *
 * Creating a post is not idempotent. Only failures where Buffer certainly
 * made nothing are `retryable`; a lost connection or a server error while
 * creating one is `unknown_outcome`, never retried by itself.
 */

export const BUFFER_API_URL = 'https://api.buffer.com'
const REQUEST_TIMEOUT_MS = 30_000

/** Buffer's name for X channels. */
export const X_SERVICES: ReadonlySet<string> = new Set(['twitter', 'x'])

export type FetchFn = typeof fetch

export type BufferContext = {
  apiKey: string
  apiUrl?: string
  fetchFn?: FetchFn
  /** The network posts go to, for messages ("X", "Facebook"); "X" when unset. */
  platformName?: string
}

/** What a request does: creating a post is the one that must not repeat. */
type Sending = 'post' | 'read'

const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])

const error = (
  message: string,
  code: PublicationErrorCode,
  status?: number
) => new PlatformApiError(message, code, status)

const nameOf = (ctx: Pick<BufferContext, 'platformName'>) =>
  ctx.platformName ?? 'X'

const mayHavePosted = (name: string) =>
  `and the post may still have gone through: check your ${name} profile before trying again.`

function networkError(
  err: unknown,
  what: Sending,
  name: string
): PlatformApiError {
  const code = (err as { cause?: { code?: string } })?.cause?.code
  if (what === 'read' || (code !== undefined && NOT_SENT_CODES.has(code))) {
    return error(
      'Buffer could not be reached. It will be tried again.',
      'platform_unavailable'
    )
  }
  return error(
    `The connection to Buffer was lost ${mayHavePosted(name)}`,
    'unknown_outcome'
  )
}

type GraphQLError = { message?: string; extensions?: { code?: string } }

/** A refused request, by Buffer's error code or the HTTP status. */
function requestError(
  status: number,
  errors: GraphQLError[],
  what: Sending,
  name: string
): PlatformApiError {
  const codes = new Set(errors.map(e => e.extensions?.code).filter(Boolean))
  const detail = errors
    .map(e => e.message)
    .filter(Boolean)
    .join('; ')
    .slice(0, 300)
  if (status === 401 || codes.has('UNAUTHORIZED') || codes.has('UNAUTHENTICATED')) {
    return error(
      `Buffer no longer accepts this connection. Connect ${name} again in Settings.`,
      'reauth_required',
      status
    )
  }
  if (status === 403 || codes.has('FORBIDDEN')) {
    return error(
      `Buffer refused: this connection lacks permission for the ${name} channel. Connect ${name} again in Settings.`,
      'missing_permission',
      status
    )
  }
  // Buffer documents that a 429 consumes nothing.
  if (status === 429 || codes.has('RATE_LIMIT_EXCEEDED')) {
    return error(
      'Buffer is limiting requests right now. It will be tried again.',
      'rate_limited',
      status
    )
  }
  if (status === 503) {
    return error(
      'Buffer is unavailable right now. It will be tried again.',
      'platform_unavailable',
      status
    )
  }
  const serverSide =
    status >= 500 || codes.has('UNEXPECTED') || codes.has('INTERNAL_SERVER_ERROR')
  if (serverSide) {
    return what === 'read'
      ? error(
          'Buffer is unavailable right now. It will be tried again.',
          'platform_unavailable',
          status
        )
      : error(
          `Buffer answered with an error ${mayHavePosted(name)}`,
          'unknown_outcome',
          status
        )
  }
  // Validation and NOT_FOUND: the request was refused, nothing was made.
  return error(
    `Buffer rejected the request${detail ? `: ${detail}` : '.'}`,
    'rejected_by_platform',
    status
  )
}

async function graphql<T>(
  ctx: BufferContext,
  query: string,
  variables: Record<string, unknown>,
  what: Sending
): Promise<T> {
  let res: Response
  try {
    res = await (ctx.fetchFn ?? fetch)(ctx.apiUrl ?? BUFFER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.apiKey}`
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    throw networkError(err, what, nameOf(ctx))
  }
  const body = (await res.json().catch(() => null)) as {
    data?: T | null
    errors?: GraphQLError[]
  } | null
  const errors = Array.isArray(body?.errors) ? body.errors : []
  if (!res.ok || errors.length > 0 || !body?.data) {
    throw requestError(res.status, errors, what, nameOf(ctx))
  }
  return body.data
}

// ---------------------------------------------------------------------------
// The account and its channels on one network, for connecting
// ---------------------------------------------------------------------------

export type BufferChannel = {
  /** Buffer's id for the channel: what posts are created on. */
  id: string
  name: string
  avatar: string | null
  /** Buffer's free plan locks channels past its limit; a locked one cannot post. */
  isLocked: boolean
}
export type XChannel = BufferChannel

type ChannelNode = {
  id: string
  name: string
  displayName?: string | null
  service: string
  avatar?: string | null
  isDisconnected?: boolean
  isLocked?: boolean
}

/**
 * The channels of one network (Buffer's `service` names: X_SERVICES,
 * "facebook", "instagram") the key's account can post to, across its
 * organizations.
 */
export async function listChannels(
  ctx: BufferContext,
  services: ReadonlySet<string>
): Promise<BufferChannel[]> {
  const { account } = await graphql<{
    account: { organizations: Array<{ id: string }> }
  }>(ctx, 'query Organizations { account { organizations { id } } }', {}, 'read')
  const channels: BufferChannel[] = []
  for (const organization of account.organizations ?? []) {
    const data = await graphql<{ channels: ChannelNode[] }>(
      ctx,
      `query Channels($input: ChannelsInput!) {
        channels(input: $input) {
          id name displayName service avatar isDisconnected isLocked
        }
      }`,
      { input: { organizationId: organization.id } },
      'read'
    )
    for (const channel of data.channels ?? []) {
      if (!services.has(channel.service) || channel.isDisconnected) continue
      channels.push({
        id: channel.id,
        name: channel.displayName || channel.name,
        avatar: channel.avatar?.startsWith('https://') ? channel.avatar : null,
        isLocked: Boolean(channel.isLocked)
      })
    }
  }
  return channels
}

/** The X channels the key's account can post to. */
export const listXChannels = (ctx: BufferContext) =>
  listChannels(ctx, X_SERVICES)

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/** Where a post Buffer was given stands. */
export type BufferPostState = {
  id: string
  /** sent: on the network. error: Buffer gave up. pending: still queued or sending. */
  state: 'sent' | 'error' | 'pending'
  /** The post on the network, once sent. */
  url: string | null
  sentAt: Date | null
  error: string | null
}

type PostNode = {
  id: string
  status: string
  externalLink?: string | null
  sentAt?: string | null
  error?: { message?: string | null } | null
}

const POST_FIELDS = 'id status externalLink sentAt error { message }'

function toState(post: PostNode, name: string): BufferPostState {
  const state =
    post.status === 'sent' ? 'sent' : post.status === 'error' ? 'error' : 'pending'
  const sentAt = post.sentAt ? new Date(post.sentAt) : null
  return {
    id: post.id,
    state,
    url: post.externalLink?.startsWith('https://') ? post.externalLink : null,
    sentAt: sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null,
    error:
      state === 'error'
        ? `${name} did not take the post: ${post.error?.message?.slice(0, 300) || 'Buffer reported an error.'}`
        : null
  }
}

/**
 * Hands the post to Buffer to publish on the channel now (mode shareNow).
 * Buffer answers before the network has it: the state is usually `pending`,
 * and getPost follows it to `sent`.
 *
 * With `replies`, it is an X thread: Buffer publishes
 * `metadata.twitter.thread` (every post, the first included) in order, each
 * a reply to the one before, and the top-level text and image must be the
 * first post's. `metadata` is the network's own (`facebook`: the post type
 * and first comment; `instagram`: the post type).
 */
export async function createPost(
  ctx: BufferContext,
  post: {
    channelId: string
    text: string
    replies?: string[]
    image?: { url: string; altText?: string | null }
    /** A carousel: several images in one post, in order (instead of `image`). */
    images?: Array<{ url: string; altText?: string | null }>
    metadata?: Record<string, unknown>
  }
): Promise<BufferPostState> {
  const images = post.images?.length ? post.images : post.image ? [post.image] : []
  const assets = images.map(image => ({
    image: {
      url: image.url,
      ...(image.altText && {
        metadata: { altText: image.altText.slice(0, 1000) }
      })
    }
  }))
  const replies = post.replies?.filter(text => text.trim()) ?? []
  const metadata = {
    ...post.metadata,
    ...(replies.length > 0 && {
      twitter: {
        thread: [
          { text: post.text, assets },
          ...replies.map(text => ({ text, assets: [] }))
        ]
      }
    })
  }
  const data = await graphql<{
    createPost: { __typename?: string; post?: PostNode; message?: string }
  }>(
    ctx,
    `mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on PostActionSuccess { post { ${POST_FIELDS} } }
        ... on MutationError { message }
      }
    }`,
    {
      input: {
        channelId: post.channelId,
        text: post.text,
        schedulingType: 'automatic',
        mode: 'shareNow',
        needsApproval: false,
        aiAssisted: true,
        assets,
        ...(Object.keys(metadata).length > 0 && { metadata })
      }
    },
    'post'
  )
  const result = data.createPost
  if (result?.post?.id) return toState(result.post, nameOf(ctx))
  if (result?.message) {
    // A typed refusal (InvalidInputError, LimitReachedError, …): nothing made.
    throw error(
      `Buffer refused the post: ${result.message.slice(0, 300)}`,
      'rejected_by_platform'
    )
  }
  // A success with no id to follow: it may be on its way to X.
  throw error(
    `Buffer accepted the post but did not return its id. Check your ${nameOf(ctx)} profile before trying again.`,
    'unknown_outcome'
  )
}

/** Where a post stands now; a post Buffer no longer has throws rejected_by_platform. */
export async function getPost(
  ctx: BufferContext,
  postId: string
): Promise<BufferPostState> {
  const data = await graphql<{ post: PostNode }>(
    ctx,
    `query Post($input: PostInput!) { post(input: $input) { ${POST_FIELDS} } }`,
    { input: { id: postId } },
    'read'
  )
  return toState(data.post, nameOf(ctx))
}
