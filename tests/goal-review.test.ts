import assert from 'node:assert'
import { describe, it } from 'node:test'
import { ideaQuality } from '../src/lib/ai/idea-diversity'
import {
  applyGoalReviews,
  MIN_GOAL_FIT,
  missesGoal,
  readGoalReviews
} from '../src/lib/ai/skills/goal-review/guard'
import {
  buildPrompt as buildReviewPrompt,
  INSTRUCTIONS as REVIEW_INSTRUCTIONS
} from '../src/lib/ai/skills/goal-review/prompt'
import { resolveGeneratedIdea } from '../src/lib/ai/skills/ideation/guard'
import type {
  GeneratedIdeaItem,
  IdeaGenerationItem
} from '../src/lib/ai/skills/ideation/schema'

function idea(
  title: string,
  extra: Partial<GeneratedIdeaItem> = {}
): GeneratedIdeaItem {
  return {
    title,
    thesis: 'Founders should get their numbers in days, not weeks.',
    perspectiveAngle: 'common_misconception',
    angle: 'Speed of close',
    goalId: 'goal-1',
    goalIds: ['goal-1'],
    targetAudience: 'D2C founders',
    format: 'thought_leadership',
    whyNow: 'Month-end is coming.',
    hookConcept: 'Three weeks is too long to wait for last month.',
    coreArgument: 'A late close means decisions made blind.',
    audienceTakeaway: 'Ask when your numbers will be ready.',
    supportingEvidence: [],
    suggestedMedia: { mode: 'none' },
    noveltyNote: 'Fresh',
    estimatedStrength: 80,
    groundingScore: 80,
    originalityScore: 80,
    unsupportedClaims: [],
    sourceIds: [],
    risks: [],
    ...extra
  }
}

describe('reading the goal review', () => {
  it('maps reviews to ideas by label and ignores unknown or repeated ones', () => {
    const reviews = readGoalReviews(
      {
        reviews: [
          {
            idea: 'I2',
            readerFit: true,
            score: 88,
            reason: 'Lands the message.'
          },
          {
            idea: '[I1]',
            readerFit: true,
            score: 70.4,
            reason: '  Weak action.  '
          },
          {
            idea: 'I2',
            readerFit: false,
            score: 10,
            reason: 'Repeat, ignored.'
          },
          { idea: 'I9', readerFit: true, score: 99, reason: 'No such idea.' }
        ]
      },
      3
    )
    assert.deepStrictEqual(reviews, [
      { score: 70, readerFit: true, reason: 'Weak action.' },
      { score: 88, readerFit: true, reason: 'Lands the message.' },
      null
    ])
  })

  it('never lets an idea for the wrong reader pass, whatever its score', () => {
    const [review] = readGoalReviews(
      {
        reviews: [
          {
            idea: 'I1',
            readerFit: false,
            score: 90,
            reason: 'Written for CIOs.'
          }
        ]
      },
      1
    )
    assert.strictEqual(review!.score, 40)
    assert.ok(missesGoal(review!))
    assert.ok(
      missesGoal({ score: MIN_GOAL_FIT - 1, readerFit: true, reason: '' })
    )
    assert.ok(!missesGoal({ score: MIN_GOAL_FIT, readerFit: true, reason: '' }))
  })
})

describe('applying the goal review', () => {
  it('keeps ideas that achieve their goal with score and reason, discards the rest with why', () => {
    const { kept, missed } = applyGoalReviews(
      [idea('Serves'), idea('Off goal'), idea('Not reviewed')],
      [
        {
          score: 86,
          readerFit: true,
          reason: 'Lands the close message and invites a call.'
        },
        {
          score: 30,
          readerFit: false,
          reason: 'Written for SAP partners, not D2C founders.'
        },
        null
      ]
    )
    assert.deepStrictEqual(
      kept.map(i => i.title),
      ['Serves', 'Not reviewed']
    )
    assert.strictEqual(kept[0]!.goalFitScore, 86)
    assert.strictEqual(
      kept[0]!.goalFitNote,
      'Lands the close message and invites a call.'
    )
    assert.strictEqual(kept[1]!.goalFitScore, undefined)
    assert.deepStrictEqual(missed, [
      {
        title: 'Off goal',
        goalId: 'goal-1',
        reason:
          'It misses its goal: Written for SAP partners, not D2C founders.'
      }
    ])
  })

  it('ranks an idea that achieves its goal above an equally crafted one that barely does', () => {
    const strong = idea('Strong', { goalFitScore: 90 })
    const weak = idea('Weak', { goalFitScore: 55 })
    assert.ok(ideaQuality(strong) > ideaQuality(weak))
    // Unreviewed ideas are ranked as before.
    assert.strictEqual(ideaQuality(idea('Unreviewed')), 80)
  })
})

describe('the readers an idea is for', () => {
  const generated = (audienceRef: string, readers: string) =>
    ({
      title: 't',
      thesis: 'x',
      perspectiveAngle: 'common_misconception',
      angle: 'a',
      goalRefs: ['G1'],
      readers,
      audienceRef,
      format: 'thought_leadership',
      whyNow: 'w',
      hookConcept: 'h',
      coreArgument: 'c',
      audienceTakeaway: 'k',
      supportingEvidence: [],
      noveltyNote: 'n',
      estimatedStrength: 80,
      risks: []
    }) as IdeaGenerationItem
  const groups = ['CIOs planning an ERP move', 'SAP partners']

  it('is a profile group when the idea names one', () => {
    const resolved = resolveGeneratedIdea(
      generated('A2', 'SAP partners'),
      [],
      groups,
      ['goal-1']
    )
    assert.strictEqual(resolved.targetAudience, 'SAP partners')
  })

  it('is the goal’s own readers when no profile group is them', () => {
    const resolved = resolveGeneratedIdea(
      generated(
        'none',
        ' D2C founders who still wait weeks for their numbers '
      ),
      [],
      groups,
      ['goal-1']
    )
    assert.strictEqual(
      resolved.targetAudience,
      'D2C founders who still wait weeks for their numbers'
    )
  })
})

describe('the goal review prompt', () => {
  it('judges reader, message and action, and shows each idea with its goal', () => {
    assert.match(
      REVIEW_INSTRUCTIONS,
      /1\. Reader:[\s\S]*2\. Message:[\s\S]*3\. Action:/
    )
    const prompt = buildReviewPrompt({
      account: 'Ledgerly, bookkeeping for D2C brands',
      goals: [
        {
          label: 'G1',
          title: 'Become the finance operations person D2C founders trust',
          objective: 'lead_gen',
          keyMessage:
            'D2C founders should not wait three weeks for their numbers.',
          desiredAction: 'Book a discovery call'
        }
      ],
      ideas: [
        {
          label: 'I1',
          goalLabel: 'G1',
          readers: 'D2C founders <script>',
          title: 'Close faster',
          thesis: 't',
          hookConcept: 'h',
          coreArgument: 'c',
          audienceTakeaway: 'k'
        }
      ]
    })
    assert.match(
      prompt,
      /\[G1\] Become the finance operations person D2C founders trust/
    )
    assert.match(prompt, /Desired action: Book a discovery call/)
    assert.match(
      prompt,
      /\[I1\] for goal G1\n {4}Written for: D2C founders script/
    )
  })
})
