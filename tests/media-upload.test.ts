import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  cleanHashtags,
  itemFor,
  overLimit,
  plainText,
  toDraft
} from '../src/lib/ai/skills/media-post/guard'
import {
  buildInstructions,
  buildPrompt,
  MEDIA_TRUTH_RULES
} from '../src/lib/ai/skills/media-post/prompt'
import type { MediaPostItem } from '../src/lib/ai/skills/media-post/schema'
import {
  resolveMediaFormat,
  takesUploadedVideo,
  validatePost
} from '../src/lib/formats'
import {
  captionOf,
  draftColumnsOf,
  mediaPostProblem,
  type MediaPostDraft
} from '../src/lib/media-upload/drafts'
import { frameTimes, parseFfmpegInfo } from '../src/lib/media-upload/inspect'
import {
  aspectRatioOf,
  UPLOAD_MAX_BYTES,
  uploadedMediaOf,
  uploadFormatOf,
  uploadPlatforms,
  uploadTypeByExtension,
  uploadTypeOf,
  validateUploadFile,
  videoWarning
} from '../src/lib/media-upload/rules'
import { goldenCases } from './fixtures/generation'

const item = (overrides: Partial<MediaPostItem> = {}): MediaPostItem => ({
  platform: 'linkedin',
  hook: 'A hook',
  body: 'A body',
  cta: 'A question?',
  hashtags: [],
  firstComment: '',
  title: '',
  altText: '',
  mediaDetails: [],
  ...overrides
})

const draft = (overrides: Partial<MediaPostDraft> = {}): MediaPostDraft => ({
  platform: 'linkedin',
  formatId: 'linkedin.post',
  hook: 'Hook',
  body: 'Body',
  cta: '',
  hashtags: [],
  firstComment: '',
  title: '',
  altText: '',
  ...overrides
})

describe('upload rules', () => {
  it('takes the image and video types every network accepts, and nothing else', () => {
    assert.deepStrictEqual(uploadTypeOf('image/jpeg'), {
      kind: 'image',
      mediaType: 'image/jpeg',
      extension: 'jpg'
    })
    assert.strictEqual(uploadTypeOf('VIDEO/MP4')?.kind, 'video')
    assert.strictEqual(uploadTypeOf('video/quicktime')?.extension, 'mov')
    assert.strictEqual(uploadTypeOf('image/gif'), null)
    assert.strictEqual(uploadTypeOf('image/heic'), null)
    assert.strictEqual(
      uploadTypeByExtension('mov')?.mediaType,
      'video/quicktime'
    )
    assert.strictEqual(uploadTypeByExtension('exe'), null)
  })

  it('refuses empty, oversized and unknown files with a reason', () => {
    assert.strictEqual(
      validateUploadFile({ type: 'image/png', size: 1000 }),
      null
    )
    assert.match(validateUploadFile({ type: 'image/png', size: 0 })!, /empty/)
    assert.match(
      validateUploadFile({
        type: 'image/png',
        size: UPLOAD_MAX_BYTES.image + 1
      })!,
      /Images must be under 10 MB/
    )
    assert.strictEqual(
      validateUploadFile({
        type: 'video/mp4',
        size: UPLOAD_MAX_BYTES.image + 1
      }),
      null
    )
    assert.match(
      validateUploadFile({ type: 'application/pdf', size: 10 })!,
      /application\/pdf/
    )
  })

  it('posts images on the image platforms and videos everywhere, YouTube as a Short', () => {
    assert.ok(!uploadPlatforms('image').includes('youtube'))
    assert.ok(uploadPlatforms('video').includes('youtube'))
    assert.strictEqual(uploadFormatOf('video', 'youtube'), 'youtube.short')
    assert.strictEqual(
      uploadFormatOf('video', 'instagram'),
      'instagram.caption'
    )
    assert.strictEqual(uploadFormatOf('image', 'youtube'), null)
  })

  it('warns when a video does not suit a platform', () => {
    const long = { durationSeconds: 200, width: 1080, height: 1920 }
    assert.match(videoWarning('x', long)!, /Longer than/)
    assert.match(videoWarning('youtube', long)!, /3 minutes/)
    assert.strictEqual(videoWarning('instagram', long), null)
    assert.match(
      videoWarning('youtube', {
        durationSeconds: 30,
        width: 1920,
        height: 1080
      })!,
      /landscape/
    )
    assert.strictEqual(
      videoWarning('linkedin', {
        durationSeconds: null,
        width: null,
        height: null
      }),
      null
    )
  })

  it('reads the upload a post was made from out of its payload', () => {
    assert.deepStrictEqual(
      uploadedMediaOf({
        upload: { kind: 'video', fileName: 'a.mp4', summary: 'A dog' }
      }),
      { kind: 'video', fileName: 'a.mp4', summary: 'A dog' }
    )
    assert.strictEqual(uploadedMediaOf({ upload: { kind: 'gif' } }), null)
    assert.strictEqual(uploadedMediaOf(null), null)
  })

  it('names a video shape in ten characters or fewer', () => {
    assert.strictEqual(aspectRatioOf(1080, 1920), '9:16')
    assert.strictEqual(aspectRatioOf(1280, 720), '16:9')
    assert.ok(aspectRatioOf(1081, 1919).length <= 10)
  })
})

