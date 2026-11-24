import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  buildSlidePrompt,
  buildSlidesInstructions
} from '../src/lib/ai/skills/carousel-slides/prompt'
import { cleanLookSeries } from '../src/lib/ai/skills/look-series'
import { buildPrompt as buildSeriesPrompt } from '../src/lib/ai/skills/look-series/prompt'
import type { LookSeries } from '../src/lib/ai/skills/look-series/schema'
import {
  carouselReviewText,
  slideLookDesign,
  slideTextParts
} from '../src/lib/carousel/look'
import {
  slideContentOf,
  slideLookOf,
  slideRowValues,
  type SlideLook
} from '../src/lib/carousel/rows'
import {
  cleanDesign,
  lookDesign,
  type SlideContent
} from '../src/lib/carousel/types'
import { buildLookPrompt, seriesLines } from '../src/lib/media/learned-look'
import { SLIDE_SIZE } from '../src/lib/media/carousel/render'
import { renderInsightsForSlides } from '../src/lib/profile-insights/render'
import { goldenCases } from './fixtures/generation'

const look: SlideLook = {
  kind: 'graphic',
  styleNotes: 'Flat red background, large white lowercase type, wordmark bottom left.',
  examples: [1, 3],
  logoCorner: 'bottom-left',
  wordmark: true,
  scene: 'The main line large in the upper half, the smaller line under it.',
  concept: 'Your first dish was a lopsided omelette.'
}

const slide = (over: Partial<SlideContent> = {}): SlideContent => ({
  role: 'content',
  headline: 'your first dish was a lopsided omelette',
  body: 'slightly burnt, with a little shell in it.',
  imagePrompt: 'a small line drawing of a fried egg beside the words',
  design: lookDesign('content'),
  altText: 'Your first dish was a lopsided omelette.',
  ...over
})

