import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  cleanHashtags,
  itemFor,
  overLimit,
  plainText,
  tagsOutOfText,
  toDraft,
  withClosingQuestion
} from '../src/lib/ai/skills/media-post/guard'
import {
  buildFixPrompt,
  buildInstructions,
  buildPrompt,
  MEDIA_MESSAGE_RULES,
  MEDIA_TRUTH_RULES,
  MEDIA_WRITING_RULES
} from '../src/lib/ai/skills/media-post/prompt'
import type {
  MediaAnalysis,
  MediaPostItem
} from '../src/lib/ai/skills/media-post/schema'
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
import {
  findHolds,
  frameCountFor,
  frameTimes,
  motionBetween,
  parseFfmpegInfo,
  pickFrameTimes
} from '../src/lib/media-upload/inspect'
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
  angle: '',
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
      ['One', 'TwoWords']
    )
  })

  it('splits tags sent as one, joins words in CamelCase, and drops tags with no letter', () => {
    assert.deepStrictEqual(
      cleanHashtags(['#AI #SaaS', 'order tracking', 'ai', '#1', 'eCommerce, B2B'], 10),
      ['AI', 'SaaS', 'OrderTracking', 'eCommerce', 'B2B']
    )
    // Tags already written as tags, sent in one item with spaces, stay apart.
    assert.deepStrictEqual(
      cleanHashtags(['OrderTracking CustomerExperience', 'AI SaaS', 'Customer Experience'], 10),
      // "Customer Experience" is one tag, and the same one again.
      ['OrderTracking', 'CustomerExperience', 'AI', 'SaaS']
    )
  })

  it('takes hashtags written at the end of the text out, and spaces glued ones', () => {
    assert.deepStrictEqual(tagsOutOfText('Where do you land?\n\n#AI #SaaS'), {
      text: 'Where do you land?',
      tags: ['AI', 'SaaS']
    })
    assert.deepStrictEqual(tagsOutOfText('Great day. #Launch'), {
      text: 'Great day.',
      tags: ['Launch']
    })
    assert.deepStrictEqual(tagsOutOfText('Ask me?#AI#SaaS'), {
      text: 'Ask me?',
      tags: ['AI', 'SaaS']
    })
    // A tag a sentence ends on, or one inside it, is part of the sentence.
    assert.deepStrictEqual(tagsOutOfText('Proud of the team at #TDC'), {
      text: 'Proud of the team at #TDC',
      tags: []
    })
    assert.deepStrictEqual(tagsOutOfText('Built for #ecommerce teams.'), {
      text: 'Built for #ecommerce teams.',
      tags: []
    })
    assert.deepStrictEqual(tagsOutOfText("We're #1 here"), {
      text: "We're #1 here",
      tags: []
    })
  })

  it('moves a closing question at the end of the body into the call to action', () => {
    assert.deepStrictEqual(
      withClosingQuestion({ body: 'Point.\n\nWhere do you land?', cta: '' }),
      { body: 'Point.', cta: 'Where do you land?' }
    )
    const kept = { body: 'Point.\n\nWhere?', cta: 'Book a call.' }
    assert.strictEqual(withClosingQuestion(kept), kept)
    const single = { body: 'Is this a question?', cta: '' }
    assert.strictEqual(withClosingQuestion(single), single)
  })

  it('cleans what the model wrote into the text before the page shows it', () => {
    const post = toDraft(
      'linkedin',
      'linkedin.post',
      item({
        hook: 'Carrier sites send customers away.',
        body: 'Carrier sites send customers away. Your page keeps them.\n\nWhere do yours go?\n\n#OrderTracking #Ecommerce',
        cta: '',
        hashtags: ['CustomerExperience']
      }),
      { kind: 'video', voiceMaxHashtags: 5 }
    )
    assert.strictEqual(post.body, 'Your page keeps them.')
    assert.strictEqual(post.cta, 'Where do yours go?')
    assert.deepStrictEqual(post.hashtags, [
      'CustomerExperience',
      'OrderTracking',
      'Ecommerce'
    ])
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

  it('works out the message and every feature, checked, ranked and grouped, then tells it as a story', () => {
    const instructions = buildInstructions(ctx)
    assert.ok(instructions.includes(MEDIA_MESSAGE_RULES))
    assert.ok(instructions.includes(MEDIA_WRITING_RULES))
    assert.match(MEDIA_MESSAGE_RULES, /problem it addresses, who has that problem/)
    assert.match(MEDIA_MESSAGE_RULES, /every capability it demonstrates or names/)
    assert.match(MEDIA_MESSAGE_RULES, /a mobile or phone preview/)
    assert.match(MEDIA_MESSAGE_RULES, /scaffolding/)
    assert.match(MEDIA_MESSAGE_RULES, /A feature is a capability, not a control/)
    assert.match(MEDIA_MESSAGE_RULES, /give the numbers of the frames it can be seen in/)
    assert.match(MEDIA_MESSAGE_RULES, /Rank them: the one to three lead demonstrations/)
    assert.match(MEDIA_MESSAGE_RULES, /Group them by the outcome they serve/)
    assert.match(MEDIA_WRITING_RULES, /Tell it as a short story for the reader, not a feature list or a manual/)
    assert.match(MEDIA_WRITING_RULES, /Carry both the main message and what the media demonstrates, by priority/)
    assert.match(MEDIA_WRITING_RULES, /Never more than three things in one sentence/)
    assert.match(MEDIA_WRITING_RULES, /Turn features into benefits/)
    assert.match(MEDIA_WRITING_RULES, /One main message per post, said once/)
    assert.match(MEDIA_WRITING_RULES, /at most three lines/)
    assert.match(MEDIA_WRITING_RULES, /Never narrate it/)
    assert.match(MEDIA_WRITING_RULES, /never walk through it in order/)
    assert.match(MEDIA_TRUTH_RULES, /only when the analysis lists it with the frames it is in/)
    assert.match(MEDIA_TRUTH_RULES, /integrations, analytics, automation, AI, real-time updates/)
    assert.match(MEDIA_TRUTH_RULES, /how common, costly or important a problem or a moment is/)
    assert.match(MEDIA_TRUTH_RULES, /never tie it to the author's other offerings or industry/)
    // Every post ends on a question, not a generic one.
    assert.match(instructions, /CLOSING QUESTION\nEnd every post on one closing question, in cta/)
    // The goal's action is offered only where the media fits it.
    assert.match(instructions, /the question may steer toward/)
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
    assert.match(prompt, /where the picture holds still/)
    assert.match(prompt, /read them for its message .*never to retell them/)
    assert.match(prompt, /cannot hear/)
    assert.match(prompt, /ending with "message"/)
    assert.match(prompt, /write "angle" before the hook/)
    // The LinkedIn shape is LinkedIn's alone.
    assert.doesNotMatch(prompt, /Shape:/)
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

  it('gives a LinkedIn post a story shape and room for each group; shorter platforms the main message', () => {
    const prompt = buildPrompt(ctx, {
      media: { kind: 'video', width: 1920, height: 1080, durationSeconds: 65, hasAudio: true, frameTimes: [1.5] },
      targets: [
        { platform: 'linkedin', formatId: 'linkedin.post' },
        { platform: 'x', formatId: 'x.post' }
      ],
      notes: ''
    })
    assert.match(prompt, /Shape: the hook \(a moment or problem the reader knows/)
    assert.match(prompt, /two or three short paragraphs, one per group of what the media demonstrates, strongest first/)
    assert.match(prompt, /No closing line that sums the post up or says the main message again/)
    assert.match(prompt, /Coverage: the main message, and every lead and supporting feature in the analysis, by group/)
    assert.match(prompt, /Each supporting feature gets a clause or a short sentence inside its group's paragraph, never a paragraph or a bullet of its own; minor ones stay out/)
    assert.match(prompt, /up to about 1690 characters; it never gets there by listing more/)
    assert.match(prompt, /Coverage: the main message, made concrete by the lead demonstration \(two at most\)/)
    assert.match(prompt, /each with the frames it is in, its rank and its group/)
    assert.doesNotMatch(prompt, /moment worth watching for/)
    assert.match(prompt, /one per item in the hashtags field/)
  })

  it('sends a rewrite the description of the media, the notes and what to fix', () => {
    const analysis: MediaAnalysis = {
      summary: 'A walkthrough of a tracking page builder.',
      details: ['A tracking page with an In transit parcel'],
      visibleText: ['Carrier sites send customers away.'],
      mood: 'calm',
      uncertain: ['What the voice-over says'],
      message: {
        kind: 'product',
        subject: 'Track360 tracking pages',
        problem: 'Carrier sites send customers away.',
        audience: 'Online store owners',
        value: 'Customers track orders without leaving the store.',
        features: [
          {
            name: 'Mobile preview',
            frames: [6, 7, 9],
            shown: 'Caption "Check it on mobile before you publish." over a phone-width page',
            benefit: 'Check the page on a phone before it goes live',
            priority: 'supporting',
            group: 'Nothing goes live unchecked',
            terms: ['mobile', 'phone']
          },
          {
            name: 'Brand styling',
            frames: [4],
            shown: 'Logo, colour and font controls',
            benefit: 'The page looks like the store',
            priority: 'lead',
            group: 'Looks like your own store',
            terms: ['brand']
          }
        ],
        scaffolding: ['Northwind Outfitters']
      }
    }
    const prompt = buildFixPrompt(
      ctx,
      { kind: 'video', analysis, notes: 'Our launch video' },
      [draft({ hook: 'First, set the brand.', body: 'Then add offers.' })],
      [['It walks through the video step by step.']]
    )
    assert.match(prompt, /THE VIDEO, AS DESCRIBED WHEN IT WAS LOOKED AT/)
    assert.match(prompt, /Problem it addresses: Carrier sites send customers away\./)
    assert.match(
      prompt,
      /What it demonstrates, by the outcome for the audience, strongest first \(only these are capabilities of the product\):\n- Looks like your own store:\n  - Brand styling \[lead; frame 4\]: The page looks like the store\. Shown: Logo, colour and font controls\.\n- Nothing goes live unchecked:\n  - Mobile preview \[supporting; frames 6-7, 9\]: Check the page on a phone before it goes live\. Shown: Caption "Check it on mobile before you publish\." over a phone-width page\./
    )
    assert.match(prompt, /Demo scaffolding \(never name these\):\n- Northwind Outfitters/)
    assert.match(prompt, /Our launch video/)
    assert.match(prompt, /Problems to fix:\n- It walks through the video step by step\./)
    assert.match(prompt, /"hook":"First, set the brand\."/)
    assert.match(prompt, /PLATFORM: linkedin/)
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

  it('shows a longer video more frames, up to sixteen', () => {
    assert.strictEqual(frameCountFor(30), 8)
    assert.strictEqual(frameCountFor(45), 12)
    assert.strictEqual(frameCountFor(65), 16)
    assert.strictEqual(frameCountFor(600), 16)
    assert.strictEqual(frameCountFor(null), 1)
  })

  it('measures how much each grey sample differs from the one before', () => {
    const gray = new Uint8Array([0, 0, 0, 0, 4, 4, 0, 0, 4, 4, 0, 0])
    assert.deepStrictEqual(motionBetween(gray, 4), [2, 0])
  })

  it('finds where the picture holds still for half a second or more', () => {
    // Four samples a second: still at samples 2-3 and 6-7, moving after.
    const motion = [5, 0, 0, 0, 5, 0, 0, 0, 9]
    assert.deepStrictEqual(findHolds(motion, 4), [
      { start: 0.5, end: 0.75 },
      { start: 1.5, end: 1.75 }
    ])
    assert.deepStrictEqual(findHolds([9, 9, 9], 4), [])
  })

  it("keeps a video's opening cards and end card, and a held moment in each part between", () => {
    // Where a 65-second launch video held still (measured on the real file):
    // "Carrier sites send customers away.", "Your page keeps them.", the
    // logo, then caption cards over screens, then the end card.
    const holds = [
      [1.25, 1.75], [2.75, 3.5], [4.5, 6.25], [8.25, 8.75], [11.25, 12.5],
      [14.75, 15.75], [21, 22.75], [24.25, 27], [29.75, 31.5], [33.25, 35],
      [38, 39.5], [41.25, 42.5], [43.75, 44.5], [49.25, 50.5], [52.5, 53.25],
      [56.25, 57.75], [59.5, 64.5]
    ].map(([start, end]) => ({ start: start!, end: end! }))
    const times = pickFrameTimes(65, holds, 12)
    assert.strictEqual(times.length, 12)
    assert.deepStrictEqual(times.slice(0, 3), [1.5, 3.13, 5.38])
    assert.strictEqual(times[times.length - 1], 62)
    assert.deepStrictEqual([...times].sort((a, b) => a - b), times)
    // Every frame is inside a hold: nothing caught mid-transition.
    for (const t of times) {
      assert.ok(holds.some(h => t >= h.start && t <= h.end), `${t} is in a hold`)
    }
    // Even frames missed both opening cards.
    assert.ok(frameTimes(65, 12).every(t => t > 2.5))
  })

  it('keeps a short card between two longer screens, dropping the most crowded moments', () => {
    // The same video's holds as the bundled ffmpeg reads them: nine caption
    // cards, each over one to three holds. The longest hold in each equal
    // part lost "Your own address, your own page." (46.75-47) to the
    // preview screen before it.
    const holds = [
      [1.25, 1.75], [2.5, 3.25], [4.5, 6], [8.25, 8.5], [11.25, 12.25],
      [14.75, 15.5], [20, 20.25], [21, 22.5], [24.25, 26.75], [29.75, 31.25],
      [33.25, 34.75], [38, 39.25], [41.25, 42.25], [43.75, 44.25], [46.75, 47],
      [49.25, 50.25], [52.5, 53], [56.25, 57.5], [59.5, 60], [61, 64.25]
    ].map(([start, end]) => ({ start: start!, end: end! }))
    const times = pickFrameTimes(65, holds, 16)
    assert.deepStrictEqual(times, [
      1.5, 2.88, 5.25, 8.38, 11.75, 15.13, 20.13, 25.5, 30.5, 34, 38.63, 41.75,
      46.88, 52.75, 56.88, 62.63
    ])
  })

  it('takes frames across a long stretch of motion between holds', () => {
    // A card, 40 seconds of a demonstration in motion, an end card.
    const holds = [
      { start: 1, end: 3 },
      { start: 55, end: 58 }
    ]
    const times = pickFrameTimes(60, holds, 8)
    assert.strictEqual(times.length, 8)
    assert.strictEqual(times[0], 2)
    assert.strictEqual(times[times.length - 1], 56.5)
    const inMotion = times.filter(t => t > 3 && t < 55)
    assert.strictEqual(inMotion.length, 6)
    // Spread across it, none more than twice an even spacing apart.
    const all = [2, ...inMotion, 56.5]
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i]! - all[i - 1]! <= 15, `${all[i - 1]} to ${all[i]}`)
    }
  })

  it('frames a video that never holds still evenly, and a short clip by its seconds', () => {
    assert.deepStrictEqual(pickFrameTimes(80, [], 8), frameTimes(80, 8))
    assert.deepStrictEqual(pickFrameTimes(3, [{ start: 0.5, end: 1 }], 8), [0.75, 1.67, 2.58])
  })
})
