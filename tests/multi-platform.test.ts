import assert from 'node:assert'
import { describe, it } from 'node:test'
import { channelAudience, forFormat } from '../src/lib/ai/channel-context'
import { resolvePreferences, type GenerationContext } from '../src/lib/ai/context-blocks'
import {
  buildFormatLintOptions,
  buildPostLintOptions
} from '../src/lib/ai/pipeline/post-lint'
import * as ideationPrompt from '../src/lib/ai/skills/ideation/prompt'
import { instructionsFor, INSTRUCTIONS } from '../src/lib/ai/skills/goal-review/prompt'
import * as variantPrompt from '../src/lib/ai/skills/variant-drafting/prompt'
import * as draftingPrompt from '../src/lib/ai/skills/post-drafting/prompt'
import { toVariantDraft, VariantOutputSchema } from '../src/lib/ai/skills/variant-drafting/schema'
import {
  cleanChannelSettings,
  copyText,
  countChars,
  FORMAT_IDS,
  FORMATS,
  formatCharCount,
  formatOf,
  formatsToDraft,
  initialTargetFormats,
  limitedTexts,
  PLATFORMS,
  resolveChannels,
  samplePlatform,
  spokenSeconds,
  splitThread,
  threadColumns,
  videoScriptOf
} from '../src/lib/formats'
import { runLinter } from '../src/lib/lint/run-linter'
import { platformPostText } from '../src/lib/post-text'
import {
  account,
  audience,
  context,
  goal,
  goldenCases,
  goldenDrafts,
  idea,
  NOW,
  samplePost
} from './fixtures/generation'

/** A context whose identity drafts `formats` and said `settings` about its platforms. */
function withChannels(
  ctx: GenerationContext,
  formats: string[],
  settings: Record<string, { audience?: string; tone?: string }> = {}
): GenerationContext {
  return {
    ...ctx,
    prefs: resolvePreferences(
      {
        id: 'prefs',
        accountId: ctx.account.id,
        pillars: [],
        ideasPerRun: 5,
        postConstraints: { cta_required: true },
        guardrails: null,
        enabledFormats: formats,
        channelSettings: settings,
        createdAt: NOW,
        updatedAt: NOW
      },
      ctx.voice
    )
  }
}

describe('format registry', () => {
  it('has a spec for every format id, each on a known platform', () => {
    for (const id of FORMAT_IDS) {
      assert.strictEqual(FORMATS[id].id, id)
      assert.ok(FORMATS[id].limits.maxChars > 0)
    }
  })

  it('treats rows from before formats as LinkedIn posts', () => {
    assert.strictEqual(formatOf(null), 'linkedin.post')
    assert.strictEqual(formatOf('myspace.post'), 'linkedin.post')
    assert.strictEqual(formatOf('x.thread'), 'x.thread')
  })
})

describe('counting characters the way each platform does', () => {
  it('counts a link as 23 on X, however long it is', () => {
    const url = 'https://example.com/a/very/long/path/that/goes/on/and/on?with=params'
    assert.strictEqual(countChars(`Read ${url}`, 'x_weighted'), 5 + 23)
  })

  it('counts emoji and CJK as 2 on X, Latin as 1', () => {
    assert.strictEqual(countChars('ab', 'x_weighted'), 2)
    assert.strictEqual(countChars('👍', 'x_weighted'), 2)
    assert.strictEqual(countChars('👨‍👩‍👧', 'x_weighted'), 2)
    assert.strictEqual(countChars('日本', 'x_weighted'), 4)
  })

  it('counts a joined emoji as one grapheme', () => {
    assert.strictEqual(countChars('👨‍👩‍👧 hi', 'graphemes'), 4)
    assert.strictEqual(countChars('👨‍👩‍👧 hi', 'utf16'), '👨‍👩‍👧 hi'.length)
  })
})

