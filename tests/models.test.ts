import assert from 'node:assert'
import { describe, it } from 'node:test'
import { estimateCostUsd } from '../src/lib/ai/usage'
import { defaultModel, fastModel } from '../src/lib/models'

describe('which model the app uses', () => {
  it('is Sonnet, with Haiku only for bulk extraction', () => {
    assert.strictEqual(defaultModel, 'claude-sonnet-5-5')
    assert.strictEqual(fastModel, 'claude-haiku-4-5')
    assert.ok(!/opus/i.test(defaultModel + fastModel))
  })
})

describe('cost for a model missing from the price table', () => {
  const usage = {
    noCacheInputTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 1_000_000
  }

  it('is priced as Sonnet, not Opus', () => {
    const unknown = estimateCostUsd('some-future-model', usage)
    assert.strictEqual(unknown, estimateCostUsd(defaultModel, usage))
    // 2 input + 10 output per million tokens: well under Opus's 5 + 25.
    assert.strictEqual(unknown, 12)
  })
})
