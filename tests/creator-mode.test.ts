import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  renderIdentityBlock,
  renderMediaContext
} from '../src/lib/ai/context-blocks'
import { buildPostLintOptions } from '../src/lib/ai/pipeline/post-lint'
import { keepValidSuggestions } from '../src/lib/ai/skills/goal-suggestions/guard'
import { instructionsFor, INSTRUCTIONS } from '../src/lib/ai/skills/goal-review/prompt'
import { detectFabricatedAnecdote } from '../src/lib/ai/skills/ideation/guard'
import * as ideationPrompt from '../src/lib/ai/skills/ideation/prompt'
import * as draftingPrompt from '../src/lib/ai/skills/post-drafting/prompt'
import {
  CREATOR_STYLE_RULES,
  CREATOR_TRUTH_RULES
} from '../src/lib/ai/skills/shared/creator-rules'
import { TRUTH_RULES } from '../src/lib/ai/skills/shared/truth-rules'
import * as variantPrompt from '../src/lib/ai/skills/variant-drafting/prompt'
import { objectivesFor } from '../src/lib/goal-objectives'
import {
  identityProfileSchemaFor,
  parseAccountType
} from '../src/lib/identity-profile'
import { runLinter } from '../src/lib/lint/run-linter'
import { buildSearchQueries } from '../src/lib/research/findings'
import { account, audience, context, goal, idea } from './fixtures/generation'

/**
 * A creator identity (dance, comedy, lifestyle) gets casual, personal posts:
 * creator wording in every prompt, creator goals, content formats instead of
 * analytical lenses, trend research and a shot idea instead of a graphic.
 * Professional and company identities are unchanged (tests/linkedin-golden).
 */

const creatorCtx = context({
  account: account({
    name: 'Priya Dances',
    accountType: 'creator',
    headline: 'Priya Dances · Bollywood dance tutorials',
    industry: 'Bollywood dance tutorials',
    bio: 'Dance teacher from Pune. Short choreography tutorials and rehearsal bloopers.',
    linkedinUrl: 'https://www.instagram.com/priyadances',
    company: 'Should not show'
  }),
  audiences: [audience('Teens learning to dance at home')],
  goal: goal({ title: 'Grow my followers', objective: 'grow_audience', keyMessage: 'Anyone can dance' })
})

const professionalCtx = context({
  account: account({ name: 'Northwind', accountType: 'company', industry: 'Logistics' })
})

describe('creator identities', () => {
  it('is a third identity type; anything unknown stays a person', () => {
    assert.strictEqual(parseAccountType('creator'), 'creator')
    assert.strictEqual(parseAccountType('company'), 'company')
    assert.strictEqual(parseAccountType('anything'), 'personal')
  })

  it('lets a creator leave "what you promote" empty, but not a professional', () => {
    const profile = {
      name: 'Priya',
      description: 'I dance',
      targetAudience: 'Teens',
      offerings: '',
      industry: 'Dance'
    }
    assert.ok(identityProfileSchemaFor('creator').safeParse(profile).success)
    assert.ok(!identityProfileSchemaFor('personal').safeParse(profile).success)
  })

  it('offers creator goals to a creator and the usual ones to everyone else', () => {
    assert.ok(objectivesFor('creator').includes('grow_audience'))
    assert.ok(!objectivesFor('creator').includes('lead_gen'))
    assert.deepStrictEqual(objectivesFor('personal').slice(0, 2), ['authority', 'awareness'])
    assert.ok(!objectivesFor('company').includes('entertain'))
  })

  it("drops a goal suggestion of the wrong kind for the identity", () => {
    const kept = keepValidSuggestions(
      {
        goals: [
          { title: 'Book demos', objectiveType: 'lead_gen', keyMessage: 'Buy', desiredAction: '', targetUrl: '', basedOn: '' },
          { title: 'Grow followers', objectiveType: 'grow_audience', keyMessage: 'Dance daily', desiredAction: '', targetUrl: '', basedOn: '' }
        ]
      } as Parameters<typeof keepValidSuggestions>[0],
      { allowedUrls: new Map(), existingGoals: [], objectives: objectivesFor('creator') }
    )
    assert.deepStrictEqual(kept.map(g => g.title), ['Grow followers'])
  })
})

