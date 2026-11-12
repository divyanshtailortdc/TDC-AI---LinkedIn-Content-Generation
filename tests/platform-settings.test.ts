import assert from 'node:assert'
import { describe, it } from 'node:test'
import { forFormat } from '../src/lib/ai/channel-context'
import { renderGoalsBlock } from '../src/lib/ai/context-blocks'
import {
  buildFormatLintOptions,
  buildPostLintOptions
} from '../src/lib/ai/pipeline/post-lint'
import * as ideationPrompt from '../src/lib/ai/skills/ideation/prompt'
import * as variantPrompt from '../src/lib/ai/skills/variant-drafting/prompt'
import {
  cleanChannelSettings,
  cleanGoalPlatforms,
  emojiOf,
  goalPlatformsLabel,
  goalServes,
  initialTargetFormats,
  isPerformedWell,
  splitSamplePosts,
  withoutPerformedWell,
  type FormatId
} from '../src/lib/formats'
import {
  readChannelNotes,
  scopeGoalPlatforms
} from '../src/lib/ai/skills/profile-setup/guard'
import { INSTRUCTIONS as SETUP_INSTRUCTIONS } from '../src/lib/ai/skills/profile-setup/prompt'
import {
  EMPTY_SUGGESTIONS,
  GoalSuggestionsSchema
} from '../src/lib/ai/skills/profile-setup/schema'
import { buildPrompt as buildVoicePrompt } from '../src/lib/ai/skills/voice-analysis/prompt'
import { runLinter } from '../src/lib/lint/run-linter'
import { buildGoalPayload } from '../src/lib/settings-merge'
import {
  GoalPayloadSchema,
  PreferencesPayloadSchema
} from '../src/lib/setup-payloads'
import { account, context, goal, voice } from './fixtures/generation'

/**
 * One identity, with what differs per platform kept per platform: how freely
 * posts use emoji, and which platforms a goal's posts go on.
 */

const founder = account({
  name: 'Northwind',
  accountType: 'company',
  industry: 'Logistics'
})

/** No emoji in the voice, as LinkedIn samples teach; fun on Instagram, professional on X. */
const ctx = context({
  account: founder,
  voice: voice({ emojiPolicy: 'none' }),
  enabledFormats: ['linkedin.post', 'instagram.caption', 'x.post'],
  channelSettings: {
    instagram: { style: 'fun' },
    x: { style: 'professional' }
  }
})

describe('emoji per platform', () => {
  it('follows the voice on LinkedIn and professional platforms, and is free on casual and fun ones', () => {
    assert.strictEqual(emojiOf({}, 'linkedin', 'none'), 'none')
    // Instagram is casual until the identity says otherwise.
    assert.strictEqual(emojiOf({}, 'instagram', 'none'), 'liberal')
    assert.strictEqual(emojiOf({ x: { style: 'professional' } }, 'x', 'none'), 'none')
    assert.strictEqual(
      emojiOf({ instagram: { style: 'fun', emoji: 'bullets_only' } }, 'instagram', 'none'),
      'bullets_only'
    )
    // LinkedIn's is the voice's, whatever was saved for it.
    assert.strictEqual(emojiOf({ linkedin: { emoji: 'liberal' } }, 'linkedin', 'none'), 'none')
  })

  it('keeps an emoji choice for every platform but LinkedIn, and drops one that is not a level', () => {
    assert.deepStrictEqual(
      cleanChannelSettings({
        linkedin: { style: 'professional', emoji: 'liberal' },
        instagram: { emoji: 'none' },
        x: { emoji: 'lots' }
      }),
      { linkedin: { style: 'professional' }, instagram: { emoji: 'none' } }
    )
  })

  it('lets a fun Instagram caption use emoji when the voice uses none', () => {
    const level = (formatId: FormatId) =>
      forFormat(ctx, formatId).prefs.constraints.emoji_level
    assert.strictEqual(level('linkedin.post'), 'none')
    assert.strictEqual(level('instagram.caption'), 'liberal')
    assert.strictEqual(level('x.post'), 'none')
    // Applied twice, the same.
    assert.strictEqual(
      forFormat(forFormat(ctx, 'instagram.caption'), 'instagram.caption').prefs
        .constraints.emoji_level,
      'liberal'
    )
    assert.match(
      variantPrompt.buildFormatPrompt(ctx, 'instagram.caption'),
      /- Emoji are welcome where they add warmth\./
    )
    assert.match(variantPrompt.buildFormatPrompt(ctx, 'x.post'), /- Use no emoji at all\./)
  })

  it("checks each platform's post against its own level", () => {
    const post = {
      hook: 'POV: moving day 📦',
      body: 'We packed 400 boxes 🚚 before lunch.',
      cta: 'Seen worse?'
    }
    const emojiPassed = (options: Parameters<typeof runLinter>[0]) =>
      runLinter(options).find(f => f.rule === 'emoji_policy')?.passed
    assert.strictEqual(emojiPassed(buildFormatLintOptions(ctx, 'instagram.caption', null, post)), true)
    assert.strictEqual(emojiPassed(buildPostLintOptions(ctx, null, post)), false)
  })

  it('is saved from Preferences', () => {
    const parsed = PreferencesPayloadSchema.parse({
      ideasPerRun: 5,
      post_constraints: { cta_required: false },
      guardrails: { banned_topics: [], compliance_notes: '' },
      channels: {
        enabledFormats: ['instagram.caption'],
        settings: { instagram: { style: 'fun', emoji: 'none' } }
      }
    })
    assert.strictEqual(parsed.channels?.settings.instagram?.emoji, 'none')
    assert.throws(() =>
      PreferencesPayloadSchema.parse({
        ideasPerRun: 5,
        post_constraints: { cta_required: false },
        guardrails: { banned_topics: [], compliance_notes: '' },
        channels: { enabledFormats: [], settings: { x: { emoji: 'lots' } } }
      })
    )
  })
})

