import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  checkClaimDirectSupport,
  detectFabricatedAnecdote,
  extractNumbers,
  findUnsupportedAbsolutes,
  mentionsFigure,
  validateIdea,
  type GroundingCorpus
} from '../src/lib/ai/skills/ideation/guard'
import {
  calculateThesisSimilarity,
  filterDiverseIdeas,
  sharesDominantTopic
} from '../src/lib/ai/idea-diversity'
import type { GeneratedIdeaItem } from '../src/lib/ai/skills/ideation/schema'
import { parseHashtagPolicy } from '../src/lib/ai/hashtags'
import { pickWeightedPillars } from '../src/lib/ai/pillars'
import { runLinter } from '../src/lib/lint/run-linter'
import { checkNovelty } from '../src/lib/novelty'
import { looksLikePlaceholderPage } from '../src/lib/scraper'
import { guardMediaBrief } from '../src/lib/ai/skills/media-brief/guard'
import type { MediaBrief } from '../src/lib/ai/skills/media-brief/schema'

const corpus: GroundingCorpus = {
  verifiedClaims: [
    {
      claim: 'Teams that run evaluations in CI catch 40% more regressions before release.',
      quote: 'Teams that run evaluations in CI catch 40% more regressions before release.',
      sourceTitle: 'Evaluation Practices Report',
      sourceUrl: 'https://example.com/evals',
      sourceId: 'doc-1'
    },
    {
      claim: 'Retrieval quality, not model size, is the dominant driver of answer accuracy.',
      quote: 'Retrieval quality, not model size, is the dominant driver of answer accuracy.',
      sourceTitle: 'Retrieval Benchmarks',
      sourceUrl: 'https://example.com/retrieval',
      sourceId: 'doc-2'
    }
  ],
  hasFreshEvidence: false
}

function makeIdea(overrides: Partial<GeneratedIdeaItem> = {}): GeneratedIdeaItem {
  return {
    title: 'Retrieval beats model size',
    thesis: 'Retrieval quality, not model size, is the dominant driver of answer accuracy.',
    perspectiveAngle: 'common_misconception',
    angle: 'Where accuracy actually comes from',
    pillar: 'AI Engineering',
    format: 'thought_leadership',
    whyNow: 'Teams keep reaching for bigger models before fixing retrieval.',
    hookConcept: 'Most teams upgrade the model when the retrieval layer is the problem.',
    coreArgument:
      'Retrieval quality, not model size, is the dominant driver of answer accuracy.',
    audienceTakeaway: 'Measure retrieval before paying for a larger model.',
    supportingEvidence: [],
    suggestedMedia: { mode: 'none' },
    noveltyNote: 'Targets the upgrade reflex rather than repeating generic RAG advice.',
    estimatedStrength: 85,
    groundingScore: 85,
    originalityScore: 85,
    unsupportedClaims: [],
    sourceIds: [],
    risks: [],
    ...overrides
  }
}

describe('extractNumbers', () => {
  it('does not treat ordinary integers as statistical claims', () => {
    // Regression: every integer >= 10 used to be flagged, so "10 minutes" was
    // rewritten to "scale minutes".
    const found = extractNumbers('This takes 10 minutes and covers 15 teams.')
    assert.deepStrictEqual(found, [])
  })

  it('captures percentages, currency, multipliers and stated thresholds', () => {
    assert.ok(extractNumbers('accuracy rose 40%').includes('40%'))
    assert.ok(extractNumbers('costs $1.2M per year').includes('$1.2m'))
    assert.ok(extractNumbers('a 3x improvement').includes('3x'))
    assert.ok(extractNumbers('around 50 customers').includes('50'))
    assert.ok(extractNumbers('2 million users').some(n => n.includes('million')))
  })
  it('never takes part of a longer number as a figure', () => {
    assert.deepStrictEqual(extractNumbers('rose 25%'), ['25%'])
    assert.deepStrictEqual(extractNumbers('rose 12.5%'), ['12.5%'])
    assert.deepStrictEqual(extractNumbers('rose 1,250%'), ['1,250%'])
    assert.deepStrictEqual(extractNumbers('1.5 million users'), ['1.5 million'])
    assert.deepStrictEqual(extractNumbers('a 2.5x lift'), ['2.5x'])
    assert.deepStrictEqual(extractNumbers('raised $1,200,000'), ['$1,200,000'])
  })
})

