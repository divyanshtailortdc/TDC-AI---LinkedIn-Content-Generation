import assert from 'node:assert'
import { describe, it } from 'node:test'
import { EMPTY_HISTORY, describeCta, recentCtasOf } from '../src/lib/ai/context-blocks'
import { balanceByGoal, selectIdeas } from '../src/lib/ai/idea-selection'
import { buildPostLintOptions } from '../src/lib/ai/pipeline/post-lint'
import {
  replaceEvidenceLabels,
  resolveGeneratedIdea
} from '../src/lib/ai/skills/ideation/guard'
import { buildPrompt as ideationPrompt, buildInstructions as ideationInstructions } from '../src/lib/ai/skills/ideation/prompt'
import * as draftingPrompt from '../src/lib/ai/skills/post-drafting/prompt'
import { analyzeHeuristically } from '../src/lib/ai/skills/voice-analysis/fallback'
import { runLinter, type LintOptions } from '../src/lib/lint/run-linter'
import { DEFAULT_WRITING_THRESHOLDS, writingSettingsForVoice } from '../src/lib/lint/writing-rules'
import {
  countContrastFrames,
  ctaSimilarity,
  longestSharedRun
} from '../src/lib/lint/writing-checks'

// Posts as the app produced them for the AI-consultant test account.
const PRIYA_POST_3 = `Most teams can't say what the model upgrade changed.
The pilot doesn't fail. It idles.
It's not a delay. It's the missing definition of correct showing up late.
This is not a pitch. It is a decision rule.
One recent post says evaluation comes last.`

const rules = (o: Partial<LintOptions> & { hook: string; body: string }) =>
  runLinter(o)
    .filter(f => !f.passed)
    .map(f => f.rule)

describe('writing checks: habits that read as machine-written', () => {
  it('counts "not X, it\'s Y" turns', () => {
    assert.ok(countContrastFrames("It's not a delay. It's a missing spec.") >= 1)
    assert.ok(
      countContrastFrames(
        "It's not a delay. It's a spec.\nThis isn't a tool. It's a habit.\nThe pilot doesn't fail. It idles."
      ) >= 3
    )
    assert.equal(countContrastFrames('We ran the test on Monday and wrote down what broke.'), 0)
  })

  it('flags a post that leans on the pattern', () => {
    const failed = rules({
      hook: "It's not a delay. It's a missing spec.",
      body: "This isn't a tool. It's a habit.\nThe pilot doesn't fail. It idles."
    })
    assert.ok(failed.includes('contrast_overuse'))
  })

  it('allows one or two', () => {
    const failed = rules({
      hook: 'The review step had no owner.',
      body: "It's not a delay. It's a missing definition.\nWrite the definition first."
    })
    assert.ok(!failed.includes('contrast_overuse'))
  })

  it('flags the draft that said "not a pitch" and then pitched', () => {
    const failed = rules({ hook: 'A rule for pilots.', body: PRIYA_POST_3 })
    assert.ok(failed.includes('meta_statement'))
    assert.ok(failed.includes('vague_attribution'))
    assert.ok(failed.includes('sweeping_claim'))
  })

  it('leaves hedged and named claims alone', () => {
    const failed = rules({
      hook: 'Many teams skip the baseline.',
      body: 'In most teams the review has no owner. The Stanford AI Index reports a rise in pilots.'
    })
    assert.ok(!failed.includes('sweeping_claim'))
    assert.ok(!failed.includes('vague_attribution'))
  })

  it('accepts "a recent post" when the source is named', () => {
    assert.ok(!rules({ hook: 'h', body: 'A recent post from Stanford HAI says evaluation comes first.' }).includes('vague_attribution'))
    assert.ok(rules({ hook: 'h', body: 'A recent post says evaluation comes first.' }).includes('vague_attribution'))
  })

  it('catches "research shows" as well as "studies show"', () => {
    assert.ok(rules({ hook: 'h', body: 'Research shows evaluation comes first.' }).includes('vague_attribution'))
    assert.ok(rules({ hook: 'h', body: 'Studies show evaluation comes first.' }).includes('vague_attribution'))
    assert.ok(!rules({ hook: 'h', body: 'People say this works. I tested it for six weeks.' }).includes('vague_attribution'))
  })

  it('does not take an author speaking for themselves as the template', () => {
    for (const text of [
      "I don't know. It depends on the team.",
      "We don't ship on Fridays. We learned that the hard way.",
      "You don't need a framework. It helps to write one down."
    ]) {
      assert.equal(countContrastFrames(text), 0, text)
    }
    assert.equal(countContrastFrames("The pilot doesn't fail. It idles."), 1)
    assert.equal(countContrastFrames("Teams don't skip the review. They forget who owns it."), 1)
  })

  it('asks the author to confirm first-hand experience', () => {
    const failed = rules({
      hook: 'A pilot stalls.',
      body: 'I keep seeing the same pattern in the work I do.'
    })
    assert.ok(failed.includes('unverified_experience'))
  })

  it('asks for nothing on a post with none of it', () => {
    const failed = rules({
      hook: 'The demo went well. Six weeks later the pilot is still in review.',
      body: 'Nobody had written down what correct looks like.\n\nWrite ten questions and the answer each should get.'
    })
    for (const rule of [
      'contrast_overuse',
      'meta_statement',
      'vague_attribution',
      'sweeping_claim',
      'unverified_experience',
      'copied_source_text',
      'repeated_cta'
    ]) {
      assert.ok(!failed.includes(rule), rule)
    }
  })
})