describe('uploaded video on single-post formats', () => {
  it('goes out as a video only on formats that take one, and only when stored as one', () => {
    assert.ok(takesUploadedVideo('linkedin.post'))
    assert.ok(!takesUploadedVideo('x.thread'))
    assert.strictEqual(
      resolveMediaFormat('linkedin.post', 'video', { image: false }),
      'video'
    )
    assert.strictEqual(
      resolveMediaFormat('instagram.caption', 'video', { image: false }),
      'video'
    )
    assert.strictEqual(
      resolveMediaFormat('x.thread', 'video', { image: false }),
      'text'
    )
    // Unchanged for everything else.
    assert.strictEqual(
      resolveMediaFormat('linkedin.post', null, { image: true }),
      'image'
    )
    assert.strictEqual(
      resolveMediaFormat('youtube.short', null, { image: false }),
      'video'
    )
  })

  it('tells the reviewer the post goes out with the uploaded video, not a script to film', () => {
    const checks = validatePost({
      formatId: 'linkedin.post',
      mediaFormat: 'video',
      post: {
        hook: 'A hook',
        body: 'Body',
        payload: { upload: { kind: 'video' } }
      },
      image: { present: false },
      slides: []
    })
    const media = checks.find(c => c.id === 'media')
    assert.match(media!.message, /video you uploaded/)
  })
})

describe('posts from uploaded media', () => {
  it('stores a Short as its caption and title, with no script', () => {
    const columns = draftColumnsOf(
      draft({
        platform: 'youtube',
        formatId: 'youtube.short',
        hook: 'Watch this',
        body: 'The rest',
        cta: 'Subscribe',
        title: 'T'.repeat(150),
        hashtags: ['#shorts', 'shorts', 'how to']
      })
    )
    assert.strictEqual(columns.hook, '')
    assert.strictEqual(columns.body, '')
    assert.strictEqual(
      columns.payload.caption,
      'Watch this\n\nThe rest\n\nSubscribe'
    )
    assert.strictEqual((columns.payload.title as string).length, 100)
    assert.deepStrictEqual(columns.hashtags, ['shorts', 'howto'])
  })

  it('keeps the text columns for every other platform', () => {
    const columns = draftColumnsOf(
      draft({ cta: '  ', firstComment: ' https://x.y ' })
    )
    assert.strictEqual(columns.hook, 'Hook')
    assert.strictEqual(columns.cta, null)
    assert.strictEqual(columns.firstComment, 'https://x.y')
    assert.deepStrictEqual(columns.payload, {})
  })

  it('refuses an empty post, a Short without a title, and a post over its limit', () => {
    assert.match(mediaPostProblem(draft({ hook: '', body: '' }))!, /caption/)
    assert.match(
      mediaPostProblem(
        draft({ platform: 'youtube', formatId: 'youtube.short' })
      )!,
      /title/
    )
    const longX = draft({
      platform: 'x',
      formatId: 'x.post',
      body: 'word '.repeat(80)
    })
    assert.match(mediaPostProblem(longX)!, /280/)
    assert.deepStrictEqual(overLimit([longX, draft()]), [longX])
    assert.strictEqual(mediaPostProblem(draft()), null)
    assert.strictEqual(captionOf({ hook: ' a ', body: '', cta: 'b' }), 'a\n\nb')
  })
})

