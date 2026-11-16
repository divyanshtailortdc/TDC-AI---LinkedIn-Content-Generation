import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  createOAuthState,
  STATE_TTL_MS,
  verifyOAuthState
} from '../src/lib/publishing/oauth-state'
import {
  decryptToken,
  encryptToken,
  TokenDecryptionError
} from '../src/lib/publishing/token-crypto'

/** Publishing pieces that need no database. */

const key = randomBytes(32)

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
    const { state, cookie } = createOAuthState(key, 'user-a', 1_000)
    assert.deepStrictEqual(
      verifyOAuthState(key, { cookie, state, userId: 'user-a', now: 2_000 }),
      {
        ok: true,
        accountId: null,
        // When the flow started: what a duplicate callback is checked against.
        issuedAt: 1_000
      }
    )
  })

  it('carries the identity the connection is for, and refuses it swapped', () => {
    const { state, cookie } = createOAuthState(key, 'user-a', 1_000, 'linkedin', 'identity-1')
    assert.deepStrictEqual(
      verifyOAuthState(key, { cookie, state, userId: 'user-a', now: 2_000 }),
      { ok: true, accountId: 'identity-1', issuedAt: 1_000 }
    )
    // Another user, even with the same identity id, is refused.
    assert.strictEqual(
      verifyOAuthState(key, { cookie, state, userId: 'user-b' }).ok,
      false
    )
    // Pointing the cookie at another identity breaks its signature.
    const swapped = cookie.replace('identity-1', 'identity-2')
    assert.deepStrictEqual(
      verifyOAuthState(key, { cookie: swapped, state, userId: 'user-a' }),
      { ok: false, reason: 'invalid' }
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

  it("names the network in Buffer's errors", async () => {
    const { getAccount } = await import('../src/lib/publishing/buffer/api')
    const refused = (async () =>
      Response.json({ errors: [{ message: 'no', extensions: { code: 'UNAUTHORIZED' } }] })) as typeof fetch
    const err = await getAccount({
      apiKey: 'KEY',
      apiUrl: 'https://buffer.example/graphql',
      fetchFn: refused,
      platformName: 'Instagram'
    }).catch(e => e)
    assert.strictEqual(err.code, 'reauth_required')
    assert.match(err.message, /Reconnect Buffer in Settings to keep publishing to Instagram/)
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

  it("Threads sends its reply as a thread under Threads' own key; X keeps twitter", async () => {
    const { bufferThreadsProvider, bufferXProvider } = await import(
      '../src/lib/publishing/buffer/provider'
    )
    const inputs: any[] = []
    const fetchFn = (async (_url: string | URL, init: RequestInit = {}) => {
      inputs.push(JSON.parse(String(init.body)).variables.input)
      return Response.json({
        data: {
          createPost: {
            __typename: 'PostActionSuccess',
            post: { id: 'P1', status: 'sent', externalLink: null, sentAt: null }
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
    await bufferThreadsProvider.createPost(ctx, { authorId: 'T1', text: 'Post', replies: ['Reply'] })
    await bufferThreadsProvider.createPost(ctx, { authorId: 'T1', text: 'Post' })
    await bufferXProvider.createPost(ctx, { authorId: 'X1', text: 'Post', replies: ['Reply'] })
    assert.deepStrictEqual(inputs[0].metadata, {
      threads: {
        thread: [
          { text: 'Post', assets: [] },
          { text: 'Reply', assets: [] }
        ]
      }
    })
    // A post without a reply needs no metadata at all.
    assert.strictEqual(inputs[1].metadata, undefined)
    assert.deepStrictEqual(Object.keys(inputs[2].metadata), ['twitter'])
    assert.deepStrictEqual(bufferThreadsProvider.formats, ['threads.post'])
    assert.strictEqual(bufferThreadsProvider.threads, true)
    assert.strictEqual(bufferThreadsProvider.maxPostLength, 500)
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
