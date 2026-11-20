import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatPostCost,
  formatTokens,
  postUsageStageLabel,
  summarizePostUsage
} from '../src/lib/post-usage'

/** What each post cost in AI, from its ledger rows (src/lib/post-usage.ts). */

const row = (
  draftId: string,
  stage: string,
  costUsd: number,
  tokens: number,
  more = {}
) => ({
  draftId,
  stage,
  calls: 1,
  inputTokens: Math.round(tokens * 0.8),
  outputTokens: Math.round(tokens * 0.2),
  totalTokens: tokens,
  costUsd,
  estimated: false,
  ...more
})

describe('post usage', () => {
  it('adds up each post on its own, by kind of work, the costliest first', () => {
    const usage = summarizePostUsage([
      row('A', 'drafting', 0.03, 12_000, { calls: 2 }),
      row('A', 'image', 0.04, 0),
      row('A', 'media_brief', 0.005, 3_000),
      row('B', 'video', 0.64, 0, { estimated: true })
    ])
    const a = usage.get('A')!
    assert.equal(a.calls, 4)
    assert.equal(a.totalTokens, 15_000)
    assert.equal(a.inputTokens + a.outputTokens, 15_000)
    assert.ok(Math.abs(a.costUsd - 0.075) < 1e-9)
    assert.equal(a.estimated, false)
    assert.deepEqual(
      a.stages.map(s => [s.label, s.calls]),
      [
        ['Image', 1],
        ['Writing', 2],
        ['Image planning', 1]
      ]
    )
    const b = usage.get('B')!
    assert.equal(b.estimated, true)
    assert.equal(b.stages[0]!.label, 'Video')
    assert.equal(usage.has('C'), false)
  })

  it('names stages people know, and any other one readably', () => {
    assert.equal(postUsageStageLabel('media_review'), 'Image check')
    assert.equal(postUsageStageLabel('goal_review'), 'Goal review')
  })

  it("shows a post's cost to the hundredth of a cent, and tokens compactly", () => {
    assert.equal(formatPostCost(0.07342), '$0.0734')
    assert.equal(formatPostCost(1.2), '$1.20')
    assert.equal(formatPostCost(0.00001), '<$0.0001')
    assert.equal(formatPostCost(0), '$0.0000')
    assert.equal(formatTokens(940), '940')
    assert.equal(formatTokens(18_240), '18.2k')
    assert.equal(formatTokens(2_000_000), '2M')
  })
})
