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
  status?: number,
  retryAfterMs?: number
) => new PlatformApiError(message, code, status, retryAfterMs)

/**
 * A Retry-After header in ms: delay-seconds or an HTTP date (RFC 9110).
 * Undefined when there is none or it cannot be read.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now()
): number | undefined {
  const text = value?.trim()
  if (!text) return undefined
  if (/^\d+$/.test(text)) return Number(text) * 1000
  // Only a date in HTTP's form ("Wed, 18 Nov 2026 12:00:00 GMT"): Date.parse
  // alone takes "-5" or "1.5" for dates.
  if (!/^[A-Za-z]{3,9}, .+ GMT$/.test(text)) return undefined
  const at = Date.parse(text)
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined
}

/** A wait, roughly, for messages: "about 13 min", "about 5 hours", "about 3 days". */
function aboutHowLong(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 120) return `about ${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `about ${hours} hours` : `about ${Math.round(hours / 24)} days`
}

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
    return error('Buffer could not be reached.', 'platform_unavailable')
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
  name: string,
  /** Buffer's Retry-After header (on a 429: until the window resets). */
  retryAfter?: string | null
): PlatformApiError {
  const retryAfterMs = parseRetryAfter(retryAfter)
  const codes = new Set(errors.map(e => e.extensions?.code).filter(Boolean))
  const detail = errors
    .map(e => e.message)
    .filter(Boolean)
    .join('; ')
    .slice(0, 300)
  if (status === 401 || codes.has('UNAUTHORIZED') || codes.has('UNAUTHENTICATED')) {
    return error(
      `Buffer no longer accepts this connection. Reconnect Buffer in Settings to keep publishing to ${name}.`,
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
    const wait = retryAfterMs ? ` for ${aboutHowLong(retryAfterMs)}` : ' right now'
    return error(
      `Buffer is limiting requests${wait}.`,
      'rate_limited',
      status,
      retryAfterMs
    )
  }
  if (status === 503) {
    return error(
      'Buffer is unavailable right now.',
      'platform_unavailable',
      status,
      retryAfterMs
    )
  }
  const serverSide =
    status >= 500 || codes.has('UNEXPECTED') || codes.has('INTERNAL_SERVER_ERROR')
  if (serverSide) {
    return what === 'read'
      ? error('Buffer is unavailable right now.', 'platform_unavailable', status)
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
  what: Sending,
  /** For a post: whether the answer holds the post Buffer made. */
  made?: (data: T) => boolean
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
  const data = body?.data ?? null
  if (res.ok && errors.length === 0 && data) return data
  if (what === 'post' && res.ok) {
    // The post was made even with errors beside it: keep it, so it is
    // followed rather than made again.
    if (data && made?.(data)) return data
    // A 2xx with nothing readable: Buffer took the request and may have
    // made the post.
    if (errors.length === 0) {
      throw error(
        `Buffer's answer could not be read ${mayHavePosted(nameOf(ctx))}`,
        'unknown_outcome',
        res.status
      )
    }
  }
  throw requestError(
    res.status,
    errors,
    what,
    nameOf(ctx),
    res.headers.get('retry-after')
  )
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

type ChannelNode = {
  id: string
  name: string
  displayName?: string | null
  service: string
  type?: string | null
  avatar?: string | null
  externalLink?: string | null
  organizationId?: string | null
  isDisconnected?: boolean
  isLocked?: boolean
}

/** The authorized Buffer account (Buffer's `account` query). */
export type BufferAccount = {
  id: string
  name: string | null
  email: string | null
  avatar: string | null
  organizationIds: string[]
}

/** Every channel of the account, on any network, as Buffer describes it. */
export type BufferChannelDetail = BufferChannel & {
  /** Buffer's own `name` for it (usually the handle); `name` is the display name. */
  handle: string
  /** Buffer's Service: "twitter", "facebook", "instagram", "linkedin", … */
  service: string
  /** Buffer's ChannelType ("profile", "page", "business", …). */
  type: string | null
  organizationId: string | null
  /** The account on the network, when Buffer gives a link to it. */
  externalLink: string | null
  /** Buffer lost the network's authorization: it must be reconnected in Buffer. */
  isDisconnected: boolean
}

const httpsOrNull = (value: string | null | undefined) =>
  value?.startsWith('https://') ? value : null

