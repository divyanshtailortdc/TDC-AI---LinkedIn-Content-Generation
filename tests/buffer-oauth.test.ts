import assert from 'node:assert'
import { createHash, randomBytes } from 'node:crypto'
import { describe, it } from 'node:test'
import { getAccount, listAllChannels } from '../src/lib/publishing/buffer/api'
import {
  BufferOAuthError,
  buildAuthorizationUrl,
  callbackErrorResult,
  exchangeCode,
  missingBufferScopes,
  refreshAccessToken,
  type BufferOAuthConfig
} from '../src/lib/publishing/buffer/oauth'
import {
  bufferTokenKey,
  encryptBufferToken,
  tokenColumns
} from '../src/lib/publishing/buffer/token'
import {
  createOAuthState,
  pkceChallenge,
  pkceVerifier,
  verifyOAuthState
} from '../src/lib/publishing/oauth-state'
import { bufferPlatformOf } from '../src/lib/publishing/platform'
import {
  decryptToken,
  TokenDecryptionError
} from '../src/lib/publishing/token-crypto'

/**
 * Buffer OAuth pieces that need no database, against stubbed Buffer
 * responses: the consent URL, the state, the code exchange and refresh, token
 * encryption, and reading the account and its channels.
 */

const key = randomBytes(32)
const confidential: BufferOAuthConfig = {
  clientId: 'buffer-client',
  clientSecret: 'buffer-secret',
  redirectUri: 'https://app.example.com/api/integrations/buffer/callback',
  scopes: ['account:read', 'posts:read', 'posts:write', 'offline_access']
}
const publicClient: BufferOAuthConfig = {
  ...confidential,
  clientSecret: undefined
}

/** Records the token request and answers with `body` (and `status`). */
function tokenEndpoint(body: unknown, status = 200) {
  const seen: Array<{
    url: string
    body: URLSearchParams
    contentType: string
  }> = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen.push({
      url: String(url),
      body: new URLSearchParams(String(init.body)),
      contentType: (init.headers as Record<string, string>)['Content-Type']!
    })
    return Response.json(body, { status })
  }) as typeof fetch
  return { fetchFn, seen }
}

describe('Buffer authorization URL', () => {
  it("goes to Buffer's consent screen with the scopes, state, redirect and an S256 PKCE challenge", () => {
    const verifier = pkceVerifier(key, 'the-state')
    const url = new URL(
      buildAuthorizationUrl(confidential, 'the-state', verifier)
    )
    assert.strictEqual(
      url.origin + url.pathname,
      'https://auth.buffer.com/auth'
    )
    assert.strictEqual(url.searchParams.get('response_type'), 'code')
    assert.strictEqual(url.searchParams.get('client_id'), 'buffer-client')
    assert.strictEqual(
      url.searchParams.get('redirect_uri'),
      confidential.redirectUri
    )
    assert.strictEqual(
      url.searchParams.get('scope'),
      'account:read posts:read posts:write offline_access'
    )
    assert.strictEqual(url.searchParams.get('state'), 'the-state')
    assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256')
    assert.strictEqual(
      url.searchParams.get('code_challenge'),
      createHash('sha256').update(verifier).digest('base64url')
    )
    // The secret and the verifier never go to the browser.
    assert.ok(!url.toString().includes('buffer-secret'))
    assert.ok(!url.toString().includes(verifier))
  })

  it('derives a 43-character verifier only this server can work out from the state', () => {
    const verifier = pkceVerifier(key, 'state-1')
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/)
    assert.strictEqual(pkceVerifier(key, 'state-1'), verifier)
    assert.notStrictEqual(pkceVerifier(key, 'state-2'), verifier)
    assert.notStrictEqual(pkceVerifier(randomBytes(32), 'state-1'), verifier)
    assert.strictEqual(pkceChallenge(verifier).length, 43)
  })
})

