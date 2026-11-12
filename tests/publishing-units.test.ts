import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  createPost,
  LinkedInApiError,
  PostImageError,
  uploadImage
} from '../src/lib/publishing/linkedin/api'
import { toLittleText } from '../src/lib/publishing/linkedin/commentary'
import {
  buildAuthorizationUrl,
  callbackErrorResult,
  createOAuthState,
  exchangeCode,
  parseScopes,
  STATE_TTL_MS,
  verifyOAuthState
} from '../src/lib/publishing/linkedin/oauth'
import {
  decryptToken,
  encryptToken,
  TokenDecryptionError
} from '../src/lib/publishing/token-crypto'

/** LinkedIn publishing pieces that need no database. */

const key = randomBytes(32)
const config = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://app.example.com/api/integrations/linkedin/callback',
  scopes: ['openid', 'profile', 'w_member_social'],
  apiVersion: '202610',
  encryptionKey: key
}

describe('token encryption', () => {
  it('round-trips and never stores the plain token', () => {
    const stored = encryptToken('AQX-secret-token', key, 'user-a')
    assert.ok(!stored.includes('AQX-secret-token'))
    assert.strictEqual(decryptToken(stored, key, 'user-a'), 'AQX-secret-token')
  })

  it('uses a fresh IV each time', () => {
    assert.notStrictEqual(
      encryptToken('t', key, 'u'),
      encryptToken('t', key, 'u')
    )
  })

  it("refuses a token moved onto another user's row", () => {
    const stored = encryptToken('token', key, 'user-a')
    assert.throws(
      () => decryptToken(stored, key, 'user-b'),
      TokenDecryptionError
    )
  })

  it('refuses a tampered value or the wrong key', () => {
    const stored = encryptToken('token', key, 'user-a')
    const parts = stored.split(':')
    parts[3] = Buffer.from('tampered').toString('base64url')
    assert.throws(
      () => decryptToken(parts.join(':'), key, 'user-a'),
      TokenDecryptionError
    )
    assert.throws(
      () => decryptToken(stored, randomBytes(32), 'user-a'),
      TokenDecryptionError
    )
    assert.throws(
      () => decryptToken('plain-token', key, 'user-a'),
      TokenDecryptionError
    )
  })
})

describe('OAuth state (CSRF)', () => {
  it('accepts the state this user was sent off with', () => {
    const { state, cookie } = createOAuthState(key, 'user-a')
    assert.deepStrictEqual(
      verifyOAuthState(key, { cookie, state, userId: 'user-a' }),
      {
        ok: true
      }
    )
  })

  it('refuses a missing cookie or state', () => {
    const { state, cookie } = createOAuthState(key, 'user-a')
    assert.strictEqual(
      verifyOAuthState(key, { cookie: undefined, state, userId: 'user-a' }).ok,
      false
    )
    assert.strictEqual(
      verifyOAuthState(key, { cookie, state: null, userId: 'user-a' }).ok,
      false
    )
  })

  it('refuses a state that does not match the cookie', () => {
    const { cookie } = createOAuthState(key, 'user-a')
    const other = createOAuthState(key, 'user-a').state
    assert.deepStrictEqual(
      verifyOAuthState(key, { cookie, state: other, userId: 'user-a' }),
      {
        ok: false,
        reason: 'mismatch'
      }
    )
  })

  it("refuses another user's flow (a callback link sent to a victim)", () => {
    const { state, cookie } = createOAuthState(key, 'attacker')
    assert.deepStrictEqual(
      verifyOAuthState(key, { cookie, state, userId: 'victim' }),
      {
        ok: false,
        reason: 'wrong_user'
      }
    )
  })

  it('refuses a forged or re-signed cookie', () => {
    const { state, cookie } = createOAuthState(key, 'attacker')
    const forged = cookie.replace(/^attacker\./, 'victim.')
    assert.deepStrictEqual(
      verifyOAuthState(key, { cookie: forged, state, userId: 'victim' }),
      {
        ok: false,
        reason: 'invalid'
      }
    )
    const otherKey = createOAuthState(randomBytes(32), 'victim')
    assert.strictEqual(
      verifyOAuthState(key, {
        cookie: otherKey.cookie,
        state: otherKey.state,
        userId: 'victim'
      }).ok,
      false
    )
  })

  it('refuses an expired state', () => {
    const { state, cookie } = createOAuthState(key, 'user-a', 1_000)
    assert.deepStrictEqual(
      verifyOAuthState(key, {
        cookie,
        state,
        userId: 'user-a',
        now: 1_000 + STATE_TTL_MS + 1
      }),
      { ok: false, reason: 'expired' }
    )
  })

  it('reports a cancelled authorization as cancelled, anything else as failed', () => {
    assert.strictEqual(
      callbackErrorResult('user_cancelled_authorize'),
      'cancelled'
    )
    assert.strictEqual(callbackErrorResult('user_cancelled_login'), 'cancelled')
    assert.strictEqual(callbackErrorResult('invalid_scope'), 'failed')
  })
})

