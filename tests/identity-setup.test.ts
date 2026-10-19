import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  applyGuidance,
  normalizeWeights,
  sanitizeIdentitySetup,
  tidyIndustry,
  tidyProfileList,
  type SanitizeContext
} from '../src/lib/ai/skills/profile-setup/guard'
import { buildPrompt } from '../src/lib/ai/skills/profile-setup/prompt'
import {
  AnalysisGuidanceSchema,
  AnalyzeIdentityInputSchema,
  fieldLabel,
  getSectionStatus,
  hasAnySuggestion,
  IdentitySetupSuggestionsSchema
} from '../src/lib/ai/skills/profile-setup/schema'
import { IdentityProfileSchema } from '../src/lib/identity-profile'
import {
  isPrivateAddress,
  parsePublicHttpUrl,
  resolvePublicHttpUrl,
  UnsafeUrlError
} from '../src/lib/safe-url'
import {
  buildGoalPayload,
  buildPreferencesPayload,
  buildVoiceSaveInput,
  mergeValues,
  preferencesSuggestionValues,
  preferencesValuesFromRow,
  profileSuggestionValues,
  undoValues,
  voiceSuggestionValues,
  voiceValuesFromConfig
} from '../src/lib/settings-merge'

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
        entry(
          'description',
          'Founder of Ledgerly, a bookkeeping service for Indian D2C brands.',
          'fact',
          'description'
        ),
        entry(
          'targetAudience',
          'Founders and finance leads at Indian D2C brands'
        ),
        entry('offerings', 'Month-end close\nBookkeeping'),
        entry('industry', 'Financial services', 'fact', 'description'),
        entry(
          'websiteUrl',
          'https://ledgerly.in',
          'fact',
          'https://ledgerly.in'
        )
      ],
      missing: []
    },
    voice: {
      fields: [
        entry('tone', 'Analytical'),
        entry(
          'derivedStyleRubric',
          'Open with a concrete number from finance operations, keep paragraphs short, and close with one practical step.'
        ),
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
        {
          url: 'https://ledgerly.in',
          title: 'Ledgerly website',
          reason: 'Company overview'
        },
        {
          url: 'ledgerly.in/case-studies',
          title: 'Case studies',
          reason: 'Proof points'
        },
        {
          url: 'https://invented.example.com/report',
          title: 'Industry report',
          reason: 'Stats'
        }
      ],
      facts: [
        {
          statement: 'Ledgerly serves 40 D2C brands.',
          quote: 'runs month-end close for 40 D2C brands',
          source: 'https://ledgerly.in'
        },
        {
          statement: 'Close takes 5 days.',
          quote: 'close their books in 5 days instead of 20',
          source: 'description'
        },
        {
          statement: 'Ledgerly has 500 clients.',
          quote: 'Ledgerly serves 500 clients nationwide',
          source: 'https://ledgerly.in'
        }
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
    // A link written without a scheme is kept as an address that can be saved.
    assert.deepStrictEqual(urls, [
      'https://ledgerly.in',
      'https://ledgerly.in/case-studies'
    ])
    assert.strictEqual(suggestions.knowledge.sources[0]?.accessible, true)
    assert.strictEqual(suggestions.knowledge.sources[1]?.accessible, false)
    // The invented report survives only as an idea, without its link.
    assert.ok(
      suggestions.knowledge.suggestedAdditions.some(a =>
        a.startsWith('Industry report')
      )
    )
  })

  it('normalizes pillar weights to 100', () => {
    const pillars = suggestions.preferences.pillars?.value ?? []
    assert.strictEqual(
      pillars.reduce((sum, p) => sum + p.weight_pct, 0),
      100
    )
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
      {
        profile: { fields: [entry('name', 'Priya Rao')], missing: ['Industry'] }
      },
      { ...context, providedUrls: [], fetchedSources: [] }
    )
    assert.strictEqual(suggestions.profile.name?.value, 'Priya Rao')
    assert.deepStrictEqual(
      getSectionStatus(suggestions, 'profile').missingInfo,
      ['Industry']
    )
    assert.strictEqual(
      getSectionStatus(suggestions, 'profile').state,
      'partial'
    )
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
      {
        profile: {
          fields: [entry('company', 'N/A'), entry('industry', 'unknown')]
        }
      },
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
      {
        profile: {
          fields: [entry('industry', 'Fintech', 'fact', 'https://other.com')]
        }
      },
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
    assert.strictEqual(
      IdentitySetupSuggestionsSchema.safeParse(tampered).success,
      false
    )
  })
})