describe('goals per platform', () => {
  it('reads saved platforms, empty being every platform', () => {
    assert.deepStrictEqual(cleanGoalPlatforms(['x', 'linkedin', 'myspace', 'x']), ['linkedin', 'x'])
    assert.deepStrictEqual(cleanGoalPlatforms(null), [])
    assert.ok(goalServes({ platforms: [] }, 'instagram'))
    assert.ok(goalServes({}, 'instagram'))
    assert.ok(goalServes({ platforms: ['linkedin'] }, 'linkedin'))
    assert.ok(!goalServes({ platforms: ['linkedin'] }, 'instagram'))
    assert.strictEqual(goalPlatformsLabel([]), null)
    assert.strictEqual(goalPlatformsLabel(['linkedin']), 'LinkedIn only')
    assert.strictEqual(goalPlatformsLabel(['x', 'linkedin']), 'LinkedIn, X')
  })

  it("starts an idea on its goal's platforms only", () => {
    const enabled: FormatId[] = ['linkedin.post', 'instagram.caption', 'x.post']
    // It suits Instagram and LinkedIn, but its goal is LinkedIn's.
    assert.deepStrictEqual(
      initialTargetFormats({ enabled, fit: ['instagram.caption', 'linkedin.post'], goalPlatforms: ['linkedin'] }),
      ['linkedin.post']
    )
    // It suits none of the goal's platforms: the goal's first format.
    assert.deepStrictEqual(
      initialTargetFormats({ enabled, fit: ['instagram.caption'], goalPlatforms: ['x'] }),
      ['x.post']
    )
    // A goal for a platform no longer posted on counts as one for every platform.
    assert.deepStrictEqual(
      initialTargetFormats({ enabled, fit: ['instagram.caption'], goalPlatforms: ['youtube'] }),
      ['instagram.caption']
    )
    // A goal for every platform: as before.
    assert.deepStrictEqual(
      initialTargetFormats({ enabled, fit: ['instagram.caption'], goalPlatforms: [] }),
      ['instagram.caption']
    )
  })

  const leads = goal({ id: 'g1', title: 'Win logistics clients', platforms: ['linkedin'] })
  const fans = goal({ id: 'g2', title: 'Grow followers', platforms: [] })

  it("says which goals are for only some of a run's platforms", () => {
    const block = renderGoalsBlock([leads, fans], ['linkedin', 'instagram'])
    assert.match(
      block,
      /\[G1\] Win logistics clients[\s\S]*Posts only on: LinkedIn\. An idea whose main goal this is names only that platform's formats\.\n\[G2\]/
    )
    assert.strictEqual(block.match(/Posts only on/g)?.length, 1)
    // One platform, or none: as before.
    assert.strictEqual(renderGoalsBlock([leads, fans], ['linkedin']), renderGoalsBlock([leads, fans]))
  })

  it('tells ideation only in a run across platforms', () => {
    const multi = context({
      account: founder,
      goal: leads,
      otherGoals: [fans],
      enabledFormats: ['linkedin.post', 'instagram.caption']
    })
    const everywhere = ideationPrompt.ideationChannels(['linkedin.post', 'instagram.caption'], null)
    assert.match(ideationPrompt.buildInstructions(multi, everywhere), /Posts only on: LinkedIn\./)
    const instagram = ideationPrompt.ideationChannels(['linkedin.post', 'instagram.caption'], 'instagram')
    assert.ok(!ideationPrompt.buildInstructions(multi, instagram).includes('Posts only on'))
  })

  it('is saved from the goal form, and kept when a form sends none', () => {
    const base = {
      title: 'Win logistics clients',
      objectiveType: 'lead_gen',
      keyMessage: 'Late freight is a planning problem.',
      linkStrategy: 'first_comment'
    }
    assert.deepStrictEqual(GoalPayloadSchema.parse({ ...base, platforms: ['linkedin'] }).platforms, ['linkedin'])
    assert.strictEqual(GoalPayloadSchema.parse(base).platforms, undefined)
  })
})