describe('authorization URL and scopes', () => {
  it('asks only for the configured scopes, with the state and redirect', () => {
    const url = new URL(buildAuthorizationUrl(config, 'abc'))
    assert.strictEqual(
      url.origin + url.pathname,
      'https://www.linkedin.com/oauth/v2/authorization'
    )
    assert.strictEqual(url.searchParams.get('response_type'), 'code')
    assert.strictEqual(
      url.searchParams.get('scope'),
      'openid profile w_member_social'
    )
    assert.strictEqual(url.searchParams.get('state'), 'abc')
    assert.strictEqual(url.searchParams.get('redirect_uri'), config.redirectUri)
    assert.strictEqual(url.searchParams.get('client_secret'), null)
  })

  it('reads space- or comma-separated scopes', () => {
    assert.deepStrictEqual(parseScopes('openid,profile, w_member_social'), [
      'openid',
      'profile',
      'w_member_social'
    ])
    assert.deepStrictEqual(parseScopes(''), [])
  })

  it('exchanges the code with the secret in the body, not the URL', async () => {
    let seen: { url: string; body: string } | null = null
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, body: String(init.body) }
      return Response.json({
        access_token: 'AT',
        expires_in: 3600,
        scope: 'openid,profile,w_member_social'
      })
    }) as typeof fetch
    const tokens = await exchangeCode(config, 'the-code', fetchFn, 0)
    assert.strictEqual(
      seen!.url,
      'https://www.linkedin.com/oauth/v2/accessToken'
    )
    assert.ok(seen!.body.includes('client_secret=client-secret'))
    assert.ok(seen!.body.includes('code=the-code'))
    assert.strictEqual(tokens.accessToken, 'AT')
    assert.strictEqual(tokens.accessTokenExpiresAt.getTime(), 3_600_000)
    assert.strictEqual(tokens.refreshToken, null)
    assert.ok(tokens.scopes.includes('w_member_social'))
  })
})

describe('commentary in little text format', () => {
  it('escapes every reserved character', () => {
    assert.strictEqual(
      toLittleText('a (b) [c] {d} <e> @f *g* _h_ ~i~ | \\'),
      'a \\(b\\) \\[c\\] \\{d\\} \\<e\\> \\@f \\*g\\* \\_h\\_ \\~i\\~ \\| \\\\'
    )
  })

  it('keeps hashtags as hashtags, and a bare # escaped', () => {
    assert.strictEqual(
      toLittleText('Ship it #DevOps #1 C#'),
      'Ship it {hashtag|\\#|DevOps} \\#1 C\\#'
    )
    assert.strictEqual(toLittleText('#my_tag'), '{hashtag|\\#|my\\_tag}')
  })

  it('leaves emoji, Unicode bold and line breaks alone', () => {
    assert.strictEqual(toLittleText('𝗛𝗼𝗼𝗸 🚀\n\nBody'), '𝗛𝗼𝗼𝗸 🚀\n\nBody')
  })
})