/** The account behind the token or key, with its organizations' ids. */
export async function getAccount(ctx: BufferContext): Promise<BufferAccount> {
  const { account } = await graphql<{
    account: {
      id: string
      name?: string | null
      email?: string | null
      avatar?: string | null
      organizations?: Array<{ id: string }>
    }
  }>(
    ctx,
    'query Account { account { id name email avatar organizations { id } } }',
    {},
    'read'
  )
  return {
    id: account.id,
    name: account.name?.trim() || null,
    email: account.email?.trim() || null,
    avatar: httpsOrNull(account.avatar),
    organizationIds: (account.organizations ?? []).map(o => o.id)
  }
}

/**
 * Every channel in the given organizations (from getAccount), on every
 * network, disconnected and locked ones included: one request per
 * organization.
 */
export async function listAllChannels(
  ctx: BufferContext,
  organizationIds: readonly string[]
): Promise<BufferChannelDetail[]> {
  const channels: BufferChannelDetail[] = []
  for (const organizationId of organizationIds) {
    const data = await graphql<{ channels: ChannelNode[] }>(
      ctx,
      `query Channels($input: ChannelsInput!) {
        channels(input: $input) {
          id name displayName service type avatar externalLink organizationId isDisconnected isLocked
        }
      }`,
      { input: { organizationId } },
      'read'
    )
    for (const channel of data.channels ?? []) {
      channels.push({
        id: channel.id,
        name: channel.displayName || channel.name,
        avatar: httpsOrNull(channel.avatar),
        isLocked: Boolean(channel.isLocked),
        handle: channel.name,
        service: channel.service,
        type: channel.type ?? null,
        organizationId: channel.organizationId ?? organizationId,
        externalLink: httpsOrNull(channel.externalLink),
        isDisconnected: Boolean(channel.isDisconnected)
      })
    }
  }
  return channels
}

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
 * With `replies`, it is a thread: Buffer publishes
 * `metadata.<threadKey>.thread` (`twitter` for X, `threads` for Threads;
 * every post, the first included) in order, each a reply to the one before,
 * and the top-level text and image must be the first post's. `metadata` is
 * the network's own (`facebook`: the post type and first comment;
 * `instagram`: the post type).
 */
export async function createPost(
  ctx: BufferContext,
  post: {
    channelId: string
    text: string
    replies?: string[]
    /** The network's key for a thread in Buffer's metadata; X's by default. */
    threadKey?: 'twitter' | 'threads'
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
      [post.threadKey ?? 'twitter']: {
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
    'post',
    made => Boolean(made?.createPost?.post?.id)
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

// ---------------------------------------------------------------------------
// Sent posts, for learning how the account posts (src/lib/profile-insights)
// ---------------------------------------------------------------------------

/** A post Buffer sent on a channel. */
export type SentPost = {
  id: string
  text: string
  sentAt: Date | null
  /** The post on the network, when Buffer has its link. */
  url: string | null
  /** Buffer's thumbnails of its images. */
  imageUrls: string[]
}

type SentPostNode = {
  id: string
  text?: string | null
  sentAt?: string | null
  externalLink?: string | null
  assets?: Array<{ thumbnail?: string | null; mimeType?: string | null }> | null
}

/**
 * The newest posts Buffer sent on a channel (only what went out through
 * Buffer: Buffer does not hold posts made on the network itself), newest
 * first. Reads need the posts:read scope the app already asks for.
 */
export async function listSentPosts(
  ctx: BufferContext,
  channelId: string,
  limit = 30
): Promise<SentPost[]> {
  const { channel } = await graphql<{ channel: { organizationId: string } }>(
    ctx,
    'query Channel($input: ChannelInput!) { channel(input: $input) { organizationId } }',
    { input: { id: channelId } },
    'read'
  )
  const data = await graphql<{ posts: { edges?: Array<{ node: SentPostNode }> } }>(
    ctx,
    `query SentPosts($first: Int, $input: PostsInput!) {
      posts(first: $first, input: $input) {
        edges { node { id text sentAt externalLink assets { thumbnail mimeType } } }
      }
    }`,
    {
      first: limit,
      input: {
        organizationId: channel.organizationId,
        filter: { status: ['sent'], channelIds: [channelId] }
      }
    },
    'read'
  )
  const posts = (data.posts?.edges ?? []).map(({ node }): SentPost => {
    const sentAt = node.sentAt ? new Date(node.sentAt) : null
    return {
      id: node.id,
      text: (node.text ?? '').trim(),
      sentAt: sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null,
      url: node.externalLink?.startsWith('https://') ? node.externalLink : null,
      imageUrls: (node.assets ?? [])
        .filter(a => a.mimeType?.startsWith('image/') && a.thumbnail?.startsWith('https://'))
        .map(a => a.thumbnail!)
    }
  })
  return posts.sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0))
}