describe('mentionsFigure', () => {
  it('matches a figure stated in the text', () => {
    assert.strictEqual(mentionsFigure('churn fell 5% last year', '5%'), true)
    assert.strictEqual(mentionsFigure('churn fell 5 % last year', '5%'), true)
    assert.strictEqual(mentionsFigure('churn fell 2.5%.', '2.5%'), true)
    assert.strictEqual(mentionsFigure('over 1,200 clients', '1,200'), true)
    assert.strictEqual(mentionsFigure('costs $ 5k a month', '$5k'), true)
    assert.strictEqual(mentionsFigure('we have 50.', '50'), true)
  })

  it('does not match a figure that is only part of a longer number', () => {
    assert.strictEqual(mentionsFigure('churn fell 25%', '5%'), false)
    assert.strictEqual(mentionsFigure('churn fell 12.5%', '2.5%'), false)
    assert.strictEqual(mentionsFigure('churn fell 2.55%', '2.5%'), false)
    assert.strictEqual(mentionsFigure('over 1,200 clients', '200'), false)
    assert.strictEqual(mentionsFigure('over 1,2005 clients', '1,200'), false)
    assert.strictEqual(mentionsFigure('over 120 clients', '12'), false)
    assert.strictEqual(mentionsFigure('it costs $50', '$5'), false)
    assert.strictEqual(mentionsFigure('a 13x lift', '3x'), false)
    assert.strictEqual(mentionsFigure('1.5 million users', '5 million'), false)
  })
})

describe('validateIdea', () => {
  it('never rewrites the idea prose', () => {
    // Regression: absolutes and figures used to be regex-substituted in place,
    // producing broken sentences such as "many single day".
    const idea = makeIdea({
      thesis: 'Every single day, teams never revisit their retrieval layer.',
      coreArgument: 'This happens in nearly every team we would consider mature.'
    })
    const before = JSON.parse(JSON.stringify(idea))
    const result = validateIdea(idea, corpus)

    assert.strictEqual(result.idea.thesis, before.thesis)
    assert.strictEqual(result.idea.coreArgument, before.coreArgument)
    assert.strictEqual(result.idea.hookConcept, before.hookConcept)
    assert.strictEqual(result.idea.title, before.title)
  })

  it('leaves the account name intact in the title', () => {
    // Regression: the account's own name was scrubbed out and replaced with
    // "Modern B2B Operations" by an anti-promotional rule.
    const idea = makeIdea({ title: 'What Acme learned about retrieval' })
    const result = validateIdea(idea, corpus)
    assert.match(result.idea.title, /Acme/)
  })

  it('flags a figure that appears in no source and marks the idea invalid', () => {
    const result = validateIdea(
      makeIdea({ coreArgument: 'Retrieval tuning cut our error rate by 93%.' }),
      corpus
    )
    assert.strictEqual(result.hasUnsupportedNumbers, true)
    assert.strictEqual(result.isValid, false)
    assert.ok(result.issues.some(i => i.includes('93%')))
  })

  it('accepts a figure that is present in the evidence', () => {
    const result = validateIdea(
      makeIdea({
        coreArgument:
          'Teams that run evaluations in CI catch 40% more regressions before release.'
      }),
      corpus
    )
    assert.strictEqual(result.hasUnsupportedNumbers, false)
    assert.strictEqual(result.isValid, true)
  })

  it('drops unverifiable evidence but keeps grounded evidence', () => {
    const result = validateIdea(
      makeIdea({
        supportingEvidence: [
          {
            claim:
              'Retrieval quality, not model size, is the dominant driver of answer accuracy.',
            factType: 'verified',
            confidence: 0.9
          },
          {
            claim: 'Nine out of ten CTOs switched vendors after a 55% cost rise.',
            factType: 'verified',
            confidence: 0.9
          }
        ]
      }),
      corpus
    )

    assert.strictEqual(result.idea.supportingEvidence.length, 1)
    assert.match(result.idea.supportingEvidence[0]!.claim, /Retrieval quality/)
    assert.strictEqual(
      result.idea.supportingEvidence[0]!.sourceUrl,
      'https://example.com/retrieval'
    )
  })

  it('surfaces problems on the idea so the approval gate can show them', () => {
    const result = validateIdea(
      makeIdea({ coreArgument: 'This proves that retrieval is all that matters.' }),
      corpus
    )
    assert.ok(result.idea.risks.some(r => r.includes('proves that')))
  })
})