describe('Buffer OAuth state', () => {
  it("accepts this user's own Buffer flow and says when it started", () => {
    const { state, cookie } = createOAuthState(
      key,
      'user-a',
      5_000,
      'buffer',
      'identity-1'
    )
    assert.deepStrictEqual(
      verifyOAuthState(key, {
        cookie,
        state,
        userId: 'user-a',
        flow: 'buffer',
        now: 6_000
      }),
      { ok: true, accountId: 'identity-1', issuedAt: 5_000 }
    )
  })

  it("refuses a state made for another platform's flow, another user, or after ten minutes", () => {
    const { state, cookie } = createOAuthState(key, 'user-a', 5_000, 'x')
    assert.deepStrictEqual(
      verifyOAuthState(key, {
        cookie,
        state,
        userId: 'user-a',
        flow: 'buffer',
        now: 6_000
      }),
      { ok: false, reason: 'invalid' }
    )
    const buffer = createOAuthState(key, 'user-a', 5_000, 'buffer')
    assert.deepStrictEqual(
      verifyOAuthState(key, {
        ...buffer,
        userId: 'user-b',
        flow: 'buffer',
        now: 6_000
      }),
      { ok: false, reason: 'wrong_user' }
    )
    assert.deepStrictEqual(
      verifyOAuthState(key, {
        ...buffer,
        userId: 'user-a',
        flow: 'buffer',
        now: 5_000 + 10 * 60_000 + 1
      }),
      { ok: false, reason: 'expired' }
    )
    assert.deepStrictEqual(
      verifyOAuthState(key, {
        cookie: buffer.cookie,
        state: 'forged',
        userId: 'user-a',
        flow: 'buffer',
        now: 6_000
      }),
      { ok: false, reason: 'mismatch' }
    )
  })

  it('reports a user who said no as cancelled, any other error as failed', () => {
    assert.strictEqual(callbackErrorResult('access_denied'), 'cancelled')
    assert.strictEqual(callbackErrorResult('invalid_scope'), 'failed')
    assert.strictEqual(callbackErrorResult('invalid_request'), 'failed')
  })
})

describe('Buffer token exchange and refresh', () => {
  it('exchanges the code with the verifier, and the secret of a confidential client, in the body', async () => {
    const endpoint = tokenEndpoint({
      access_token: 'AT-1',
      refresh_token: 'RT-1',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'account:read posts:read posts:write offline_access'
    })
    const tokens = await exchangeCode(
      confidential,
      'CODE',
      'VERIFIER',
      endpoint.fetchFn,
      0
    )
    const [request] = endpoint.seen
    assert.strictEqual(request!.url, 'https://auth.buffer.com/token')
    assert.strictEqual(
      request!.contentType,
      'application/x-www-form-urlencoded'
    )
    assert.strictEqual(request!.body.get('grant_type'), 'authorization_code')
    assert.strictEqual(request!.body.get('code'), 'CODE')
    assert.strictEqual(request!.body.get('code_verifier'), 'VERIFIER')
    assert.strictEqual(
      request!.body.get('redirect_uri'),
      confidential.redirectUri
    )
    assert.strictEqual(request!.body.get('client_secret'), 'buffer-secret')
    assert.deepStrictEqual(tokens, {
      accessToken: 'AT-1',
      accessTokenExpiresAt: new Date(3_600_000),
      refreshToken: 'RT-1',
      refreshTokenExpiresAt: null,
      scopes: ['account:read', 'posts:read', 'posts:write', 'offline_access']
    })
  })

  it('a public client authenticates with the verifier alone: no secret is sent', async () => {
    const endpoint = tokenEndpoint({ access_token: 'AT', expires_in: 60 })
    await exchangeCode(publicClient, 'CODE', 'VERIFIER', endpoint.fetchFn, 0)
    assert.strictEqual(endpoint.seen[0]!.body.get('client_secret'), null)
    assert.strictEqual(endpoint.seen[0]!.body.get('code_verifier'), 'VERIFIER')
  })

  it('refreshes with the refresh token and gets a new one in its place', async () => {
    const endpoint = tokenEndpoint({
      access_token: 'AT-2',
      refresh_token: 'RT-2',
      expires_in: 3600
    })
    const tokens = await refreshAccessToken(
      confidential,
      'RT-1',
      endpoint.fetchFn,
      1_000
    )
    assert.strictEqual(
      endpoint.seen[0]!.body.get('grant_type'),
      'refresh_token'
    )
    assert.strictEqual(endpoint.seen[0]!.body.get('refresh_token'), 'RT-1')
    assert.strictEqual(tokens.refreshToken, 'RT-2')
    assert.strictEqual(tokens.accessTokenExpiresAt.getTime(), 1_000 + 3_600_000)
    // Without a scope in the answer, the asked-for scopes stand.
    assert.deepStrictEqual(tokens.scopes, confidential.scopes)
  })

  it("an invalid or expired code is refused with Buffer's reason, never the request's secrets", async () => {
    const endpoint = tokenEndpoint(
      {
        error: 'invalid_grant',
        error_description: 'Authorization code has expired'
      },
      400
    )
    const err = await exchangeCode(
      confidential,
      'SECRET-CODE',
      'VERIFIER',
      endpoint.fetchFn
    ).catch(e => e)
    assert.ok(err instanceof BufferOAuthError)
    assert.strictEqual(err.status, 400)
    assert.match(err.message, /Authorization code has expired/)
    for (const secret of ['SECRET-CODE', 'VERIFIER', 'buffer-secret']) {
      assert.ok(!err.message.includes(secret), secret)
    }
  })

  it('a 200 without an access token is a failure, not a connection', async () => {
    const endpoint = tokenEndpoint({ token_type: 'Bearer' })
    await assert.rejects(
      refreshAccessToken(confidential, 'RT', endpoint.fetchFn),
      BufferOAuthError
    )
  })

  it('needs account:read and posts:write; the rest is optional', () => {
    assert.deepStrictEqual(missingBufferScopes(confidential.scopes), [])
    assert.deepStrictEqual(
      missingBufferScopes(['account:read', 'posts:write']),
      []
    )
    assert.deepStrictEqual(
      missingBufferScopes(['posts:read', 'offline_access']),
      ['account:read', 'posts:write']
    )
  })
})