describe('name and company fit the identity type', () => {
  const ORACLE =
    'Oracle offers cloud infrastructure, databases and business applications with AI built in.'
  const bare = { description: ORACLE, providedUrls: [], fetchedSources: [] }
  const profileOf = (identityType: string | undefined, fields: unknown[]) => ({
    profile: { ...(identityType ? { identityType } : {}), fields, missing: [] }
  })

  it("puts a company's own name in Display name, never under Parent company", () => {
    // Regression: the AI filed "Oracle" as the company and left the name
    // empty, so the form showed it under Parent Company / Brand.
    const { suggestions, accountType } = sanitizeIdentitySetup(
      profileOf('company', [entry('company', 'Oracle', 'fact', 'description')]),
      { ...bare, accountType: 'company' }
    )
    assert.strictEqual(accountType, 'company')
    assert.strictEqual(suggestions.profile.name?.value, 'Oracle')
    assert.strictEqual(suggestions.profile.company, undefined)
  })

  it('drops a company that only repeats the name, and keeps a real parent', () => {
    const repeated = sanitizeIdentitySetup(
      profileOf('company', [
        entry('name', 'Crumb & Co.'),
        entry('company', 'crumb & co')
      ]),
      { ...bare, accountType: 'company' }
    ).suggestions.profile
    assert.strictEqual(repeated.name?.value, 'Crumb & Co.')
    assert.strictEqual(repeated.company, undefined)

    const parent = sanitizeIdentitySetup(
      profileOf('company', [
        entry('name', 'Slack'),
        entry('company', 'Salesforce')
      ]),
      { ...bare, accountType: 'company' }
    ).suggestions.profile
    assert.strictEqual(parent.name?.value, 'Slack')
    assert.strictEqual(parent.company?.value, 'Salesforce')
  })

  it("leaves a person's business as their company when they are not named", () => {
    const { suggestions, accountType } = sanitizeIdentitySetup(
      profileOf('person', [entry('company', 'Reyes Legal')]),
      { ...bare, accountType: 'personal' }
    )
    assert.strictEqual(accountType, 'personal')
    assert.strictEqual(suggestions.profile.name, undefined)
    assert.strictEqual(suggestions.profile.company?.value, 'Reyes Legal')
  })

  it("follows the model's identity type only when the user chose none", () => {
    const output = profileOf('company', [entry('name', 'Oracle')])
    assert.strictEqual(
      sanitizeIdentitySetup(output, bare).accountType,
      'company'
    )
    assert.strictEqual(
      sanitizeIdentitySetup(output, { ...bare, accountType: 'personal' })
        .accountType,
      'personal'
    )
    // An answer without one is read the way the Profile form starts: a person.
    assert.strictEqual(
      sanitizeIdentitySetup(profileOf(undefined, []), bare).accountType,
      'personal'
    )
  })

  it('names the company field the way the Profile form does', () => {
    assert.strictEqual(
      fieldLabel('profile', 'company', 'company'),
      'Parent company / brand'
    )
    assert.strictEqual(
      fieldLabel('profile', 'company', 'personal'),
      'Current company'
    )
    assert.strictEqual(fieldLabel('profile', 'company'), 'Company')
  })
})