describe('LinkedIn API errors say whether a retry is safe', () => {
  const ctx = (status: number, headers: Record<string, string> = {}) => ({
    accessToken: 'AT',
    apiVersion: '202610',
    fetchFn: (async () =>
      new Response(
        status === 201 ? null : JSON.stringify({ message: 'nope' }),
        {
          status,
          headers
        }
      )) as unknown as typeof fetch
  })
  const post = { authorUrn: 'urn:li:person:1', commentary: 'hi' }
  const failureOf = async (status: number) => {
    try {
      await createPost(ctx(status), post)
    } catch (err) {
      return err as LinkedInApiError
    }
    assert.fail('expected a failure')
  }

  it('returns the post URN from x-restli-id', async () => {
    assert.strictEqual(
      await createPost(ctx(201, { 'x-restli-id': 'urn:li:share:9' }), post),
      'urn:li:share:9'
    )
  })

  it('sends the version and protocol headers', async () => {
    let headers: Record<string, string> = {}
    await createPost(
      {
        accessToken: 'AT',
        apiVersion: '202610',
        fetchFn: (async (_url: string, init: RequestInit) => {
          headers = init.headers as Record<string, string>
          return new Response(null, {
            status: 201,
            headers: { 'x-restli-id': 'urn:li:share:1' }
          })
        }) as typeof fetch
      },
      post
    )
    assert.strictEqual(headers['LinkedIn-Version'], '202610')
    assert.strictEqual(headers['X-Restli-Protocol-Version'], '2.0.0')
    assert.strictEqual(headers.Authorization, 'Bearer AT')
  })

  it('401 needs a reconnect, 403 a permission; neither is retried', async () => {
    const e401 = await failureOf(401)
    assert.strictEqual(e401.code, 'reauth_required')
    assert.strictEqual(e401.retryable, false)
    assert.strictEqual((await failureOf(403)).code, 'missing_permission')
  })

  it('429 and 503 are retried: LinkedIn made nothing', async () => {
    const e429 = await failureOf(429)
    assert.strictEqual(e429.code, 'rate_limited')
    assert.strictEqual(e429.retryable, true)
    const e503 = await failureOf(503)
    assert.strictEqual(e503.code, 'platform_unavailable')
    assert.strictEqual(e503.retryable, true)
  })

  it('500, 502 and 504 on the post may have published it: never retried', async () => {
    for (const status of [500, 502, 504]) {
      const err = await failureOf(status)
      assert.strictEqual(err.code, 'unknown_outcome', String(status))
      assert.strictEqual(err.retryable, false, String(status))
      assert.match(err.message, /the post may still have gone through/)
    }
  })

  it('a 201 without an id is unconfirmable, not retried', async () => {
    const err = await failureOf(201)
    assert.strictEqual(err.code, 'unknown_outcome')
    assert.strictEqual(err.retryable, false)
  })

  it('a timeout on the post is ambiguous; a refused connection is not', async () => {
    const throwing = (cause: object) => ({
      accessToken: 'AT',
      apiVersion: '202610',
      fetchFn: (async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause })
      }) as unknown as typeof fetch
    })
    const timeout = await createPost(
      throwing({ name: 'TimeoutError' }),
      post
    ).catch(e => e)
    assert.strictEqual(timeout.code, 'unknown_outcome')
    const refused = await createPost(
      throwing({ code: 'ECONNREFUSED' }),
      post
    ).catch(e => e)
    assert.strictEqual(refused.code, 'platform_unavailable')
    assert.strictEqual(refused.retryable, true)
  })

  it('a server error during the image upload is retried: nothing is published yet', async () => {
    const err: LinkedInApiError = await uploadImage(
      ctx(500),
      'urn:li:person:1',
      {
        bytes: Buffer.from('x'),
        mediaType: 'image/png'
      }
    ).then(
      () => assert.fail('expected a failure'),
      e => e
    )
    assert.strictEqual(err.code, 'platform_unavailable')
    assert.strictEqual(err.retryable, true)
  })

  it('an image LinkedIn rejects names the image, not the post', async () => {
    const err: LinkedInApiError = await uploadImage(
      ctx(422),
      'urn:li:person:1',
      { bytes: Buffer.from('x'), mediaType: 'image/png' }
    ).then(
      () => assert.fail('expected a failure'),
      e => e
    )
    assert.strictEqual(err.code, 'rejected_by_platform')
    assert.match(err.message, /^LinkedIn rejected the image: /)
  })

  it('an image that cannot be converted is refused before anything is sent', async () => {
    let sent = false
    const err = await uploadImage(
      {
        accessToken: 'AT',
        apiVersion: '202610',
        fetchFn: (async () => {
          sent = true
          return new Response(null, { status: 201 })
        }) as unknown as typeof fetch
      },
      'urn:li:person:1',
      { bytes: Buffer.from('not an image'), mediaType: 'image/webp' }
    ).then(
      () => assert.fail('expected a failure'),
      e => e
    )
    assert.ok(err instanceof PostImageError, String(err))
    assert.strictEqual(sent, false)
  })
})

