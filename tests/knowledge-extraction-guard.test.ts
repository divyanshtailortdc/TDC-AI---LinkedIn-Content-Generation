import assert from 'node:assert'
import { describe, it } from 'node:test'
import { keepVerifiableClaims } from '../src/lib/ai/skills/knowledge-extraction/guard'

const content =
  'In 2024 churn fell 14% after onboarding moved to week one. ' +
  'The team grew to 1,200 customers across 25 cities, and revenue reached $1.5 million.'

const kept = (claim: string, quote: string) =>
  keepVerifiableClaims([{ claim, quote }], content).length === 1

describe('a knowledge claim keeps only the numbers its quote states', () => {
  it('keeps a claim whose figures are all in its quote', () => {
    assert.ok(kept('Churn dropped 14% in 2024.', 'In 2024 churn fell 14% after onboarding'))
  })

  it('keeps a claim with no numbers', () => {
    assert.ok(kept('Moving onboarding earlier reduced churn.', 'churn fell 14% after onboarding moved'))
  })

  it('drops a misread figure even though the quote is verbatim', () => {
    assert.ok(!kept('Churn dropped 41% in 2024.', 'In 2024 churn fell 14% after onboarding'))
  })

  it('drops a misread year', () => {
    assert.ok(!kept('Churn dropped 14% in 2023.', 'In 2024 churn fell 14% after onboarding'))
  })

  it('drops a number that is only part of one in the quote', () => {
    assert.ok(!kept('They serve 5 cities.', 'grew to 1,200 customers across 25 cities'))
  })

  it('drops a number the quote does not state at all', () => {
    assert.ok(!kept('Churn fell 14% within 30 days.', 'In 2024 churn fell 14% after onboarding'))
  })

  it('treats thousands separators and units as the same number', () => {
    assert.ok(kept('They reached 1200 customers.', 'grew to 1,200 customers across 25 cities'))
    assert.ok(kept('Revenue hit $1.5M.', 'revenue reached $1.5 million'))
  })

  it('still drops a quote that is not in the source', () => {
    assert.ok(!kept('Churn fell 14%.', 'churn fell 14 percent after onboarding'))
  })
})