describe('media-post guard', () => {
  it('cleans hashtags and caps them at the platform maximum', () => {
    assert.deepStrictEqual(
      cleanHashtags(['#One', 'one', 'two words', '', '#3'], 2),
      ['One', 'twowords']
    )
  })

  it('takes markdown out and keeps paragraphs', () => {
    assert.strictEqual(
      plainText('## Title\n**Bold** text  \n\n\n\nNext'),
      'Title\nBold text\n\nNext'
    )
  })

  it('holds each post to its platform: no links on Instagram, a title only on a Short', () => {
    const insta = toDraft(
      'instagram',
      'instagram.caption',
      item({
        platform: 'instagram',
        body: 'See https://example.com/x for more',
        hashtags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        title: 'ignored',
        altText: 'A red bike'
      }),
      { kind: 'image', voiceMaxHashtags: 3 }
    )
    assert.ok(!insta.body.includes('http'))
    assert.strictEqual(insta.hashtags.length, 5)
    assert.strictEqual(insta.title, '')
    assert.strictEqual(insta.altText, 'A red bike')

    const short = toDraft(
      'youtube',
      'youtube.short',
      item({ title: 'How we pack', altText: 'x' }),
      {
        kind: 'video',
        voiceMaxHashtags: 3
      }
    )
    assert.strictEqual(short.title, 'How we pack')
    assert.strictEqual(short.altText, '')

    const missing = toDraft('x', 'x.post', undefined, {
      kind: 'image',
      voiceMaxHashtags: 3
    })
    assert.strictEqual(missing.hook, '')
  })

  it("matches the model's post to its platform by id", () => {
    const posts = [
      item({ platform: ' LinkedIn ' }),
      item({ platform: 'x', hook: 'X hook' })
    ]
    assert.strictEqual(itemFor(posts, 'x')?.hook, 'X hook')
    assert.ok(itemFor(posts, 'linkedin'))
    assert.strictEqual(itemFor(posts, 'threads'), undefined)
  })
})

describe('media-post prompt', () => {
  const { ctx } = goldenCases()[0]!

  it("writes in the author's voice and holds every post to what the media shows", () => {
    const instructions = buildInstructions(ctx)
    assert.ok(instructions.includes(ctx.account.name))
    assert.ok(instructions.includes(MEDIA_TRUTH_RULES))
  })

  it("describes a video's frames, its unheard sound and each platform's rules", () => {
    const prompt = buildPrompt(ctx, {
      media: {
        kind: 'video',
        width: 1080,
        height: 1920,
        durationSeconds: 75,
        hasAudio: true,
        frameTimes: [4.7, 65]
      },
      targets: [
        { platform: 'x', formatId: 'x.post' },
        { platform: 'youtube', formatId: 'youtube.short' }
      ],
      notes: 'Our new warehouse in Leeds'
    })
    assert.match(prompt, /1080x1920, 1:15 long/)
    assert.match(prompt, /frame 1 at 0:04, frame 2 at 1:05/)
    assert.match(prompt, /cannot hear/)
    assert.match(prompt, /Our new warehouse in Leeds/)
    assert.match(prompt, /PLATFORM: x \(X post, posted with the video\)/)
    assert.match(prompt, /under 280 characters as X counts them/)
    assert.match(prompt, /title: what the viewer gets/)
    // A Short's script rules are not for an uploaded video.
    assert.doesNotMatch(prompt, /records as a text video/)
  })

  it('says an image post goes with the image, and asks for alt text', () => {
    const prompt = buildPrompt(ctx, {
      media: { kind: 'image', width: 1200, height: 900 },
      targets: [{ platform: 'instagram', formatId: 'instagram.caption' }],
      notes: ''
    })
    assert.match(prompt, /The image is attached \(1200x900\)/)
    assert.match(prompt, /Never write a URL/)
    assert.doesNotMatch(prompt, /visualIdea/)
    assert.match(prompt, /altText: what the image shows/)
  })
})

describe('reading an uploaded video', () => {
  it("reads length, size and sound from ffmpeg's description, upright", () => {
    const stderr = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 8000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 7800 kb/s, 30 fps
      Side data:
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo`
    assert.deepStrictEqual(parseFfmpegInfo(stderr), {
      durationSeconds: 62.5,
      width: 1080,
      height: 1920,
      hasAudio: true
    })
    assert.deepStrictEqual(
      parseFfmpegInfo(
        '  Duration: N/A\n  Stream #0:0: Video: vp9, yuv420p, 640x360, 25 fps'
      ),
      { durationSeconds: null, width: 640, height: 360, hasAudio: false }
    )
  })

  it('takes frames from the middle of equal parts, fewer for a very short clip', () => {
    assert.deepStrictEqual(frameTimes(80, 8), [5, 15, 25, 35, 45, 55, 65, 75])
    assert.deepStrictEqual(frameTimes(2, 8), [0.5, 1.5])
    assert.deepStrictEqual(frameTimes(null), [0])
  })
})
