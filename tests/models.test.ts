import assert from 'node:assert'
import { describe, it } from 'node:test'
import { estimateCostUsd } from '../src/lib/ai/usage'
import { defaultModel, fastModel } from '../src/lib/models'

describe('which model the app uses', () => {
  it('is Sonnet, with the current Haiku for mechanical work', () => {
    assert.strictEqual(defaultModel, 'claude-sonnet-5-5')
    assert.strictEqual(fastModel, 'claude-haiku-5-5')
    assert.ok(!/opus/i.test(defaultModel + fastModel))
  })

  it('prices Haiku 5.5 at its own rates, a twentieth of Sonnet', () => {
    const usage = {
      noCacheInputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000
    }
    // 0.10 input + 0.01 cache read + 0.50 output per million tokens.
    assert.ok(Math.abs(estimateCostUsd(fastModel, usage) - 0.61) < 1e-9)
    assert.ok(
      Math.abs(estimateCostUsd(`anthropic/${fastModel}`, usage) - 0.61) < 1e-9
    )
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
