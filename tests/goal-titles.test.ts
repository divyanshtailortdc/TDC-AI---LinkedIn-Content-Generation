import assert from 'node:assert'
import { describe, it } from 'node:test'
import { hasGoalTitle } from '../src/lib/goal-titles'

describe('goal title duplicates', () => {
  const saved = ['Book discovery calls', 'Grow followers']

  it('finds the same title however it is cased or spaced', () => {
    assert.equal(hasGoalTitle(saved, 'Book discovery calls'), true)
    assert.equal(hasGoalTitle(saved, '  book   DISCOVERY calls '), true)
  })

  it('does not match a different title', () => {
    assert.equal(hasGoalTitle(saved, 'Book discovery calls with founders'), false)
    assert.equal(hasGoalTitle([], 'Book discovery calls'), false)
  })

  it('an empty title never counts as a duplicate', () => {
    assert.equal(hasGoalTitle(saved, ''), false)
    assert.equal(hasGoalTitle(['', ' '], '  '), false)
  })
})