describe('Advanced analysis guidance', () => {
  const { suggestions } = sanitizeIdentitySetup(fullModelOutput(), context)

  it("overrides the model with the user's own choices, marked as provided", () => {
    const { suggestions: guided, warnings } = applyGuidance(suggestions, {
      tone: 'storytelling',
      perspective: 'we',
      formality: 2,
      emojiPolicy: 'liberal',
      objectiveType: 'authority',
      callToAction: 'Join the waitlist',
      ctaUrl: 'https://ledgerly.in/waitlist'
    })
    assert.strictEqual(guided.voice.tone?.value, 'storytelling')
    assert.strictEqual(guided.voice.tone?.kind, 'fact')
    assert.strictEqual(guided.voice.tone?.source, 'provided')
    assert.strictEqual(guided.voice.perspective?.value, 'we')
    assert.strictEqual(guided.voice.formality?.value, 2)
    assert.strictEqual(guided.voice.emojiPolicy?.value, 'liberal')
    assert.strictEqual(guided.goals.objectiveType?.value, 'authority')
    assert.strictEqual(guided.goals.desiredAction?.value, 'Join the waitlist')
    // A CTA link the user typed survives, unlike one the model invents.
    assert.strictEqual(
      guided.goals.targetUrl?.value,
      'https://ledgerly.in/waitlist'
    )
    // Untouched fields keep the model's suggestion.
    assert.strictEqual(
      guided.goals.title?.value,
      suggestions.goals.title?.value
    )
    assert.ok(IdentitySetupSuggestionsSchema.safeParse(guided).success)
    assert.deepStrictEqual(warnings, [])
  })

  it("uses the stated audience and adds avoided topics to the model's", () => {
    const { suggestions: guided } = applyGuidance(suggestions, {
      targetAudience: 'CFOs at D2C brands, Founders\nFinance leads',
      avoidTopics: 'politics, Tax evasion'
    })
    assert.strictEqual(
      guided.profile.targetAudience?.value,
      'CFOs at D2C brands\nFounders\nFinance leads'
    )
    assert.deepStrictEqual(guided.preferences.bannedTopics?.value, [
      'politics',
      'Tax evasion',
      'tax evasion'
    ])
  })

  it('changes nothing when there is no guidance', () => {
    assert.strictEqual(applyGuidance(suggestions, undefined).suggestions, suggestions)
    assert.deepStrictEqual(applyGuidance(suggestions, {}), { suggestions, warnings: [] })
  })

  it('keeps every other choice when one topic is too long to use', () => {
    const longTopic = `Anything about ${'regulatory detail '.repeat(20)}`
    const { suggestions: guided, warnings } = applyGuidance(suggestions, {
      tone: 'storytelling',
      formality: 2,
      objectiveType: 'authority',
      callToAction: 'Join the waitlist',
      avoidTopics: `politics, ${longTopic}`
    })
    // Checked all together, this one topic used to discard every choice.
    assert.strictEqual(guided.voice.tone?.value, 'storytelling')
    assert.strictEqual(guided.voice.formality?.value, 2)
    assert.strictEqual(guided.goals.objectiveType?.value, 'authority')
    assert.strictEqual(guided.goals.desiredAction?.value, 'Join the waitlist')
    assert.ok(guided.preferences.bannedTopics?.value.includes('politics'))
    assert.ok(!guided.preferences.bannedTopics?.value.includes(longTopic.trim()))
    assert.strictEqual(warnings.length, 1)
    assert.match(warnings[0]!, /^Preferences → Topics to avoid: "Anything about regulatory/)
  })

  it('reports a choice it cannot use and applies the rest', () => {
    const { suggestions: guided, warnings } = applyGuidance(suggestions, {
      tone: 'storytelling',
      // Nothing is left once the separators are split off.
      targetAudience: ', ,'
    })
    assert.strictEqual(guided.voice.tone?.value, 'storytelling')
    assert.strictEqual(
      guided.profile.targetAudience?.value,
      suggestions.profile.targetAudience?.value
    )
    assert.deepStrictEqual(warnings, [
      "Profile → Target audience: your Advanced analysis choice could not be used, so the AI's suggestion was kept."
    ])
  })

  it('rejects invalid choices before they reach the model', () => {
    for (const bad of [
      { tone: 'sarcastic' },
      { formality: 9 },
      { objectiveType: 'world_domination' },
      { accountType: 'robot' }
    ]) {
      assert.strictEqual(AnalysisGuidanceSchema.safeParse(bad).success, false)
    }
    const parsed = AnalyzeIdentityInputSchema.safeParse({
      description: 'Ledgerly',
      guidance: { tone: 'candid', goal: '   ', ctaUrl: '' }
    })
    assert.ok(parsed.success)
    // Blank text and links become "not set", not empty values.
    assert.strictEqual(parsed.data.guidance?.goal, undefined)
    assert.strictEqual(parsed.data.guidance?.ctaUrl, undefined)
  })
})

describe('normalizeWeights', () => {
  it('always sums to 100', () => {
    for (const weights of [
      [50, 30, 30],
      [1, 1, 1],
      [0, 0],
      [33.3, 33.3, 33.3],
      [NaN, 10]
    ]) {
      assert.strictEqual(
        normalizeWeights(weights).reduce((a, b) => a + b, 0),
        100
      )
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
    const merged = mergeValues(
      current,
      profileSuggestionValues(suggestions.profile),
      'fill-empty'
    )
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
      derivedStyleRubric:
        'My rubric written from twelve real posts, kept as is.',
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
    assert.strictEqual(
      merged.values.derivedStyleRubric,
      saved.derivedStyleRubric
    )
    assert.strictEqual(merged.values.tone, 'storytelling')
    assert.strictEqual(merged.values.formality, 2)
    // Only the empty hashtag policy was filled.
    assert.deepStrictEqual(merged.filled, ['hashtagPolicy'])

    const input = buildVoiceSaveInput(
      '00000000-0000-4000-8000-000000000000',
      merged.values
    )
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
    const input = buildVoiceSaveInput(
      '00000000-0000-4000-8000-000000000000',
      merged.values
    )
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
    assert.strictEqual(
      payload.pillars.reduce((sum, p) => sum + p.weight_pct, 0),
      100
    )
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

    const incomplete = buildGoalPayload({
      title: suggestions.goals.title,
      missing: []
    })
    assert.ok('missing' in incomplete)
    assert.deepStrictEqual(incomplete.missing, ['keyMessage'])
  })

  it('produces a profile the create and edit forms accept', () => {
    const merged = mergeValues(
      {
        name: '',
        company: '',
        description: '',
        targetAudience: '',
        offerings: '',
        industry: '',
        linkedinUrl: '',
        websiteUrl: ''
      },
      profileSuggestionValues(suggestions.profile),
      'fill-empty'
    )
    assert.ok(IdentityProfileSchema.safeParse(merged.values).success)
  })
})

describe('undoing a prefill', () => {
  const before = { description: '', industry: '', company: 'Ledgerly' }
  const after = {
    description: 'Bookkeeping for D2C brands.',
    industry: 'Accounting',
    company: 'Ledgerly'
  }

  it('puts back what the prefill filled', () => {
    assert.deepStrictEqual(undoValues(before, after, after), {
      description: '',
      industry: ''
    })
  })

  it('keeps a field the user typed into after the prefill', () => {
    // Undo used to put the whole form back, wiping this company name.
    const current = { ...after, company: 'Ledgerly Books' }
    assert.deepStrictEqual(undoValues(before, after, current), {
      description: '',
      industry: ''
    })
  })

  it('keeps an AI value the user has since edited', () => {
    const current = { ...after, description: 'Bookkeeping for Indian D2C brands.' }
    assert.deepStrictEqual(undoValues(before, after, current), { industry: '' })
  })

  it('compares with the form as shown, not the raw suggestion', () => {
    // Topics are edited as comma-separated text, so a suggested topic with a
    // comma reads back as two. Untouched, it still goes back.
    const pillarsBefore = { pillars: [] as Array<{ name: string; example_topics: string[] }> }
    const shown = {
      pillars: [{ name: 'Pricing', example_topics: ['Bundles', 'discounts'] }]
    }
    assert.deepStrictEqual(undoValues(pillarsBefore, shown, shown), { pillars: [] })
  })

  it('has nothing to undo once every change was edited', () => {
    const current = { description: 'Mine', industry: 'Finance', company: 'Ledgerly' }
    assert.deepStrictEqual(undoValues(before, after, current), {})
  })
})

describe('safe-url', () => {
  it('flags private, loopback, link-local and mapped addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.2.62',
      '169.254.169.254',
      '::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '0.0.0.0'
    ]) {
      assert.strictEqual(isPrivateAddress(address), true, address)
    }
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) {
      assert.strictEqual(isPrivateAddress(address), false, address)
    }
  })

  it('flags deprecated IPv6 forms that embed an IPv4 address', () => {
    for (const address of [
      '::7f00:1', // IPv4-compatible ::127.0.0.1
      '::127.0.0.1',
      '::a9fe:a9fe', // ::169.254.169.254
      '::ffff:0:7f00:1', // IPv4-translated
      '2002:7f00:1::' // 6to4 wrapping 127.0.0.1
    ]) {
      assert.strictEqual(isPrivateAddress(address), true, address)
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
    assert.strictEqual(
      parsePublicHttpUrl('example.com/about').toString(),
      'https://example.com/about'
    )
    assert.strictEqual(
      parsePublicHttpUrl('http://example.com').protocol,
      'http:'
    )
  })

  it('rejects a hostname that resolves to a private address', async () => {
    await assert.rejects(
      resolvePublicHttpUrl('http://localtest.me'),
      UnsafeUrlError
    )
  })
})