describe('threads in the stored columns', () => {
  it('round-trips posts through hook and body', () => {
    const posts = ['First claim.', 'Second step.', 'Third, the ask?']
    const cols = threadColumns(posts)
    assert.strictEqual(cols.hook, 'First claim.')
    assert.deepStrictEqual(splitThread(cols.hook, cols.body), posts)
  })

  it('splits on a --- line however it is spaced, and drops empty posts', () => {
    assert.deepStrictEqual(splitThread('One', 'Two\n  ---  \nThree\n---\n\n---\nFour'), [
      'One',
      'Two',
      'Three',
      'Four'
    ])
  })

  it('limits each post, with the hashtags on the last', () => {
    const texts = limitedTexts('x.thread', {
      hook: 'One',
      body: 'Two\n\n---\n\nThree',
      hashtags: ['ops']
    })
    assert.deepStrictEqual(texts, ['One', 'Two', 'Three\n\n#ops'])
  })
})

describe('copy-out per format', () => {
  it('leaves LinkedIn copy-out exactly as it was', () => {
    for (const { draft } of goldenDrafts()) {
      assert.strictEqual(copyText('linkedin.post', draft), platformPostText(draft))
    }
  })

  it('copies other formats as plain text with hashtags and no bold hook', () => {
    const text = copyText('facebook.post', {
      hook: '**Bold** opening',
      body: 'Body line',
      cta: 'What do you do?',
      hashtags: ['team', '#ops']
    })
    assert.strictEqual(text, 'Bold opening\n\nBody line\n\nWhat do you do?\n\n#team #ops')
  })

  it('copies a thread with a --- line between its posts', () => {
    const text = copyText('x.thread', { hook: 'One', body: 'Two\n\n---\n\nThree' })
    assert.strictEqual(text, 'One\n\n---\n\nTwo\n\n---\n\nThree')
  })
})

describe('channel settings', () => {
  it('starts every identity on LinkedIn alone', () => {
    const resolved = resolveChannels(undefined)
    assert.deepStrictEqual(resolved.enabledFormats, ['linkedin.post'])
    assert.deepStrictEqual(resolved.platforms, ['linkedin'])
  })

  it('keeps known formats in registry order and drops the rest', () => {
    const resolved = resolveChannels({
      enabledFormats: ['instagram.caption', 'bogus', 'x.post', 'x.post']
    })
    assert.deepStrictEqual(resolved.enabledFormats, ['x.post', 'instagram.caption'])
  })

  it('drops LinkedIn, unknown platforms and blank notes', () => {
    assert.deepStrictEqual(
      cleanChannelSettings({
        linkedin: { audience: 'peers' },
        myspace: { audience: 'x' },
        x: { audience: '  ', tone: ' blunt ' },
        instagram: { audience: '' }
      }),
      { x: { audience: undefined, tone: 'blunt' } }
    )
  })

  it('drafts an idea in its chosen formats, else its suited ones, else LinkedIn', () => {
    assert.deepStrictEqual(formatsToDraft({ targetFormats: ['x.thread'], formatFit: ['x.post'] }), ['x.thread'])
    assert.deepStrictEqual(formatsToDraft({ targetFormats: [], formatFit: ['x.post'] }), ['x.post'])
    assert.deepStrictEqual(formatsToDraft({}), ['linkedin.post'])
  })

  it('targets a run idea at the enabled formats it suits', () => {
    const enabled = ['linkedin.post', 'x.post', 'instagram.caption'] as const
    assert.deepStrictEqual(
      initialTargetFormats({ enabled: [...enabled], fit: ['instagram.caption', 'x.thread'] }),
      ['instagram.caption']
    )
    // Nothing named: the first enabled format, not all of them.
    assert.deepStrictEqual(initialTargetFormats({ enabled: [...enabled], fit: [] }), ['linkedin.post'])
    // A run for one platform: that platform's enabled formats.
    assert.deepStrictEqual(
      initialTargetFormats({ enabled: [...enabled], fit: [], channel: 'x' }),
      ['x.post']
    )
  })
})

describe('sample posts per platform', () => {
  it('reads a platform tag and removes it', () => {
    assert.deepStrictEqual(samplePlatform('[X] Ship it.'), { platform: 'x', content: 'Ship it.' })
    assert.deepStrictEqual(samplePlatform('Caption here [Instagram]'), {
      platform: 'instagram',
      content: 'Caption here'
    })
    assert.deepStrictEqual(samplePlatform('No tag at all'), {
      platform: 'linkedin',
      content: 'No tag at all'
    })
  })
})

