import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  EMPTY_SUGGESTIONS,
  hasReviewableSuggestions,
  type IdentitySetupSuggestions
} from '../src/lib/ai/skills/profile-setup/schema'

const withKnowledge = (
  knowledge: Partial<IdentitySetupSuggestions['knowledge']>
): IdentitySetupSuggestions => ({
  ...EMPTY_SUGGESTIONS,
  knowledge: { ...EMPTY_SUGGESTIONS.knowledge, ...knowledge }
})
const fact = { statement: 'S', quote: 'Q', source: 'description' }

describe('leftover knowledge does not keep the card on "Apply Suggestions"', () => {
  it('nothing left means nothing to review', () => {
    assert.equal(hasReviewableSuggestions(EMPTY_SUGGESTIONS), false)
  })

  it('facts and ideas alone are not reviewable', () => {
    assert.equal(hasReviewableSuggestions(withKnowledge({ facts: [fact] })), false)
    assert.equal(hasReviewableSuggestions(withKnowledge({ suggestedAdditions: ['A case study'] })), false)
  })

  it('a source the review window can add is reviewable', () => {
    const source = { url: 'https://acme.com', title: 'Acme', reason: 'r', accessible: true }
    assert.equal(hasReviewableSuggestions(withKnowledge({ sources: [source] })), true)
  })

  it('another section with suggestions is reviewable', () => {
    const s: IdentitySetupSuggestions = {
      ...EMPTY_SUGGESTIONS,
      profile: {
        missing: [],
        name: { value: 'Priya', kind: 'fact', source: 'description', confidence: 'high' }
      }
    }
    assert.equal(hasReviewableSuggestions(s), true)
  })
})
