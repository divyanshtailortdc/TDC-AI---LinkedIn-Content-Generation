import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { VIDEO_GENERATION_ENABLED } from '../src/lib/video/formats'

/** Tests of video drafting, run only while videos are switched on. */
const whileVideosOn = { skip: !VIDEO_GENERATION_ENABLED && 'video generation is switched off' }

/**
 * Short-form video: the formats and their platform specs, the cost shown
 * before generating, the recorder's plan and page built from a script, the
 * AI prompt for the Veo models still listed, and which ideas draft a video.
 * Pure: no database, no browser, no provider calls.
 */

const script = {
  hook: 'Most month-end closes slip for one reason.',
  body: 'It is the bank feed nobody owns.\n\nGive it an owner and watch the close shrink.',
  cta: '',
  hashtags: ['finance'],
  payload: {
    caption: 'Who owns your bank feed?',
    shots: [
      { show: 'A finance lead frowning at a laptop late at night' },
      { show: 'A bank feed screen with "unreconciled" rows' },
      { show: 'The same lead smiling as a checklist turns green' }
    ]
  }
}

describe('video formats', () => {
  it('are the three short-video platforms, vertical 9:16 at 1080×1920, about 15 seconds', async () => {
    const { VIDEO_FORMATS, VIDEO_SPECS, describeVideoSpec } =
      await import('../src/lib/video/formats')
    assert.deepEqual(
      [...VIDEO_FORMATS],
      ['instagram.reel', 'youtube.short', 'facebook.reel']
    )
    for (const id of VIDEO_FORMATS) {
      const spec = VIDEO_SPECS[id]
      assert.equal(spec.aspectRatio, '9:16')
      assert.equal(spec.width / spec.height, 9 / 16)
      assert.equal(spec.seconds, 15)
      assert.ok(spec.seconds <= spec.platformMaxSeconds, id)
    }
    assert.equal(
      describeVideoSpec(VIDEO_SPECS['facebook.reel']),
      '9:16 · 1080×1920 · ~15 s · MP4'
    )
    assert.equal(VIDEO_SPECS['facebook.reel'].platformMaxSeconds, 90)
  })

  it('are scripts of a few slides, never image posts, and never created another way', async () => {
    const { FORMATS, canHaveImage, isCreatableFormat } =
      await import('../src/lib/formats')
    const { VIDEO_FORMATS } = await import('../src/lib/video/formats')
    for (const id of VIDEO_FORMATS) {
      assert.equal(FORMATS[id].structure, 'script', id)
      // Every platform takes a minute; the recorder keeps videos under one.
      assert.ok(FORMATS[id].limits.seconds!.max <= 60, id)
      assert.deepEqual(FORMATS[id].limits.shots, { min: 3, max: 6 }, id)
      assert.equal(canHaveImage(id), false, id)
      assert.equal(isCreatableFormat(id), false, id)
    }
    assert.equal(FORMATS['facebook.reel'].platform, 'facebook')
  })

  it('ask the writer for slides: a few big words and a caption line per shot', async () => {
    const { buildFormatPrompt } =
      await import('../src/lib/ai/skills/variant-drafting/prompt')
    const { goldenCases } = await import('./fixtures/generation')
    const prompt = buildFormatPrompt(goldenCases()[0]!.ctx, 'facebook.reel')
    assert.match(prompt, /PLATFORM: Facebook/)
    assert.match(prompt, /usually 3 to 6 shots/)
    assert.match(prompt, /about 15 seconds/)
    assert.match(prompt, /records as a text video/)
    assert.match(prompt, /onScreenText \(2 to 6 words, the shot's point, shown big on its slide; never empty\)/)
    assert.doesNotMatch(prompt, /Leave onScreenText empty/)
    assert.doesNotMatch(prompt, /8-second/)
  })
})

describe('video cost', () => {
  it('records by default, which costs nothing', async () => {
    const { estimateVideoCostUsd, videoModelInfo, RECORDER_MODEL_ID } =
      await import('../src/lib/video/models')
    const model = videoModelInfo(undefined)!
    assert.equal(model.id, RECORDER_MODEL_ID)
    assert.equal(model.provider, 'recorder')
    assert.equal(
      estimateVideoCostUsd(model, { seconds: 15, resolution: '1080p', audio: true }),
      0
    )
  })

  it('still prices Veo 3.1 Lite when VIDEO_MODEL names it: $0.64 for 8 seconds at 1080p with audio', async () => {
    const { estimateVideoCostUsd, videoModelInfo } =
      await import('../src/lib/video/models')
    const model = videoModelInfo('google/veo-3.1-lite-generate-001')!
    assert.equal(model.id, 'google/veo-3.1-lite-generate-001')
    assert.equal(
      estimateVideoCostUsd(model, {
        seconds: 8,
        resolution: '1080p',
        audio: true
      }),
      0.64
    )
    assert.equal(
      estimateVideoCostUsd(model, {
        seconds: 8,
        resolution: '720p',
        audio: false
      }),
      0.24
    )
  })

  it('still prices Veo 3.1 Fast when VIDEO_MODEL names it: $0.96 for 8 seconds at 1080p with audio', async () => {
    const { estimateVideoCostUsd, videoModelInfo } =
      await import('../src/lib/video/models')
    const fast = videoModelInfo('google/veo-3.1-fast-generate-001')!
    assert.equal(
      estimateVideoCostUsd(fast, {
        seconds: 8,
        resolution: '1080p',
        audio: true
      }),
      0.96
    )
  })

  it('uses the default model for a blank VIDEO_MODEL and refuses one with no price on record', async () => {
    const { videoModelInfo } = await import('../src/lib/video/models')
    assert.equal(videoModelInfo('  ')?.id, 'product-video/recorder')
    assert.equal(videoModelInfo('someone/unpriced-video'), null)
  })

  it('formats dollars for the confirm button', async () => {
    const { formatUsd } = await import('../src/lib/video/formats')
    assert.equal(formatUsd(0.96), '$0.96')
    assert.equal(formatUsd(0.004), '<$0.01')
  })
})

describe('video prompt', () => {
  it('describes a vertical clip for the platform with each shot as a timed beat and its voiceover', async () => {
    const { buildVideoPrompt } = await import('../src/lib/video/prompt')
    const prompt = buildVideoPrompt({
      formatId: 'instagram.reel',
      post: script,
      topic: 'Bank feeds'
    })
    assert.match(
      prompt,
      /vertical 9:16 short-form social video for Instagram Reels/
    )
    assert.match(prompt, /8-second live-action clip/)
    assert.match(prompt, /Subject: Bank feeds\./)
    assert.match(prompt, /1\. \(0–3s\) Picture: A finance lead frowning/)
    assert.match(
      prompt,
      /Voiceover: "Most month-end closes slip for one reason\."/
    )
    assert.match(prompt, /3\. \(5–8s\)/)
    assert.match(
      prompt,
      /No on-screen text, captions, subtitles, logos or watermarks/
    )
    // Veo drew a phone around the picture when told the clip was for a phone.
    assert.match(prompt, /fills the whole vertical frame/)
    assert.match(prompt, /No phone mockup, device frame, bezel, border/)
    assert.doesNotMatch(prompt, /for a phone held upright/)
  })

  it('keeps at most three shots, keeps quotes from breaking the voiceover, and caps the direction', async () => {
    const { buildVideoPrompt, MAX_VIDEO_DIRECTION_CHARS } =
      await import('../src/lib/video/prompt')
    const long = {
      ...script,
      hook: 'She said "stop" twice.',
      body: ['Two.', 'Three.', 'Four.', 'Five.'].join('\n\n')
    }
    const prompt = buildVideoPrompt({
      formatId: 'youtube.short',
      post: long,
      direction: 'x'.repeat(MAX_VIDEO_DIRECTION_CHARS + 100)
    })
    assert.match(prompt, /YouTube Shorts/)
    assert.ok(!/\n4\. /.test(prompt), 'no fourth beat')
    assert.match(prompt, /Voiceover: "She said 'stop' twice\."/)
    const direction = prompt.split('change: ')[1]!
    assert.equal(direction.length, MAX_VIDEO_DIRECTION_CHARS)
  })

  it('gives a shot with no picture a stand-in', async () => {
    const { buildVideoPrompt } = await import('../src/lib/video/prompt')
    const prompt = buildVideoPrompt({
      formatId: 'facebook.reel',
      post: { hook: 'One line.', body: '', payload: {} }
    })
    assert.match(
      prompt,
      /1\. \(0–8s\) Picture: a picture that shows what the voiceover says/
    )
  })
})

describe('which ideas draft a video', () => {
  it('drafts no video while video generation is switched off', { skip: VIDEO_GENERATION_ENABLED }, async () => {
    const { formatsToDraft } = await import('../src/lib/formats')
    const { videoFormatsChosen } = await import('../src/lib/video/formats')
    const idea = {
      targetFormats: ['instagram.reel', 'linkedin.post'],
      suggestedMedia: { mode: 'none', videoFormats: ['instagram.reel'] }
    }
    assert.deepEqual(videoFormatsChosen(idea), [])
    assert.deepEqual(formatsToDraft(idea), ['linkedin.post'])
  })

  it('drafts a video only when Short video asked for it', whileVideosOn, async () => {
    const { formatsToDraft } = await import('../src/lib/formats')
    assert.deepEqual(
      formatsToDraft({
        targetFormats: ['instagram.reel', 'facebook.reel'],
        suggestedMedia: {
          mode: 'none',
          videoFormats: ['instagram.reel', 'facebook.reel']
        }
      }),
      ['instagram.reel', 'facebook.reel']
    )
    // A Reel targeted before (no Short video choice) is still not drafted.
    assert.deepEqual(
      formatsToDraft({
        targetFormats: ['instagram.reel', 'instagram.caption']
      }),
      ['instagram.caption']
    )
    // A later image request without videos drafts no video.
    assert.deepEqual(
      formatsToDraft({
        targetFormats: ['linkedin.post'],
        suggestedMedia: { mode: 'none', videoFormats: [] }
      }),
      ['linkedin.post']
    )
  })

  it('reads the choice from the idea, ignoring anything that is not a video format', whileVideosOn, async () => {
    const { videoFormatsChosen } = await import('../src/lib/video/formats')
    assert.deepEqual(
      videoFormatsChosen({
        suggestedMedia: { videoFormats: ['youtube.short', 'x.post', 'nope'] }
      }),
      ['youtube.short']
    )
    assert.deepEqual(videoFormatsChosen({ suggestedMedia: null }), [])
  })

  it('never gives a video post a generated image', async () => {
    const { imageChosenFor } = await import('../src/lib/formats')
    assert.equal(
      imageChosenFor(
        { suggestedMedia: { imageFormats: ['facebook.reel'] } },
        'facebook.reel'
      ),
      false
    )
  })
})

describe('recorded video plan', () => {
  const post = {
    hook: 'Most month-end closes slip for one reason.',
    body: "It's the bank feed nobody owns. 🚀\n\nGive it one owner.\n\nTeams that do close sooner.",
    cta: 'Ask who owns yours.',
    hashtags: [],
    payload: {
      shots: [
        { show: 'hook', onScreenText: 'Why closes slip' },
        { show: 'cause', onScreenText: 'The bank feed' },
        { show: 'fix', onScreenText: 'Give it one owner.' },
        { show: 'result' },
        { show: 'ask', onScreenText: 'Who owns yours?' }
      ]
    }
  }

  it('puts the hook on the opening card, each line on a slide and the call to action on the closing card', async () => {
    const { planVideo } = await import('../src/lib/video/render/plan')
    const plan = planVideo({ post })
    assert.deepEqual(
      { title: plan.intro.title, subtitle: plan.intro.subtitle },
      {
        title: 'Why closes slip',
        subtitle: 'Most month-end closes slip for one reason.'
      }
    )
    assert.deepEqual(
      plan.scenes.map(s => [s.key, s.num, s.headline, s.caption]),
      [
        // The emoji is dropped: the server's browser has no emoji font.
        ['slide-1', '01', 'The bank feed', "It's the bank feed nobody owns."],
        // On-screen text that repeats the line shows once, with no caption.
        ['slide-2', '02', 'Give it one owner.', undefined],
        // No on-screen text: the line itself is the headline.
        ['slide-3', '03', 'Teams that do close sooner.', undefined]
      ]
    )
    assert.equal(plan.outro?.title, 'Who owns yours?')
    assert.equal(plan.outro?.subtitle, 'Ask who owns yours.')
  })

  it('ends on the last slide when there is no call to action, and plans a short video', async () => {
    const { planVideo, plannedSeconds } =
      await import('../src/lib/video/render/plan')
    const plan = planVideo({ post: { ...post, cta: '' } })
    assert.equal(plan.outro, null)
    assert.equal(plan.scenes.length, 3)
    const seconds = plannedSeconds(plan)
    assert.ok(seconds >= 10 && seconds <= 30, String(seconds))
    for (const scene of plan.scenes) {
      assert.ok(scene.holdMs >= 2600 && scene.holdMs <= 6000, scene.key)
    }
  })

  it('keeps a long script under a minute, with its last slide', async () => {
    const { planVideo, plannedSeconds } =
      await import('../src/lib/video/render/plan')
    const line =
      'This line is long enough that reading it takes the slide its longest time on screen'
    const plan = planVideo({
      post: {
        hook: 'A hook.',
        body: Array.from({ length: 12 }, (_, i) => `${line} ${i + 1}.`).join('\n\n'),
        cta: ''
      }
    })
    assert.equal(plan.scenes.length, 8)
    assert.match(plan.scenes[7]!.headline, / 12\.$/)
    assert.ok(plannedSeconds(plan) < 60, String(plannedSeconds(plan)))
  })

  it('cuts very long text at a word, and reads back only a plan it wrote', async () => {
    const { parsePlan, planVideo, screenText } =
      await import('../src/lib/video/render/plan')
    const cut = screenText('word '.repeat(100))
    assert.ok(cut.length <= 221 && cut.endsWith('word…'), cut)

    const plan = planVideo({ post })
    assert.deepEqual(parsePlan(JSON.stringify(plan)), plan)
    for (const stored of [
      'not json',
      '{}',
      JSON.stringify({ ...plan, version: 2 }),
      JSON.stringify({ ...plan, scenes: [{ key: 'Bad Key', num: '01', headline: 'x', holdMs: 3000 }] }),
      JSON.stringify({ ...plan, intro: { title: 'x', holdMs: 99_999 } })
    ]) {
      assert.throws(() => parsePlan(stored), /cannot be read/, stored)
    }
  })
})

describe('recorded video page', () => {
  it('makes cards dark enough for white text and slide marks that read on the background', async () => {
    const { contrastRatio } = await import('../src/lib/brand/theme')
    const { videoThemeFor } = await import('../src/lib/video/render/page')
    for (const primaryColor of [null, '#2563eb', '#fde047', '#ffffff', '#000000']) {
      const theme = videoThemeFor({
        primaryColor,
        accentColor: '#fde047',
        backgroundColor: null,
        footerText: null
      })
      assert.ok(contrastRatio(theme.card, theme.cardText) >= 7, `card ${primaryColor}`)
      assert.ok(contrastRatio(theme.cardAccent, theme.card) >= 3, `accent ${primaryColor}`)
      assert.ok(contrastRatio(theme.mark, theme.background) >= 3, `mark ${primaryColor}`)
      assert.match(theme.card, /^#[0-9a-f]{6}$/)
    }
  })

  it('never writes script or brand text into the page as markup', async () => {
    const { stageDocument, videoThemeFor } =
      await import('../src/lib/video/render/page')
    const hostile = '</style><script>alert(1)</script>'
    const theme = videoThemeFor({
      primaryColor: null,
      accentColor: null,
      backgroundColor: null,
      footerText: hostile
    })
    const { html, script } = stageDocument(theme)
    assert.ok(!html.includes('alert(1)'), 'the footer is set by script, as text')
    assert.ok(script.includes(JSON.stringify(hostile)))
    assert.match(script, /textContent/)
    assert.doesNotMatch(script, /innerHTML/)
  })

  it('embeds its typefaces, so the server fetches nothing while recording', async () => {
    const { stageDocument, videoThemeFor } =
      await import('../src/lib/video/render/page')
    const theme = videoThemeFor(
      { primaryColor: null, accentColor: null, backgroundColor: null, footerText: null },
      { heading: 'Inter', fonts: [{ family: 'Inter', weight: 800, data: new Uint8Array([1, 2, 3]) }] }
    )
    const { html } = stageDocument(theme)
    assert.match(html, /@font-face\{font-family:"Inter";font-weight:800;.*src:url\(data:font\/ttf;base64,AQID\)/)
    assert.doesNotMatch(html, /https?:\/\//)
  })
})

describe('the logo on a recorded video', () => {
  it('sits on a plate only where it would vanish: a dark logo on the cards, a light one on the slides', async () => {
    const { logoPlates, videoThemeFor } =
      await import('../src/lib/video/render/page')
    const brand = { primaryColor: '#0297b2', accentColor: null, backgroundColor: null, footerText: null }
    const withLogo = (logoTone: number | null) =>
      logoPlates(videoThemeFor(brand, { logo: 'data:image/png;base64,AA==', logoTone }))
    assert.deepEqual(withLogo(0.2), { card: '#ffffff', slide: null })
    const light = videoThemeFor(brand, { logo: 'data:image/png;base64,AA==', logoTone: 0.9 })
    assert.deepEqual(logoPlates(light), { card: null, slide: light.card })
    assert.deepEqual(withLogo(0.6), { card: null, slide: null })
    // Unknown tone: plated on the dark cards, where a dark logo would be lost.
    assert.deepEqual(withLogo(null), { card: '#ffffff', slide: null })
    assert.deepEqual(logoPlates(videoThemeFor(brand)), { card: null, slide: null })
  })
})
