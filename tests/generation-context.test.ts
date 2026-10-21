import assert from 'node:assert'
import { describe, it } from 'node:test'
import type {
  Account,
  Audience,
  Goal,
  Idea,
  KnowledgeDocument,
  Offering,
  VoiceConfig
} from '../src/db/schema'
import {
  describeCta,
  EMPTY_HISTORY,
  renderAudienceBlock,
  renderIdeationHistoryBlock,
  renderMediaContext,
  renderReviewerFeedbackBlock,
  resolvePreferences,
  type GenerationContext,
  type ReviewHistory
} from '../src/lib/ai/context-blocks'
import {
  buildGroundingCorpus,
  interleave
} from '../src/lib/ai/pipeline/grounding-corpus'
import * as ideationPrompt from '../src/lib/ai/skills/ideation/prompt'
import { buildPrompt as buildMediaPrompt } from '../src/lib/ai/skills/media-brief/prompt'
import { collectFigureSources } from '../src/lib/ai/skills/post-drafting/guard'
import * as draftingPrompt from '../src/lib/ai/skills/post-drafting/prompt'
import { runLinter } from '../src/lib/lint/run-linter'

/**
 * Prompts are checked across identities from unrelated fields, because the
 * pipeline was once tuned to a single ERP customer and served its domain to
 * everyone. Each account's prompts must carry its own details and none of
 * another account's.
 */

const now = new Date('2026-10-01T00:00:00Z')

