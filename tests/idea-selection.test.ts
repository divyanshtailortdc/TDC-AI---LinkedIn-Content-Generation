import assert from 'node:assert'
import { describe, it } from 'node:test'
import { filterDiverseIdeas } from '../src/lib/ai/idea-diversity'
import { selectIdeas } from '../src/lib/ai/idea-selection'
import type { GeneratedIdeaItem } from '../src/lib/ai/skills/ideation/schema'
import { checkNovelty } from '../src/lib/novelty'

const ANGLES = [
  'common_misconception',
  'contrarian',
  'process',
  'data',
  'story',
  'how_to',
  'case',
  'trend'
] as const

// Eight unrelated subjects, written out so none overlaps another in wording.
const SUBJECTS = [
  ['Marketplace payouts', 'Reconcile settlement ledgers weekly, because marketplace payouts arrive net of fees and hide refunds.', 'Nobody audits the payout report until a founder spots a missing lakh.'],
  ['Warehouse shrinkage', 'Cycle counts beat annual stocktakes since shelf errors compound silently across dozens of SKUs.', 'Your inventory number is probably wrong by the time you read it.'],
  ['Contractor withholding', 'Classify freelancers properly before year end, as tax deductions at source follow the contract, not the invoice.', 'A single mislabelled contractor can cost a quarter of profit.'],
  ['Renewal cohorts', 'Retention curves flatten only when onboarding emails stop selling and start teaching.', 'Churn is a symptom; the first week is the cause.'],
  ['Term sheet clauses', 'Liquidation preferences matter more than valuation for founders raising their first round.', 'The headline number is the least important line in your term sheet.'],
  ['Discount discipline', 'Gross margin erodes through small coupons that nobody tracks against unit economics.', 'Every festival sale quietly rewrites your pricing power.'],
  ['Ninety day onboarding', 'New hires ship faster when the first month has one written project and one reviewer.', 'Most onboarding plans describe tools, not outcomes.'],
  ['Cash on delivery returns', 'Courier reconciliation should start when a parcel is rejected, not when the remittance is late.', 'Returns cost twice: the freight and the weeks of trapped cash.']
]

/** Ideas about unrelated subjects, each with its own hook, best ones first. */
function candidates(): GeneratedIdeaItem[] {
  return SUBJECTS.map(([title, argument, hook], i) => ({
    title,
    thesis: argument,
    perspectiveAngle: ANGLES[i]!,
    angle: title,
    pillar: 'Finance',
    format: 'thought_leadership',
    whyNow: 'Founders ask about this every month.',
    hookConcept: hook!,
    coreArgument: argument!,
    audienceTakeaway: 'Review it weekly.',
    supportingEvidence: [],
    suggestedMedia: { mode: 'none' },
    noveltyNote: 'n',
    estimatedStrength: 95 - i,
    groundingScore: 95 - i,
    originalityScore: 95 - i,
    unsupportedClaims: [],
    sourceIds: [],
    risks: []
  })) as GeneratedIdeaItem[]
}

const asPast = (ideas: GeneratedIdeaItem[]) =>
  ideas.map(i => ({ hook: i.hookConcept, body: `${i.title} ${i.thesis} ${i.coreArgument}` }))

describe('selecting a run\'s ideas', () => {
  it('fills the target with fresh ideas when the best ones are repeats', () => {
    const all = candidates()
    // The three strongest candidates repeat earlier work.
    const past = asPast(all.slice(0, 3))

    const { selected, discarded } = selectIdeas(all, past, 5)

    assert.equal(selected.length, 5)
    assert.equal(discarded.length, 3)
    for (const idea of selected) assert.ok(!all.slice(0, 3).includes(idea))
  })

  it('the old order (cut to the count, then drop repeats) came up short', () => {
    const all = candidates()
    const past = asPast(all.slice(0, 3))
    const oldWay = filterDiverseIdeas(all, 5).selected.filter(
      i => checkNovelty(i.hookConcept, `${i.title} ${i.thesis} ${i.coreArgument}`, past).isNovel
    )
    assert.ok(oldWay.length < 5)
  })

  it('does not fail outright when every top candidate is a repeat', () => {
    const all = candidates()
    const { selected } = selectIdeas(all, asPast(all.slice(0, 5)), 3)
    assert.equal(selected.length, 3)
  })

  it('keeps everything when there is no past work', () => {
    const all = candidates()
    const { selected, discarded } = selectIdeas(all, [], 5)
    assert.equal(selected.length, 5)
    assert.deepEqual(discarded, [])
  })

  it('returns what is left, never more than exists', () => {
    const all = candidates()
    const { selected } = selectIdeas(all, asPast(all.slice(0, 7)), 5)
    assert.equal(selected.length, 1)
  })
})
