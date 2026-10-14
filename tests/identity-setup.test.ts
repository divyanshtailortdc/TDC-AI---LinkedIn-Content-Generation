import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  buildGoalPayload,
  buildPreferencesPayload,
  buildVoiceSaveInput,
  mergeValues,
  preferencesSuggestionValues,
  preferencesValuesFromRow,
  profileSuggestionValues,
  voiceSuggestionValues,
  voiceValuesFromConfig
} from '../src/lib/settings-merge'
import {
  getSectionStatus,
  hasAnySuggestion,
  IdentitySetupSuggestionsSchema
} from '../src/lib/ai/skills/profile-setup/schema'
import { normalizeWeights, sanitizeIdentitySetup, type SanitizeContext } from '../src/lib/ai/skills/profile-setup/guard'
import { IdentityProfileSchema } from '../src/lib/identity-profile'
import {
  isPrivateAddress,
  parsePublicHttpUrl,
  resolvePublicHttpUrl,
  UnsafeUrlError
} from '../src/lib/safe-url'

const DESCRIPTION =
  'I am Priya Rao, founder of Ledgerly, a bookkeeping service for Indian D2C brands. We help founders close their books in 5 days instead of 20. See ledgerly.in/case-studies for examples.'

const context: SanitizeContext = {
  description: DESCRIPTION,
  providedUrls: ['https://ledgerly.in'],
  fetchedSources: [
    {
      url: 'https://ledgerly.in',
      content:
        'Ledgerly runs month-end close for 40 D2C brands across India. Founded in 2021 in Bengaluru.'
    }
  ]
}

const entry = (
  field: string,
  value: string,
  kind: 'fact' | 'recommendation' = 'recommendation',
  source = ''
) => ({ field, value, kind, source, confidence: 'high' })

/** A well-formed response in the shape IdentitySetupModelSchema describes. */
function fullModelOutput() {
  return {
    profile: {
      fields: [
        entry('name', 'Priya Rao', 'fact', 'description'),
        entry('company', 'Ledgerly', 'fact', 'description'),
        entry('description', 'Founder of Ledgerly, a bookkeeping service for Indian D2C brands.', 'fact', 'description'),
        entry('targetAudience', 'Founders and finance leads at Indian D2C brands'),
        entry('offerings', 'Month-end close\nBookkeeping'),
        entry('industry', 'Financial services', 'fact', 'description'),
        entry('websiteUrl', 'https://ledgerly.in', 'fact', 'https://ledgerly.in')
      ],
      missing: []
    },
    voice: {
      fields: [
        entry('tone', 'Analytical'),
        entry('derivedStyleRubric', 'Open with a concrete number from finance operations, keep paragraphs short, and close with one practical step.'),
        entry('formality', '3'),
        entry('directness', '4'),
        entry('perspective', 'i'),
        entry('emojiPolicy', 'none'),
        entry('hashtagPolicy', '0-3, end of post'),
        // The model claims this as a fact; voice is never a fact here.
        entry('bannedWords', 'synergy\nleverage', 'fact', 'description')
      ],
      missing: []
    },
    goals: {
      fields: [
        entry('title', 'Faster close for D2C founders'),
        entry('keyMessage', 'Month-end close should take days, not weeks.'),
        entry('desiredAction', 'Book a call'),
        entry('targetUrl', 'https://calendly.com/ledgerly'),
        entry('linkStrategy', 'body'),
        entry('objectiveType', 'lead_gen')
      ],
      missing: ['Booking link']
    },
    preferences: {
      fields: [entry('bannedTopics', 'tax evasion')],
      pillars: [
        { name: 'Close faster', weightPct: 50, topics: ['Month-end'] },
        { name: 'D2C finance', weightPct: 30, topics: [] },
        { name: 'Founder lessons', weightPct: 30, topics: [] }
      ],
      missing: []
    },
    knowledge: {
      sources: [
        { url: 'https://ledgerly.in', title: 'Ledgerly website', reason: 'Company overview' },
        { url: 'ledgerly.in/case-studies', title: 'Case studies', reason: 'Proof points' },
        { url: 'https://invented.example.com/report', title: 'Industry report', reason: 'Stats' }
      ],
      facts: [
        { statement: 'Ledgerly serves 40 D2C brands.', quote: 'runs month-end close for 40 D2C brands', source: 'https://ledgerly.in' },
        { statement: 'Close takes 5 days.', quote: 'close their books in 5 days instead of 20', source: 'description' },
        { statement: 'Ledgerly has 500 clients.', quote: 'Ledgerly serves 500 clients nationwide', source: 'https://ledgerly.in' }
      ],
      suggestedAdditions: ['A client testimonial with permission to quote'],
      missing: []
    }
  }
}

