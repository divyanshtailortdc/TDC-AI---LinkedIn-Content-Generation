import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  keepVerifiedFindings,
  type ResearchSeen
} from '../src/lib/ai/agents/research/guard'
import { MAX_FINDINGS } from '../src/lib/ai/agents/research/limits'
import { parseJsonLoosely } from '../src/lib/ai/parse-json'
import {
  collectAllowedUrls,
  keepValidSuggestions
} from '../src/lib/ai/skills/goal-suggestions/guard'
import { buildPrompt as buildGoalPrompt } from '../src/lib/ai/skills/goal-suggestions/prompt'
import { keepVerifiableClaims } from '../src/lib/ai/skills/knowledge-extraction/guard'
import {
  isCompleteDraft,
  withoutRepeatedHook
} from '../src/lib/ai/skills/post-drafting/guard'
import { buildPrompt as buildVoicePrompt } from '../src/lib/ai/skills/voice-analysis/prompt'

describe('parseJsonLoosely', () => {
  it('reads JSON inside a code fence or surrounding prose', () => {
    assert.deepStrictEqual(parseJsonLoosely('```json\n{"a":1}\n```'), { a: 1 })
    assert.deepStrictEqual(parseJsonLoosely('Here it is: {"a":2} done'), {
      a: 2
    })
  })

  it('returns null when there is nothing parseable', () => {
    assert.strictEqual(parseJsonLoosely(undefined), null)
    assert.strictEqual(parseJsonLoosely('no json here'), null)
    assert.strictEqual(parseJsonLoosely('{"a": }'), null)
  })
})

describe('knowledge-extraction guard', () => {
  const content =
    'Our onboarding takes two weeks.  Teams that adopt the checklist ship faster.'

  it('keeps quotes that appear verbatim, ignoring case and spacing', () => {
    const kept = keepVerifiableClaims(
      [
        {
          claim: 'Onboarding is two weeks',
          quote: 'our onboarding takes two   weeks'
        }
      ],
      content
    )
    assert.strictEqual(kept.length, 1)
  })

  it('drops paraphrased and too-short quotes', () => {
    const kept = keepVerifiableClaims(
      [
        { claim: 'x', quote: 'Onboarding lasts about two weeks' },
        { claim: 'y', quote: 'two weeks' }
      ],
      content
    )
    assert.strictEqual(kept.length, 0)
  })
})