describe('Buffer token encryption', () => {
  const tokenKey = randomBytes(32)
  const config = { encryptionKey: key, tokenEncryptionKey: tokenKey }

  it('encrypts both tokens with the Buffer key, for their owner only', () => {
    const columns = tokenColumns(config, 'user-a', {
      accessToken: 'AT-plain',
      accessTokenExpiresAt: new Date(0),
      refreshToken: 'RT-plain'
    })
    for (const value of [columns.accessToken, columns.refreshToken!]) {
      assert.ok(!value.includes('plain'))
      assert.match(value, /^v1:/)
    }
    assert.strictEqual(
      decryptToken(columns.accessToken, tokenKey, 'user-a'),
      'AT-plain'
    )
    assert.strictEqual(
      decryptToken(columns.refreshToken!, tokenKey, 'user-a'),
      'RT-plain'
    )
    // Not with the general key, and not on another user's row.
    assert.throws(
      () => decryptToken(columns.accessToken, key, 'user-a'),
      TokenDecryptionError
    )
    assert.throws(
      () => decryptToken(columns.accessToken, tokenKey, 'user-b'),
      TokenDecryptionError
    )
  })

  it('uses TOKEN_ENCRYPTION_KEY when no Buffer key is set, and a fresh IV every time', () => {
    assert.strictEqual(bufferTokenKey({ encryptionKey: key }), key)
    const a = encryptBufferToken({ encryptionKey: key }, 'user-a', 'same')
    const b = encryptBufferToken({ encryptionKey: key }, 'user-a', 'same')
    assert.notStrictEqual(a, b)
    assert.strictEqual(
      tokenColumns(config, 'user-a', {
        accessToken: 'AT',
        accessTokenExpiresAt: new Date(0),
        refreshToken: null
      }).refreshToken,
      null
    )
  })
})