describe('copying from sources', () => {
  const source =
    'Without evaluation, teams are only guessing whether the system is improving over time.'

  it('finds a lifted sentence', () => {
    const run = longestSharedRun(
      'Here is the thing. Without evaluation, teams are only guessing whether the system is improving.',
      [source]
    )
    assert.ok(run.length >= 8)
    assert.ok(
      rules({
        hook: 'Hook',
        body: 'Without evaluation, teams are only guessing whether the system is improving.',
        evidenceTexts: [source]
      }).includes('copied_source_text')
    )
  })

  it('accepts a paraphrase', () => {
    assert.ok(
      !rules({
        hook: 'Hook',
        body: 'If nobody measures it, you cannot tell whether version two beat version one.',
        evidenceTexts: [source]
      }).includes('copied_source_text')
    )
  })

  it('accepts a quotation', () => {
    assert.ok(
      !rules({
        hook: 'Hook',
        body: 'The report puts it plainly: "Without evaluation, teams are only guessing whether the system is improving".',
        evidenceTexts: [source]
      }).includes('copied_source_text')
    )
  })

  it('is skipped when no evidence is given', () => {
    assert.ok(!rules({ hook: 'Hook', body: source }).includes('copied_source_text'))
  })
})

describe('which evidence the copy check reads', () => {
  const ev = (factType: string, claim: string, quote?: string) => ({ claim, quote, factType })
  const idea = {
    title: 't', thesis: '', hookConcept: '', coreArgument: '', whyNow: '',
    supportingEvidence: [
      ev('sourced', 'A restated claim the model wrote about the report', 'Without evaluation, teams are only guessing whether the system is improving.'),
      ev('verified', 'OpenAI published Supporting the blind community with ChatGPT on Sep 9', 'OpenAI published Supporting the blind community with ChatGPT'),
      ev('sourced', 'A claim with no quote')
    ]
  } as never
  const ctx = {
    account: { name: 'A' }, voice: null, offerings: [], audiences: [], primaryGoal: null, selectedGoals: [],
    prefs: { constraints: { cta_required: false, hashtags: null, emoji_level: 'liberal', hook_max_chars: 200, max_chars: 3000 }, guardrails: { banned_topics: [] }, research: { min_citations_per_post: 1 } },
    history: EMPTY_HISTORY
  } as never

  it('uses the verbatim quotes of web sources only', () => {
    assert.deepStrictEqual(buildPostLintOptions(ctx, idea, { hook: 'h', body: 'b' }).evidenceTexts, [
      'Without evaluation, teams are only guessing whether the system is improving.'
    ])
  })

  it("does not flag naming the author's own page by its title", () => {
    const failed = runLinter(
      buildPostLintOptions(ctx, idea, {
        hook: 'OpenAI published Supporting the blind community with ChatGPT last month.',
        body: 'Read it.'
      })
    ).filter(f => !f.passed).map(f => f.rule)
    assert.ok(!failed.includes('copied_source_text'))
  })

  it("does not flag the model's own restated claim", () => {
    const failed = runLinter(
      buildPostLintOptions(ctx, idea, {
        hook: 'h',
        body: 'A restated claim the model wrote about the report, in the post too.'
      })
    ).filter(f => !f.passed).map(f => f.rule)
    assert.ok(!failed.includes('copied_source_text'))
  })

  it('still flags a sentence lifted from the web source', () => {
    const failed = runLinter(
      buildPostLintOptions(ctx, idea, {
        hook: 'h',
        body: 'Without evaluation, teams are only guessing whether the system is improving.'
      })
    ).filter(f => !f.passed).map(f => f.rule)
    assert.ok(failed.includes('copied_source_text'))
  })

  it('does not run the repeated-ask check when a post is edited', () => {
    const failed = runLinter(
      buildPostLintOptions(ctx, idea, { hook: 'h', body: 'b', cta: 'Which metric do you use?' })
    ).filter(f => !f.passed).map(f => f.rule)
    assert.ok(!failed.includes('repeated_cta'))
  })
})