describe('voice-analysis prompt', () => {
  it('numbers samples and flags the ones marked as high performers', () => {
    const prompt = buildVoicePrompt(
      'First post about hiring well.\n---\n[performed well] Second post about pricing.'
    )
    assert.match(prompt, /Post Sample #1 ---/)
    assert.match(
      prompt,
      /Post Sample #2 \[FLAGGED: PERFORMED EXCEPTIONALLY WELL/
    )
    assert.doesNotMatch(prompt, /\[performed well\]/)
  })
})

describe('goal-suggestions guard', () => {
  const allowedUrls = collectAllowedUrls({
    websiteUrl: 'https://www.acme.com/',
    bio: 'See acme.com/pricing for plans.',
    offerings: [{ url: null, description: 'Consulting' }]
  })
  const goal = {
    title: 'Win more demos',
    objectiveType: 'lead_gen' as const,
    keyMessage: 'Short demos convert better than long ones.',
    desiredAction: '',
    targetUrl: '',
    basedOn: 'Consulting'
  }

  it('collects the website and links written in the bio', () => {
    assert.deepStrictEqual([...allowedUrls.values()].sort(), [
      'acme.com/pricing',
      'https://www.acme.com/'
    ])
  })

  it('keeps saved links in their saved form and drops invented ones', () => {
    const kept = keepValidSuggestions(
      {
        goals: [
          { ...goal, targetUrl: 'acme.com' },
          {
            ...goal,
            title: 'Another goal',
            targetUrl: 'https://made-up.example/x'
          }
        ]
      },
      { allowedUrls, existingGoals: [] }
    )
    assert.strictEqual(kept[0]?.targetUrl, 'https://www.acme.com/')
    assert.strictEqual(kept[1]?.targetUrl, undefined)
  })

  it('drops empty, duplicate and already-existing goals', () => {
    const kept = keepValidSuggestions(
      {
        goals: [
          goal,
          { ...goal },
          { ...goal, title: 'Existing Goal' },
          { ...goal, title: 'No message', keyMessage: '  ' }
        ]
      },
      { allowedUrls, existingGoals: ['existing goal'] }
    )
    assert.deepStrictEqual(
      kept.map(g => g.title),
      ['Win more demos']
    )
    // An empty action becomes no action, not an empty string.
    assert.strictEqual(kept[0]?.desiredAction, undefined)
  })

  it('tells the model when there are no links it may use', () => {
    const prompt = buildGoalPrompt({
      profile: 'Name: Acme',
      pillars: [],
      existingGoals: [],
      allowedUrls: []
    })
    assert.match(prompt, /Allowed links: none, so leave targetUrl empty/)
    assert.match(prompt, /Existing goals: none/)
  })
})

describe('post-drafting guard', () => {
  it('requires a hook and a body', () => {
    const draft = {
      hook: 'A hook',
      body: 'A body',
      cta: '',
      hashtags: [],
      alternateHooks: ['a', 'b'],
      selfScores: {
        hookStrength: 5,
        onBrand: 5,
        clarity: 5,
        evidenceGrounding: 5,
        originality: 5
      },
      selfFlags: []
    }
    assert.strictEqual(isCompleteDraft(draft), true)
    assert.strictEqual(isCompleteDraft({ ...draft, body: '  ' }), false)
    assert.strictEqual(isCompleteDraft(null), false)
  })

  it('cuts a hook the body repeats, ignoring spacing and case', () => {
    const hook =
      'Standardizing on one platform makes classrooms simpler to run. It also narrows your options.'
    assert.strictEqual(
      withoutRepeatedHook({
        hook,
        body: `${hook.toUpperCase().replace('. ', '.\n')}\n\nBoth are true.`
      }).body,
      'Both are true.'
    )
    // A body that only shares a few words, or is nothing but the hook, stays.
    const partial = { hook, body: 'Standardizing is hard.\n\nMore here.' }
    assert.strictEqual(withoutRepeatedHook(partial), partial)
    const midWord = { hook: 'Plan the run', body: 'Plan the running order.' }
    assert.strictEqual(withoutRepeatedHook(midWord), midWord)
    const onlyHook = { hook, body: hook }
    assert.strictEqual(withoutRepeatedHook(onlyHook), onlyHook)
    // Regex characters in the hook are matched literally.
    assert.strictEqual(
      withoutRepeatedHook({ hook: 'Is $5 (really) enough?', body: 'Is $5 (really) enough? Yes.' }).body,
      'Yes.'
    )
  })
})

describe('research agent guard', () => {
  const url = 'https://example.com/report'
  const seen: ResearchSeen = new Map([
    [
      url,
      {
        finding: {
          url,
          title: 'Annual report',
          snippet: 'Short snippet.',
          provider: 'serper_search',
          publishedAt: 'Jan 2026'
        },
        text: 'Short snippet.\nThe survey of 400 teams found that weekly reviews cut rework by a third.'
      }
    ]
  ])

  it('keeps a verbatim quote and uses it as the finding text', () => {
    const { findings, rejected } = keepVerifiedFindings(
      [{ url, quote: 'weekly reviews cut   rework by a third' }],
      seen
    )
    assert.strictEqual(rejected, 0)
    assert.strictEqual(
      findings[0]?.snippet,
      'weekly reviews cut   rework by a third'
    )
    assert.strictEqual(findings[0]?.title, 'Annual report')
    assert.strictEqual(findings[0]?.publishedAt, 'Jan 2026')
  })

  it('rejects unknown URLs, paraphrases, short quotes and duplicates', () => {
    const { findings, rejected } = keepVerifiedFindings(
      [
        {
          url: 'https://invented.example',
          quote: 'weekly reviews cut rework by a third'
        },
        { url, quote: 'weekly reviews reduce rework by about 33 percent' },
        { url, quote: 'a third' },
        { url, quote: 'The survey of 400 teams found that weekly reviews' },
        { url, quote: 'the survey of 400 teams found that weekly reviews' }
      ],
      seen
    )
    assert.strictEqual(findings.length, 1)
    assert.strictEqual(rejected, 4)
  })

  it(`stops at ${MAX_FINDINGS} findings`, () => {
    const many: ResearchSeen = new Map(
      Array.from({ length: MAX_FINDINGS + 3 }, (_, i) => {
        const u = `https://example.com/${i}`
        return [
          u,
          {
            finding: {
              url: u,
              title: `Page ${i}`,
              snippet: '',
              provider: 'serper_search'
            },
            text: `This page states a long enough fact number ${i} for the guard.`
          }
        ] as const
      })
    )
    const { findings } = keepVerifiedFindings(
      [...many.keys()].map((u, i) => ({
        url: u,
        quote: `states a long enough fact number ${i} for the guard`
      })),
      many
    )
    assert.strictEqual(findings.length, MAX_FINDINGS)
  })
})