describe('X through Buffer', () => {
  it("counts a post's length the way X does", async () => {
    const { countChars } = await import('../src/lib/formats/count')
    const xWeightedLength = (text: string) => countChars(text, 'x_weighted')
    assert.strictEqual(xWeightedLength('hello'), 5)
    // Any link is 23, an emoji (with its joined parts) 2, CJK 2 per character.
    assert.strictEqual(xWeightedLength(`see https://example.com/${'a'.repeat(200)}`), 4 + 23)
    assert.strictEqual(xWeightedLength('👨‍👩‍👧 🇮🇳'), 5)
    assert.strictEqual(xWeightedLength('日本'), 4)
  })

  it('signs image links for one post and one day only', async () => {
    const { createMediaToken, verifyMediaToken, MEDIA_TOKEN_TTL_MS } =
      await import('../src/lib/publishing/media-token')
    const token = createMediaToken(key, 'POST-1', 0)
    assert.strictEqual(verifyMediaToken(key, token, 1000), 'POST-1')
    assert.strictEqual(verifyMediaToken(key, token, MEDIA_TOKEN_TTL_MS + 1), null)
    assert.strictEqual(verifyMediaToken(randomBytes(32), token, 1000), null)
    assert.strictEqual(verifyMediaToken(key, token.replace('POST-1', 'POST-2'), 1000), null)
    assert.strictEqual(verifyMediaToken(key, 'garbage', 1000), null)
  })

  it("classifies Buffer's answers: what may be retried, and what may have posted", async () => {
    const { createPost } = await import('../src/lib/publishing/buffer/api')
    const ctx = (answer: () => Response | Promise<Response>) => ({
      apiKey: 'KEY',
      apiUrl: 'https://buffer.example/graphql',
      fetchFn: (async () => answer()) as typeof fetch
    })
    const post = { channelId: 'C', text: 'Hi' }
    const codeOf = async (answer: () => Response | Promise<Response>) => {
      const err = await createPost(ctx(answer), post).catch(e => e)
      return [err.code, err.retryable]
    }
    const graphqlError = (code: string, status = 200) => () =>
      Response.json({ errors: [{ message: code, extensions: { code } }] }, { status })

    assert.deepStrictEqual(await codeOf(graphqlError('UNAUTHORIZED')), ['reauth_required', false])
    assert.deepStrictEqual(await codeOf(graphqlError('FORBIDDEN')), ['missing_permission', false])
    assert.deepStrictEqual(await codeOf(graphqlError('RATE_LIMIT_EXCEEDED', 429)), ['rate_limited', true])
    assert.deepStrictEqual(await codeOf(graphqlError('UNEXPECTED')), ['unknown_outcome', false])
    assert.deepStrictEqual(await codeOf(() => new Response('', { status: 503 })), ['platform_unavailable', true])
    assert.deepStrictEqual(await codeOf(() => new Response('', { status: 502 })), ['unknown_outcome', false])
    assert.deepStrictEqual(
      await codeOf(() =>
        Response.json({ data: { createPost: { __typename: 'LimitReachedError', message: 'Queue full' } } })
      ),
      ['rejected_by_platform', false]
    )
    // A refused connection never reached Buffer; a dropped one may have.
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    assert.deepStrictEqual(await codeOf(() => Promise.reject(refused)), ['platform_unavailable', true])
    assert.deepStrictEqual(
      await codeOf(() => Promise.reject(new TypeError('socket hang up'))),
      ['unknown_outcome', false]
    )
  })
})

