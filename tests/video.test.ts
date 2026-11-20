import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { VIDEO_GENERATION_ENABLED } from '../src/lib/video/formats'

/** Tests of video drafting, run only while videos are switched on. */
const whileVideosOn = { skip: !VIDEO_GENERATION_ENABLED && 'video generation is switched off' }

/**
 * Short-form video: the formats and their platform specs, the cost shown
 * before generating, the prompt built from a script, and which ideas draft a
 * video. Pure: no database, no provider calls.
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
  it('are the three short-video platforms, vertical 9:16 at 1080×1920, one 8-second clip', async () => {
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
      assert.equal(spec.seconds, 8)
      assert.ok(spec.seconds <= spec.platformMaxSeconds, id)
    }
    assert.equal(
      describeVideoSpec(VIDEO_SPECS['facebook.reel']),
      '9:16 · 1080×1920 · 8 s · MP4'
    )
    assert.equal(VIDEO_SPECS['facebook.reel'].platformMaxSeconds, 90)
  })

  it('are scripts that fit the clip, never image posts, and never created another way', async () => {
    const { FORMATS, canHaveImage, isCreatableFormat } =
      await import('../src/lib/formats')
    const { VIDEO_FORMATS } = await import('../src/lib/video/formats')
    for (const id of VIDEO_FORMATS) {
      assert.equal(FORMATS[id].structure, 'script', id)
      assert.ok(FORMATS[id].limits.seconds!.max <= 8, id)
      assert.equal(canHaveImage(id), false, id)
      assert.equal(isCreatableFormat(id), false, id)
    }
    assert.equal(FORMATS['facebook.reel'].platform, 'facebook')
  })

  it('ask the writer for a few shots, not a filmed script', async () => {
    const { buildFormatPrompt } =
      await import('../src/lib/ai/skills/variant-drafting/prompt')
    const { goldenCases } = await import('./fixtures/generation')
    const prompt = buildFormatPrompt(goldenCases()[0]!.ctx, 'facebook.reel')
    assert.match(prompt, /PLATFORM: Facebook/)
    assert.match(prompt, /usually 1 to 3 shots/)
    assert.match(prompt, /about 6 seconds/)
    assert.match(prompt, /8-second clip/)
  })
})

describe('video cost', () => {
  it('estimates the default, Veo 3.1 Lite, at its per-second rate: $0.64 for 8 seconds at 1080p with audio', async () => {
    const { estimateVideoCostUsd, videoModelInfo } =
      await import('../src/lib/video/models')
    const model = videoModelInfo(undefined)!
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
    assert.equal(videoModelInfo('  ')?.id, 'google/veo-3.1-lite-generate-001')
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
