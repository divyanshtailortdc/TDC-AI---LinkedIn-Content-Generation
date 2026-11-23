import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as researchAgentPrompt from '../src/lib/ai/agents/research/prompt'
import * as slidesPrompt from '../src/lib/ai/skills/carousel-slides/prompt'
import * as goalPrompt from '../src/lib/ai/skills/goal-suggestions/prompt'
import { getPlatform } from '../src/lib/platforms'
import { insightsInUse } from '../src/lib/profile-insights/in-use'
import type { ProfileInsights } from '../src/lib/profile-insights/types'
import { planTrendScan } from '../src/lib/research/findings'
import { account, audience, context, goal } from './fixtures/generation'

/**
 * What an identity's profile analysis ("Learned from 6 posts") reaches
 * beyond ideation, drafting and the image brief: goal suggestions, research
 * and carousel slides, and only while it still describes this identity.
 * The insights are the TDCCommerce LinkedIn analysis of 2026-11-23, trimmed.
 */

const linkedin: ProfileInsights = {
  summary:
    "TDCCommerce's LinkedIn presence is product-focused and centred on AI and ERP-connected B2B commerce.",
  themes: [
    { name: 'AI in commerce', description: 'AI as the direction for how businesses sell and buy.' },
    { name: 'ERP and eCommerce unification', description: 'One connected system for commerce and records.' },
    { name: 'TIA AI shopping concierge', description: 'An AI assistant that guides buyers to purchase.' }
  ],
  writingStyle:
    "Announcements of the form 'Introducing X by TDCCommerce. Meet X, the AI-powered ...'.",
  tone: 'Corporate, confident and promotional.',
  captions: 'Polished product announcements.',
  hashtags: ['#erp', '#ai', '#ecommerce'],
  hashtagUsage: 'About three, in a block.',
  visualIdentity: 'Portrait market-report infographics in blue and white with purple and teal accents.',
  formats: [{ format: 'Infographic images', note: 'Market data and trends.' }]
}

const instagram: ProfileInsights = {
  summary: 'Behind-the-scenes reels from the office.',
  themes: [{ name: 'Team culture', description: 'Life at the company.' }],
  writingStyle: 'Short lowercase captions.',
  tone: 'Playful.',
  captions: 'One line.',
  hashtags: ['#teamtdc'],
  hashtagUsage: 'One branded tag.',
  visualIdentity: 'Handheld phone footage, warm light.',
  formats: [{ format: 'Reels', note: 'Office skits.' }]
}

function tdc(enabledFormats?: string[]) {
  return context({
    account: account({
      name: 'TDCCommerce',
      company: 'The Developer Company Inc.',
      industry: 'B2B eCommerce and ERP',
      bio: 'An AI-enabled platform that joins B2B eCommerce and ERP in one system.',
      websiteUrl: 'https://www.tdccommerce.com'
    }),
    audiences: [audience('Wholesale founders')],
    goal: goal({
      title: 'Educate B2B operators on connected eCommerce and ERP',
      keyMessage: 'Connected technology transforms how B2B businesses operate.'
    }),
    enabledFormats
  })
}