describe('Facebook and Instagram through Buffer', () => {
  it("pads an image into Instagram's 4:5 to 1.91:1 range, never cropping", async () => {
    const { instagramPadding } = await import('../src/lib/publishing/buffer/image-variant')
    const sized = (width: number, height: number) => {
      const p = instagramPadding(width, height)
      return { width: width + p.left + p.right, height: height + p.top + p.bottom }
    }
    // Already within range: untouched.
    assert.deepStrictEqual(instagramPadding(1080, 1080), { top: 0, bottom: 0, left: 0, right: 0 })
    assert.deepStrictEqual(instagramPadding(1440, 754), { top: 0, bottom: 0, left: 0, right: 0 })
    // The app's 2048x1072 canvas is a hair past 1.91:1.
    const wide = sized(2048, 1072)
    assert.ok(wide.width / wide.height <= 1.91 && wide.height - 1072 <= 1)
    // A banner and a tall image land on the limits.
    const banner = sized(3000, 1000)
    assert.ok(banner.width / banner.height <= 1.91 && banner.width === 3000)
    const tall = sized(400, 1000)
    assert.deepStrictEqual(tall, { width: 800, height: 1000 })
  })

  it('serves Instagram a JPEG within its range, and Facebook WebP as JPEG', async () => {
    const sharp = (await import('sharp')).default
    const { imageForVariant } = await import('../src/lib/publishing/buffer/image-variant')
    const png = await sharp({
      create: { width: 2048, height: 1072, channels: 4, background: '#336699' }
    })
      .png()
      .toBuffer()
    const ig = await imageForVariant('instagram', { bytes: png, mediaType: 'image/png' })
    assert.strictEqual(ig.mediaType, 'image/jpeg')
    const meta = await sharp(ig.bytes).metadata()
    assert.strictEqual(meta.format, 'jpeg')
    assert.strictEqual(meta.width, 1440)
    assert.ok(meta.width! / meta.height! <= 1.91 && meta.width! / meta.height! >= 0.8)

    const fbPng = await imageForVariant('facebook', { bytes: png, mediaType: 'image/png' })
    assert.strictEqual(fbPng.bytes, png, 'a PNG goes to Facebook as it is')
    const webp = await sharp(png).webp().toBuffer()
    const fbWebp = await imageForVariant('facebook', { bytes: webp, mediaType: 'image/webp' })
    assert.strictEqual(fbWebp.mediaType, 'image/jpeg')
    assert.strictEqual((await sharp(fbWebp.bytes).metadata()).format, 'jpeg')
  })

  it('names the variant in the signed image link only when there is one', async () => {
    const { mediaUrl } = await import('../src/lib/publishing/media-token')
    assert.strictEqual(
      mediaUrl('https://app.example.com', 'T.1.S', 'instagram'),
      'https://app.example.com/api/publishing-media/T.1.S?for=instagram'
    )
    assert.strictEqual(
      mediaUrl('https://app.example.com', 'T.1.S'),
      'https://app.example.com/api/publishing-media/T.1.S'
    )
  })

  it("lists only the network's channels, and names it in Buffer's errors", async () => {
    const { listPlatformChannels } = await import('../src/lib/publishing/buffer/provider')
    const fetchFn = (async (_url: string | URL, init: RequestInit = {}) => {
      const { query } = JSON.parse(String(init.body))
      if (query.includes('organizations')) {
        return Response.json({ data: { account: { organizations: [{ id: 'O1' }] } } })
      }
      return Response.json({
        data: {
          channels: [
            { id: 'X1', name: 'qa', service: 'twitter', avatar: '' },
            { id: 'F1', name: 'page', displayName: 'QA Page', service: 'facebook', avatar: 'https://cdn.example/a.png' },
            { id: 'I1', name: 'qa.ig', service: 'instagram', avatar: '', isLocked: true },
            { id: 'I2', name: 'old.ig', service: 'instagram', avatar: '', isDisconnected: true }
          ]
        }
      })
    }) as typeof fetch
    const ctx = { apiKey: 'KEY', apiUrl: 'https://buffer.example/graphql', fetchFn }
    assert.deepStrictEqual(await listPlatformChannels(ctx, 'facebook'), [
      { id: 'F1', name: 'QA Page', avatar: 'https://cdn.example/a.png', isLocked: false }
    ])
    assert.deepStrictEqual(
      (await listPlatformChannels(ctx, 'instagram')).map(c => [c.id, c.isLocked]),
      [['I1', true]]
    )

    const refused = (async () =>
      Response.json({ errors: [{ message: 'no', extensions: { code: 'UNAUTHORIZED' } }] })) as typeof fetch
    const err = await listPlatformChannels({ ...ctx, fetchFn: refused }, 'instagram').catch(e => e)
    assert.strictEqual(err.code, 'reauth_required')
    assert.match(err.message, /Connect Instagram again/)
  })

  it('Facebook sends its first comment in the post; Instagram never sends one', async () => {
    const { bufferFacebookProvider, bufferInstagramProvider } = await import(
      '../src/lib/publishing/buffer/provider'
    )
    const inputs: any[] = []
    const fetchFn = (async (_url: string | URL, init: RequestInit = {}) => {
      inputs.push(JSON.parse(String(init.body)).variables.input)
      return Response.json({
        data: {
          createPost: {
            __typename: 'PostActionSuccess',
            post: { id: 'P1', status: 'sent', externalLink: 'https://facebook.com/p/1', sentAt: null }
          }
        }
      })
    }) as typeof fetch
    const ctx = {
      accessToken: 'KEY',
      fetchFn,
      config: {
        oauth: null,
        apiUrl: 'https://buffer.example/graphql',
        appUrl: 'https://app.example.com',
        encryptionKey: key,
        inlineWaitMs: 0
      }
    }
    await bufferFacebookProvider.createPost(ctx, { authorId: 'F1', text: 'Hi', comment: 'Link: https://e.com' })
    await bufferFacebookProvider.createPost(ctx, { authorId: 'F1', text: 'Hi' })
    await bufferInstagramProvider.createPost(ctx, {
      authorId: 'I1',
      text: 'Caption',
      image: { ref: 'https://app.example.com/i.jpg', altText: null }
    })
    assert.deepStrictEqual(inputs[0].metadata, {
      facebook: { type: 'post', firstComment: 'Link: https://e.com' }
    })
    assert.deepStrictEqual(inputs[1].metadata, { facebook: { type: 'post' } })
    assert.deepStrictEqual(inputs[2].metadata, {
      instagram: { type: 'post', shouldShareToFeed: true }
    })
    assert.strictEqual(bufferFacebookProvider.commentInPost, true)
    assert.strictEqual(bufferInstagramProvider.requiresImage, true)
    assert.deepStrictEqual(bufferInstagramProvider.formats, ['instagram.caption'])
  })
})