describe('the context each format sees', () => {
  const base = context({
    account: account({ name: 'Northwind' }),
    samplePosts: [
      samplePost('LinkedIn one, long enough'),
      samplePost('LinkedIn two, long enough'),
      samplePost('X one', { platform: 'x' })
    ],
    history: {
      drafts: [
        { hook: 'LinkedIn hook', originalHook: 'LinkedIn hook', body: 'b', cta: 'LinkedIn ask?', status: 'approved' }
      ],
      otherDrafts: [
        { hook: 'X hook', originalHook: 'X hook', body: 'b', cta: 'X ask?', status: 'approved', formatId: 'x.post' },
        { hook: 'IG hook', originalHook: 'IG hook', body: 'b', cta: 'IG ask?', status: 'approved', formatId: 'instagram.caption' }
      ],
      ideas: [],
      rejectionReasons: []
    }
  })

  it('gives LinkedIn its own posts and samples', () => {
    const li = forFormat(base, 'linkedin.post')
    assert.deepStrictEqual(li.history.drafts.map(d => d.hook), ['LinkedIn hook'])
    assert.deepStrictEqual(li.samplePosts.map(s => s.platform), ['linkedin', 'linkedin'])
  })

  it('gives X only its own earlier posts, so siblings never repeat each other', () => {
    const x = forFormat(base, 'x.post')
    assert.deepStrictEqual(x.history.drafts.map(d => d.hook), ['X hook'])
  })

  it('falls back to every sample when a platform has fewer than two of its own', () => {
    assert.strictEqual(forFormat(base, 'x.post').samplePosts.length, 3)
  })

  it('turns a platform audience note into an audience row', () => {
    const ctx = withChannels(base, ['linkedin.post', 'instagram.caption'], {
      instagram: { audience: 'Customers who shop online' }
    })
    assert.strictEqual(channelAudience(ctx, 'instagram')?.name, 'Customers who shop online')
    assert.strictEqual(channelAudience(ctx, 'x'), null)
    assert.strictEqual(channelAudience(ctx, 'linkedin'), null)
  })
})

describe('drafting prompts for other formats', () => {
  const { ctx: goldenCtx, idea: goldenIdea } = goldenCases()[0]!
  const ctx = withChannels(goldenCtx, ['linkedin.post', 'x.thread', 'instagram.caption'], {
    instagram: { audience: 'Shoppers who follow the brand', tone: 'Warm, first names' }
  })

  it('shares the first two blocks across formats, so later formats read them from cache', () => {
    const shared = variantPrompt.buildSharedInstructions(ctx)
    assert.ok(shared.includes('Northwind Freight'))
    assert.ok(shared.includes('Book audit calls'))
    // Nothing format-specific in the shared parts.
    for (const id of FORMAT_IDS) assert.ok(!shared.includes(FORMATS[id].label))
    const ideaBlock = variantPrompt.buildIdeaBlock(goldenIdea)
    assert.ok(ideaBlock.includes('Freight Billing Report 2026'))
  })

  it('states the platform, its rules and what the identity said about it', () => {
    const ig = variantPrompt.buildFormatPrompt(ctx, 'instagram.caption')
    assert.ok(ig.includes('PLATFORM: Instagram'))
    assert.ok(ig.includes('Shoppers who follow the brand'))
    assert.ok(ig.includes('Warm, first names'))
    assert.ok(ig.includes('visualIdea'))
    assert.ok(ig.includes('Never write a URL'))
    // The goal's link is never put in a caption.
    assert.ok(!ig.includes('https://northwind.example/audit'))
  })

  it('puts the goal link in the reply on X and asks for a thread', () => {
    const x = variantPrompt.buildFormatPrompt(ctx, 'x.thread')
    assert.ok(x.includes('PLATFORM: X'))
    assert.ok(x.includes('3 to 7 posts'))
    assert.ok(x.includes('https://northwind.example/audit'))
    assert.ok(!x.includes('Shoppers who follow the brand'))
  })

  it('maps a thread answer onto the stored columns', () => {
    const parsed = VariantOutputSchema.parse({
      posts: ['One', 'Two', 'Three'],
      alternateHooks: ['A', 'B'],
      selfScores: { hookStrength: 7, onBrand: 7, clarity: 7, evidenceGrounding: 7, originality: 7 }
    })
    const draft = toVariantDraft('x.thread', parsed)
    assert.strictEqual(draft.hook, 'One')
    assert.deepStrictEqual(splitThread(draft.hook, draft.body), ['One', 'Two', 'Three'])
    assert.strictEqual(draft.cta, '')
  })

  it('still reads a thread the model wrote into hook and body', () => {
    const draft = toVariantDraft('x.thread', {
      hook: 'One',
      body: 'Two\n\n---\n\nThree',
      posts: []
    })
    assert.deepStrictEqual(splitThread(draft.hook, draft.body), ['One', 'Two', 'Three'])
  })

  it("keeps a creator's shot idea on any single post, and none when not written", () => {
    assert.deepStrictEqual(
      toVariantDraft('facebook.post', { hook: 'H', body: 'B', visualIdea: 'Film the rehearsal' }).payload,
      { visualIdea: 'Film the rehearsal' }
    )
    assert.strictEqual(toVariantDraft('facebook.post', { hook: 'H', body: 'B' }).payload, null)
  })

  it("keeps an Instagram caption's visual idea", () => {
    const draft = toVariantDraft('instagram.caption', {
      hook: 'Hook',
      body: 'Body',
      cta: 'Ask?',
      visualIdea: 'A stack of invoices with one circled'
    })
    assert.deepStrictEqual(draft.payload, { visualIdea: 'A stack of invoices with one circled' })
  })
})