describe('sanitizeIdentitySetup: valid output', () => {
  const { suggestions } = sanitizeIdentitySetup(fullModelOutput(), context)

  it('produces output that passes the strict schema', () => {
    assert.ok(IdentitySetupSuggestionsSchema.safeParse(suggestions).success)
    assert.ok(hasAnySuggestion(suggestions))
  })

  it('normalizes enum casing and reads scales as numbers', () => {
    assert.strictEqual(suggestions.voice.tone?.value, 'analytical')
    assert.strictEqual(suggestions.voice.perspective?.value, 'I')
    assert.strictEqual(suggestions.voice.formality?.value, 3)
  })

  it('keeps every voice setting a recommendation', () => {
    assert.strictEqual(suggestions.voice.bannedWords?.kind, 'recommendation')
    assert.strictEqual(suggestions.voice.bannedWords?.source, undefined)
  })

  it('drops a CTA URL the user never provided', () => {
    assert.strictEqual(suggestions.goals.targetUrl, undefined)
  })

  it('keeps facts whose quote is in the cited source and drops the rest', () => {
    const statements = suggestions.knowledge.facts.map(f => f.statement)
    assert.deepStrictEqual(statements, [
      'Ledgerly serves 40 D2C brands.',
      'Close takes 5 days.'
    ])
  })

  it('keeps only source URLs from the user input', () => {
    const urls = suggestions.knowledge.sources.map(s => s.url)
    assert.deepStrictEqual(urls, ['https://ledgerly.in', 'ledgerly.in/case-studies'])
    assert.strictEqual(suggestions.knowledge.sources[0]?.accessible, true)
    assert.strictEqual(suggestions.knowledge.sources[1]?.accessible, false)
    // The invented report survives only as an idea, without its link.
    assert.ok(
      suggestions.knowledge.suggestedAdditions.some(a => a.startsWith('Industry report'))
    )
  })

  it('normalizes pillar weights to 100', () => {
    const pillars = suggestions.preferences.pillars?.value ?? []
    assert.strictEqual(pillars.reduce((sum, p) => sum + p.weight_pct, 0), 100)
    assert.deepStrictEqual(pillars[0]?.example_topics, ['Month-end'])
  })

  it('marks a profile URL from the form as a provided fact', () => {
    assert.strictEqual(suggestions.profile.websiteUrl?.kind, 'fact')
    assert.strictEqual(suggestions.profile.websiteUrl?.source, 'provided')
  })
})