describe('image links Buffer can reach', () => {
  it('knows which origins only this computer or its network can open', async () => {
    const { isPrivateOrigin } = await import('../src/lib/publishing/media-token')
    for (const origin of [
      'http://localhost:3000',
      'https://localhost:3000',
      'http://app.localhost',
      'http://127.0.0.1:3000',
      'http://192.168.2.62:3000',
      'http://10.0.0.5',
      'http://172.20.1.1',
      'http://[::1]:3000',
      'not a url'
    ]) {
      assert.strictEqual(isPrivateOrigin(origin), true, origin)
    }
    for (const origin of [
      'https://app.example.com',
      'https://abc-def.trycloudflare.com',
      'http://172.32.0.1',
      'https://8.8.8.8'
    ]) {
      assert.strictEqual(isPrivateOrigin(origin), false, origin)
    }
  })

  it('refuses an image post from localhost before Buffer is called, saying what to set', async () => {
    const { bufferInstagramProvider } = await import('../src/lib/publishing/buffer/provider')
    const { PostImageError } = await import('../src/lib/publishing/errors')
    const config = {
      oauth: null,
      apiUrl: 'https://buffer.example/graphql',
      appUrl: 'http://localhost:3000',
      encryptionKey: key
    }
    const input = {
      authorId: 'I1',
      draftId: 'POST-1',
      image: { bytes: Buffer.from('png'), mediaType: 'image/png', altText: null },
      now: new Date()
    }
    const err = await bufferInstagramProvider
      .prepareImage({ accessToken: 'KEY', config }, input)
      .catch(e => e)
    assert.ok(err instanceof PostImageError)
    assert.match(err.message, /http:\/\/localhost:3000.*PUBLISHING_MEDIA_URL/)

    const url = await bufferInstagramProvider.prepareImage(
      { accessToken: 'KEY', config: { ...config, appUrl: 'https://abc.trycloudflare.com' } },
      input
    )
    assert.match(url, /^https:\/\/abc\.trycloudflare\.com\/api\/publishing-media\/.+\?for=instagram$/)
  })
})
