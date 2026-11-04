import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  deliver,
  DeliveryError,
  readPrefix,
  sign,
  toBase64
} from '../cloudflare/email-worker/src/deliver'
import { toMessageRow } from '../src/lib/mail/parse-message'
import {
  deliveryUid,
  inboundPayloadSchema,
  localPartOf,
  signatureError,
  signatureFor
} from '../src/lib/mail/webhook-payload'

const SECRET = 'a-test-secret-that-is-long-enough-123'
const NOW = Date.UTC(2026, 10, 3, 12)
const TS = String(NOW / 1000)
const body = new TextEncoder().encode('{"to":"test@in.tdc.test"}')

const check = (over: Partial<Parameters<typeof signatureError>[0]>) =>
  signatureError({
    secret: SECRET,
    timestamp: TS,
    signature: signatureFor(SECRET, TS, body),
    body,
    now: NOW,
    toleranceMs: 5 * 60_000,
    ...over
  })

describe('webhook signature', () => {
  it('the worker signs exactly as the app verifies', async () => {
    assert.strictEqual(
      await sign(SECRET, TS, body),
      signatureFor(SECRET, TS, body)
    )
    assert.strictEqual(check({ signature: await sign(SECRET, TS, body) }), null)
  })

  it('refuses a changed body, another secret and a missing header', () => {
    assert.strictEqual(
      check({ body: new TextEncoder().encode('{"to":"other@in.tdc.test"}') }),
      'bad signature'
    )
    assert.strictEqual(
      check({
        signature: signatureFor('another-secret-that-is-long-enough', TS, body)
      }),
      'bad signature'
    )
    assert.strictEqual(check({ signature: 'v1=short' }), 'bad signature')
    assert.strictEqual(check({ signature: null }), 'missing signature')
    assert.strictEqual(check({ timestamp: null }), 'missing signature')
  })

  it('refuses old, future and malformed timestamps', () => {
    for (const offset of [-6 * 60, 6 * 60]) {
      const ts = String(NOW / 1000 + offset)
      assert.strictEqual(
        check({ timestamp: ts, signature: signatureFor(SECRET, ts, body) }),
        'timestamp outside the allowed window'
      )
    }
    assert.strictEqual(check({ timestamp: '12.5' }), 'malformed timestamp')
  })
})

describe('localPartOf', () => {
  it('reads the identity name from the envelope recipient', () => {
    assert.strictEqual(
      localPartOf('Test.Sisodia@IN.tdc.test', 'in.tdc.test'),
      'test.sisodia'
    )
    assert.strictEqual(localPartOf(' test@in.tdc.test ', 'IN.TDC.TEST'), 'test')
  })

  it('is null for other domains and odd addresses', () => {
    assert.strictEqual(localPartOf('test@gmail.com', 'in.tdc.test'), null)
    assert.strictEqual(localPartOf('test@evilin.tdc.test', 'in.tdc.test'), null)
    assert.strictEqual(localPartOf('@in.tdc.test', 'in.tdc.test'), null)
    assert.strictEqual(localPartOf('a@b@in.tdc.test', 'in.tdc.test'), null)
  })
})

describe('deliveryUid', () => {
  const raw = Buffer.from('Subject: hi\r\n\r\nbody')

  it('is the same for the same delivery and a safe positive integer', () => {
    const uid = deliveryUid('test', raw)
    assert.strictEqual(uid, deliveryUid('test', Buffer.from(raw)))
    assert.ok(Number.isSafeInteger(uid) && uid > 0)
  })

  it('differs by recipient and by content', () => {
    assert.notStrictEqual(deliveryUid('test', raw), deliveryUid('other', raw))
    assert.notStrictEqual(
      deliveryUid('test', raw),
      deliveryUid('test', Buffer.from('x'))
    )
  })
})

describe('inboundPayloadSchema', () => {
  const good = {
    to: 'test@in.tdc.test',
    from: '',
    rawSize: 4,
    raw: toBase64(new Uint8Array([1, 2, 3, 4]))
  }

  it('accepts a bounce (empty MAIL FROM)', () => {
    assert.ok(inboundPayloadSchema.safeParse(good).success)
  })

  it('refuses bad base64, sizes and missing fields', () => {
    assert.ok(
      !inboundPayloadSchema.safeParse({ ...good, raw: 'not base64!' }).success
    )
    assert.ok(!inboundPayloadSchema.safeParse({ ...good, rawSize: -1 }).success)
    assert.ok(
      !inboundPayloadSchema.safeParse({ ...good, rawSize: 1.5 }).success
    )
    assert.ok(!inboundPayloadSchema.safeParse({ raw: good.raw }).success)
  })
})

