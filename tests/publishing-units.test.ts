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
