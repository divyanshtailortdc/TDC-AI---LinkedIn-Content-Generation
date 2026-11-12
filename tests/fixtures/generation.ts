import type {
  Account,
  Audience,
  Goal,
  Idea,
  Offering,
  SamplePost,
  VoiceConfig
} from '../../src/db/schema'
import {
  EMPTY_HISTORY,
  resolvePreferences,
  type GenerationContext,
  type ReviewHistory
} from '../../src/lib/ai/context-blocks'

/**
 * Typed fixtures for prompt and check tests. Every row is complete, so a
 * column added to the schema shows up here as a type error rather than as a
 * silently different prompt.
 */

export const NOW = new Date('2026-10-01T00:00:00Z')

export function account(overrides: Partial<Account> = {}): Account {
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

export function audience(name: string, overrides: Partial<Audience> = {}): Audience {
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

export function offering(name: string, overrides: Partial<Offering> = {}): Offering {
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

export function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal',
    accountId: 'acc',
    title: 'Goal',
    objective: 'authority',
    keyMessage: null,
    desiredAction: null,
    targetUrl: null,
    linkStrategy: 'first_comment',
    platforms: [],
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

export function voice(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

export function samplePost(
  content: string,
  overrides: Partial<SamplePost> = {}
): SamplePost {
  return {
    id: `sample-${content.length}`,
    accountId: 'acc',
    content,
    performedWell: false,
    engagementNote: null,
    isActive: true,
    platform: 'linkedin',
    createdAt: NOW,
    ...overrides
  }
}

export function idea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea',
    accountId: 'acc',
    runId: 'run',
    goalId: 'goal',
    goalIds: ['goal'],
    goalSnapshot: null,
    offeringId: null,
    title: 'Idea title',
    hook: 'Hook concept',
    angle: 'An angle',
    pillar: null,
    format: 'thought_leadership',
    thesis: 'A thesis',
    perspectiveAngle: 'practitioner_lesson',
    whyNow: 'Why now',
    hookConcept: 'Hook concept',
    coreArgument: 'Core argument',
    audienceTakeaway: 'Takeaway',
    supportingEvidence: [],
    suggestedMedia: { mode: 'none' },
    noveltyNote: null,
    score: 80,
    groundingScore: 80,
    originalityScore: 80,
    goalFitScore: null,
    goalFitNote: null,
    unsupportedClaims: [],
    sourceIds: [],
    risks: [],
    status: 'approved',
    targetFormats: ['linkedin.post'],
    formatFit: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

export function context(parts: {
  account: Account
  audiences?: Audience[]
  offerings?: Offering[]
  goal?: Goal | null
  otherGoals?: Goal[]
  voice?: VoiceConfig | null
  samplePosts?: SamplePost[]
  history?: ReviewHistory
  ctaRequired?: boolean
  bannedTopics?: string[]
  complianceNotes?: string
  /** The formats it drafts; LinkedIn alone when left out. */
  enabledFormats?: string[]
  /** What it said about each platform, its style included. */
  channelSettings?: Record<
    string,
    { audience?: string; tone?: string; style?: string; emoji?: string; rubric?: string }
  >
}): GenerationContext {
  const v = parts.voice === undefined ? voice() : parts.voice
  const primary = parts.goal ?? null
  const selected = [...(primary ? [primary] : []), ...(parts.otherGoals ?? [])]
  return {
    account: parts.account,
    voice: v,
    offerings: parts.offerings ?? [],
    audiences: parts.audiences ?? [],
    knowledgeDocs: [],
    samplePosts: parts.samplePosts ?? [],
    goals: selected,
    selectedGoals: selected,
    primaryGoal: primary,
    preferencesId: null,
    prefs: resolvePreferences(
      {
        id: 'prefs',
        accountId: parts.account.id,
        pillars: [],
        ideasPerRun: 5,
        postConstraints: { cta_required: parts.ctaRequired ?? true },
        guardrails:
          parts.bannedTopics || parts.complianceNotes
            ? {
                banned_topics: parts.bannedTopics ?? [],
                compliance_notes: parts.complianceNotes ?? ''
              }
            : null,
        enabledFormats: parts.enabledFormats,
        channelSettings: parts.channelSettings,
        createdAt: NOW,
        updatedAt: NOW
      },
      v
    ),
    history: parts.history ?? EMPTY_HISTORY
  }
}

/**
 * Three identities that between them reach every branch of the LinkedIn
 * prompt: a company with a full profile, a person with almost nothing set,
 * and a goal that puts its link in the body with a strict hashtag policy.
 */
export function goldenCases(): Array<{
  name: string
  ctx: GenerationContext
  idea: Idea
}> {
  const full = context({
    account: account({
      name: 'Northwind Freight',
      headline: 'Freight audits for mid-size shippers',
      company: 'Northwind Freight',
      industry: 'Logistics',
      bio: 'We audit freight invoices.',
      websiteUrl: 'https://northwind.example',
      linkedinUrl: 'https://www.linkedin.com/company/northwind'
    }),
    offerings: [
      offering('Freight audit', {
        tagline: 'Find the overcharges',
        description: 'Freight audit\nInvoice recovery',
        whoItIsFor: 'Shippers with 500+ loads a month',
        problemSolved: 'Overbilling',
        differentiators: ['Carrier-neutral'],
        proofPoints: [{ label: 'Recovered 3.2% of spend', detail: 'for a retailer' }]
      })
    ],
    audiences: [
      audience('Logistics managers\nCFOs at mid-size shippers', {
        painPoints: ['Invoice errors'],
        whatTheyDontBelieveYet: 'That audits pay for themselves'
      })
    ],
    goal: goal({
      title: 'Book audit calls',
      objective: 'lead_generation',
      keyMessage: 'Most freight invoices hide errors',
      desiredAction: 'Book a free audit call',
      targetUrl: 'https://northwind.example/audit',
      linkStrategy: 'first_comment'
    }),
    otherGoals: [
      goal({ id: 'goal-2', title: 'Hire analysts', keyMessage: 'We grow our team' })
    ],
    voice: voice({
      tone: 'direct',
      derivedStyleRubric: 'Short sentences. Numbers first.',
      bannedWords: ['synergy', 'game changer'],
      emojiPolicy: 'bullets only',
      hashtagPolicy: '0-3, end of post'
    }),
    samplePosts: [
      samplePost('We found 14 duplicate invoices in one month.', {
        performedWell: true,
        engagementNote: '40 comments'
      }),
      samplePost('Accessorial fees are where budgets leak.')
    ],
    history: {
      drafts: [
        {
          hook: 'Your freight bill is wrong.',
          originalHook: 'Your freight bill is probably wrong.',
          body: 'Body one',
          cta: 'How do you check invoices today?',
          status: 'approved'
        },
        {
          hook: 'Duplicate invoices cost more than fuel.',
          originalHook: 'Duplicate invoices cost more than fuel.',
          body: 'Body two',
          cta: 'Which fee surprises you most?',
          status: 'rejected'
        }
      ],
      ideas: [
        {
          title: 'Old idea',
          hookConcept: 'Old hook',
          thesis: 'Old thesis',
          coreArgument: 'Old argument',
          status: 'rejected',
          runId: 'old-run'
        }
      ],
      rejectionReasons: ['Too salesy']
    },
    bannedTopics: ['politics'],
    complianceNotes: 'Never name clients.'
  })

  const minimal = context({
    account: account({
      name: 'Asha Rao',
      headline: 'Product designer',
      accountType: 'personal'
    }),
    voice: null,
    ctaRequired: false
  })

  const bodyLink = context({
    account: account({ name: 'Ledgerly', headline: 'Bookkeeping for agencies' }),
    audiences: [audience('Agency owners')],
    goal: goal({
      title: 'Webinar sign-ups',
      keyMessage: 'Cash flow beats profit',
      desiredAction: 'Register for the webinar',
      targetUrl: 'https://ledgerly.example/webinar',
      linkStrategy: 'body'
    }),
    voice: voice({ emojiPolicy: 'liberal', hashtagPolicy: 'exactly 2' })
  })

  const evidence: Idea['supportingEvidence'] = [
    {
      claim: 'Duplicate billing affects 1 in 20 invoices',
      factType: 'sourced',
      sourceUrl: 'https://research.example/report',
      sourceTitle: 'Freight Billing Report 2026',
      quote: 'roughly one in twenty invoices contained a duplicate charge'
    },
    {
      claim: 'Recovered 3.2% of spend for a retailer',
      factType: 'verified'
    }
  ]

  return [
    {
      name: 'full-company',
      ctx: full,
      idea: idea({
        title: 'Duplicate charges hide in plain sight',
        thesis: 'Most overbilling is duplicates, not rates',
        angle: 'Audit the boring fees first',
        whyNow: 'Peak season raises volume',
        hookConcept: 'One in twenty invoices bills you twice',
        coreArgument: 'Rate negotiation gets attention; duplicates get missed',
        audienceTakeaway: 'For Logistics managers: check duplicates before rates',
        supportingEvidence: evidence,
        goalIds: ['goal', 'goal-2']
      })
    },
    {
      name: 'minimal-person',
      ctx: minimal,
      idea: idea({
        title: 'Design reviews that ship',
        goalId: null,
        goalIds: [],
        thesis: null,
        angle: null,
        whyNow: null,
        hookConcept: null,
        coreArgument: null,
        audienceTakeaway: null,
        supportingEvidence: []
      })
    },
    {
      name: 'body-link',
      ctx: bodyLink,
      idea: idea({
        title: 'Profit is not cash',
        thesis: 'Agencies run out of cash while profitable',
        hookConcept: 'Profitable and broke',
        supportingEvidence: []
      })
    }
  ]
}

/** Drafts that between them trip and pass every LinkedIn check. */
export function goldenDrafts() {
  return [
    {
      name: 'clean',
      draft: {
        hook: 'One in twenty freight invoices bills you twice.',
        body: 'Rates get the meetings.\n\nDuplicates get missed, because nobody owns the boring fees.',
        cta: 'Who on your team checks accessorial fees?',
        firstComment: 'Our audit checklist: https://northwind.example/audit',
        hashtags: ['freight', 'logistics']
      }
    },
    {
      name: 'messy',
      draft: {
        hook: 'This is a **game changer** for every shipper and you NEED TO KNOW THIS NOW because it changes everything about how invoices are handled across the whole industry and beyond',
        body: '## Why\n\n- Studies show 45% of invoices are wrong.\n- Read https://northwind.example/audit today.\n\nComment YES below — tag a friend — share if you agree.',
        cta: 'Thoughts?',
        firstComment: null,
        hashtags: ['a', 'b', 'c', 'd', 'e']
      }
    }
  ]
}