describe('repeated closing asks', () => {
  const asked = 'If your pilot is stuck in review, message me about a 2-week AI readiness assessment.'

  it('measures similarity', () => {
    assert.ok(
      ctaSimilarity(asked, 'If your pilot stalled in review, message me about a 2-week AI readiness assessment.') >= 0.7
    )
    assert.ok(ctaSimilarity(asked, 'Which metric does your team use to call a pilot done?') < 0.4)
  })

  it('flags a repeat and passes a different ask', () => {
    const base = { hook: 'Hook', body: 'Body' }
    assert.ok(
      rules({ ...base, cta: asked, recentCtas: [asked] }).includes('repeated_cta')
    )
    assert.ok(
      !rules({
        ...base,
        cta: 'Which metric does your team use to call a pilot done?',
        recentCtas: [asked]
      }).includes('repeated_cta')
    )
    assert.ok(!rules({ ...base, cta: asked }).includes('repeated_cta'))
  })

  it('shows recent asks to the drafting model so the next one differs', () => {
    const ctx = {
      primaryGoal: { desiredAction: 'Message me about a 2-week AI readiness assessment' },
      prefs: { constraints: { cta_required: true } },
      history: {
        ...EMPTY_HISTORY,
        drafts: [
          { hook: 'h1', originalHook: 'h1', body: 'b', cta: asked, status: 'approved' },
          { hook: 'h2', originalHook: 'h2', body: 'b', cta: asked, status: 'approved' },
          { hook: 'h3', originalHook: 'h3', body: 'b', cta: null, status: 'approved' }
        ]
      }
    } as never
    assert.deepStrictEqual(recentCtasOf(ctx), [asked])
    const text = describeCta(ctx)
    assert.match(text, /Steer the reader toward: Message me about a 2-week/)
    assert.match(text, /only when this post's argument leads to it/)
    assert.match(text, /do not repeat their wording/)
    assert.ok(text.includes(asked))
  })

  it('adds nothing to the brief for an account with no earlier posts', () => {
    const ctx = {
      primaryGoal: null,
      prefs: { constraints: { cta_required: true } },
      history: EMPTY_HISTORY
    } as never
    assert.ok(!describeCta(ctx).includes('Recent posts already ended'))
  })
})

describe('drafting instructions', () => {
  const ctx = {
    account: { name: 'Priya', accountType: 'person', headline: 'AI consultant' },
    voice: null,
    offerings: [],
    audiences: [],
    knowledgeDocs: [],
    samplePosts: [],
    goals: [],
    selectedGoals: [],
    primaryGoal: null,
    preferencesId: null,
    prefs: { constraints: { cta_required: true, hashtags: null, hashtag_policy: '0-3', emoji_level: 'none', hook_max_chars: 200, target_chars: 1300, max_chars: 3000, variants_per_post: 2 }, guardrails: { banned_topics: [], compliance_notes: '' } },
    history: {
      ...EMPTY_HISTORY,
      drafts: [{ hook: 'The review step nobody owned.', originalHook: 'The review step nobody owned.', body: 'b', cta: null, status: 'approved' }]
    }
  } as never

  it('tells the model how to treat sources, sweeping claims and hooks', () => {
    const text = draftingPrompt.buildInstructions(ctx)
    assert.match(text, /name its source by title/)
    assert.match(text, /never write "one recent post"/)
    assert.match(text, /"most", "everyone", "always" or "never" only when the evidence measures it/)
    assert.match(text, /Open on one concrete thing/)
    assert.match(text, /at most twice/)
    assert.match(text, /this is not a pitch/)
  })

  it('keeps the cached instructions free of per-draft history', () => {
    assert.ok(!draftingPrompt.buildInstructions(ctx).includes('The review step nobody owned.'))
  })

  it('shows the latest hooks in the brief so the new post opens differently', () => {
    const prompt = draftingPrompt.buildPrompt(ctx, {
      title: 'T', thesis: '', angle: '', whyNow: '', hookConcept: 'h', hook: 'h',
      coreArgument: '', audienceTakeaway: '', supportingEvidence: []
    } as never)
    assert.match(prompt, /latest posts opened with the lines below/)
    assert.match(prompt, /- The review step nobody owned\./)
  })
})

// ------------------------------------------------------------------ ideation

describe('evidence labels in idea text', () => {
  const corpus = [
    { claim: 'a', sourceTitle: 'Supporting the blind community with ChatGPT' },
    { claim: 'b', sourceTitle: 'Sam Altman at UN Security Council' },
    { claim: 'c' }
  ]

  it('names the source instead of the label', () => {
    assert.equal(
      replaceEvidenceLabels('E2 is an unverified third-party source.', corpus),
      '"Sam Altman at UN Security Council" is an unverified third-party source.'
    )
    assert.equal(
      replaceEvidenceLabels('E1 and [E2] disagree', corpus),
      '"Supporting the blind community with ChatGPT" and "Sam Altman at UN Security Council" disagree'
    )
  })

  it('falls back to "a source" when there is no title or no such item', () => {
    assert.equal(replaceEvidenceLabels('E3 is unverified', corpus), 'a source is unverified')
    assert.equal(replaceEvidenceLabels('E16 is unverified', corpus), 'a source is unverified')
  })

  it('leaves ordinary words alone', () => {
    const text = 'Build E2E tests and read the E-mail policy.'
    assert.equal(replaceEvidenceLabels(text, corpus), text)
  })

  it('is applied to the notes written for the reviewer', () => {
    const idea = resolveGeneratedIdea(
      {
        title: 'T', thesis: 'Per E1', perspectiveAngle: 'process', angle: 'a', pillar: 'P',
        format: 'f', whyNow: 'See E2', hookConcept: 'h', coreArgument: 'E2 says so',
        audienceTakeaway: 't', supportingEvidence: [{ evidenceRef: 'E1', claim: 'From E1' }],
        noveltyNote: 'n', estimatedStrength: 80,
        risks: ['E2 is an unverified third-party source, so confirm the quote.']
      } as never,
      corpus
    )
    assert.match(idea.risks[0]!, /^"Sam Altman at UN Security Council" is an unverified/)
    assert.equal(idea.whyNow, 'See "Sam Altman at UN Security Council"')
  })

  it("leaves the post's own content alone, where E5 may be a real name", () => {
    const idea = resolveGeneratedIdea(
      {
        title: 'Microsoft 365 E5 vs E3', thesis: 'Teams on E5 pay for security they skip',
        perspectiveAngle: 'process', angle: 'E5 licences', pillar: 'P', format: 'f',
        whyNow: 'w', hookConcept: 'Is E5 worth it?', coreArgument: 'E3 plus add-ons often wins.',
        audienceTakeaway: 'Compare E3 and E5', supportingEvidence: [], noveltyNote: 'n',
        estimatedStrength: 80, risks: []
      } as never,
      corpus
    )
    assert.equal(idea.title, 'Microsoft 365 E5 vs E3')
    assert.equal(idea.hookConcept, 'Is E5 worth it?')
    assert.equal(idea.coreArgument, 'E3 plus add-ons often wins.')
  })

  it('tells the ideation model not to write labels outside evidenceRef', () => {
    assert.match(ideationInstructions(ctxForIdeation()), /Evidence labels \(E1, E2\.\.\.\) belong only in evidenceRef/)
  })
})

function ctxForIdeation() {
  return {
    account: { name: 'A', accountType: 'person', headline: 'h' },
    voice: null, offerings: [], audiences: [], knowledgeDocs: [], samplePosts: [],
    goals: [], selectedGoals: [], primaryGoal: null, preferencesId: null,
    prefs: { constraints: { cta_required: true, hashtags: null, hashtag_policy: '', emoji_level: 'none', hook_max_chars: 200, target_chars: 1300, max_chars: 3000, variants_per_post: 2 }, guardrails: { banned_topics: [], compliance_notes: '' } },
    history: EMPTY_HISTORY
  } as never
}

describe('dates in ideation', () => {
  const corpus = {
    verifiedClaims: [
      { claim: 'Research post', sourceTitle: 'Navier-Stokes', publishedAt: '2026-09-08', origin: 'web' as const }
    ],
    hasFreshEvidence: true
  }
  const build = (today: Date) =>
    ideationPrompt({ corpus, history: '', candidateCount: 3, assignedGoals: ['G1', 'G1', 'G1'], hookMaxChars: 200, today })

  it("gives the model today's date and each item's publication date", () => {
    const text = build(new Date('2026-10-19T10:00:00Z'))
    assert.match(text, /TODAY'S DATE: 2026-10-19/)
    assert.match(text, /Published: 2026-09-08/)
  })

  it('defines recent as within 30 days of that date', () => {
    assert.match(ideationInstructions(ctxForIdeation()), /within 30 days of today's date/)
  })
})

describe('goal shares in the final selection', () => {
  const goals = ['research', 'safety', 'products']
  const idea = (title: string, goalId: string, score: number) =>
    ({ title, goalId, estimatedStrength: score, groundingScore: score, originalityScore: score }) as never

  // The best scores all sit under one goal, as model output tends to.
  const ranked = [
    idea('p1', 'products', 95), idea('p2', 'products', 94), idea('p3', 'products', 93),
    idea('s1', 'safety', 90), idea('r1', 'research', 89), idea('r2', 'research', 88),
    idea('s2', 'safety', 80)
  ]
  const counts = (items: Array<{ goalId: string }>) =>
    items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.goalId]: (m[i.goalId] ?? 0) + 1 }), {})

  it('gives each selected goal an equal share, not the top scorers', () => {
    const picked = balanceByGoal(ranked, goals, 5)
    assert.equal(picked.length, 5)
    // 5 over 3 goals: the first two listed take the remainder.
    assert.deepStrictEqual(counts(picked as never), { products: 1, safety: 2, research: 2 })
  })

  it("hands a short goal's places to the best of the rest", () => {
    const noSafety = ranked.filter(i => (i as { goalId: string }).goalId !== 'safety')
    const picked = balanceByGoal(noSafety, goals, 5)
    assert.equal(picked.length, 5)
    assert.equal((counts(picked as never) as Record<string, number>).safety, undefined)
  })

  it('keeps the ranking order within the chosen set', () => {
    const titles = balanceByGoal(ranked, goals, 5).map(i => (i as { title: string }).title)
    assert.deepStrictEqual(titles, ['p1', 's1', 'r1', 'r2', 's2'])
  })

  it('does nothing for a run with one goal', () => {
    assert.deepStrictEqual(
      balanceByGoal(ranked, ['products'], 3).map(i => (i as { title: string }).title),
      ['p1', 'p2', 'p3']
    )
  })

  it('reaches selectIdeas: every selected goal is represented', () => {
    const subjects = [
      ['Payout reconciliation', 'Reconcile settlement ledgers weekly because marketplace payouts arrive net of fees.'],
      ['Warehouse shrinkage', 'Cycle counts beat annual stocktakes since shelf errors compound silently.'],
      ['Contractor withholding', 'Classify freelancers properly before year end since deductions follow the contract.'],
      ['Renewal cohorts', 'Retention curves flatten only when onboarding stops selling and starts teaching.'],
      ['Term sheet clauses', 'Liquidation preferences matter more than valuation for first rounds.'],
      ['Discount discipline', 'Gross margin erodes through small coupons nobody tracks against unit economics.']
    ]
    const pool = subjects.map(([title, text], i) => ({
      title, thesis: text, coreArgument: text, hookConcept: `Hook about ${title}`,
      perspectiveAngle: (['process', 'data', 'story', 'how_to', 'case', 'trend'] as const)[i],
      goalId: i < 4 ? 'products' : i === 4 ? 'safety' : 'research',
      estimatedStrength: 95 - i, groundingScore: 95 - i, originalityScore: 95 - i
    })) as never[]
    const { selected } = selectIdeas(pool, [], 3, goals)
    assert.deepStrictEqual(
      selected.map(i => i.goalId).sort(),
      ['products', 'research', 'safety']
    )
  })
})