describe('checks per format', () => {
  const { ctx, idea: goldenIdea } = goldenCases()[0]!
  const findings = (formatId: Parameters<typeof buildFormatLintOptions>[1], post: Parameters<typeof buildFormatLintOptions>[3]) =>
    runLinter(buildFormatLintOptions(ctx, formatId, goldenIdea, post))
  const rule = (list: ReturnType<typeof runLinter>, name: string) =>
    list.find(f => f.rule === name)

  it('checks LinkedIn exactly as before', () => {
    for (const { draft } of goldenDrafts()) {
      assert.deepStrictEqual(
        runLinter(buildFormatLintOptions(ctx, 'linkedin.post', goldenIdea, draft)),
        runLinter(buildPostLintOptions(ctx, goldenIdea, draft))
      )
    }
  })

  it('holds an X post to 280 as X counts it', () => {
    const long = { hook: 'a'.repeat(200), body: 'b'.repeat(100), cta: '' }
    const over = rule(findings('x.post', long), 'char_limit')
    assert.strictEqual(over?.passed, false)
    assert.strictEqual(over?.severity, 'error')
    const fits = { hook: 'Short and sharp.', body: '', cta: '' }
    assert.strictEqual(rule(findings('x.post', fits), 'char_limit')?.passed, true)
    // X has no fold.
    assert.strictEqual(rule(findings('x.post', fits), 'hook_fold'), undefined)
  })

  it('names the thread post that is too long, and checks the thread length', () => {
    const post = { hook: 'Fine opener.', body: `${'x'.repeat(300)}\n\n---\n\nLast.`, cta: '' }
    const list = findings('x.thread', post)
    assert.match(rule(list, 'char_limit')?.message ?? '', /Post 2 of the thread/)
    assert.strictEqual(rule(list, 'thread_length')?.passed, true)
    const short = findings('x.thread', { hook: 'Only one.', body: '', cta: '' })
    assert.strictEqual(rule(short, 'thread_length')?.passed, false)
    // The ask is in the last post, so an empty call to action is not missing.
    assert.strictEqual(rule(list, 'cta_required'), undefined)
  })

  it('flags a URL in an Instagram caption as not clickable', () => {
    const list = findings('instagram.caption', {
      hook: 'Hook line.',
      body: 'See https://northwind.example/audit',
      cta: 'Saved it?',
      hashtags: ['freight']
    })
    const link = rule(list, 'link_placement')
    assert.strictEqual(link?.passed, false)
    assert.match(link?.message ?? '', /not clickable/)
  })

  it('allows a link in a Facebook post', () => {
    const list = findings('facebook.post', {
      hook: 'Hook line.',
      body: 'See https://northwind.example/audit',
      cta: 'What did you find?'
    })
    assert.strictEqual(rule(list, 'link_placement')?.passed, true)
  })

  it('counts what was stored the way the platform does', () => {
    assert.strictEqual(
      formatCharCount('x.post', { hook: 'Read https://example.com/a/b/c', body: '', cta: '' }),
      5 + 23
    )
  })
})