describe('slides made like the account’s posts', () => {
  it('sets exactly the slide’s words, with the wordmark only when asked', () => {
    assert.deepStrictEqual(slideTextParts(slide(), null), [
      { part: 'main line', text: 'your first dish was a lopsided omelette' },
      { part: 'smaller line', text: 'slightly burnt, with a little shell in it.' }
    ])
    // A list body: one part per line.
    assert.deepStrictEqual(
      slideTextParts(slide({ body: 'pickle was currency\n\n no contracts ' }), 'Zomato'),
      [
        { part: 'main line', text: 'your first dish was a lopsided omelette' },
        { part: 'line 1', text: 'pickle was currency' },
        { part: 'line 2', text: 'no contracts' },
        { part: 'wordmark', text: 'Zomato' }
      ]
    )
    assert.strictEqual(slideTextParts(slide({ body: '' }), null).length, 1)
  })

  it('makes each slide from the set’s look, its scene and its words', () => {
    const design = slideLookDesign(look, slide(), {
      accountName: 'Zomato',
      logoFile: false
    })
    assert.strictEqual(design.styleNotes, look.styleNotes)
    assert.deepStrictEqual(design.examples, [1, 3])
    assert.strictEqual(design.scene, look.scene)
    assert.deepStrictEqual(design.text.at(-1), { part: 'wordmark', text: 'Zomato' })
    // The real logo goes on afterwards: no wordmark drawn.
    const withLogo = slideLookDesign(look, slide(), {
      accountName: 'Zomato',
      logoFile: true
    })
    assert.ok(!withLogo.text.some(t => t.part === 'wordmark'))
    // A slide added later has no scene of its own: the writer's idea stands in.
    const added = slideLookDesign({ ...look, scene: '' }, slide(), {
      accountName: 'Zomato',
      logoFile: false
    })
    assert.strictEqual(added.scene, slide().imagePrompt)
    const bare = slideLookDesign({ ...look, scene: '' }, slide({ imagePrompt: '' }), {
      accountName: 'Zomato',
      logoFile: false
    })
    assert.match(bare.scene, /Only the words/)
  })

  it('checks a slide against the caption and every slide, not the caption alone', () => {
    const text = carouselReviewText('THE CAPTION', [
      slide({ headline: 'cover words', body: '' }),
      slide({ headline: 'Even the Indian Express noticed', body: 'line a\nline b' })
    ])
    assert.match(text, /^THE CAPTION/)
    assert.match(text, /2\. Even the Indian Express noticed — line a \/ line b/)
  })

  it('keeps a slide one set: the cover attached first, no numbers or arrows', () => {
    const prompt = buildLookPrompt({
      design: slideLookDesign(look, slide(), { accountName: 'Zomato', logoFile: false }),
      platformName: 'Instagram',
      target: SLIDE_SIZE,
      exampleCount: 2,
      series: { position: 3, total: 7, anchor: 'cover' }
    })
    assert.match(prompt, /^This image is slide 3 of 7 of one Instagram carousel\. The first attached image is its cover/)
    assert.match(prompt, /in the style of the 2 other images, posts from this account, attached after it/)
    assert.match(prompt, /Do not number the slide, and draw no arrows/)
    assert.match(prompt, /main line: "your first dish was a lopsided omelette"/)

    const one = buildLookPrompt({
      design: slideLookDesign(look, slide(), { accountName: 'Zomato', logoFile: false }),
      platformName: 'Instagram',
      target: SLIDE_SIZE,
      exampleCount: 1,
      series: { position: 3, total: 7, anchor: 'cover' }
    })
    assert.match(one, /in the style of the second image, a post from this account/)

    assert.match(
      seriesLines({ position: 1, total: 7, anchor: null }, 'Instagram'),
      /the cover, slide 1 of 7,.*The other slides will be made to match it/
    )
    assert.match(
      seriesLines({ position: 4, total: 7, anchor: 'self' }, 'Instagram'),
      /this slide as it is now: make it again with the same design/
    )
    assert.match(
      seriesLines({ position: 1, total: 7, anchor: 'slide' }, 'Instagram'),
      /another of its slides/
    )
    // The last slide points to nothing.
    assert.match(
      seriesLines({ position: 7, total: 7, anchor: 'cover' }, 'Instagram'),
      /it is the last slide, so nothing on it points to another\.$/
    )
    assert.ok(!/last slide/.test(seriesLines({ position: 6, total: 7, anchor: 'cover' }, 'Instagram')))
  })

  it('leaves a single image’s prompt as it was', () => {
    const prompt = buildLookPrompt({
      design: slideLookDesign(look, slide(), { accountName: 'Zomato', logoFile: false }),
      platformName: 'Instagram',
      target: SLIDE_SIZE,
      exampleCount: 2
    })
    assert.match(prompt, /^Create a new Instagram post image in the style of the 2 attached images, posts from this account, so/)
    assert.ok(!/carousel/.test(prompt))
  })

  it('stores a slide’s look so it can be made again alone', () => {
    const values = slideRowValues('draft', 2, slide(), {
      imageUrl: 'storage://x.png',
      pictureUrl: null,
      error: null,
      issues: [],
      look
    })
    assert.deepStrictEqual(values.design, lookDesign('content'))
    const row = { ...values, id: 'id', createdAt: new Date(), updatedAt: new Date() } as never
    assert.deepStrictEqual(slideLookOf(row), look)
    assert.strictEqual(slideContentOf(row).design.look, true)
    assert.strictEqual(slideLookOf({ metadata: { look: { styleNotes: ' ' } } } as never), null)
    assert.strictEqual(slideLookOf({ metadata: {} } as never), null)
    assert.deepStrictEqual(
      slideLookOf({ metadata: { look: { ...look, examples: [0, 2, 'x'], logoCorner: 'middle' } } } as never),
      { ...look, examples: [2], logoCorner: 'none' }
    )
  })

  it('has no layout, icon, figure or picture of its own', () => {
    assert.deepStrictEqual(
      cleanDesign('content', { look: true, layout: 'icon', icon: 'target', picture: true }),
      lookDesign('content')
    )
    assert.strictEqual(lookDesign('cover').layout, 'cover')
    assert.strictEqual(lookDesign('cta').layout, 'cta')
    assert.strictEqual(cleanDesign('content', { layout: 'icon', icon: 'target' }).look, undefined)
  })
})