function account(overrides: Partial<Account>): Account {
  return {
    id: 'acc',
    userId: null,
    name: 'Account',
    handle: 'account',
    headline: 'Headline',
    bio: null,
    avatarUrl: null,
    accountType: 'company',
    company: null,
    websiteUrl: null,
    linkedinUrl: null,
    industry: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function audience(name: string, overrides: Partial<Audience> = {}): Audience {
  return {
    id: `aud-${name.length}`,
    accountId: 'acc',
    name,
    jobTitles: [],
    seniority: [],
    industries: [],
    companySize: null,
    geography: null,
    painPoints: [],
    goals: [],
    desires: [],
    objections: [],
    sophisticationLevel: 'practitioner',
    whatTheyDontBelieveYet: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function offering(name: string, overrides: Partial<Offering> = {}): Offering {
  return {
    id: `off-${name.length}`,
    accountId: 'acc',
    name,
    type: 'service',
    tagline: null,
    description: null,
    whoItIsFor: null,
    problemSolved: null,
    keyFeatures: [],
    differentiators: [],
    pricingNote: null,
    proofPoints: [],
    url: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function goal(overrides: Partial<Goal>): Goal {
  return {
    id: 'goal',
    accountId: 'acc',
    title: 'Goal',
    objective: 'authority',
    keyMessage: null,
    desiredAction: null,
    targetUrl: null,
    linkStrategy: 'first_comment',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function voice(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    id: 'voice',
    accountId: 'acc',
    tone: 'candid',
    perspective: 'we',
    formality: 3,
    directness: 4,
    emojiPolicy: 'none',
    hashtagPolicy: '0-3, end of post',
    bannedWords: [],
    derivedStyleRubric: null,
    rawSamplesText: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function doc(id: string, overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id,
    accountId: 'acc',
    title: `Document ${id}`,
    sourceType: 'url',
    sourceUrl: `https://example.com/${id}`,
    content: '',
    author: null,
    publishedAt: null,
    wordCount: 0,
    summary: null,
    topics: [],
    keyClaims: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function context(parts: {
  account: Account
  audiences?: Audience[]
  offerings?: Offering[]
  goal?: Goal | null
  voice?: VoiceConfig | null
  docs?: KnowledgeDocument[]
  history?: ReviewHistory
  ctaRequired?: boolean
}): GenerationContext {
  const v = parts.voice === undefined ? voice() : parts.voice
  const primary = parts.goal ?? null
  return {
    account: parts.account,
    voice: v,
    offerings: parts.offerings ?? [],
    audiences: parts.audiences ?? [],
    knowledgeDocs: parts.docs ?? [],
    samplePosts: [],
    goals: primary ? [primary] : [],
    selectedGoals: primary ? [primary] : [],
    primaryGoal: primary,
    preferencesId: null,
    prefs: resolvePreferences(
      {
        id: 'prefs',
        accountId: parts.account.id,
        pillars: [],
        ideasPerRun: 5,
        postConstraints: { cta_required: parts.ctaRequired ?? true },
        guardrails: null,
        createdAt: now,
        updatedAt: now
      },
      v
    ),
    history: parts.history ?? EMPTY_HISTORY
  }
}

// Four identities with nothing in common. `marker` is a phrase only that
// account's settings contain.
const ACCOUNTS = [
  {
    marker: 'back-office outsourcing',
    ctx: context({
      account: account({
        id: 'bpo',
        name: 'Arcline',
        company: 'Arcline Services',
        industry: 'BPO and IT outsourcing',
        bio: 'Arcline runs back-office outsourcing for venture-backed startups.'
      }),
      audiences: [audience('Founders and COOs at seed to Series B startups')],
      offerings: [
        offering('Back-office operations', {
          description: 'Back-office operations\nFinance and HR operations run by a dedicated pod'
        })
      ],
      goal: goal({
        title: 'Scale without headcount',
        objective: 'engagement',
        keyMessage: 'An outsourcing partner extends the team rather than cutting cost.'
      })
    })
  },
  {
    marker: 'month-end close',
    ctx: context({
      account: account({
        id: 'books',
        name: 'Priya Rao',
        accountType: 'personal',
        industry: 'Bookkeeping for D2C brands',
        bio: 'Priya closes the books for D2C founders and explains month-end close in plain words.'
      }),
      audiences: [audience('D2C brand founders in India\r\nFinance leads at early D2C brands')],
      offerings: [offering('Bookkeeping for D2C brands')],
      goal: goal({
        title: 'Discovery calls',
        objective: 'lead_gen',
        keyMessage: 'Clean books are a growth tool, not a compliance chore.',
        desiredAction: 'Book a discovery call'
      }),
      voice: voice({ perspective: 'I' })
    })
  },
  {
    marker: 'used vehicle',
    ctx: context({
      account: account({
        id: 'cars',
        name: 'Roadly',
        industry: 'Automotive marketplace',
        bio: 'Roadly is a used vehicle marketplace with inspected listings.'
      }),
      audiences: [
        audience('People in Indian cities buying their first used car', {
          sophisticationLevel: 'novice'
        })
      ],
      offerings: [offering('Inspected used vehicle listings')],
      goal: goal({
        title: 'Trust in used cars',
        objective: 'awareness',
        keyMessage: 'An inspection report matters more than a low price.'
      })
    })
  },
  {
    marker: 'paediatric dentistry',
    ctx: context({
      account: account({
        id: 'dental',
        name: 'Brightsmile Clinic',
        industry: 'Healthcare — paediatric dentistry',
        bio: 'Brightsmile is a paediatric dentistry clinic for children under twelve.'
      }),
      audiences: [audience('Parents booking a first dental visit for a toddler')],
      offerings: [offering('First-visit check-ups for toddlers')],
      goal: null
    })
  }
]

/** Every prompt an account's content passes through. */
function allPrompts(ctx: GenerationContext): string {
  const idea = makeIdea()
  return [
    ideationPrompt.buildInstructions(ctx),
    ideationPrompt.buildPrompt({
      corpus: buildGroundingCorpus(ctx, []),
      history: renderIdeationHistoryBlock(ctx),
      candidateCount: 5,
      assignedGoals: ['G1'],
      hookMaxChars: 200
    }),
    draftingPrompt.buildInstructions(ctx),
    draftingPrompt.buildPrompt(ctx, idea),
    buildMediaPrompt({
      postText: 'A post.',
      accountContext: renderMediaContext(ctx)
    })
  ].join('\n')
}

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea',
    accountId: 'acc',
    runId: 'run',
    goalId: null,
    goalIds: [],
    goalSnapshot: null,
    offeringId: null,
    title: 'An idea',
    hook: 'A hook',
    angle: null,
    pillar: null,
    format: 'thought_leadership',
    thesis: 'A thesis.',
    perspectiveAngle: null,
    whyNow: null,
    hookConcept: 'A hook concept',
    coreArgument: 'A core argument.',
    audienceTakeaway: null,
    supportingEvidence: [],
    suggestedMedia: { mode: 'none' },
    noveltyNote: null,
    score: 80,
    groundingScore: 80,
    originalityScore: 80,
    unsupportedClaims: [],
    sourceIds: [],
    risks: [],
    status: 'approved',
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

describe('prompts across unrelated identities', () => {
  for (const { marker, ctx } of ACCOUNTS) {
    it(`${ctx.account.name}: carries its own identity and no one else's`, () => {
      const text = allPrompts(ctx)
      assert.ok(text.includes(marker), `missing "${marker}"`)
      assert.ok(text.includes(ctx.account.industry!), 'missing industry')
      assert.ok(text.includes(ctx.audiences[0]!.name.split(/\r?\n/)[0]!))
      if (ctx.primaryGoal?.keyMessage) {
        assert.ok(text.includes(ctx.primaryGoal.keyMessage))
      }
      for (const other of ACCOUNTS) {
        if (other.ctx === ctx) continue
        assert.ok(
          !text.includes(other.marker),
          `leaked "${other.marker}" into ${ctx.account.name}`
        )
        assert.ok(!text.includes(other.ctx.account.name))
      }
      // Domains and defaults that were once hardcoded for every account.
      for (const banned of ['FlowERP', 'warehouse', 'Business strategy', 'strategic technology leadership']) {
        assert.ok(!text.includes(banned), `hardcoded "${banned}"`)
      }
    })
  }
})

describe('renderAudienceBlock', () => {
  it('leaves out the sophistication default that no form sets', () => {
    const block = renderAudienceBlock(ACCOUNTS[0]!.ctx)
    assert.ok(!block.includes('sophistication'))
  })

  it('keeps a sophistication level someone chose', () => {
    assert.match(renderAudienceBlock(ACCOUNTS[2]!.ctx), /sophistication: novice/)
  })

  it('keeps every line of a multi-line audience, indented under one bullet', () => {
    const block = renderAudienceBlock(ACCOUNTS[1]!.ctx)
    assert.strictEqual(
      block,
      '- D2C brand founders in India\n  Finance leads at early D2C brands'
    )
  })
})

const history: ReviewHistory = {
  drafts: [
    {
      hook: 'Your outsourcing partner should own the runbook, not you.',
      originalHook: 'Outsourcing is not about cost.',
      body: 'Body of an earlier post.',
      status: 'approved'
    },
    {
      hook: 'Interrupt logs show where engineering time goes.',
      originalHook: 'Interrupt logs show where engineering time goes.',
      body: 'Another earlier post.',
      status: 'awaiting_review'
    }
  ],
  ideas: [
    {
      title: 'Why outsourcing breaks in month four',
      hookConcept: 'Month four is when handoffs fail.',
      thesis: 'Handoffs, not vendors, break outsourcing.',
      coreArgument: 'Document the handoff.',
      status: 'proposed',
      runId: 'run-earlier'
    },
    {
      title: 'Outsourcing is a cost play',
      hookConcept: 'Cut costs by outsourcing.',
      thesis: 'Outsourcing is mainly about saving money.',
      coreArgument: 'Save money.',
      status: 'rejected',
      runId: 'run-earlier'
    },
    {
      title: 'An idea from the run being generated',
      hookConcept: 'This run.',
      thesis: 'This run.',
      coreArgument: 'This run.',
      status: 'proposed',
      runId: 'run-now'
    }
  ],
  rejectionReasons: ['Too salesy, reads like an ad for our services']
}

describe('review history in ideation', () => {
  const ctx = { ...ACCOUNTS[0]!.ctx, history }

  it('lists covered angles, rejected ideas and the reviewer\'s reasons', () => {
    const block = renderIdeationHistoryBlock(ctx, 'run-now')
    assert.match(block, /ALREADY COVERED[\s\S]*own the runbook/)
    assert.match(block, /ALREADY COVERED[\s\S]*Why outsourcing breaks in month four/)
    assert.match(block, /REJECTED[\s\S]*- Outsourcing is a cost play/)
    assert.match(block, /"Too salesy, reads like an ad for our services"/)
  })

  it('does not count the run being generated as history', () => {
    assert.ok(
      !renderIdeationHistoryBlock(ctx, 'run-now').includes('from the run being generated')
    )
  })

  it('lists a rejected idea only as rejected, not as covered', () => {
    const block = renderIdeationHistoryBlock(ctx, 'run-now')
    const covered = block.split('IDEAS THE REVIEWER REJECTED')[0]!
    assert.ok(!covered.includes('Outsourcing is a cost play'))
  })

  it('reaches the ideation prompt', () => {
    const prompt = ideationPrompt.buildPrompt({
      corpus: { verifiedClaims: [] },
      history: renderIdeationHistoryBlock(ctx, 'run-now'),
      candidateCount: 3,
      assignedGoals: ['G1'],
      hookMaxChars: 200
    })
    assert.match(prompt, /Outsourcing is a cost play/)
  })

  it('is empty for an account with no history', () => {
    assert.strictEqual(renderIdeationHistoryBlock(ACCOUNTS[3]!.ctx), '')
  })
})

describe('review history in drafting', () => {
  it("passes on the reviewer's reasons and hook rewrites", () => {
    const ctx = { ...ACCOUNTS[0]!.ctx, history }
    const feedback = renderReviewerFeedbackBlock(ctx)
    assert.match(feedback, /Rejected earlier work because: "Too salesy/)
    assert.match(
      feedback,
      /Rewrote the hook "Outsourcing is not about cost\." as "Your outsourcing partner should own the runbook, not you\."/
    )
    // A hook the reviewer left alone teaches nothing.
    assert.ok(!feedback.includes('Interrupt logs'))
    assert.match(draftingPrompt.buildInstructions(ctx), /REVIEWER FEEDBACK[\s\S]*Too salesy/)
  })

  it('adds nothing when the reviewer has not acted', () => {
    const ctx = ACCOUNTS[0]!.ctx
    assert.strictEqual(renderReviewerFeedbackBlock(ctx), '')
    assert.ok(!draftingPrompt.buildInstructions(ctx).includes('REVIEWER FEEDBACK'))
  })
})

describe('describeCta', () => {
  it("steers toward the goal's own action", () => {
    const cta = describeCta(ACCOUNTS[1]!.ctx)
    assert.match(cta, /Steer the reader toward: Book a discovery call/)
    assert.match(cta, /beyond the action above/)
  })

  it('asks something the reader can answer when the goal names no action, and offers nothing', () => {
    const cta = describeCta(ACCOUNTS[0]!.ctx)
    assert.match(cta, /answer from their own work/)
    assert.match(cta, /Offer nothing the goal does not name/)
    assert.match(cta, /Never a generic "Thoughts\?"/)
  })

  it('lets the post end without an ask when the account does not require one', () => {
    const ctx = context({ account: account({}), ctaRequired: false })
    assert.match(describeCta(ctx), /optional; leave it empty/)
  })

  it('reaches the draft brief', () => {
    const prompt = draftingPrompt.buildPrompt(ACCOUNTS[1]!.ctx, makeIdea())
    assert.match(prompt, /3\. cta — required\. Steer the reader toward: Book a discovery call/)
  })
})

describe('buildGroundingCorpus', () => {
  const longDocs = ['a', 'b'].map(id =>
    doc(id, {
      summary: `Summary of ${id}`,
      keyClaims: Array.from({ length: 30 }, (_, i) => ({
        claim: `Claim ${i} from ${id}`,
        quote: `Claim ${i} from ${id}`
      }))
    })
  )
  const ctx = context({
    account: account({}),
    docs: longDocs,
    offerings: [
      offering('Payroll', {
        description: 'Payroll run for startups',
        proofPoints: [{ label: '40 clients onboarded in 2025' }]
      }),
      offering('Recruiting', { description: 'Recruiting pods' })
    ]
  })
  const passages = [
    { documentId: 'b', content: 'A passage retrieved for this goal.', similarity: 0.8 }
  ]
  const findings = [
    {
      url: 'https://news.example.com/1',
      title: 'A fresh development',
      snippet: 'Something that happened this month.',
      provider: 'serper_search',
      publishedAt: '2026-09-25'
    }
  ]

  it('shows every kind of source inside the prompt limit', () => {
    const corpus = buildGroundingCorpus(ctx, findings, passages, now)
    const shown = corpus.verifiedClaims
      .slice(0, ideationPrompt.PROMPT_EVIDENCE_LIMIT)
      .map(c => c.claim)
    // Built one source after another, the 62 document items filled all 30 slots.
    assert.ok(shown.includes('40 clients onboarded in 2025'))
    assert.ok(shown.includes('Payroll run for startups'))
    assert.ok(shown.includes('Recruiting pods'))
    assert.ok(shown.includes('A passage retrieved for this goal.'))
    assert.ok(shown.includes('Something that happened this month.'))
    assert.ok(shown.includes('Summary of a') && shown.includes('Summary of b'))
    assert.ok(shown.some(c => c.endsWith('from a')) && shown.some(c => c.endsWith('from b')))
    assert.strictEqual(corpus.hasFreshEvidence, true)
  })

  it('keeps everything, only reordered', () => {
    const corpus = buildGroundingCorpus(ctx, findings, passages)
    // 3 own facts + 1 passage + 1 finding + 2 summaries + 60 claims
    assert.strictEqual(corpus.verifiedClaims.length, 67)
  })

  it('counts each kind of source on its own', () => {
    const corpus = buildGroundingCorpus(ctx, findings, passages)
    // Subtracting findings and passages from the total also counted the
    // offerings and summaries as knowledge claims: 65, not 60.
    assert.deepStrictEqual(corpus.sources, {
      offeringFacts: 3,
      knowledgePassages: 1,
      webFindings: 1,
      documentSummaries: 2,
      knowledgeClaims: 60
    })
    const counted = Object.values(corpus.sources).reduce((sum, n) => sum + n, 0)
    assert.strictEqual(counted, corpus.verifiedClaims.length)
  })

  it('interleaves lists of uneven length', () => {
    assert.deepStrictEqual(interleave([[1, 2, 3], [], [10], [20, 21]]), [1, 10, 20, 2, 21, 3])
  })
})

describe('runLinter: figures', () => {
  const sources = 'Teams that run evals catch 40% more regressions. Over 120 clients.'

  it('flags a figure that is in neither the evidence nor the author\'s details', () => {
    const finding = runLinter({
      hook: 'Most teams miss 37% of regressions.',
      body: 'Evals catch 40% more regressions.',
      figureSources: sources
    }).find(f => f.rule === 'unsupported_figures')
    assert.strictEqual(finding?.passed, false)
    assert.strictEqual(finding?.severity, 'error')
    assert.match(finding!.message, /"37%"/)
    assert.ok(!finding!.message.includes('"40%"'))
  })

  it('accepts figures that come from the sources', () => {
    const finding = runLinter({
      hook: 'Evals catch 40% more regressions.',
      body: 'We work with over 120 clients.',
      figureSources: sources
    }).find(f => f.rule === 'unsupported_figures')
    assert.strictEqual(finding?.passed, true)
  })

  it('checks the first comment too', () => {
    const finding = runLinter({
      hook: 'Hook.',
      body: 'Body.',
      firstComment: 'Source: a study of $2m budgets.',
      figureSources: sources
    }).find(f => f.rule === 'unsupported_figures')
    assert.strictEqual(finding?.passed, false)
  })

  it('does not accept a figure that is only part of a longer one in the sources', () => {
    // Regression: a substring test let "5%" pass on a source saying "25%".
    const check = (hook: string, figureSources: string) =>
      runLinter({ hook, body: 'Body.', figureSources }).find(
        f => f.rule === 'unsupported_figures'
      )
    assert.strictEqual(check('Churn fell 5%.', 'Churn fell 25%.')?.passed, false)
    assert.strictEqual(check('Churn fell 5%.', 'Churn fell 5%.')?.passed, true)
    assert.strictEqual(check('Churn fell 2.5%.', 'Churn fell 12.5%.')?.passed, false)
    assert.strictEqual(check('Churn fell 2.5%.', 'Churn fell 2.5 %.')?.passed, true)
    assert.strictEqual(check('Over 200 clients.', 'Over 1,200 clients.')?.passed, false)
    assert.strictEqual(check('Over 1,200 clients.', 'We serve 1,200 clients.')?.passed, true)
    assert.strictEqual(check('5 million users.', '1.5 million users.')?.passed, false)
    assert.strictEqual(check('A $5 budget.', 'A $50 budget.')?.passed, false)
  })

  it('skips the check when no sources are given', () => {
    const findings = runLinter({ hook: 'Hook 37%.', body: 'Body.' })
    assert.ok(!findings.some(f => f.rule === 'unsupported_figures'))
  })

  it("accepts the author's own proof points through collectFigureSources", () => {
    const ctx = context({
      account: account({ bio: 'Founded in 2015.' }),
      offerings: [offering('Audit', { proofPoints: [{ label: 'Cut close time by 3x' }] })]
    })
    const figureSources = collectFigureSources(
      ctx,
      makeIdea({
        supportingEvidence: [{ claim: 'Close takes 12 days', quote: 'about 12 days on average' }]
      })
    )
    const finding = runLinter({
      hook: 'We cut close time by 3x.',
      body: 'Most teams take about 12 days.',
      figureSources
    }).find(f => f.rule === 'unsupported_figures')
    assert.strictEqual(finding?.passed, true)
  })
})

describe('runLinter: call to action', () => {
  it('warns about a CTA that would close any post', () => {
    for (const cta of ['Thoughts?', 'What do you think?', 'Let me know in the comments.', 'Agree?']) {
      const finding = runLinter({ hook: 'Hook', body: 'Body', cta }).find(
        f => f.rule === 'generic_cta'
      )
      assert.strictEqual(finding?.passed, false, cta)
    }
  })

  it('leaves a specific question alone', () => {
    const findings = runLinter({
      hook: 'Hook',
      body: 'Body',
      cta: 'Which month-end task takes your team longest?'
    })
    assert.ok(!findings.some(f => f.rule === 'generic_cta'))
  })
})

describe('media brief prompt', () => {
  it('tells the art director who posts and who sees the image', () => {
    const ctx = ACCOUNTS[3]!.ctx
    const media = renderMediaContext(ctx)
    assert.match(media, /Posted by: Brightsmile Clinic, a company page/)
    assert.match(media, /Industry: Healthcare — paediatric dentistry/)
    assert.match(media, /Seen by: Parents booking a first dental visit/)
    const prompt = buildMediaPrompt({ postText: 'A post.', accountContext: media })
    assert.match(prompt, /WHO POSTS IT AND WHO SEES IT\nPosted by: Brightsmile/)
  })

  it('builds on a direction already chosen for the post', () => {
    const prompt = buildMediaPrompt({
      postText: 'A post.',
      direction: 'A toddler holding a toothbrush next to a calendar'
    })
    assert.match(prompt, /VISUAL DIRECTION ALREADY CHOSEN[\s\S]*toddler holding a toothbrush/)
  })

  it('adds neither block when there is nothing to say', () => {
    const prompt = buildMediaPrompt({ postText: 'A post.' })
    assert.ok(!prompt.includes('WHO POSTS IT'))
    assert.ok(!prompt.includes('VISUAL DIRECTION'))
  })
})