describe('industry is a short label, not a sentence', () => {
  it('keeps real labels, including ones with hyphens and ampersands', () => {
    for (const label of [
      'Fintech',
      'B2B SaaS',
      'Healthcare',
      'Bookkeeping services',
      'Direct-to-consumer retail',
      'Health & Wellness'
    ]) {
      assert.strictEqual(tidyIndustry(label), label)
    }
  })

  it('cuts a long answer back to its lead phrase', () => {
    assert.strictEqual(
      tidyIndustry(
        'Bookkeeping service for direct-to-consumer brands in India'
      ),
      'Bookkeeping service'
    )
    assert.strictEqual(
      tidyIndustry('Fintech, helping founders close their books in 5 days'),
      'Fintech'
    )
    assert.strictEqual(tidyIndustry('"B2B SaaS."'), 'B2B SaaS')
  })

  it('gives up on a pasted description rather than saving it', () => {
    assert.strictEqual(
      tidyIndustry(
        'I am Priya Rao, founder of Ledgerly, a bookkeeping service for Indian D2C brands'
      ),
      null
    )
    assert.strictEqual(
      tidyIndustry(
        'A very long unbroken phrase that keeps going well past four words'
      ),
      null
    )
  })

  it('sanitizes the model output: shortens, or leaves blank with a warning', () => {
    const long = sanitizeIdentitySetup(
      {
        profile: {
          fields: [
            entry('industry', 'Bookkeeping service for Indian D2C brands'),
            entry('description', DESCRIPTION, 'fact', 'description')
          ]
        }
      },
      context
    )
    assert.strictEqual(
      long.suggestions.profile.industry?.value,
      'Bookkeeping service'
    )
    assert.ok(long.warnings.some(w => w.includes('Industry')))

    const pasted = sanitizeIdentitySetup(
      { profile: { fields: [entry('industry', DESCRIPTION)] } },
      context
    )
    assert.strictEqual(pasted.suggestions.profile.industry, undefined)
    assert.ok(pasted.warnings.some(w => w.includes('left blank')))
  })
})

