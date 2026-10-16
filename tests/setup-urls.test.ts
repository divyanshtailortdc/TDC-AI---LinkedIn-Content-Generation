import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  AnalysisGuidanceSchema,
  AnalyzeIdentityInputSchema,
  GoalSuggestionsSchema,
  ProfileSuggestionsSchema
} from '../src/lib/ai/skills/profile-setup/schema'

const edited = (value: string) => ({
  value,
  kind: 'fact',
  source: 'edited',
  confidence: 'high'
})

describe('links in AI setup are checked where they are entered', () => {
  it('review window: an edited link must be an http(s) URL', () => {
    for (const bad of ['acme', 'ftp://acme.com', 'javascript:alert(1)', 'not a url']) {
      assert.equal(ProfileSuggestionsSchema.safeParse({ websiteUrl: edited(bad) }).success, false, bad)
      assert.equal(ProfileSuggestionsSchema.safeParse({ linkedinUrl: edited(bad) }).success, false, bad)
      assert.equal(GoalSuggestionsSchema.safeParse({ targetUrl: edited(bad) }).success, false, bad)
    }
    assert.equal(ProfileSuggestionsSchema.safeParse({ websiteUrl: edited('https://acme.com/about') }).success, true)
    assert.equal(GoalSuggestionsSchema.safeParse({ targetUrl: edited('https://acme.com/book') }).success, true)
  })

  it('analysis input: links are checked on the server too', () => {
    const base = { description: 'I run Acme.' }
    assert.equal(AnalyzeIdentityInputSchema.safeParse({ ...base, websiteUrl: 'acme' }).success, false)
    assert.equal(AnalyzeIdentityInputSchema.safeParse({ ...base, linkedinUrl: 'ftp://x.com/a' }).success, false)
    assert.equal(AnalyzeIdentityInputSchema.safeParse({ ...base, websiteUrl: 'https://acme.com' }).success, true)
    assert.equal(AnalyzeIdentityInputSchema.safeParse({ ...base, websiteUrl: '' }).success, true)
    assert.equal(AnalyzeIdentityInputSchema.safeParse(base).success, true)
  })

  it('advanced analysis: the CTA link is checked', () => {
    assert.equal(AnalysisGuidanceSchema.safeParse({ ctaUrl: 'book-a-demo' }).success, false)
    assert.equal(AnalysisGuidanceSchema.safeParse({ ctaUrl: 'https://acme.com/demo' }).success, true)
    assert.equal(AnalysisGuidanceSchema.safeParse({}).success, true)
  })
})