describe('setup fills in each platform', () => {
  it("reads who follows them, how they sound and their emoji for each picked platform but LinkedIn", () => {
    const raw = {
      styles: [
        { platform: 'linkedin', style: 'professional', audience: 'Founders', tone: 'Sharp', emoji: 'none' },
        { platform: 'instagram', style: 'fun', audience: '  Locals who come\nfor the bakes ', tone: 'Chatty', emoji: 'liberal' },
        { platform: 'x', style: 'casual', audience: '', tone: '', emoji: 'bullets only' },
        { platform: 'threads', style: 'casual', audience: 'Not picked', tone: '', emoji: 'none' },
        { platform: 'facebook', style: 'casual', audience: '', tone: '', emoji: 'loads' }
      ]
    }
    assert.deepStrictEqual(readChannelNotes(raw, ['linkedin', 'instagram', 'x', 'facebook']), {
      instagram: { audience: 'Locals who come for the bakes', tone: 'Chatty', emoji: 'liberal' },
      x: { emoji: 'bullets_only' }
    })
    assert.deepStrictEqual(readChannelNotes({}, ['instagram']), {})
  })

  const withGoalPlatforms = (value: Array<'linkedin' | 'instagram' | 'x'>) => ({
    ...EMPTY_SUGGESTIONS,
    goals: {
      title: { value: 'Win clients', kind: 'recommendation' as const, confidence: 'medium' as const },
      platforms: { value, kind: 'recommendation' as const, confidence: 'medium' as const },
      missing: []
    }
  })

  it('keeps a suggested goal on some of their platforms, and drops a list that names them all', () => {
    const picked = ['linkedin', 'instagram'] as const
    assert.deepStrictEqual(
      scopeGoalPlatforms(withGoalPlatforms(['linkedin', 'x']), picked).goals.platforms?.value,
      ['linkedin']
    )
    assert.strictEqual(
      scopeGoalPlatforms(withGoalPlatforms(['linkedin', 'instagram']), picked).goals.platforms,
      undefined
    )
    assert.strictEqual(scopeGoalPlatforms(withGoalPlatforms(['x']), picked).goals.platforms, undefined)
    assert.strictEqual(
      scopeGoalPlatforms(withGoalPlatforms(['x']), picked).goals.title?.value,
      'Win clients'
    )
  })

  it("passes a suggested goal's platforms on to the goal it creates", () => {
    const built = buildGoalPayload({
      title: { value: 'Win clients', kind: 'recommendation', confidence: 'medium' },
      keyMessage: { value: 'Late freight is a planning problem.', kind: 'recommendation', confidence: 'medium' },
      platforms: { value: ['linkedin'], kind: 'recommendation', confidence: 'medium' },
      missing: []
    })
    assert.ok('payload' in built)
    assert.deepStrictEqual(built.payload.platforms, ['linkedin'])
    assert.ok(GoalSuggestionsSchema.safeParse({ platforms: { value: ['myspace'], kind: 'recommendation', confidence: 'low' }, missing: [] }).success === false)
  })

  it('asks the model for them', () => {
    assert.match(SETUP_INSTRUCTIONS, /For each platform but LinkedIn, also give: audience/)
    assert.match(SETUP_INSTRUCTIONS, /platforms \(only when the goal suits some of the platforms/)
  })
})

describe('a style learned from each platform', () => {
  it('splits pasted posts and reads their tags', () => {
    const pasted = 'First post, long enough to count as one.\n---\nSecond post ⭐ also long enough here.\n---\nshort'
    assert.deepStrictEqual(splitSamplePosts(pasted), [
      'First post, long enough to count as one.',
      'Second post ⭐ also long enough here.'
    ])
    assert.ok(isPerformedWell('Second post ⭐ also long enough here.'))
    assert.ok(isPerformedWell('[Performed well] Big day'))
    assert.ok(!isPerformedWell('An ordinary post'))
    assert.strictEqual(withoutPerformedWell('[top post] Big day ⭐'), 'Big day')
  })

  it('is kept for every platform but LinkedIn', () => {
    assert.deepStrictEqual(
      cleanChannelSettings({
        linkedin: { style: 'professional', rubric: 'Sharp.' },
        instagram: { rubric: '  Opens with a POV.  ' },
        x: { rubric: '   ' }
      }),
      { linkedin: { style: 'professional' }, instagram: { rubric: 'Opens with a POV.' } }
    )
  })

  it('steers drafting on its platform only', () => {
    const learned = context({
      account: founder,
      enabledFormats: ['linkedin.post', 'instagram.caption', 'x.post'],
      channelSettings: { instagram: { style: 'fun', rubric: 'Opens with a POV line, then one emoji per sentence.' } }
    })
    const instagram = variantPrompt.buildFormatPrompt(learned, 'instagram.caption')
    assert.match(
      instagram,
      /How this author writes on Instagram, learned from their own Instagram posts\. Where it differs from the core voice, follow this:\nOpens with a POV line/
    )
    assert.ok(!variantPrompt.buildFormatPrompt(learned, 'x.post').includes('learned from their own'))
  })

  it('tells the analysis which platform the posts are from', () => {
    assert.match(buildVoicePrompt('A post', 'Instagram'), /^Here are real sample posts the author wrote for Instagram\./)
    assert.match(buildVoicePrompt('A post'), /^Here are real sample posts from the author:/)
  })
})
