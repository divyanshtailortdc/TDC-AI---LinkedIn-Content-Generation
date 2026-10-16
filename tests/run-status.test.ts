import assert from 'node:assert'
import { describe, it } from 'node:test'
import { runStatusAfterDrafting } from '../src/lib/run-status'

const idle = { batchRunning: false }
const midBatch = { batchRunning: true }

describe('run status after drafting', () => {
  it('stays awaiting approval while ideas are still proposed (first batch drafted)', () => {
    assert.equal(runStatusAfterDrafting(['drafted', 'drafted', 'proposed'], midBatch), 'awaiting_idea_approval')
    assert.equal(runStatusAfterDrafting(['drafted', 'proposed'], idle), 'awaiting_idea_approval')
  })

  it('returns to awaiting approval when a failed attempt left approved ideas', () => {
    // The request ended; nothing is being drafted any more.
    assert.equal(runStatusAfterDrafting(['drafted', 'approved', 'approved'], idle), 'awaiting_idea_approval')
  })

  it('stays "drafting" while the same request still has approved ideas to reach', () => {
    assert.equal(runStatusAfterDrafting(['drafted', 'approved'], midBatch), 'drafting')
  })

  it('stays "drafting" while another request is drafting an idea', () => {
    assert.equal(runStatusAfterDrafting(['drafting', 'approved'], idle), 'drafting')
  })

  it('is completed only when nothing is waiting', () => {
    assert.equal(runStatusAfterDrafting(['drafted', 'drafted', 'rejected'], idle), 'completed')
    assert.equal(runStatusAfterDrafting(['drafted', 'rejected'], midBatch), 'completed')
  })
})