describe('detectFabricatedAnecdote', () => {
  it('catches invented first-hand experience', () => {
    assert.strictEqual(
      detectFabricatedAnecdote('We worked with a logistics firm last quarter.', []).detected,
      true
    )
    assert.strictEqual(
      detectFabricatedAnecdote('A customer told us their pipeline broke.', []).detected,
      true
    )
  })

  it('allows the phrase when a source quotes it verbatim', () => {
    const quote = 'We worked with a logistics firm to rebuild the index.'
    assert.strictEqual(
      detectFabricatedAnecdote('We worked with a logistics firm.', [quote]).detected,
      false
    )
  })

  it('does not flag ordinary analytical prose', () => {
    assert.strictEqual(
      detectFabricatedAnecdote(
        'Most teams reach for a bigger model before measuring retrieval.',
        []
      ).detected,
      false
    )
  })
})

describe('findUnsupportedAbsolutes', () => {
  it('flags certainty the evidence does not carry', () => {
    assert.ok(findUnsupportedAbsolutes('This proves that scale wins.', []).length > 0)
  })

  it('leaves ordinary use of common words alone', () => {
    // Regression: "every" and "never" anywhere used to trigger a substitution.
    assert.deepStrictEqual(
      findUnsupportedAbsolutes('Every morning I never skip the retrieval check.', []),
      []
    )
  })
})

describe('checkClaimDirectSupport', () => {
  it('marks a verbatim claim as directly supported', () => {
    const result = checkClaimDirectSupport(
      'Retrieval quality, not model size, is the dominant driver of answer accuracy.',
      corpus.verifiedClaims
    )
    assert.strictEqual(result.support, 'direct')
    assert.strictEqual(result.matchedSource?.sourceId, 'doc-2')
  })

  it('marks an invented statistic as unsupported', () => {
    const result = checkClaimDirectSupport(
      'Adoption grew 88% after the migration.',
      corpus.verifiedClaims
    )
    assert.strictEqual(result.support, 'unsupported')
  })
})

describe('filterDiverseIdeas', () => {
  it('rejects a near-duplicate thesis', () => {
    const a = makeIdea({ title: 'A', perspectiveAngle: 'common_misconception' })
    const b = makeIdea({
      title: 'B',
      perspectiveAngle: 'contrarian_take',
      thesis: 'Retrieval quality, not model size, is the dominant driver of answer accuracy.',
      coreArgument:
        'Retrieval quality, not model size, is the dominant driver of answer accuracy.'
    })
    const result = filterDiverseIdeas([a, b], 5)
    assert.strictEqual(result.selected.length, 1)
    assert.strictEqual(result.rejected.length, 1)
  })

  it('never returns more than the requested count', () => {
    const ideas = Array.from({ length: 8 }, (_, i) =>
      makeIdea({
        title: `Idea ${i}`,
        thesis: `A distinct proposition number ${i} about wholly separate subject matter ${i}.`,
        coreArgument: `Unrelated reasoning ${i} concerning topic ${i} and its consequences.`
      })
    )
    assert.ok(filterDiverseIdeas(ideas, 3).selected.length <= 3)
  })
})

describe('sharesDominantTopic', () => {
  it('is domain agnostic', () => {
    assert.strictEqual(
      sharesDominantTopic(
        'Retrieval quality drives accuracy more than model scaling does',
        'Model scaling matters less than retrieval quality for accuracy'
      ),
      true
    )
    assert.strictEqual(
      sharesDominantTopic(
        'Retrieval quality drives accuracy improvements',
        'Hiring senior engineers changes review culture'
      ),
      false
    )
  })
})

describe('calculateThesisSimilarity', () => {
  it('scores paraphrases higher than unrelated statements', () => {
    const paraphrase = calculateThesisSimilarity(
      'Retrieval quality drives accuracy',
      'Accuracy is driven by retrieval quality'
    )
    const unrelated = calculateThesisSimilarity(
      'Retrieval quality drives accuracy',
      'Remote onboarding needs written documentation'
    )
    assert.ok(paraphrase > unrelated)
  })
})

