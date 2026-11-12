import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  renderIdentityBlock,
  renderMediaContext,
  styleMixFor
} from '../src/lib/ai/context-blocks'
import {
  buildFormatLintOptions,
  buildPostLintOptions
} from '../src/lib/ai/pipeline/post-lint'
import { keepValidSuggestions } from '../src/lib/ai/skills/goal-suggestions/guard'
import { instructionsFor, INSTRUCTIONS } from '../src/lib/ai/skills/goal-review/prompt'
import { detectFabricatedAnecdote } from '../src/lib/ai/skills/ideation/guard'
import * as ideationPrompt from '../src/lib/ai/skills/ideation/prompt'
import * as draftingPrompt from '../src/lib/ai/skills/post-drafting/prompt'
import { readStyles } from '../src/lib/ai/skills/profile-setup/guard'
import {
  CASUAL_TRUTH_RULES,
  casualStyleRules
} from '../src/lib/ai/skills/shared/casual-rules'
import { TRUTH_RULES } from '../src/lib/ai/skills/shared/truth-rules'
import * as variantPrompt from '../src/lib/ai/skills/variant-drafting/prompt'
import {
  cleanChannelSettings,
  mixOf,
  STARTING_FORMATS,
  styleOf
} from '../src/lib/formats'
import { objectivesFor } from '../src/lib/goal-objectives'
import {
  ACCOUNT_TYPES,
  IdentityProfileSchema,
  parseAccountType
} from '../src/lib/identity-profile'
import { runLinter } from '../src/lib/lint/run-linter'
import { buildSearchQueries } from '../src/lib/research/findings'
import { account, audience, context, goal } from './fixtures/generation'

/**
 * How posts sound is chosen per platform (professional, casual or fun),
 * separately from who is posting (a person or a brand). A dancer can be fun
 * everywhere, a founder professional on LinkedIn and casual on Instagram.
 * Professional is the prompt every identity had before (tests/linkedin-golden).
 */

const dancer = account({
  name: 'Priya Rao',
  accountType: 'personal',
  headline: 'Priya Rao · Bollywood dance',
  industry: 'Bollywood dance',
  bio: 'Dance teacher from Pune. Short choreography tutorials and rehearsal bloopers.',
  linkedinUrl: 'https://www.instagram.com/priyadances'
})

/** Fun on Instagram, its only platform. */
const funCtx = context({
  account: dancer,
  audiences: [audience('Teens learning to dance at home')],
  goal: goal({ title: 'Grow my followers', objective: 'grow_audience', keyMessage: 'Anyone can dance' }),
  enabledFormats: ['instagram.caption'],
  channelSettings: { instagram: { style: 'fun' } }
})

/** Professional on LinkedIn, fun on Instagram. */
const mixedCtx = context({
  account: dancer,
  audiences: [audience('Teens learning to dance at home')],
  goal: goal({ title: 'Grow my followers' }),
  enabledFormats: ['linkedin.post', 'instagram.caption'],
  channelSettings: { linkedin: { style: 'professional' }, instagram: { style: 'fun' } }
})

/** LinkedIn alone, as every identity was before styles. */
const professionalCtx = context({
  account: account({ name: 'Northwind', accountType: 'company', industry: 'Logistics' })
})

/** LinkedIn alone, but fun. */
const funLinkedInCtx = context({
  account: dancer,
  channelSettings: { linkedin: { style: 'fun' } }
})