describe('voice fallback', () => {
  it("does not put one account's phrases into another's rubric", () => {
    const { derivedStyleRubric } = analyzeHeuristically(
      'Our team creates value. Before making the call we check before making a decision. Net revenue retention matters.'
    )
    assert.ok(!/net revenue retention/i.test(derivedStyleRubric))
    assert.ok(!/before making a single dollar/i.test(derivedStyleRubric))
    assert.ok(!/A creates B/.test(derivedStyleRubric))
  })
})

// ------------------------------------------------- per-account writing rules

describe('writing rules follow the voice and the author\'s own posts', () => {
  const contrast3 =
    "It's not a delay. It's a missing spec.\nThis isn't a tool. It's a habit.\nThe pilot doesn't fail. It idles."
  const filler = 'To be honest, the review step had no owner.'

  const ctxFor = (voice: unknown, samples: string[] = []) =>
    ({
      account: { name: 'A' }, offerings: [], audiences: [], primaryGoal: null, selectedGoals: [],
      voice, samplePosts: samples.map(content => ({ content })),
      prefs: { constraints: { cta_required: false, hashtags: null, emoji_level: 'liberal', hook_max_chars: 200, max_chars: 3000 }, guardrails: { banned_topics: [] }, research: { min_citations_per_post: 1 } },
      history: EMPTY_HISTORY
    }) as never
  const failedFor = (ctx: never, post: { hook: string; body: string }) =>
    runLinter(buildPostLintOptions(ctx, null, post, 0)).filter(f => !f.passed).map(f => f.rule)

  it('derives settings from tone, directness and samples', () => {
    assert.deepStrictEqual(writingSettingsForVoice({ tone: 'candid', directness: 4 }, [{ content: 'My post' }]), {
      skip: ['filler_phrase'],
      thresholds: { contrastFrames: DEFAULT_WRITING_THRESHOLDS.contrastFrames + 1 },
      authorText: 'My post'
    })
    assert.deepStrictEqual(writingSettingsForVoice({ tone: 'analytical', directness: 3 }), {
      skip: [], thresholds: {}, authorText: null
    })
    assert.deepStrictEqual(writingSettingsForVoice(null), { skip: [], thresholds: {}, authorText: null })
  })

  it('flags throat-clearing by default', () => {
    assert.ok(failedFor(ctxFor({ tone: 'analytical', directness: 3 }), { hook: filler, body: 'b' }).includes('filler_phrase'))
    assert.ok(failedFor(ctxFor(null), { hook: filler, body: 'b' }).includes('filler_phrase'))
  })

  it('lets a candid voice say it', () => {
    assert.ok(!failedFor(ctxFor({ tone: 'candid', directness: 3 }), { hook: filler, body: 'b' }).includes('filler_phrase'))
  })

  it('lets any voice say what its own posts already say', () => {
    const ctx = ctxFor({ tone: 'analytical', directness: 3 }, ['To be honest, I never liked slide decks.'])
    assert.ok(!failedFor(ctx, { hook: filler, body: 'b' }).includes('filler_phrase'))
  })

  it('allows one more contrast for a punchy voice', () => {
    const post = { hook: contrast3.split('\n')[0]!, body: contrast3.split('\n').slice(1).join('\n') }
    assert.ok(failedFor(ctxFor({ tone: 'analytical', directness: 3 }), post).includes('contrast_overuse'))
    assert.ok(!failedFor(ctxFor({ tone: 'analytical', directness: 5 }), post).includes('contrast_overuse'))
  })

  it('does not count em dashes against an author who writes them', () => {
    const post = { hook: 'One — two — three — four — five.', body: 'b' }
    assert.ok(failedFor(ctxFor(null), post).includes('dash_overuse'))
    assert.ok(!failedFor(ctxFor(null, ['I like a dash — it breathes.']), post).includes('dash_overuse'))
  })

  it('takes its thresholds from the settings, not from the checking code', () => {
    const post = { hook: 'One — two — three — four — five.', body: 'b' }
    const rules = (writing: LintOptions['writing']) =>
      runLinter({ ...post, writing }).filter(f => !f.passed).map(f => f.rule)
    assert.ok(rules(undefined).includes('dash_overuse'))
    assert.ok(!rules({ thresholds: { emDashes: 10 } }).includes('dash_overuse'))
    assert.ok(rules({ thresholds: { emDashes: 0 } }).includes('dash_overuse'))
    assert.ok(!rules({ skip: ['dash_overuse'] }).includes('dash_overuse'))
  })
})

describe('sweeping claims share the absolutes check with ideation', () => {
  const rules = (o: Partial<LintOptions> & { hook: string; body: string }) =>
    runLinter(o).filter(f => !f.passed).map(f => f.rule)

  it('flags an absolute ideation already treats as unsupported', () => {
    assert.ok(rules({ hook: 'A study proves that evaluation always fails.', body: 'b' }).includes('sweeping_claim'))
  })

  it('lets the post say what its evidence or the author already says', () => {
    const known = 'The report notes that this proves that scale matters.'
    assert.ok(!rules({ hook: 'This proves that scale matters.', body: 'b', figureSources: known }).includes('sweeping_claim'))
  })

  it('reports each phrase once', () => {
    const finding = runLinter({ hook: 'It always fails. Most teams can\'t say why.', body: 'b' }).find(f => f.rule === 'sweeping_claim')!
    assert.equal((finding.message.match(/always fails/g) || []).length, 1)
  })
})
