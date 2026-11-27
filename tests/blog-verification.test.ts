import assert from 'node:assert'
import { describe, it } from 'node:test'
import { cleanJudgement } from '../src/lib/ai/skills/blog-verification/guard'
import {
  buildJudgePrompt,
  JUDGE_INSTRUCTIONS
} from '../src/lib/ai/skills/blog-verification/prompt'

const CLAIMS = [
  {
    id: 'C1',
    sentence: 'Gartner found that 61% of B2B buyers prefer a rep-free experience.',
    sourceId: 'S1',
    sourceTitle: 'Gartner sales survey',
    quotes: ['61% of B2B buyers prefer an overall rep-free buying experience.']
  },
  {
    id: 'C2',
    sentence: 'McKinsey says most companies now sell only online.',
    sourceId: 'S2',
    sourceTitle: 'B2B growth',
    quotes: ['Seventy-one percent of B2B companies now offer e-commerce.']
  }
]
const ARTICLE =
  'Gartner found that 61% of B2B buyers prefer a rep-free experience.\n\nOur demo order #1048 shipped at 4:30 PM.\n\nHypothetical example:\nSay a buyer orders at 10:24.'

describe('checking citations with a model', () => {
  it('gives each claim its own source passages and the rules', () => {
    const prompt = `${JUDGE_INSTRUCTIONS}\n${buildJudgePrompt({ claims: CLAIMS, articleText: ARTICLE })}`
    for (const part of [
      '[C1] Sentence: "Gartner found that 61% of B2B buyers prefer a rep-free experience."',
      'It links [S1] Gartner sales survey: read its passages under SOURCES.',
      '[S1] Gartner sales survey:\n  - "61% of B2B buyers prefer an overall rep-free buying experience."',
      'supported:',
      'partial:',
      'unsupported:',
      'A sentence that states no fact',
      'Hypothetical example',
      'sample_data_as_real',
      "A source's title is part of what it says"
    ]) {
      assert.ok(prompt.includes(part), `missing ${part}`)
    }
  })

  it("sends a source's passages once, however many sentences link it", () => {
    const repeated = [
      CLAIMS[0]!,
      {
        ...CLAIMS[0]!,
        id: 'C3',
        sentence: 'Most buyers would rather not talk to a rep.'
      }
    ]
    const prompt = buildJudgePrompt({ claims: repeated, articleText: ARTICLE })
    const quote = '"61% of B2B buyers prefer an overall rep-free buying experience."'
    assert.strictEqual(prompt.split(quote).length - 1, 1)
    assert.ok(prompt.includes('[C3] Sentence: "Most buyers would rather not talk to a rep."'))
    assert.strictEqual(prompt.split('It links [S1]').length - 1, 2)
  })

  it('keeps verdicts for known claims and issues quoting real sentences', () => {
    const result = cleanJudgement(
      {
        verdicts: [
          { id: 'C1', verdict: 'supported', reason: 'Matches.' },
          { id: 'C2', verdict: 'unsupported', reason: 'The source says 71% offer e-commerce, not that most sell only online.' },
          { id: 'C9', verdict: 'supported', reason: 'Unknown claim.' }
        ],
        issues: [
          { sentence: 'Our demo order #1048 shipped at 4:30 PM.', issue: 'sample_data_as_real', note: 'Demo data.' },
          { sentence: 'A sentence the article does not have.', issue: 'fact_without_source', note: '' }
        ]
      },
      { claims: CLAIMS, articleText: ARTICLE }
    )
    assert.deepStrictEqual(result.verdicts, [
      { id: 'C1', verdict: 'supported', reason: 'Matches.' },
      {
        id: 'C2',
        verdict: 'unsupported',
        reason: 'The source says 71% offer e-commerce, not that most sell only online.'
      }
    ])
    assert.deepStrictEqual(result.issues, [
      { sentence: 'Our demo order #1048 shipped at 4:30 PM.', issue: 'sample_data_as_real', note: 'Demo data.' }
    ])
  })
})