describe('how a creator is described to the model', () => {
  it('names their niche and profile, not an industry, company or LinkedIn', () => {
    const block = renderIdentityBlock(creatorCtx)
    assert.match(block, /^Type: creator/m)
    assert.match(block, /^Niche: Bollywood dance tutorials$/m)
    assert.match(block, /^Main profile: https:\/\/www\.instagram\.com\/priyadances$/m)
    assert.ok(!block.includes('Company:'))
    assert.ok(!block.includes('Industry:'))
  })

  it('asks for a playful image, never a business graphic', () => {
    assert.match(renderMediaContext(creatorCtx), /never a diagram, chart or business layout/)
    assert.ok(!renderMediaContext(professionalCtx).includes('creator'))
  })
})

describe('creator drafting', () => {
  it('writes LinkedIn posts with the creator rules instead of the professional ones', () => {
    const instructions = draftingPrompt.buildInstructions(creatorCtx)
    assert.match(instructions, /for one specific creator/)
    assert.ok(instructions.includes(CREATOR_TRUTH_RULES))
    assert.ok(instructions.includes(CREATOR_STYLE_RULES))
    assert.ok(!instructions.includes(TRUTH_RULES))
  })

  it('writes every other format with the creator rules and asks what to shoot', () => {
    const shared = variantPrompt.buildSharedInstructions(creatorCtx)
    assert.ok(shared.includes(CREATOR_STYLE_RULES))
    assert.ok(!shared.includes(TRUTH_RULES))
    const prompt = variantPrompt.buildFormatPrompt(creatorCtx, 'x.post')
    assert.match(prompt, /visualIdea — what the creator should photograph or film/)
    // A professional's X post still leaves it empty.
    assert.match(variantPrompt.buildFormatPrompt(professionalCtx, 'x.post'), /visualIdea — leave empty/)
  })

  it("treats a creator's 'tag a friend' as a warning, not a rewrite", () => {
    const post = { hook: 'POV: your first dance class', body: 'Tag a friend who needs this.', cta: 'Which step was hardest?' }
    const rule = (ctx: typeof creatorCtx) =>
      runLinter(buildPostLintOptions(ctx, null, post)).find(f => f.rule === 'engagement_bait')
    assert.strictEqual(rule(creatorCtx)?.severity, 'warning')
    assert.strictEqual(rule(professionalCtx)?.severity, 'error')
  })
})

describe('creator ideation', () => {
  it('plans content for a following, with creator rules', () => {
    const instructions = ideationPrompt.buildInstructions(creatorCtx)
    assert.match(instructions, /content strategist for one creator/)
    assert.match(instructions, /WHAT A GOOD IDEA IS FOR THIS CREATOR/)
    assert.match(instructions, /leaves the specifics for them in square brackets/)
    assert.ok(!instructions.includes('senior editorial strategist'))
  })

  it('offers content formats instead of analytical lenses', () => {
    const prompt = ideationPrompt.buildPrompt({
      corpus: { verifiedClaims: [] },
      history: '',
      candidateCount: 3,
      assignedGoals: ['G1', 'G1', 'G1'],
      hookMaxChars: 200,
      creator: true
    })
    assert.match(prompt, /CONTENT FORMATS — give each idea a different one/)
    assert.match(prompt, /- pov_skit: /)
    assert.ok(!prompt.includes('- contrarian_take:'))
    assert.match(prompt, /mediaBrief: what the creator should photograph or film/)
  })

  it('does not count a [placeholder] storytime as an invented anecdote', () => {
    assert.strictEqual(
      detectFabricatedAnecdote('Storytime: [last week I fell during the recital]', []).detected,
      false
    )
    assert.strictEqual(
      detectFabricatedAnecdote('Last week I watched a client cry', []).detected,
      true
    )
  })

  it('researches trends in the niche, not brand news', () => {
    const queries = buildSearchQueries(creatorCtx, 5)
    assert.ok(queries.length > 0)
    assert.ok(queries.every(q => q.startsWith('Bollywood dance tutorials')))
    assert.ok(queries.some(q => /trend/.test(q)))
  })

  it('judges goal fit by the following, not by business', () => {
    assert.strictEqual(instructionsFor(null), INSTRUCTIONS)
    assert.match(instructionsFor(null, true), /creator posting for a following/)
  })

  it('still builds a professional idea brief from the same idea', () => {
    // The idea block is the same for both: what the post is about.
    assert.ok(variantPrompt.buildIdeaBlock(idea({ title: 'Five-count basics' })).includes('Five-count basics'))
  })
})
