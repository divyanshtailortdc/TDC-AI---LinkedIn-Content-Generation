import assert from 'node:assert'
import { describe, it } from 'node:test'
import { newRequestId } from '../src/lib/blogs/input'
import { blogViewKey } from '../src/lib/blogs/types'
import { isUuid } from '../src/lib/ids'

describe('the blog page in the browser', () => {
  it('opens the editor afresh when a run fails again, stops, or saves new text', () => {
    const base = {
      lockVersion: 5,
      generationStatus: 'failed',
      generationStartedAt: '2026-11-24T10:00:00.000Z',
      stale: false
    }
    const key = blogViewKey(base)
    assert.strictEqual(blogViewKey({ ...base }), key)
    // A second failed run of the same text: only its start time differs.
    assert.notStrictEqual(
      blogViewKey({ ...base, generationStartedAt: '2026-11-24T10:05:00.000Z' }),
      key
    )
    // A regeneration that stopped.
    assert.notStrictEqual(
      blogViewKey({ ...base, generationStatus: 'generating', stale: true }),
      blogViewKey({ ...base, generationStatus: 'generating', stale: false })
    )
    assert.notStrictEqual(blogViewKey({ ...base, lockVersion: 6 }), key)
  })

  it('makes request ids where crypto.randomUUID is missing (a plain-http page)', () => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
      writable: true
    })
    try {
      const a = newRequestId()
      const b = newRequestId()
      assert.ok(isUuid(a), a)
      assert.ok(isUuid(b), b)
      assert.notStrictEqual(a, b)
    } finally {
      delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID
    }
    assert.ok(isUuid(newRequestId()))
  })
})