describe('sanitizeIdentitySetup: partial and incorrect output', () => {
  it('accepts a response with only some sections', () => {
    const { suggestions, warnings } = sanitizeIdentitySetup(
      { profile: { fields: [entry('name', 'Priya Rao')], missing: ['Industry'] } },
      { ...context, providedUrls: [], fetchedSources: [] }
    )
    assert.strictEqual(suggestions.profile.name?.value, 'Priya Rao')
    assert.deepStrictEqual(getSectionStatus(suggestions, 'profile').missingInfo, ['Industry'])
    assert.strictEqual(getSectionStatus(suggestions, 'profile').state, 'partial')
    assert.strictEqual(getSectionStatus(suggestions, 'voice').state, 'empty')
    assert.deepStrictEqual(warnings, [])
  })

  it('drops invalid fields with a warning and keeps valid ones', () => {
    const { suggestions, warnings } = sanitizeIdentitySetup(
      {
        voice: {
          fields: [
            entry('formality', 'very high'),
            entry('tone', 'sarcastic'),
            entry('directness', '9'),
            entry('emojiPolicy', 'liberal'),
            entry('humor', 'dry'),
            'not an entry'
          ]
        },
        preferences: { pillars: 'Close faster' }
      },
      context
    )
    assert.strictEqual(suggestions.voice.emojiPolicy?.value, 'liberal')
    assert.strictEqual(suggestions.voice.formality, undefined)
    assert.strictEqual(suggestions.voice.tone, undefined)
    assert.strictEqual(suggestions.voice.directness, undefined)
    assert.strictEqual(suggestions.preferences.pillars, undefined)
    assert.ok(warnings.some(w => w.includes('Writing style')))
    // A field the product no longer has is reported, not saved.
    assert.ok(warnings.some(w => w.includes('"humor"')))
    assert.ok(warnings.some(w => w.includes('Content pillars')))
  })

  it('treats placeholder values as missing rather than as answers', () => {
    const { suggestions } = sanitizeIdentitySetup(
      { profile: { fields: [entry('company', 'N/A'), entry('industry', 'unknown')] } },
      context
    )
    assert.strictEqual(suggestions.profile.company, undefined)
    assert.strictEqual(suggestions.profile.industry, undefined)
  })

  it('matches enum values written with spaces or hyphens', () => {
    // Regression: a live run returned link placement as "first comment".
    const { suggestions, warnings } = sanitizeIdentitySetup(
      {
        voice: { fields: [entry('emojiPolicy', 'bullets_only')] },
        goals: {
          fields: [
            entry('objectiveType', 'lead-gen'),
            entry('targetUrl', 'https://ledgerly.in'),
            entry('linkStrategy', 'First comment')
          ]
        }
      },
      context
    )
    assert.strictEqual(suggestions.goals.linkStrategy?.value, 'first_comment')
    assert.strictEqual(suggestions.voice.emojiPolicy?.value, 'bullets only')
    assert.strictEqual(suggestions.goals.objectiveType?.value, 'lead_gen')
    assert.deepStrictEqual(warnings, [])
  })

  it('keeps "none" where it is a real answer', () => {
    // Regression: "none" was treated as a placeholder, which dropped valid
    // emoji and hashtag settings.
    const { suggestions } = sanitizeIdentitySetup(
      {
        profile: { fields: [entry('company', 'None')] },
        voice: {
          fields: [entry('emojiPolicy', 'none'), entry('hashtagPolicy', 'none')]
        }
      },
      context
    )
    assert.strictEqual(suggestions.profile.company, undefined)
    assert.strictEqual(suggestions.voice.emojiPolicy?.value, 'none')
    assert.strictEqual(suggestions.voice.hashtagPolicy?.value, 'none')
  })

  it('downgrades a fact that cites a source that was never fetched', () => {
    const { suggestions } = sanitizeIdentitySetup(
      { profile: { fields: [entry('industry', 'Fintech', 'fact', 'https://other.com')] } },
      context
    )
    assert.strictEqual(suggestions.profile.industry?.kind, 'recommendation')
  })

  it('returns empty suggestions for output that is not an object', () => {
    for (const bad of [null, 'here are my suggestions', 42, []]) {
      const { suggestions, warnings } = sanitizeIdentitySetup(bad, context)
      assert.strictEqual(hasAnySuggestion(suggestions), false)
      assert.strictEqual(warnings.length, 1)
    }
  })

  it('rejects tampered suggestions coming back from the browser', () => {
    const { suggestions } = sanitizeIdentitySetup(fullModelOutput(), context)
    const tampered = structuredClone(suggestions) as any
    tampered.voice.formality.value = 11
    assert.strictEqual(IdentitySetupSuggestionsSchema.safeParse(tampered).success, false)
  })
})