describe('audience and offerings are clean lists', () => {
  it('drops bullets and lines that repeat another', () => {
    assert.deepStrictEqual(
      tidyProfileList(
        '- Founders at D2C brands\n• founders at D2C brands.\n2) Finance leads\n\n'
      ),
      ['Founders at D2C brands', 'Finance leads']
    )
  })

  it('keeps at most 6 audiences and 8 offerings, and says so', () => {
    const lines = [
      'Founders',
      'Finance leads',
      'Controllers',
      'Investors',
      'Accountants',
      'Auditors',
      'Lenders',
      'Bankers',
      'Advisors'
    ]
    const { suggestions, warnings } = sanitizeIdentitySetup(
      {
        profile: {
          fields: [
            entry('targetAudience', lines.slice(0, 7).join('\n')),
            entry('offerings', lines.join('\n'))
          ]
        }
      },
      context
    )
    assert.deepStrictEqual(
      suggestions.profile.targetAudience?.value.split('\n'),
      lines.slice(0, 6)
    )
    assert.deepStrictEqual(
      suggestions.profile.offerings?.value.split('\n'),
      lines.slice(0, 8)
    )
    assert.ok(warnings.some(w => w.includes('kept the first 6 of 7')))
    assert.ok(warnings.some(w => w.includes('kept the first 8 of 9')))
  })
})