describe('styles per platform', () => {
  it('defaults LinkedIn to professional and every other platform to casual', () => {
    assert.strictEqual(styleOf({}, 'linkedin'), 'professional')
    assert.strictEqual(styleOf({}, 'instagram'), 'casual')
    assert.strictEqual(styleOf({ instagram: { style: 'fun' } }, 'instagram'), 'fun')
    assert.strictEqual(styleOf({ linkedin: { style: 'casual' } }, 'linkedin'), 'casual')
  })

  it('reads all professional, all casual or fun, or a mix', () => {
    assert.strictEqual(mixOf([]), 'professional')
    assert.strictEqual(mixOf(['professional']), 'professional')
    assert.strictEqual(mixOf(['casual', 'fun']), 'casual')
    assert.strictEqual(mixOf(['professional', 'fun']), 'mixed')
    assert.strictEqual(styleMixFor(funCtx), 'casual')
    assert.strictEqual(styleMixFor(mixedCtx), 'mixed')
    assert.strictEqual(styleMixFor(professionalCtx), 'professional')
  })

  it('starts each picked platform on its main formats', () => {
    assert.deepStrictEqual(STARTING_FORMATS.instagram, ['instagram.caption'])
    assert.deepStrictEqual(STARTING_FORMATS.x, ['x.post'])
  })

  it("keeps a platform's style, and drops a style that is not one", () => {
    assert.deepStrictEqual(
      cleanChannelSettings({ linkedin: { style: 'casual' }, x: { style: 'loud' } }),
      { linkedin: { style: 'casual' } }
    )
  })
})

describe('who is posting', () => {
  it('is a person or a brand; anything else, an old "creator" included, is a person', () => {
    assert.deepStrictEqual([...ACCOUNT_TYPES], ['personal', 'company'])
    assert.strictEqual(parseAccountType('company'), 'company')
    assert.strictEqual(parseAccountType('creator'), 'personal')
  })

  it('lets anyone leave "what you promote" empty', () => {
    const profile = {
      name: 'Priya',
      description: 'I dance',
      targetAudience: 'Teens',
      offerings: '',
      industry: 'Dance'
    }
    assert.ok(IdentityProfileSchema.safeParse(profile).success)
    assert.ok(IdentityProfileSchema.safeParse({ ...profile, offerings: undefined }).success)
  })

  it('labels the profile link by what it is', () => {
    assert.match(renderIdentityBlock(funCtx), /^Profile: https:\/\/www\.instagram\.com\/priyadances$/m)
    const onLinkedIn = context({
      account: account({ linkedinUrl: 'https://www.linkedin.com/in/priya' })
    })
    assert.match(renderIdentityBlock(onLinkedIn), /^LinkedIn: https:\/\/www\.linkedin\.com\/in\/priya$/m)
  })

  it('describes an identity saved as a "creator" as a person', () => {
    const legacy = context({ account: account({ accountType: 'creator' }) })
    assert.match(renderIdentityBlock(legacy), /^Type: personal$/m)
  })
})

describe('goals', () => {
  it('offers objectives by how the identity posts', () => {
    assert.deepStrictEqual(objectivesFor('professional').slice(0, 2), ['authority', 'awareness'])
    assert.ok(objectivesFor('casual').includes('grow_audience'))
    assert.ok(!objectivesFor('casual').includes('lead_gen'))
    const mixed = objectivesFor('mixed')
    assert.ok(mixed.includes('lead_gen') && mixed.includes('entertain'))
    assert.strictEqual(new Set(mixed).size, mixed.length)
  })

  it('drops a suggestion whose objective is not offered', () => {
    const kept = keepValidSuggestions(
      {
        goals: [
          { title: 'Book demos', objectiveType: 'lead_gen', keyMessage: 'Buy', desiredAction: '', targetUrl: '', basedOn: '' },
          { title: 'Grow followers', objectiveType: 'grow_audience', keyMessage: 'Dance daily', desiredAction: '', targetUrl: '', basedOn: '' }
        ]
      } as Parameters<typeof keepValidSuggestions>[0],
      { allowedUrls: new Map(), existingGoals: [], objectives: objectivesFor('casual') }
    )
    assert.deepStrictEqual(kept.map(g => g.title), ['Grow followers'])
  })
})