describe('reading the Buffer account and its channels', () => {
  const graphql = (answers: Record<string, unknown>) => {
    const seen: Array<{ operation: string; variables: any; auth: string }> = []
    const fetchFn = (async (_url: string | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body))
      const operation = /(query|mutation)\s+(\w+)/.exec(body.query)![2]!
      seen.push({
        operation,
        variables: body.variables,
        auth: (init.headers as Record<string, string>).Authorization!
      })
      const answer = answers[operation]
      return typeof answer === 'function'
        ? (answer as (v: any) => Response)(body.variables)
        : Response.json(answer)
    }) as typeof fetch
    return { fetchFn, seen }
  }

  it('reads the account with the OAuth token, keeping only https avatars', async () => {
    const buffer = graphql({
      Account: {
        data: {
          account: {
            id: 'ACC-1',
            name: ' Dana ',
            email: 'dana@example.com',
            avatar: 'http://insecure.example/a.png',
            organizations: [{ id: 'O1' }, { id: 'O2' }]
          }
        }
      }
    })
    const account = await getAccount({
      apiKey: 'OAUTH-AT',
      apiUrl: 'https://buffer.example',
      fetchFn: buffer.fetchFn
    })
    assert.deepStrictEqual(account, {
      id: 'ACC-1',
      name: 'Dana',
      email: 'dana@example.com',
      avatar: null,
      organizationIds: ['O1', 'O2']
    })
    assert.strictEqual(buffer.seen[0]!.auth, 'Bearer OAUTH-AT')
  })

  it('lists every channel in every organization, on every network, with its state', async () => {
    const buffer = graphql({
      Channels: (variables: any) =>
        Response.json({
          data: {
            channels:
              variables.input.organizationId === 'O1'
                ? [
                    {
                      id: 'X1',
                      name: 'qa',
                      displayName: 'QA',
                      service: 'twitter',
                      type: 'profile',
                      avatar: 'https://cdn.example/x.png'
                    },
                    {
                      id: 'L1',
                      name: 'qa-li',
                      service: 'linkedin',
                      type: 'profile',
                      avatar: ''
                    },
                    {
                      id: 'I1',
                      name: 'qa.ig',
                      service: 'instagram',
                      type: 'business',
                      avatar: '',
                      isLocked: true
                    }
                  ]
                : [
                    {
                      id: 'F1',
                      name: 'page',
                      service: 'facebook',
                      type: 'page',
                      avatar: '',
                      isDisconnected: true
                    }
                  ]
          }
        })
    })
    const channels = await listAllChannels(
      {
        apiKey: 'AT',
        apiUrl: 'https://buffer.example',
        fetchFn: buffer.fetchFn
      },
      ['O1', 'O2']
    )
    assert.deepStrictEqual(
      channels.map(c => [
        c.id,
        c.service,
        c.name,
        c.handle,
        c.organizationId,
        c.isLocked,
        c.isDisconnected
      ]),
      [
        ['X1', 'twitter', 'QA', 'qa', 'O1', false, false],
        ['L1', 'linkedin', 'qa-li', 'qa-li', 'O1', false, false],
        ['I1', 'instagram', 'qa.ig', 'qa.ig', 'O1', true, false],
        ['F1', 'facebook', 'page', 'page', 'O2', false, true]
      ]
    )
    assert.strictEqual(channels[0]!.avatar, 'https://cdn.example/x.png')
    assert.deepStrictEqual(
      channels.map(c => bufferPlatformOf(c.service)),
      ['x', 'linkedin', 'instagram', 'facebook']
    )
  })

  it('a rate limit says how long to wait, and is retryable; a revoked token needs a reconnect', async () => {
    const limited = (async () =>
      Response.json(
        {
          errors: [
            {
              message: 'Too many requests',
              extensions: { code: 'RATE_LIMIT_EXCEEDED', window: '15m' }
            }
          ]
        },
        { status: 429, headers: { 'Retry-After': '753' } }
      )) as typeof fetch
    const err = await getAccount({ apiKey: 'AT', fetchFn: limited }).catch(
      e => e
    )
    assert.strictEqual(err.code, 'rate_limited')
    assert.strictEqual(err.retryable, true)
    assert.strictEqual(err.retryAfterMs, 753_000)
    assert.match(err.message, /about 13 min/)
    // Whether it is tried again is the caller's to say, not Buffer's.
    assert.doesNotMatch(err.message, /tried again/)

    const revoked = (async () =>
      Response.json({
        errors: [
          { message: 'Unauthorized', extensions: { code: 'UNAUTHORIZED' } }
        ]
      })) as typeof fetch
    const refused = await getAccount({ apiKey: 'AT', fetchFn: revoked }).catch(
      e => e
    )
    assert.strictEqual(refused.code, 'reauth_required')
    assert.strictEqual(refused.retryable, false)

    const down = (async () =>
      new Response('Service Unavailable', { status: 503 })) as typeof fetch
    assert.strictEqual(
      (await getAccount({ apiKey: 'AT', fetchFn: down }).catch(e => e)).code,
      'platform_unavailable'
    )
  })
})