describe('worker reading', () => {
  const streamOf = (...chunks: number[][]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk))
        controller.close()
      }
    })

  it('reads at most the limit, across chunks', async () => {
    assert.deepStrictEqual(
      [...(await readPrefix(streamOf([1, 2], [3, 4, 5]), 3))],
      [1, 2, 3]
    )
    assert.deepStrictEqual(
      [...(await readPrefix(streamOf([1, 2]), 10))],
      [1, 2]
    )
  })

  it('base64 matches Node for large input', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 7) % 256)
    assert.strictEqual(toBase64(bytes), Buffer.from(bytes).toString('base64'))
  })
})

describe('worker delivery', () => {
  const email = {
    to: 'test@in.tdc.test',
    from: 'a@b.com',
    rawSize: 3,
    raw: new Uint8Array([65, 66, 67])
  }

  function fakeFetch(answers: Array<number | Error | [number, unknown]>) {
    const calls: RequestInit[] = []
    const fn = (async (_url: string, init: RequestInit) => {
      calls.push(init)
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)]
      if (answer instanceof Error) throw answer
      const [status, json] = Array.isArray(answer)
        ? answer
        : [answer, { error: 'x' }]
      return Response.json(json, { status })
    }) as unknown as typeof fetch
    return { fn, calls }
  }

  const options = (fetch: typeof globalThis.fetch) => ({
    url: 'http://app/api/mail/inbound',
    secret: SECRET,
    fetch,
    sleep: async () => {},
    now: () => NOW
  })

  it('posts a body the app verifies and returns its outcome', async () => {
    const { fn, calls } = fakeFetch([[200, { status: 'stored' }]])
    assert.strictEqual(await deliver(email, options(fn)), 'stored')
    const headers = calls[0]!.headers as Record<string, string>
    const sent = calls[0]!.body as Uint8Array
    assert.strictEqual(
      check({
        body: sent,
        timestamp: headers['x-mail-timestamp']!,
        signature: headers['x-mail-signature']!
      }),
      null
    )
    const payload = inboundPayloadSchema.parse(
      JSON.parse(new TextDecoder().decode(sent))
    )
    assert.strictEqual(Buffer.from(payload.raw, 'base64').toString(), 'ABC')
  })

  it('retries 5xx and network errors, then succeeds', async () => {
    const { fn, calls } = fakeFetch([
      503,
      new Error('ECONNRESET'),
      [200, { status: 'duplicate' }]
    ])
    assert.strictEqual(await deliver(email, options(fn)), 'duplicate')
    assert.strictEqual(calls.length, 3)
  })

  it('gives up after its attempts, keeping the last error', async () => {
    const { fn, calls } = fakeFetch([500])
    await assert.rejects(
      deliver(email, options(fn)),
      (err: DeliveryError) => err.status === 500
    )
    assert.strictEqual(calls.length, 3)
  })

  it('does not retry a 4xx or an answer it does not know', async () => {
    for (const answer of [401, 400, 404, [200, { status: 'weird' }]] as const) {
      const { fn, calls } = fakeFetch([answer as number])
      await assert.rejects(deliver(email, options(fn)), DeliveryError)
      assert.strictEqual(calls.length, 1)
    }
  })
})

describe('toMessageRow for webhook mail', () => {
  const owner = { accountId: 'a', mailboxId: 'm', uidValidity: 0 }

  it('falls back to the envelope when the source cannot be parsed', () => {
    const row = toMessageRow(
      owner,
      {
        uid: 7,
        size: 10,
        internalDate: new Date(NOW),
        envelope: {
          from: [{ address: 'news@substack.com' }],
          to: [{ address: 'test@in.tdc.test' }]
        }
      },
      null
    )
    assert.strictEqual(row.fromAddress, 'news@substack.com')
    assert.deepStrictEqual(row.toAddresses, [
      { name: null, address: 'test@in.tdc.test' }
    ])
    assert.strictEqual(row.subject, null)
    assert.strictEqual(row.receivedAt?.getTime(), NOW)
  })
})