describe('drafting by style', () => {
  it('writes a professional LinkedIn post with the professional rules', () => {
    const instructions = draftingPrompt.buildInstructions(professionalCtx)
    assert.ok(instructions.includes(TRUTH_RULES))
    assert.ok(!instructions.includes(CASUAL_TRUTH_RULES))
  })

  it('writes a fun LinkedIn post for followers', () => {
    const instructions = draftingPrompt.buildInstructions(funLinkedInCtx)
    assert.match(instructions, /written for the people who follow them: fun and playful/)
    assert.ok(instructions.includes(CASUAL_TRUTH_RULES))
    assert.ok(instructions.includes(casualStyleRules('fun')))
    assert.ok(!instructions.includes(TRUTH_RULES))
  })

  it('gives each style its own shared block, professional unchanged', () => {
    const professional = variantPrompt.buildSharedInstructions(mixedCtx)
    assert.ok(professional.includes(TRUTH_RULES))
    assert.ok(professional.startsWith('You are a ghostwriter who writes finished social media posts for one specific author, one platform at a time.'))
    const casual = variantPrompt.buildSharedInstructions(mixedCtx, 'casual')
    assert.ok(casual.includes(casualStyleRules('casual')))
    assert.ok(!casual.includes(TRUTH_RULES))
    assert.notStrictEqual(casual, variantPrompt.buildSharedInstructions(mixedCtx, 'fun'))
  })

  it("follows each format's platform", () => {
    assert.strictEqual(variantPrompt.styleOfFormat(mixedCtx, 'instagram.caption'), 'fun')
    assert.strictEqual(variantPrompt.styleOfFormat(mixedCtx, 'linkedin.post'), 'professional')
    // X is casual until the identity says otherwise.
    assert.strictEqual(variantPrompt.styleOfFormat(mixedCtx, 'x.post'), 'casual')
  })

  it('asks a casual post what to shoot, and a professional one nothing', () => {
    assert.match(
      variantPrompt.buildFormatPrompt(funCtx, 'x.post'),
      /visualIdea — what the author should photograph or film/
    )
    const professionalX = context({
      account: dancer,
      enabledFormats: ['x.post'],
      channelSettings: { x: { style: 'professional' } }
    })
    assert.match(variantPrompt.buildFormatPrompt(professionalX, 'x.post'), /visualIdea — leave empty/)
  })

  it("treats 'tag a friend' as a warning on a casual platform, an error on a professional one", () => {
    const post = { hook: 'POV: your first dance class', body: 'Tag a friend who needs this.', cta: 'Which step was hardest?' }
    const bait = (options: Parameters<typeof runLinter>[0]) =>
      runLinter(options).find(f => f.rule === 'engagement_bait')?.severity
    assert.strictEqual(bait(buildPostLintOptions(professionalCtx, null, post)), 'error')
    assert.strictEqual(bait(buildPostLintOptions(funLinkedInCtx, null, post)), 'warning')
    assert.strictEqual(bait(buildFormatLintOptions(mixedCtx, 'instagram.caption', null, post)), 'warning')
    // LinkedIn's style does not leak into another platform's checks.
    const professionalX = context({
      account: dancer,
      channelSettings: { linkedin: { style: 'fun' }, x: { style: 'professional' } }
    })
    assert.strictEqual(bait(buildFormatLintOptions(professionalX, 'x.post', null, post)), 'error')
  })

  it('asks for a personal image on a casual platform, never a business graphic', () => {
    assert.match(renderMediaContext(funLinkedInCtx), /never a diagram, chart or business layout/)
    assert.ok(!renderMediaContext(professionalCtx).includes('Style:'))
  })
})