describe('the slide writer for slides made like the posts', () => {
  const { ctx, idea } = goldenCases()[0]!

  it('writes words the way the posts carry them, with no drawn layouts', () => {
    const drawn = buildSlidesInstructions(ctx, 'photorealistic')
    const like = buildSlidesInstructions(ctx, 'photorealistic', true)
    assert.match(drawn, /LAYOUTS FOR CONTENT SLIDES/)
    assert.match(drawn, /the design adds the slide number/)
    assert.ok(!like.includes('LAYOUTS FOR CONTENT SLIDES'))
    assert.ok(!like.includes('the design adds the slide number'))
    assert.match(like, /HOW THE SLIDES LOOK/)
    assert.match(like, /at most one short line under it, at most 15 words/)
    assert.match(like, /statement for every other/)
  })

  it('rewrites a slide as a statement', () => {
    const slides = (['cover', 'content', 'cta'] as const).map(role =>
      slide({ role, design: lookDesign(role) })
    )
    const prompt = buildSlidePrompt(ctx, idea as never, 'instagram.caption', 'Caption', slides, 1, null, true)
    assert.match(prompt, /its layout is statement\./)
  })

  it('tells it the slides are made in the learned look, not the brand’s colours', () => {
    const insights = {
      tone: 'Dry and witty.',
      writingStyle: 'Lowercase one-liners.',
      visualIdentity: 'Flat red cards with white lowercase type.'
    } as never
    const drawn = renderInsightsForSlides(insights, 'instagram')
    const like = renderInsightsForSlides(insights, 'instagram', true)
    assert.match(drawn, /the slides' colours and fonts are the brand's/)
    assert.match(like, /every slide is made in this look/)
    assert.ok(!like.includes("the slides' colours and fonts are the brand's"))
  })
})

describe('the design of a whole carousel', () => {
  const series: LookSeries = {
    examples: [9, 2, 2],
    kind: 'graphic',
    styleNotes: '  Red cards.  ',
    wordmark: true,
    logoCorner: 'bottom-left',
    slides: [{ scene: ' The words  large. ', concept: 'Cover.' }]
  }

  it('keeps examples that exist and one entry per slide', () => {
    const cleaned = cleanLookSeries(series, 3, 3)!
    assert.deepStrictEqual(cleaned.examples, [2])
    assert.strictEqual(cleaned.styleNotes, 'Red cards.')
    assert.deepStrictEqual(cleaned.slides, [
      { scene: 'The words large.', concept: 'Cover.' },
      { scene: '', concept: '' },
      { scene: '', concept: '' }
    ])
    assert.deepStrictEqual(cleanLookSeries({ ...series, examples: [] }, 3, 1)!.examples, [1])
    assert.strictEqual(cleanLookSeries({ ...series, styleNotes: ' ' }, 3, 1), null)
  })

  it('shows the art director every slide’s words and the wordmark rule', () => {
    const input = {
      caption: 'THE CAPTION',
      slides: [
        { role: 'cover' as const, headline: 'everybody’s from the village', body: 'menu edition.', idea: 'noodles and brunch' },
        { role: 'cta' as const, headline: 'your shanaya needs to see this', body: '', idea: '' }
      ],
      platform: { name: 'Instagram', shape: 'a portrait 4:5' },
      context: { accountName: 'Zomato', accountContext: 'A food delivery app.' } as never,
      examples: [
        { data: new Uint8Array(), mediaType: 'image/jpeg', platformName: 'Instagram', samePlatform: true, uploaded: false, aspect: '4:5' }
      ],
      logoFile: false
    }
    const prompt = buildSeriesPrompt(input)
    assert.match(prompt, /1\. cover: "everybody’s from the village" \/ "menu edition\."/)
    assert.match(prompt, /The writer pictured: noodles and brunch/)
    assert.match(prompt, /2\. last slide: "your shanaya needs to see this"/)
    assert.match(prompt, /set wordmark to true: code adds it to every slide as "Zomato"/)
    assert.match(buildSeriesPrompt({ ...input, logoFile: true }), /real logo is laid on by code afterwards/)
  })
})