describe('normalizeWeights', () => {
  it('always sums to 100', () => {
    for (const weights of [[50, 30, 30], [1, 1, 1], [0, 0], [33.3, 33.3, 33.3], [NaN, 10]]) {
      assert.strictEqual(normalizeWeights(weights).reduce((a, b) => a + b, 0), 100)
    }
  })
})

describe('mergeValues: existing data is preserved', () => {
  const { suggestions } = sanitizeIdentitySetup(fullModelOutput(), context)

  it('fills only empty fields by default', () => {
    const current = {
      name: 'Priya R.',
      company: '',
      description: 'My own words',
      targetAudience: '',
      offerings: '',
      industry: '',
      linkedinUrl: '',
      websiteUrl: ''
    }
    const merged = mergeValues(current, profileSuggestionValues(suggestions.profile), 'fill-empty')
    assert.strictEqual(merged.values.name, 'Priya R.')
    assert.strictEqual(merged.values.description, 'My own words')
    assert.strictEqual(merged.values.company, 'Ledgerly')
    assert.deepStrictEqual(merged.kept.sort(), ['description', 'name'])
    assert.ok(merged.filled.includes('industry'))
  })

  it('overwrites only when the user chooses replace', () => {
    const merged = mergeValues(
      { name: 'Priya R.', company: '' },
      { name: 'Priya Rao' },
      'replace'
    )
    assert.strictEqual(merged.values.name, 'Priya Rao')
    assert.deepStrictEqual(merged.filled, ['name'])
  })

  it('keeps a saved voice and never touches its sample posts', () => {
    const saved = {
      tone: 'storytelling',
      derivedStyleRubric: 'My rubric written from twelve real posts, kept as is.',
      formality: 2,
      directness: 3,
      perspective: 'we',
      emojiPolicy: 'liberal',
      hashtagPolicy: '',
      bannedWords: ['delve']
    }
    const merged = mergeValues(
      voiceValuesFromConfig(saved),
      voiceSuggestionValues(suggestions.voice),
      'fill-empty'
    )
    assert.strictEqual(merged.values.derivedStyleRubric, saved.derivedStyleRubric)
    assert.strictEqual(merged.values.tone, 'storytelling')
    assert.strictEqual(merged.values.formality, 2)
    // Only the empty hashtag policy was filled.
    assert.deepStrictEqual(merged.filled, ['hashtagPolicy'])

    const input = buildVoiceSaveInput('00000000-0000-4000-8000-000000000000', merged.values)
    assert.strictEqual(input.rawSamplesText, undefined)
    assert.deepStrictEqual(input.bannedWords, ['delve'])
  })

  it('keeps saved preferences and only adds what is empty', () => {
    const row = {
      pillars: [{ name: 'My pillar', weight_pct: 100 }],
      postConstraints: { cta_required: false },
      guardrails: { banned_topics: [], compliance_notes: '' }
    }
    const merged = mergeValues(
      preferencesValuesFromRow(row),
      preferencesSuggestionValues(suggestions.preferences),
      'fill-empty'
    )
    const payload = buildPreferencesPayload(
      {
        pillars: row.pillars,
        ideasPerRun: 8,
        post_constraints: row.postConstraints,
        guardrails: row.guardrails
      },
      merged.values
    )
    assert.deepStrictEqual(payload.pillars, row.pillars)
    assert.strictEqual(payload.post_constraints.cta_required, false)
    assert.strictEqual(payload.ideasPerRun, 8)
    assert.deepStrictEqual(payload.guardrails.banned_topics, ['tax evasion'])
  })
})