describe('ideas by style', () => {
  const run = (style: 'casual' | 'mixed' | 'professional') =>
    ideationPrompt.buildPrompt({
      corpus: { verifiedClaims: [] },
      history: '',
      candidateCount: 3,
      assignedGoals: ['G1', 'G1', 'G1'],
      hookMaxChars: 200,
      style
    })

  it('plans content for followers when every platform is casual or fun', () => {
    const channels = ideationPrompt.ideationChannels(['instagram.caption'], null)
    // One platform, not LinkedIn: the run plans for it.
    assert.deepStrictEqual(channels, { target: 'instagram', formats: ['instagram.caption'] })
    assert.strictEqual(ideationPrompt.ideationStyle(funCtx, channels), 'casual')
    const instructions = ideationPrompt.buildInstructions(funCtx, channels)
    assert.match(instructions, /content strategist for one person who posts on Instagram/)
    assert.match(instructions, /WHAT A GOOD IDEA IS HERE/)
    assert.match(instructions, /leaves the specifics for them in square brackets/)
    assert.ok(!instructions.includes('senior editorial strategist'))
    const prompt = run('casual')
    assert.match(prompt, /CONTENT FORMATS — give each idea a different one/)
    assert.match(prompt, /- pov_skit: /)
    assert.ok(!prompt.includes('- contrarian_take:'))
    assert.match(prompt, /mediaBrief: what the author should photograph or film/)
  })

  it('offers both kinds of idea across professional and fun platforms', () => {
    const channels = ideationPrompt.ideationChannels(['linkedin.post', 'instagram.caption'], null)
    assert.strictEqual(ideationPrompt.ideationStyle(mixedCtx, channels), 'mixed')
    const instructions = ideationPrompt.buildInstructions(mixedCtx, channels)
    assert.match(instructions, /senior editorial strategist/)
    assert.match(instructions, /NOT EVERY PLATFORM SOUNDS THE SAME/)
    assert.match(instructions, /Casual or fun here: Instagram \(fun\)/)
    assert.match(instructions, /Professional here: LinkedIn \(professional\)/)
    const prompt = run('mixed')
    assert.match(prompt, /- contrarian_take:/)
    assert.match(prompt, /- pov_skit:/)
    assert.match(prompt, /lens or format from the lists above/)
  })

  it('plans for one platform when the identity posts on one', () => {
    assert.deepStrictEqual(ideationPrompt.ideationChannels(['x.post'], null), {
      target: 'x',
      formats: ['x.post']
    })
    assert.strictEqual(ideationPrompt.ideationChannels(['linkedin.post'], null), null)
  })

  it('keeps the professional plan for LinkedIn alone', () => {
    assert.strictEqual(ideationPrompt.ideationStyle(professionalCtx, null), 'professional')
    const prompt = run('professional')
    assert.match(prompt, /ANALYTICAL LENSES — give each idea a different one/)
    assert.ok(!prompt.includes('CONTENT FORMATS'))
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

  it('researches trends for casual platforms, both for a mix', () => {
    const casual = buildSearchQueries(funCtx, 5)
    assert.ok(casual.length > 0 && casual.every(q => q.startsWith('Bollywood dance')))
    assert.ok(casual.some(q => /trend/.test(q)))
    const mixed = buildSearchQueries(mixedCtx, 6)
    assert.ok(mixed.some(q => /trend this week/.test(q)))
    assert.ok(mixed.some(q => !/trend|challenge|viral/.test(q)))
    assert.ok(!buildSearchQueries(professionalCtx, 5).some(q => /trend this week/.test(q)))
  })

  it('judges goal fit by followers on casual platforms', () => {
    assert.strictEqual(instructionsFor(null), INSTRUCTIONS)
    assert.match(instructionsFor(null, 'casual'), /for the people who follow them/)
    assert.match(instructionsFor('Instagram', 'mixed'), /Some of these ideas are meant for platforms/)
  })
})

describe('AI setup styles', () => {
  it('keeps a style for each platform the user picked, and nothing else', () => {
    const raw = {
      styles: [
        { platform: 'instagram', style: 'fun' },
        { platform: 'linkedin', style: 'Professional' },
        { platform: 'youtube', style: 'fun' },
        { platform: 'x', style: 'loud' },
        { platform: 'instagram', style: 'casual' }
      ]
    }
    assert.deepStrictEqual(readStyles(raw, ['instagram', 'linkedin', 'x']), {
      instagram: 'fun',
      linkedin: 'professional'
    })
    assert.deepStrictEqual(readStyles({}, ['instagram']), {})
  })
})