describe('pickWeightedPillars', () => {
  it('allocates in proportion to the configured weights', () => {
    const picked = pickWeightedPillars(
      [
        { name: 'A', weight_pct: 60 },
        { name: 'B', weight_pct: 40 }
      ],
      10
    )
    assert.strictEqual(picked.length, 10)
    assert.strictEqual(picked.filter(p => p.name === 'A').length, 6)
    assert.strictEqual(picked.filter(p => p.name === 'B').length, 4)
  })

  it('returns nothing when no pillars are configured', () => {
    assert.deepStrictEqual(pickWeightedPillars([], 5), [])
  })
})

describe('parseHashtagPolicy', () => {
  it('reads the counts voice configs actually contain', () => {
    assert.deepStrictEqual(parseHashtagPolicy('0-3, end of post'), { min: 0, max: 3 })
    assert.deepStrictEqual(parseHashtagPolicy('5-7 relevant tags, end of post'), { min: 5, max: 7 })
    assert.deepStrictEqual(parseHashtagPolicy('none'), { min: 0, max: 0 })
    assert.deepStrictEqual(parseHashtagPolicy('0, none'), { min: 0, max: 0 })
    assert.deepStrictEqual(parseHashtagPolicy('3'), { min: 3, max: 3 })
  })

  it('returns null rather than inventing a count', () => {
    assert.strictEqual(parseHashtagPolicy('a few relevant ones'), null)
    assert.strictEqual(parseHashtagPolicy(''), null)
  })
})

describe('runLinter', () => {
  const body = 'A clear paragraph about retrieval quality and why it matters.'

  it('honours the configured limits rather than hardcoded ones', () => {
    // Regression: the linter was always called with maxChars 3000 / hook 200,
    // ignoring the account's own post constraints.
    const findings = runLinter({
      hook: 'x'.repeat(120),
      body,
      maxChars: 500,
      hookMaxChars: 100
    })
    const hookFinding = findings.find(f => f.rule === 'hook_fold')
    assert.strictEqual(hookFinding?.passed, false)
    assert.match(hookFinding!.message, /100 character/)
  })

  it('catches markdown, which LinkedIn renders as literal characters', () => {
    const findings = runLinter({ hook: 'Hook', body: 'This is **bold** text.' })
    assert.strictEqual(
      findings.find(f => f.rule === 'no_markdown_leakage')?.passed,
      false
    )
  })

  it('flags a body link when the strategy says first comment', () => {
    const findings = runLinter({
      hook: 'Hook',
      body: 'Read more at https://example.com/post',
      linkPlacement: 'first_comment'
    })
    assert.strictEqual(findings.find(f => f.rule === 'link_placement')?.passed, false)
  })

  it('flags banned topics from the account guardrails', () => {
    const findings = runLinter({
      hook: 'Hook',
      body: 'A quick note on politics and the election.',
      bannedTopics: ['politics']
    })
    assert.strictEqual(findings.find(f => f.rule === 'banned_topics')?.passed, false)
  })

  it('flags a hashtag count outside the voice policy', () => {
    const findings = runLinter({
      hook: 'Hook',
      body: 'Body text here.',
      hashtags: ['One', 'Two', 'Three', 'Four'],
      hashtagRange: { min: 0, max: 3 }
    })
    assert.strictEqual(findings.find(f => f.rule === 'hashtag_count')?.passed, false)
  })
})

describe('checkNovelty', () => {
  it('rejects a post that repeats a recent hook opening', () => {
    const past = [
      {
        hook: 'Most teams upgrade the model when retrieval is the problem',
        body: 'Body about retrieval quality and evaluation practice.'
      }
    ]
    const result = checkNovelty(
      'Most teams upgrade the model when evaluation is the problem',
      'Different body entirely about hiring and team structure.',
      past
    )
    assert.strictEqual(result.isNovel, false)
  })

  it('accepts a genuinely different post', () => {
    const past = [
      { hook: 'Retrieval beats scale', body: 'Body about retrieval quality.' }
    ]
    const result = checkNovelty(
      'Written documentation is the real onboarding fix',
      'A body about remote onboarding, written process and async handovers.',
      past
    )
    assert.strictEqual(result.isNovel, true)
  })
})