describe('goal suggestions see what the account already posts', () => {
  it("lists each of the identity's platforms that was learned, as data", () => {
    const base = tdc(['linkedin.post', 'instagram.caption'])
    const ctx = { ...base, platformInsights: { linkedin, instagram } }
    const profile = goalPrompt.goalProfile(ctx)
    assert.match(profile, /WHAT IT ALREADY POSTS — learned from its own public posts/)
    assert.match(profile, /LinkedIn:\n- In short: TDCCommerce's LinkedIn presence/)
    assert.match(profile, /Subjects it keeps coming back to: AI in commerce/)
    assert.match(profile, /Instagram:[\s\S]*Team culture/)
    const prompt = goalPrompt.buildPrompt({
      profile,
      existingGoals: [],
      allowedUrls: [],
      learned: true
    })
    // The analysis is inside the fenced profile; the instruction is outside it.
    assert.ok(prompt.indexOf('AI in commerce') < prompt.indexOf('</profile>'))
    assert.match(prompt.split('</profile>')[1]!, /already posts/)
  })

  it('leaves out a platform the identity does not post on', () => {
    const base = tdc(['linkedin.post'])
    const profile = goalPrompt.goalProfile({ ...base, platformInsights: { instagram } })
    assert.doesNotMatch(profile, /Team culture|ALREADY POSTS/)
  })

  it('reads exactly as before without an analysis', () => {
    const base = tdc()
    const profile = goalPrompt.goalProfile(base)
    assert.doesNotMatch(profile, /ALREADY POSTS/)
    const input = { profile, existingGoals: ['A'], allowedUrls: [] }
    assert.strictEqual(
      goalPrompt.buildPrompt({ ...input, learned: false }),
      goalPrompt.buildPrompt(input)
    )
    assert.doesNotMatch(goalPrompt.buildPrompt(input), /already posts/)
  })
})

describe('research follows the subjects the account posts about', () => {
  const options = { platforms: ['LinkedIn'], platformIds: ['linkedin' as const], style: 'professional' as const }

  it("the trend scan searches this week's news on its learned subjects", () => {
    const ctx = { ...tdc(), platformInsights: { linkedin } }
    const plan = planTrendScan(ctx, options)
    const learned = plan.filter(q => q.query.startsWith('AI in commerce') || q.query.startsWith('ERP and eCommerce'))
    assert.deepStrictEqual(
      learned.map(q => [q.query, q.endpoint, q.kind, q.freshnessDays]),
      [
        ['AI in commerce', 'news', 'news', 7],
        ['ERP and eCommerce unification', 'news', 'news', 7]
      ]
    )
    // Two subjects at most: the third is not searched.
    assert.ok(!plan.some(q => q.query.includes('TIA')))
  })

  it("only the run's platforms count, and the readers' market is named", () => {
    const ctx = { ...tdc(), platformInsights: { instagram } }
    assert.ok(!planTrendScan(ctx, options).some(q => q.query.includes('Team culture')))
    const india = planTrendScan(
      { ...tdc(), platformInsights: { linkedin } },
      { ...options, region: { code: 'in', name: 'India' } as any }
    )
    assert.ok(india.some(q => q.query === 'AI in commerce India'))
  })

  it('plans the same scan as before without an analysis', () => {
    const ctx = tdc()
    assert.deepStrictEqual(
      planTrendScan(ctx, options),
      planTrendScan({ ...ctx, platformInsights: {} }, options)
    )
    assert.ok(!planTrendScan(ctx, options).some(q => q.query.includes('AI in commerce')))
  })

  it('the research agent is told where goals meet those subjects', () => {
    const ctx = { ...tdc(), platformInsights: { linkedin } }
    const prompt = researchAgentPrompt.buildPrompt(ctx, 30)
    assert.match(prompt, /Subjects it already posts about[^\n]*: AI in commerce \(AI as the direction/)
    assert.ok(prompt.indexOf('AI in commerce') < prompt.indexOf('</account>'))
    assert.doesNotMatch(researchAgentPrompt.buildPrompt(tdc(), 30), /already posts about/)
  })
})

describe("carousel slides follow the platform's learned look and voice", () => {
  it("uses the slide platform's analysis, never another's", () => {
    const base = tdc(['linkedin.post', 'instagram.caption'])
    const ctx = {
      ...base,
      platform: getPlatform('linkedin'),
      platformInsights: { linkedin, instagram }
    }
    const told = slidesPrompt.buildSlidesInstructions(ctx, 'photorealistic')
    assert.match(told, /WHAT THEIR LINKEDIN POSTS ALREADY LOOK LIKE/)
    assert.match(told, /Tone: Corporate, confident and promotional/)
    assert.match(told, /How they write: Announcements of the form/)
    assert.match(told, /How their posts look: Portrait market-report infographics/)
    assert.doesNotMatch(told, /Handheld phone footage|#erp/)
    assert.match(told, /never copy/)
  })

  it('reads exactly as before without an analysis of that platform', () => {
    const base = { ...tdc(), platform: getPlatform('linkedin') }
    assert.strictEqual(
      slidesPrompt.buildSlidesInstructions({ ...base, platformInsights: { instagram } }, 'photorealistic'),
      slidesPrompt.buildSlidesInstructions(base, 'photorealistic')
    )
  })
})

describe('insights in use for an identity', () => {
  const zomatoRow = {
    platform: 'instagram',
    profileUrl: 'https://www.instagram.com/zomato',
    insights: instagram
  }
  const tdcRow = {
    platform: 'linkedin',
    profileUrl: 'https://www.linkedin.com/company/tdccommerce',
    insights: linkedin
  }
  const renamed = account({
    name: 'TDCCommerce',
    company: 'The Developer Company Inc.',
    websiteUrl: 'https://www.tdccommerce.com',
    contextIdentity: { name: 'Zomato', company: 'Eternal Limited', websiteUrl: 'https://www.zomato.com' }
  })

  it('keeps every analysis of an identity that was not renamed', () => {
    const settled = { ...renamed, contextIdentity: null }
    assert.deepStrictEqual(Object.keys(insightsInUse([zomatoRow, tdcRow], settled)).sort(), [
      'instagram',
      'linkedin'
    ])
  })

  it("drops what was learned from the old company's links once the profile names another", () => {
    const used = insightsInUse([zomatoRow, tdcRow], renamed)
    assert.deepStrictEqual(Object.keys(used), ['linkedin'])
    assert.strictEqual(used.linkedin?.tone, linkedin.tone)
  })

  // Live e2e, 2026-11-23: TDCCommerce renamed by hand to Blinkit kept its
  // TDCCommerce insights, because "Blink Commerce" shares "commerce" with
  // linkedin.com/company/tdccommerce.
  it("drops the old company's link even when the new name shares a word with it", () => {
    const blinkit = account({
      name: 'Blinkit',
      company: 'Blink Commerce Private Limited',
      websiteUrl: 'https://blinkit.com',
      contextIdentity: {
        name: 'TDCCommerce',
        company: 'The Developer Company Inc.',
        websiteUrl: 'https://www.tdccommerce.com'
      }
    })
    const newLink = {
      platform: 'instagram',
      profileUrl: 'https://www.instagram.com/blinkit',
      insights: instagram
    }
    assert.deepStrictEqual(Object.keys(insightsInUse([tdcRow, newLink], blinkit)), ['instagram'])
  })

  it('keeps a person’s own profile when they move to another company', () => {
    const person = account({
      accountType: 'person',
      name: 'Ayushi Sharma',
      company: 'Zomato',
      websiteUrl: 'https://www.zomato.com',
      contextIdentity: { name: 'Ayushi Sharma', company: 'TDCCommerce', websiteUrl: 'https://www.tdccommerce.com' }
    })
    const own = {
      platform: 'linkedin',
      profileUrl: 'https://www.linkedin.com/in/ayushi-sharma',
      insights: linkedin
    }
    assert.deepStrictEqual(Object.keys(insightsInUse([own], person)), ['linkedin'])
  })

  it('skips rows with nothing usable or an unknown platform', () => {
    const used = insightsInUse(
      [
        { platform: 'linkedin', profileUrl: tdcRow.profileUrl, insights: null },
        { platform: 'myspace', profileUrl: 'https://myspace.com/tdc', insights: linkedin }
      ],
      renamed
    )
    assert.deepStrictEqual(used, {})
  })
})