describe('ideation for several platforms', () => {
  const { ctx } = goldenCases()[0]!

  it('changes nothing for an identity on LinkedIn alone', () => {
    assert.strictEqual(ideationPrompt.ideationChannels(['linkedin.post'], null), null)
    assert.strictEqual(ideationPrompt.ideationChannels(['linkedin.post'], 'linkedin'), null)
  })

  it('plans across every enabled format, asking which each idea suits', () => {
    const channels = ideationPrompt.ideationChannels(['linkedin.post', 'x.post', 'instagram.caption'], null)
    assert.deepStrictEqual(channels, { target: null, formats: ['linkedin.post', 'x.post', 'instagram.caption'] })
    const instructions = ideationPrompt.buildInstructions(ctx, channels)
    assert.match(instructions, /across LinkedIn, X and Instagram/)
    assert.match(instructions, /not every idea fits every platform/)
    const prompt = ideationPrompt.buildPrompt({
      corpus: { verifiedClaims: [] },
      history: '',
      candidateCount: 3,
      assignedGoals: ['G1', 'G1', 'G1'],
      hookMaxChars: 200,
      channels
    })
    assert.match(prompt, /- formats: the format ids it would make a strong post in/)
  })

  it("writes a platform's own ideas for a run aimed at it", () => {
    const channels = ideationPrompt.ideationChannels(['linkedin.post', 'instagram.caption'], 'instagram')
    assert.deepStrictEqual(channels, { target: 'instagram', formats: ['instagram.caption'] })
    const instructions = ideationPrompt.buildInstructions(ctx, channels)
    assert.match(instructions, /plans Instagram content/)
    assert.match(instructions, /WHAT WORKS ON INSTAGRAM/)
    assert.ok(!instructions.includes('plans LinkedIn content'))
    const prompt = ideationPrompt.buildPrompt({
      corpus: { verifiedClaims: [] },
      history: '',
      candidateCount: 3,
      assignedGoals: ['G1', 'G1', 'G1'],
      hookMaxChars: 200,
      channels
    })
    assert.match(prompt, /opening line on Instagram/)
    assert.ok(!prompt.includes('before the fold'))
  })

  it('reviews goal fit for the platform the run is for', () => {
    assert.strictEqual(instructionsFor(null), INSTRUCTIONS)
    assert.match(instructionsFor('Instagram'), /proposed Instagram post ideas/)
  })
})

describe('regenerating a post', () => {
  const { ctx, idea: goldenIdea } = goldenCases()[0]!

  it('asks LinkedIn for a new version on top of the unchanged brief', () => {
    const brief = draftingPrompt.buildPrompt(ctx, goldenIdea)
    const prompt = draftingPrompt.buildRegeneratePrompt(
      ctx,
      goldenIdea,
      { hook: 'Old hook', body: 'Old body', cta: 'Old ask?' },
      'Make it shorter'
    )
    assert.ok(prompt.startsWith(brief))
    assert.match(prompt, /CURRENT VERSION\nHook: Old hook/)
    assert.match(prompt, /WHAT THE REVIEWER WANTS CHANGED[^\n]*\nMake it shorter/)
  })

  it('asks for a different take when the reviewer says nothing', () => {
    const prompt = draftingPrompt.buildRegeneratePrompt(
      ctx,
      goldenIdea,
      { hook: 'Old hook', body: 'Old body' },
      null
    )
    assert.match(prompt, /genuinely different take/)
    assert.ok(!prompt.includes('WHAT THE REVIEWER WANTS CHANGED'))
  })

  it("shows a thread's posts and the instruction for other formats", () => {
    const prompt = variantPrompt.buildRegeneratePrompt(
      ctx,
      'x.thread',
      { hook: 'Post one', body: 'Post two\n\n---\n\nPost three' },
      'Punchier'
    )
    assert.match(prompt, /new version of this X thread/)
    assert.ok(prompt.includes('Post one') && prompt.includes('Post three'))
    assert.match(prompt, /Punchier$/)
  })
})