describe('looksLikePlaceholderPage', () => {
  it('catches error pages that would otherwise become grounding evidence', () => {
    assert.strictEqual(looksLikePlaceholderPage('Page not found', 'short body'), true)
    assert.strictEqual(looksLikePlaceholderPage('404', 'nothing here'), true)
    assert.strictEqual(
      looksLikePlaceholderPage('Just a moment...', 'Checking your browser'),
      true
    )
  })

  it('lets a real article through', () => {
    assert.strictEqual(
      looksLikePlaceholderPage(
        'Why retrieval quality beats model size',
        'A long article about evaluation practice and retrieval tuning across production systems.'
      ),
      false
    )
  })
})

describe('guardMediaBrief', () => {
  const post =
    'Outsourcing arrangements erode around month four, when the exceptions nobody scoped have accumulated and no one owns the decision rules for them.'

  const baseBrief: MediaBrief = {
    postTopic: 'Outsourcing exception handling',
    coreThesis: 'Unscoped exceptions accumulate until nobody owns them.',
    readerTakeaway: 'Name a decision owner for exceptions.',
    primaryConcept: 'A pipeline where unscoped exceptions accumulate into an unowned pile',
    visualMetaphor: 'A process line with exceptions peeling off into a growing stack',
    visualType: 'conceptual_illustration',
    textOverlay: { headline: 'The exception path is the work', supportingPoints: [] },
    avoidConcepts: [],
    whyItFits: 'Shows the accumulation mechanism.'
  }

  it('accepts a concept drawn from the post', () => {
    const result = guardMediaBrief(baseBrief, 'a clean diagram', post)
    assert.strictEqual(result.isAcceptable, true)
    assert.ok(result.relevanceScore >= 60)
  })

  it('rejects a third-party brand mark', () => {
    const result = guardMediaBrief(
      baseBrief,
      'a diagram with the Forbes logo in the corner',
      post
    )
    assert.strictEqual(result.isAcceptable, false)
    assert.ok(result.issues.some(i => i.toLowerCase().includes('forbes')))
  })

  it('does not count a watermark or logo the prompt asks to leave out', () => {
    // Regression: "no watermarks", which the brief's own instructions ask for,
    // failed the brief and paid for a retry.
    const result = guardMediaBrief(
      baseBrief,
      'a clean diagram on an off-white background. No logos, no text watermarks, without any Getty-style stock look.',
      post
    )
    assert.strictEqual(result.issues.length, 0)
    assert.strictEqual(result.isAcceptable, true)
  })

  it('still catches a brand requested after a negated clause', () => {
    const result = guardMediaBrief(
      baseBrief,
      'no people. Put the Forbes logo in the corner',
      post
    )
    assert.ok(result.issues.some(i => i.toLowerCase().includes('forbes')))
  })

  it('allows the account to name itself', () => {
    const result = guardMediaBrief(
      baseBrief,
      'a diagram carrying the Getty brand',
      post,
      'getty'
    )
    assert.strictEqual(result.issues.length, 0)
  })

  it('rejects a figure rendered into the image that the post never states', () => {
    const result = guardMediaBrief(
      { ...baseBrief, textOverlay: { headline: 'Costs drop 62%', supportingPoints: [] } },
      'a diagram',
      post
    )
    assert.strictEqual(result.isAcceptable, false)
    assert.ok(result.issues.some(i => i.includes('62%')))
  })

  it('does not take a figure in the image as part of a longer one in the post', () => {
    const overlay = (headline: string) => ({
      ...baseBrief,
      textOverlay: { headline, supportingPoints: [] }
    })
    const withFigure = 'Costs drop 25% once exceptions have an owner.'
    assert.ok(
      guardMediaBrief(overlay('Costs drop 5%'), 'a diagram', withFigure).issues.some(i =>
        i.includes('"5%"')
      )
    )
    assert.ok(
      !guardMediaBrief(overlay('Costs drop 25%'), 'a diagram', withFigure).issues.some(i =>
        i.includes('25%')
      )
    )
  })

  it('rejects a real person the post never mentions', () => {
    const result = guardMediaBrief(
      baseBrief,
      'a portrait of Einstein beside the diagram',
      post
    )
    assert.strictEqual(result.isAcceptable, false)
  })
})
