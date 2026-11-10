import assert from 'node:assert'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  recentCtasOf,
  renderConstraintsBlock,
  renderIdeationHistoryBlock
} from '../src/lib/ai/context-blocks'
import { buildPostLintOptions } from '../src/lib/ai/pipeline/post-lint'
import * as ideationPrompt from '../src/lib/ai/skills/ideation/prompt'
import * as draftingPrompt from '../src/lib/ai/skills/post-drafting/prompt'
import { runLinter } from '../src/lib/lint/run-linter'
import { platformPostText } from '../src/lib/post-text'
import { goldenCases, goldenDrafts } from './fixtures/generation'

/**
 * LinkedIn's prompts, checks and copy-out, frozen. Adding other platforms must
 * leave every byte of these unchanged; a change to LinkedIn itself goes
 * through a side-by-side review first (docs/MULTI_PLATFORM_PLAN.md §8).
 *
 * The expected text lives in tests/golden/linkedin. To record it again after
 * a reviewed, deliberate change: UPDATE_GOLDEN=1 npm test
 */

const here = dirname(fileURLToPath(import.meta.url))
const goldenDir = join(here, 'golden', 'linkedin')
const updating = process.env.UPDATE_GOLDEN === '1'

function matchesGolden(name: string, actual: string) {
  const file = join(goldenDir, name)
  if (updating || !existsSync(file)) {
    if (!updating) {
      throw new Error(
        `No golden file ${name}. Record it with UPDATE_GOLDEN=1 npm test.`
      )
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, actual)
    return
  }
  assert.strictEqual(actual, readFileSync(file, 'utf8'), `${name} changed`)
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const corpus = {
  verifiedClaims: [
    {
      claim: 'Roughly one in twenty invoices contained a duplicate charge',
      quote: 'roughly one in twenty invoices contained a duplicate charge',
      sourceUrl: 'https://research.example/report',
      sourceTitle: 'Freight Billing Report 2026',
      publishedAt: '2026-09-20',
      isFresh: true,
      origin: 'web' as const
    },
    {
      claim: 'Accessorial fees rose in 2025',
      sourceUrl: 'https://news.example/',
      sourceTitle: 'Freight News',
      origin: 'newsletter' as const
    }
  ]
}

describe('LinkedIn output is unchanged', () => {
  for (const { name, ctx, idea } of goldenCases()) {
    describe(name, () => {
      it('drafting instructions', () => {
        matchesGolden(
          `${name}/drafting-instructions.txt`,
          draftingPrompt.buildInstructions(ctx)
        )
      })

      it('drafting prompt', () => {
        matchesGolden(
          `${name}/drafting-prompt.txt`,
          draftingPrompt.buildPrompt(ctx, idea)
        )
      })

      it('revision prompt', () => {
        const previous = {
          hook: 'Previous hook',
          body: 'Previous body',
          cta: 'Previous ask?',
          hashtags: [],
          alternateHooks: ['A', 'B'],
          selfScores: {
            hookStrength: 7,
            onBrand: 7,
            clarity: 7,
            evidenceGrounding: 7,
            originality: 7
          },
          selfFlags: []
        }
        matchesGolden(
          `${name}/revision-prompt.txt`,
          draftingPrompt.buildRevisionPrompt(ctx, idea, previous, [
            'Post is 3100 characters, over the 3000 character limit. Trim 100.'
          ])
        )
      })

      it('constraints block', () => {
        matchesGolden(`${name}/constraints.txt`, renderConstraintsBlock(ctx))
      })

      it('ideation instructions and prompt', () => {
        matchesGolden(
          `${name}/ideation-instructions.txt`,
          ideationPrompt.buildInstructions(ctx)
        )
        matchesGolden(
          `${name}/ideation-prompt.txt`,
          ideationPrompt.buildPrompt({
            corpus,
            history: renderIdeationHistoryBlock(ctx, 'run'),
            candidateCount: 3,
            assignedGoals: ['G1', 'G1', 'G1'],
            hookMaxChars: ctx.prefs.constraints.hook_max_chars,
            today: new Date('2026-10-01T00:00:00Z')
          })
        )
      })

      for (const { name: draftName, draft } of goldenDrafts()) {
        it(`checks on the ${draftName} draft`, () => {
          const findings = runLinter({
            ...buildPostLintOptions(ctx, idea, draft),
            recentCtas: recentCtasOf(ctx)
          })
          matchesGolden(`${name}/lint-${draftName}.json`, json(findings))
        })
      }
    })
  }

  for (const { name, draft } of goldenDrafts()) {
    it(`copy-out text for the ${name} draft`, () => {
      matchesGolden(`copy-${name}.txt`, platformPostText(draft))
    })
  }
})