describe('each platform opens its own way', () => {
  const { ctx } = goldenCases()[0]!

  it("states how posts open on the platform", () => {
    const prompt = variantPrompt.buildFormatPrompt(ctx, 'facebook.post')
    assert.ok(prompt.includes(PLATFORMS.facebook.opening))
    assert.ok(!prompt.includes('already open with'))
  })

  it("lists the idea's openings on other platforms, to open differently", () => {
    const prompt = variantPrompt.buildFormatPrompt(ctx, 'instagram.caption', [
      'Ask three people if the month is closed.'
    ])
    assert.match(prompt, /already open with the lines below/)
    assert.ok(prompt.includes('- Ask three people if the month is closed.'))
  })
})

describe('short videos', () => {
  const { ctx, idea: goldenIdea } = goldenCases()[0]!
  const answer = {
    shots: [
      { say: 'Your month is not closed.', show: 'Author to camera', onScreenText: 'Is it closed?' },
      { say: 'Ask three people and you get three answers.\n\nThat is a feeling, not a close.', show: 'Three chat bubbles' },
      { say: 'Write five yes or no checks. Want help? Link in bio.', show: 'The checklist' }
    ],
    caption: 'What closed should mean.',
    title: 'Define your month-end close in 5 checks',
    hashtags: ['finance', 'd2c'],
    alternateHooks: ['A', 'B'],
    selfScores: { hookStrength: 7, onBrand: 7, clarity: 7, evidenceGrounding: 7, originality: 7 }
  }

  it('keeps the spoken words as text, one shot per paragraph', () => {
    const draft = toVariantDraft('youtube.short', VariantOutputSchema.parse(answer))
    assert.strictEqual(draft.hook, 'Your month is not closed.')
    assert.strictEqual(draft.body.split('\n\n').length, 2)
    assert.strictEqual(draft.cta, '')
    assert.strictEqual(draft.payload?.caption, 'What closed should mean.')
    assert.strictEqual(draft.payload?.title, 'Define your month-end close in 5 checks')
  })

  it('pairs each spoken paragraph with its shot and estimates timing', () => {
    const draft = toVariantDraft('instagram.reel', answer)
    // A Reel takes no title.
    assert.strictEqual(draft.payload?.title, undefined)
    const script = videoScriptOf(draft)
    assert.strictEqual(script.shots.length, 3)
    assert.strictEqual(script.shots[0]!.onScreenText, 'Is it closed?')
    assert.strictEqual(script.shots[2]!.show, 'The checklist')
    assert.strictEqual(script.shots[1]!.startsAt, spokenSeconds('Your month is not closed.'))
    assert.ok(script.seconds > 0)
  })

  it('copies the script, shot by shot, then the caption', () => {
    const text = copyText('youtube.short', toVariantDraft('youtube.short', answer))
    assert.match(text, /^TITLE\nDefine your month-end close/)
    assert.match(text, /1\. Say: Your month is not closed\.\n   Show: Author to camera\n   On screen: Is it closed\?/)
    assert.match(text, /CAPTION\nWhat closed should mean\.\n\n#finance #d2c$/)
  })

  it('checks spoken length, caption and title', () => {
    const rule = (list: ReturnType<typeof runLinter>, name: string) => list.find(f => f.rule === name)
    const good = runLinter(
      buildFormatLintOptions(ctx, 'youtube.short', goldenIdea, toVariantDraft('youtube.short', answer))
    )
    assert.strictEqual(rule(good, 'script_length')?.passed, true)
    assert.strictEqual(rule(good, 'caption_missing'), undefined)
    assert.strictEqual(rule(good, 'video_title'), undefined)
    assert.strictEqual(rule(good, 'cta_required'), undefined)

    const long = toVariantDraft('instagram.reel', {
      ...answer,
      caption: '',
      shots: [{ say: 'word '.repeat(300), show: 'x' }, { say: 'end', show: 'y' }]
    })
    const bad = runLinter(buildFormatLintOptions(ctx, 'instagram.reel', goldenIdea, long))
    assert.strictEqual(rule(bad, 'script_length')?.severity, 'error')
    assert.strictEqual(rule(bad, 'caption_missing')?.passed, false)

    const noTitle = toVariantDraft('youtube.short', { ...answer, title: '' })
    const titled = runLinter(buildFormatLintOptions(ctx, 'youtube.short', goldenIdea, noTitle))
    assert.strictEqual(rule(titled, 'video_title')?.passed, false)
  })

  it('flags a URL in a video caption', () => {
    const withLink = toVariantDraft('instagram.reel', { ...answer, caption: 'See https://example.com' })
    const list = runLinter(buildFormatLintOptions(ctx, 'instagram.reel', goldenIdea, withLink))
    assert.match(list.find(f => f.rule === 'link_placement')?.message ?? '', /not clickable/)
  })

  it('asks for shots, caption and the spoken length', () => {
    const reel = variantPrompt.buildFormatPrompt(ctx, 'instagram.reel')
    assert.match(reel, /PLATFORM: Instagram/)
    assert.match(reel, /1\. shots — /)
    assert.match(reel, /about 30 seconds/)
    assert.match(reel, /3\. title — leave empty/)
    const yt = variantPrompt.buildFormatPrompt(ctx, 'youtube.short')
    assert.match(yt, /3\. title — at most 100 characters/)
    // A Reel reads and opens as a video, not as a photo caption.
    assert.ok(reel.includes(FORMATS['instagram.reel'].opening!))
  })

  it('reads [YouTube] sample tags', () => {
    assert.strictEqual(samplePlatform('[YouTube] Hi').platform, 'youtube')
  })

  it('offers no TikTok format', () => {
    assert.ok(!FORMAT_IDS.some(id => id.startsWith('tiktok')))
    assert.strictEqual(formatOf('tiktok.video'), 'linkedin.post')
  })
})

describe('fixtures used above', () => {
  it('build a complete idea and goal', () => {
    assert.strictEqual(idea().targetFormats[0], 'linkedin.post')
    assert.strictEqual(goal().linkStrategy, 'first_comment')
    assert.ok(audience('A').name)
  })
})

describe('Instagram post with its picture', () => {
  it('is the one format drafted with a picture besides LinkedIn, and says so', async () => {
    const { FORMAT_IDS, FORMATS, formatHint } = await import('../src/lib/formats')
    assert.deepStrictEqual(
      FORMAT_IDS.filter(id => FORMATS[id].withImage),
      ['instagram.caption']
    )
    assert.strictEqual(FORMATS['instagram.caption'].label, 'Instagram post')
    assert.strictEqual(
      formatHint('instagram.caption'),
      'A picture with its caption, up to 2,200 characters'
    )
    assert.strictEqual(formatHint('x.post'), 'One post, up to 280 characters')
  })
})

describe('image shape per post type', () => {
  it("makes each platform's images in the shape its feed shows", async () => {
    const { FORMATS } = await import('../src/lib/formats')
    const { SHAPE_SIZES } = await import('../src/lib/media/canvas/spec')
    assert.strictEqual(FORMATS['linkedin.post'].imageShape, '1.91:1')
    assert.strictEqual(FORMATS['x.post'].imageShape, '16:9')
    assert.strictEqual(FORMATS['x.thread'].imageShape, '16:9')
    assert.strictEqual(FORMATS['facebook.post'].imageShape, '4:5')
    assert.strictEqual(FORMATS['instagram.caption'].imageShape, '4:5')
    // LinkedIn keeps the size it always had.
    assert.deepStrictEqual(SHAPE_SIZES['1.91:1'], { width: 2048, height: 1072 })
    for (const [shape, size] of Object.entries(SHAPE_SIZES)) {
      const [w, h] = shape.split(':').map(Number)
      assert.ok(Math.abs(size.width / size.height - w! / h!) < 0.01, shape)
      // The image models need multiples of 16.
      assert.strictEqual(size.width % 16, 0, shape)
      assert.strictEqual(size.height % 16, 0, shape)
    }
  })
})