describe('applying suggestions', () => {
  const { suggestions } = sanitizeIdentitySetup(fullModelOutput(), context)

  it('builds a voice payload for an account without one', () => {
    const merged = mergeValues(
      voiceValuesFromConfig(null),
      voiceSuggestionValues(suggestions.voice),
      'fill-empty'
    )
    const input = buildVoiceSaveInput('00000000-0000-4000-8000-000000000000', merged.values)
    assert.strictEqual(input.tone, 'analytical')
    assert.strictEqual(input.perspective, 'I')
    assert.deepStrictEqual(input.bannedWords, ['synergy', 'leverage'])
  })

  it('leaves blank voice fields out so saved values are kept', () => {
    const input = buildVoiceSaveInput(
      '00000000-0000-4000-8000-000000000000',
      voiceValuesFromConfig(null)
    )
    assert.strictEqual(input.tone, undefined)
    assert.strictEqual(input.formality, undefined)
    assert.strictEqual(input.bannedWords, undefined)
  })

  it('builds preferences for an account without any, keeping run settings', () => {
    const merged = mergeValues(
      preferencesValuesFromRow(null),
      preferencesSuggestionValues(suggestions.preferences),
      'fill-empty'
    )
    const payload = buildPreferencesPayload(
      {
        pillars: [],
        ideasPerRun: 5,
        post_constraints: { cta_required: true },
        guardrails: { banned_topics: [], compliance_notes: '' }
      },
      merged.values
    )
    assert.strictEqual(payload.pillars.reduce((sum, p) => sum + p.weight_pct, 0), 100)
    assert.strictEqual(payload.ideasPerRun, 5)
    assert.strictEqual(payload.post_constraints.cta_required, true)
  })

  it('builds a new goal and refuses one without a key message', () => {
    const built = buildGoalPayload(suggestions.goals)
    assert.ok('payload' in built)
    assert.strictEqual(built.payload.objectiveType, 'lead_gen')
    assert.strictEqual(built.payload.targetUrl, undefined)
    // The suggested placement went with the link the user never provided.
    assert.strictEqual(built.payload.linkStrategy, 'first_comment')

    const incomplete = buildGoalPayload({ title: suggestions.goals.title, missing: [] })
    assert.ok('missing' in incomplete)
    assert.deepStrictEqual(incomplete.missing, ['keyMessage'])
  })

  it('produces a profile the create and edit forms accept', () => {
    const merged = mergeValues(
      { name: '', company: '', description: '', targetAudience: '', offerings: '', industry: '', linkedinUrl: '', websiteUrl: '' },
      profileSuggestionValues(suggestions.profile),
      'fill-empty'
    )
    assert.ok(IdentityProfileSchema.safeParse(merged.values).success)
  })
})

describe('safe-url', () => {
  it('flags private, loopback, link-local and mapped addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.2.62', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) {
      assert.strictEqual(isPrivateAddress(address), true, address)
    }
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) {
      assert.strictEqual(isPrivateAddress(address), false, address)
    }
  })

  it('rejects unsafe URLs before any network access', () => {
    for (const url of [
      'ftp://example.com',
      'file:///etc/passwd',
      'http://localhost:3000',
      'http://127.0.0.1',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'https://user:pass@example.com',
      'https://example.com:5432',
      'http://intranet',
      'http://db.internal'
    ]) {
      assert.throws(() => parsePublicHttpUrl(url), UnsafeUrlError, url)
    }
  })

  it('accepts public URLs and adds a missing scheme', () => {
    assert.strictEqual(parsePublicHttpUrl('example.com/about').toString(), 'https://example.com/about')
    assert.strictEqual(parsePublicHttpUrl('http://example.com').protocol, 'http:')
  })

  it('rejects a hostname that resolves to a private address', async () => {
    await assert.rejects(resolvePublicHttpUrl('http://localtest.me'), UnsafeUrlError)
  })
})