describe('each audience and offering line keeps where it came from', () => {
  const run = (fields: unknown[], ctx: SanitizeContext = context) =>
    sanitizeIdentitySetup({ profile: { fields } }, ctx)

  it('pools stated and suggested lines, and calls the mix a suggestion', () => {
    const { suggestions } = run([
      entry(
        'targetAudience',
        'Founders of Indian D2C brands',
        'fact',
        'description'
      ),
      entry('targetAudience', 'Finance leads at D2C brands\nAngel investors')
    ])
    const audience = suggestions.profile.targetAudience
    assert.strictEqual(audience?.kind, 'recommendation')
    assert.strictEqual(audience?.source, undefined)
    assert.strictEqual(
      audience?.value,
      'Founders of Indian D2C brands\nFinance leads at D2C brands\nAngel investors'
    )
    assert.deepStrictEqual(audience?.lines, [
      {
        text: 'Founders of Indian D2C brands',
        kind: 'fact',
        source: 'description'
      },
      { text: 'Finance leads at D2C brands', kind: 'recommendation' },
      { text: 'Angel investors', kind: 'recommendation' }
    ])
    // The draft store re-validates suggestions; the lines must survive it.
    const reparsed = IdentitySetupSuggestionsSchema.parse(suggestions)
    assert.deepStrictEqual(
      reparsed.profile.targetAudience?.lines,
      audience?.lines
    )
  })

  it('is a fact as a whole only when every line is stated by one source', () => {
    const { suggestions } = run([
      entry('offerings', 'Bookkeeping for D2C brands', 'fact', 'description')
    ])
    assert.strictEqual(suggestions.profile.offerings?.kind, 'fact')
    assert.strictEqual(suggestions.profile.offerings?.source, 'description')
  })

  it('shows a "stated" line that is not in its source as a suggestion', () => {
    const { suggestions } = run([
      entry(
        'targetAudience',
        'Venture partners scouting fintech deals',
        'fact',
        'description'
      )
    ])
    assert.strictEqual(
      suggestions.profile.targetAudience?.kind,
      'recommendation'
    )
    assert.strictEqual(
      suggestions.profile.targetAudience?.lines?.[0]?.kind,
      'recommendation'
    )
  })

  it('takes offerings from the user or their own site, audiences only from the user', () => {
    const { suggestions } = run(
      [
        entry('offerings', 'Month-end close', 'fact', 'https://ledgerly.in'),
        // Even the business's own site does not state who it is for.
        entry(
          'targetAudience',
          'D2C brands across India',
          'fact',
          'https://ledgerly.in'
        ),
        entry(
          'offerings',
          'Payroll processing\nGST filing',
          'fact',
          'https://yourstory.com/ledgerly'
        )
      ],
      {
        ...context,
        fetchedSources: [
          ...context.fetchedSources,
          {
            url: 'https://yourstory.com/ledgerly',
            content:
              'Ledgerly offers payroll processing and GST filing for D2C brands.'
          }
        ]
      }
    )
    assert.deepStrictEqual(suggestions.profile.offerings?.lines, [
      { text: 'Month-end close', kind: 'fact', source: 'https://ledgerly.in' },
      { text: 'Payroll processing', kind: 'recommendation' },
      { text: 'GST filing', kind: 'recommendation' }
    ])
    assert.strictEqual(
      suggestions.profile.targetAudience?.kind,
      'recommendation'
    )
  })

  it('keeps a line given twice once', () => {
    const { suggestions } = run([
      entry('targetAudience', 'Founders of Indian D2C brands'),
      entry('targetAudience', 'founders of Indian D2C brands.')
    ])
    assert.deepStrictEqual(suggestions.profile.targetAudience?.lines, [
      {
        text: 'Founders of Indian D2C brands',
        kind: 'fact',
        source: 'description'
      }
    ])
  })

  it('labels lines by what their source says, not what the model claimed', () => {
    const { suggestions } = run(
      [
        // Called a suggestion, but the description says it.
        entry('offerings', 'Bookkeeping for D2C brands\nGST'),
        // The user's own Advanced analysis answer.
        entry('targetAudience', 'CFOs at consumer startups')
      ],
      { ...context, trustedText: 'CFOs at consumer startups' }
    )
    assert.deepStrictEqual(suggestions.profile.offerings?.lines, [
      {
        text: 'Bookkeeping for D2C brands',
        kind: 'fact',
        source: 'description'
      },
      // Too short to compare by words, and not in the description as written.
      { text: 'GST', kind: 'recommendation' }
    ])
    assert.strictEqual(suggestions.profile.targetAudience?.source, 'provided')
  })

  it("does not count the business's own name as the source stating a line", () => {
    // Regression: "Canva Pro" was shown as from the description because the
    // description says "Canva".
    const { suggestions } = run([
      entry('company', 'Ledgerly', 'fact', 'description'),
      entry('offerings', 'Ledgerly Pro\nLedgerly bookkeeping')
    ])
    assert.deepStrictEqual(suggestions.profile.offerings?.lines, [
      { text: 'Ledgerly Pro', kind: 'recommendation' },
      { text: 'Ledgerly bookkeeping', kind: 'fact', source: 'description' }
    ])
  })

  it('drops a line with an invented figure and keeps the rest in step', () => {
    const { suggestions, warnings } = run([
      entry(
        'targetAudience',
        'Founders of Indian D2C brands',
        'fact',
        'description'
      ),
      entry('targetAudience', 'Brands with 300 staff')
    ])
    const audience = suggestions.profile.targetAudience
    assert.strictEqual(audience?.value, 'Founders of Indian D2C brands')
    assert.strictEqual(audience?.lines?.length, 1)
    assert.strictEqual(audience?.kind, 'fact')
    assert.ok(warnings.some(w => w.includes('300')))
  })
})

describe("the prompt marks the business's own site", () => {
  it('flags the page research verified, not other pages', () => {
    const page = (url: string) => ({
      status: {
        url,
        kind: 'web' as const,
        status: 'fetched' as const,
        title: 'page'
      },
      content: 'text'
    })
    const prompt = buildPrompt(
      'Ledgerly',
      [page('https://ledgerly.in/'), page('https://yourstory.com/ledgerly')],
      undefined,
      {
        verified: {
          websiteUrl: {
            url: 'https://www.ledgerly.in/',
            evidence: 'named',
            confidence: 'high'
          }
        },
        notes: []
      }
    )
    assert.ok(
      prompt.includes('url="https://ledgerly.in/" kind="web" official="yes"')
    )
    assert.ok(
      prompt.includes('url="https://yourstory.com/ledgerly" kind="web" title=')
    )
  })
})
