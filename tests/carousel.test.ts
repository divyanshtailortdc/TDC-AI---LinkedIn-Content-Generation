import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  carouselIssues,
  toCarousel,
  toSlide
} from '../src/lib/ai/skills/carousel-slides/guard'
import {
  buildSlidePrompt,
  buildSlidesInstructions,
  buildSlidesPrompt
} from '../src/lib/ai/skills/carousel-slides/prompt'
import * as linkedInPrompt from '../src/lib/ai/skills/post-drafting/prompt'
import { buildFormatPrompt } from '../src/lib/ai/skills/variant-drafting/prompt'
import {
  captionOnSlides,
  cleanSlideText,
  figureIsSourced
} from '../src/lib/carousel/checks'
import {
  cleanDesign,
  MAX_DRAFT_PICTURES,
  type SlideContent
} from '../src/lib/carousel/types'
import {
  carouselWording,
  CREATABLE_FORMATS,
  FORMAT_IDS,
  FORMATS,
  mediaFormatsOf,
  plannedMediaFormat,
  resolveMediaFormat,
  slideCountRange,
  validatePost,
  type FormatId,
  type PublishCheck
} from '../src/lib/formats'
import { runLinter } from '../src/lib/lint/run-linter'
import { goldenCases } from './fixtures/generation'

/**
 * Platform post types (text only, a single image, a carousel, a video) and
 * carousels: what each format takes, how a carousel is planned and detected,
 * the slide writer's guard and prompts, and the checks before publishing.
 */

const ids = (checks: PublishCheck[], level?: PublishCheck['level']) =>
  checks.filter(c => !level || c.level === level).map(c => c.id)

describe('post types per format', () => {
  it('every format names what can go out with it, its default first', () => {
    for (const id of FORMAT_IDS) {
      const formats = mediaFormatsOf(id)
      assert.ok(formats.length > 0, id)
      // A carousel spec exactly where the format takes a carousel.
      assert.strictEqual(
        formats.includes('carousel'),
        Boolean(FORMATS[id].media.carousel),
        id
      )
      // A script is a video and nothing else.
      assert.strictEqual(
        FORMATS[id].structure === 'script',
        formats.includes('video'),
        id
      )
    }
  })

  it('offers carousels on LinkedIn (a document), Instagram and Facebook (images), never on X or Threads', () => {
    assert.strictEqual(
      FORMATS['linkedin.post'].media.carousel?.delivery,
      'document'
    )
    assert.strictEqual(
      FORMATS['instagram.caption'].media.carousel?.delivery,
      'images'
    )
    assert.strictEqual(
      FORMATS['facebook.post'].media.carousel?.delivery,
      'images'
    )
    for (const id of ['x.post', 'x.thread', 'threads.post'] as FormatId[]) {
      assert.ok(!mediaFormatsOf(id).includes('carousel'), id)
    }
  })

  it('Instagram takes no text-only post; no format offered is a video script', () => {
    assert.deepStrictEqual(
      [...mediaFormatsOf('instagram.caption')],
      ['image', 'carousel']
    )
    assert.ok(!CREATABLE_FORMATS.includes('instagram.reel'))
    assert.ok(!CREATABLE_FORMATS.includes('youtube.short'))
    assert.ok(CREATABLE_FORMATS.every(id => !mediaFormatsOf(id).includes('video')))
  })

  it('keeps every existing post as it was: its image if it has one, else text only', () => {
    // Posts from before post types have no stored choice.
    assert.strictEqual(
      resolveMediaFormat('linkedin.post', null, { image: true }),
      'image'
    )
    assert.strictEqual(
      resolveMediaFormat('linkedin.post', null, { image: false }),
      'text'
    )
    assert.strictEqual(
      resolveMediaFormat('x.post', null, { image: false }),
      'text'
    )
    // Instagram without an image is still an image post, missing its image.
    assert.strictEqual(
      resolveMediaFormat('instagram.caption', null, { image: false }),
      'image'
    )
    assert.strictEqual(
      resolveMediaFormat('youtube.short', 'carousel', { image: true }),
      'video'
    )
  })

  it('follows the choice stored on the post, when its format takes it', () => {
    assert.strictEqual(
      resolveMediaFormat('linkedin.post', 'text', { image: true }),
      'text'
    )
    assert.strictEqual(
      resolveMediaFormat('instagram.caption', 'carousel', { image: false }),
      'carousel'
    )
    // X takes no carousel, and Instagram no text-only post.
    assert.strictEqual(
      resolveMediaFormat('x.post', 'carousel', { image: true }),
      'image'
    )
    assert.strictEqual(
      resolveMediaFormat('instagram.caption', 'text', { image: true }),
      'image'
    )
  })
})

describe('planning a carousel', () => {
  const idea = (brief?: string, format?: string) => ({
    suggestedMedia: { brief, format }
  })

  it('makes a carousel when the idea suggests one and the format takes it', () => {
    const brief = 'Carousel: one slide per check, from invoice to payment.'
    assert.strictEqual(
      plannedMediaFormat('instagram.caption', idea(brief)),
      'carousel'
    )
    assert.strictEqual(
      plannedMediaFormat('linkedin.post', idea(brief)),
      'carousel'
    )
    assert.strictEqual(
      plannedMediaFormat('facebook.post', idea(undefined, 'carousel')),
      'carousel'
    )
    // X has no carousel: its default.
    assert.strictEqual(plannedMediaFormat('x.post', idea(brief)), 'text')
  })

  it("otherwise gives the format's default", () => {
    assert.strictEqual(
      plannedMediaFormat('linkedin.post', idea('A loading dock at dawn.')),
      'image'
    )
    assert.strictEqual(plannedMediaFormat('instagram.caption', idea()), 'image')
    assert.strictEqual(plannedMediaFormat('facebook.post', idea()), 'text')
    assert.strictEqual(
      plannedMediaFormat('youtube.short', idea('Carousel')),
      'video'
    )
  })

  it('writes enough slides to swipe, within each platform', () => {
    for (const id of FORMAT_IDS.filter(f => FORMATS[f].media.carousel)) {
      const spec = FORMATS[id].media.carousel!
      const range = slideCountRange(id)
      assert.ok(range.min >= Math.max(3, spec.minSlides), id)
      assert.ok(range.max <= spec.maxSlides && range.max >= range.min, id)
    }
  })
})

describe('carousel wording', () => {
  it('finds what only makes sense with slides', () => {
    for (const text of [
      'Swipe to see all five.',
      'swiping through the steps',
      'This carousel walks through it',
      'Slide 3 is the one people miss.',
      'See the last slide for the template.',
      'These 5 slides cover the close.',
      'all slides'
    ]) {
      assert.ok(carouselWording(text), text)
    }
  })

  it('leaves ordinary words alone', () => {
    for (const text of [
      'Prices slide when demand drops.',
      'A landslide of invoices arrived.',
      'the slide in margins hurt',
      'We presented one slide deck to the board.',
      ''
    ]) {
      assert.strictEqual(carouselWording(text), null, text)
    }
  })
})

describe('the "swipe" check', () => {
  const base = {
    hook: 'Five checks before you sign.',
    body: 'Swipe through them.'
  }

  it('blocks swipe wording on a post that goes out without slides', () => {
    const finding = runLinter({ ...base, mediaFormat: 'image' }).find(
      f => f.rule === 'carousel_wording'
    )
    assert.strictEqual(finding?.severity, 'error')
    assert.strictEqual(finding?.passed, false)
    assert.match(finding!.message, /Swipe/)
  })

  it('lets a carousel caption say it', () => {
    const finding = runLinter({ ...base, mediaFormat: 'carousel' }).find(
      f => f.rule === 'carousel_wording'
    )
    assert.strictEqual(finding?.passed, true)
  })

  it('is left out when the post type is not given, as for the LinkedIn goldens', () => {
    assert.ok(!runLinter(base).some(f => f.rule === 'carousel_wording'))
  })
})

describe('the slide guard', () => {
  const options = {
    maxSlides: 10,
    pictures: true,
    figureSources: 'Roughly 43% of invoices carried a duplicate charge.'
  }
  const raw = (overrides: Record<string, unknown> = {}) => ({
    role: 'content' as const,
    layout: 'statement' as const,
    headline: 'Check the totals',
    body: 'Match every invoice to its order.',
    emphasis: [],
    imagePrompt: 'A clerk at a desk of receipts.',
    picture: false,
    altText: 'Check the totals',
    ...overrides
  })

  it('puts the cover first and the call to action last, whatever roles came back', () => {
    const slides = toCarousel(
      [raw(), raw(), raw(), raw({ headline: 'Book a review' })],
      options
    )
    assert.deepStrictEqual(
      slides.map(s => s.role),
      ['cover', 'content', 'content', 'cta']
    )
    assert.deepStrictEqual(
      slides.map(s => s.design.layout),
      ['cover', 'statement', 'statement', 'cta']
    )
  })

  it('drops content slides past the platform limit, keeping the call to action', () => {
    const slides = toCarousel(
      Array.from({ length: 14 }, (_, i) => raw({ headline: `Slide ${i + 1}` })),
      { ...options, maxSlides: 10 }
    )
    assert.strictEqual(slides.length, 10)
    assert.strictEqual(slides.at(-1)!.headline, 'Slide 14')
  })

  it('refuses fewer than two slides', () => {
    assert.throws(() => toCarousel([raw()], options), /fewer than two/)
  })

  it('draws a figure only when the evidence states it', () => {
    const sourced = toSlide(
      raw({ layout: 'stat', stat: '43%' }),
      'content',
      options
    )
    assert.strictEqual(sourced.design.layout, 'stat')
    const invented = toSlide(
      raw({ layout: 'stat', stat: '87%' }),
      'content',
      options
    )
    assert.strictEqual(invented.design.layout, 'statement')
    assert.ok(figureIsSourced('43%', options.figureSources))
    assert.ok(!figureIsSourced('', options.figureSources))
  })

  it('keeps a list only with two to four points', () => {
    const list = toSlide(
      raw({ layout: 'list', body: '- Totals\n- Dates\n- Duplicates' }),
      'content',
      options
    )
    assert.strictEqual(list.design.layout, 'list')
    assert.strictEqual(list.body, 'Totals\nDates\nDuplicates')
    const short = toSlide(
      raw({ layout: 'list', body: 'Only one point' }),
      'content',
      options
    )
    assert.strictEqual(short.design.layout, 'statement')
  })

  it('takes out what a slide cannot show: emoji, links, hashtags', () => {
    assert.strictEqual(
      cleanSlideText('Close faster 🚀 #finance see https://x.co/a'),
      'Close faster finance see'
    )
    const slide = toSlide(
      raw({ headline: '✅ Check the totals' }),
      'content',
      options
    )
    assert.strictEqual(slide.headline, 'Check the totals')
  })

  it('gives the cover a picture, and at most two pictures in all', () => {
    const slides = toCarousel(
      [
        raw(),
        raw({ layout: 'photo', picture: true }),
        raw({ layout: 'photo', picture: true }),
        raw()
      ],
      options
    )
    assert.strictEqual(slides[0]!.design.picture, true)
    assert.strictEqual(
      slides.filter(s => s.design.picture).length,
      MAX_DRAFT_PICTURES
    )
  })

  it('makes no pictures for minimal graphic design', () => {
    const slides = toCarousel(
      [raw({ picture: true }), raw({ layout: 'photo', picture: true }), raw()],
      {
        ...options,
        pictures: false
      }
    )
    assert.ok(slides.every(s => !s.design.picture))
  })

  it('keeps designs fit for their role', () => {
    assert.strictEqual(cleanDesign('cover', { layout: 'stat' }).layout, 'cover')
    assert.strictEqual(
      cleanDesign('content', { layout: 'icon', icon: 'not-an-icon' }).icon,
      null
    )
    assert.strictEqual(
      cleanDesign('content', { layout: 'statement', picture: true }).picture,
      false
    )
  })
})

describe('caption and slides kept apart', () => {
  const caption =
    'Most month-end delays start weeks earlier than anyone notices.\n\nWhen bank feeds wait for the last week, every mismatch piles up at once and the close slips again.'
  const slide = (headline: string, body: string): SlideContent => ({
    role: 'content',
    headline,
    body,
    imagePrompt: '',
    design: { layout: 'statement' },
    altText: ''
  })

  it('notices a caption pasted onto the slides', () => {
    const pasted = [
      slide(
        'Delays start early',
        'Most month-end delays start weeks earlier than anyone notices.'
      ),
      slide(
        'Feeds wait',
        'When bank feeds wait for the last week, every mismatch piles up at once and the close slips again.'
      )
    ]
    assert.ok(captionOnSlides(caption, pasted) > 0.5)
    assert.equal(carouselIssues(caption, pasted).length, 1)
  })

  it('accepts slides that carry their own points', () => {
    const own = [
      slide(
        'Reconcile daily',
        'Ten minutes a day beats two lost days at close.'
      ),
      slide('Match feeds first', 'Bank, then cards, then payouts.')
    ]
    assert.ok(captionOnSlides(caption, own) < 0.2)
    assert.deepStrictEqual(carouselIssues(caption, own), [])
  })
})

describe('checks before publishing', () => {
  const post = {
    hook: 'Five checks before you sign.',
    body: 'What we look for in every contract.',
    cta: 'Which do you skip?',
    hashtags: ['contracts']
  }
  const slides = (n: number, failed?: number) =>
    Array.from({ length: n }, (_, i) => ({
      position: i + 1,
      headline: `Point ${i + 1}`,
      body: 'Short text.',
      status: i + 1 === failed ? ('failed' as const) : ('ready' as const)
    }))

  it('needs an image on Instagram, and only warns on LinkedIn', () => {
    const instagram = validatePost({
      formatId: 'instagram.caption',
      mediaFormat: 'image',
      post,
      image: null,
      slides: []
    })
    assert.ok(ids(instagram, 'error').includes('media'))
    const linkedIn = validatePost({
      formatId: 'linkedin.post',
      mediaFormat: 'image',
      post,
      image: null,
      slides: []
    })
    assert.ok(ids(linkedIn, 'warning').includes('media'))
  })

  it("holds a carousel to its platform's slide count, and to every slide being drawn", () => {
    const ok = validatePost({
      formatId: 'instagram.caption',
      mediaFormat: 'carousel',
      post,
      image: null,
      slides: slides(5)
    })
    assert.deepStrictEqual(ids(ok, 'error'), [])
    const tooFew = validatePost({
      formatId: 'instagram.caption',
      mediaFormat: 'carousel',
      post,
      image: null,
      slides: slides(1)
    })
    assert.ok(ids(tooFew, 'error').includes('slides-count'))
    const tooMany = validatePost({
      formatId: 'instagram.caption',
      mediaFormat: 'carousel',
      post,
      image: null,
      slides: slides(11)
    })
    assert.ok(ids(tooMany, 'error').includes('slides-count'))
    const failed = validatePost({
      formatId: 'linkedin.post',
      mediaFormat: 'carousel',
      post,
      image: null,
      slides: slides(5, 3)
    })
    assert.ok(ids(failed, 'error').includes('slides-failed'))
    const none = validatePost({
      formatId: 'linkedin.post',
      mediaFormat: 'carousel',
      post,
      image: null,
      slides: []
    })
    assert.ok(ids(none, 'error').includes('media'))
    // Still loading: nothing judged yet.
    const loading = validatePost({
      formatId: 'linkedin.post',
      mediaFormat: 'carousel',
      post,
      image: null,
      slides: null
    })
    assert.deepStrictEqual(ids(loading, 'error'), [])
  })

  it('refuses "swipe" without slides', () => {
    const checks = validatePost({
      formatId: 'linkedin.post',
      mediaFormat: 'image',
      post: { ...post, body: 'Swipe for all five.' },
      image: { present: true },
      slides: []
    })
    assert.ok(ids(checks, 'error').includes('swipe'))
  })

  it("measures each platform's own limits", () => {
    const long = 'x'.repeat(300)
    const x = validatePost({
      formatId: 'x.post',
      mediaFormat: 'text',
      post: { hook: long, body: '' },
      image: null,
      slides: []
    })
    assert.ok(ids(x, 'error').includes('length'))
    const tags = Array.from({ length: 31 }, (_, i) => `tag${i}`)
    const instagram = validatePost({
      formatId: 'instagram.caption',
      mediaFormat: 'image',
      post: { ...post, hashtags: tags },
      image: { present: true },
      slides: []
    })
    assert.ok(ids(instagram, 'error').includes('hashtags'))
    const link = validatePost({
      formatId: 'instagram.caption',
      mediaFormat: 'image',
      post: { ...post, body: 'Read https://example.com' },
      image: { present: true },
      slides: []
    })
    assert.ok(ids(link, 'warning').includes('links'))
  })

  it('flags the same text reused on another platform', () => {
    const text =
      'Most month-end delays start weeks earlier than anyone notices, because bank feeds wait for the last week.'
    const checks = validatePost({
      formatId: 'facebook.post',
      mediaFormat: 'text',
      post: { hook: text, body: '' },
      image: null,
      slides: [],
      siblings: [{ formatId: 'linkedin.post', text }]
    })
    assert.ok(ids(checks, 'warning').includes('reuse-linkedin.post'))
  })
})

describe('prompts', () => {
  const { ctx, idea } = goldenCases()[0]!

  it('tells the LinkedIn writer about a carousel only when there is one', () => {
    const plain = linkedInPrompt.buildPrompt(ctx, idea)
    assert.strictEqual(linkedInPrompt.buildPrompt(ctx, idea, 'image'), plain)
    const carousel = linkedInPrompt.buildPrompt(ctx, idea, 'carousel')
    assert.ok(carousel.startsWith(plain))
    assert.ok(carousel.includes(linkedInPrompt.LINKEDIN_CAROUSEL_BLOCK))
  })

  it('tells other formats what goes out with their text', () => {
    const carousel = buildFormatPrompt(ctx, 'instagram.caption', [], [], {
      format: 'carousel'
    })
    assert.match(carousel, /goes out as a carousel/)
    const image = buildFormatPrompt(ctx, 'instagram.caption', [], [], {
      format: 'image'
    })
    assert.match(image, /Never mention swiping/)
    const choice = buildFormatPrompt(ctx, 'instagram.caption', [], [], {
      format: 'image',
      mayChooseCarousel: true
    })
    assert.match(choice, /start visualIdea with "Carousel:"/)
  })

  it('gives the slide writer the caption to stay apart from, and the slide count', () => {
    const prompt = buildSlidesPrompt(
      ctx,
      idea,
      'instagram.caption',
      'THE CAPTION TEXT',
      { min: 5, max: 8 }
    )
    assert.ok(prompt.includes('THE CAPTION TEXT'))
    assert.match(prompt, /Write 5 to 8 slides/)
    const instructions = buildSlidesInstructions(ctx, 'photorealistic')
    assert.match(instructions, /never repeat|do not put the whole post/i)
    assert.match(instructions, /No emoji, hashtags, links/)
    const minimal = buildSlidesInstructions(ctx, 'minimal_graphic')
    assert.match(minimal, /false for every slide/)
  })

  it('rewrites one slide in its place', () => {
    const slides: SlideContent[] = ['cover', 'content', 'cta'].map(
      (role, i) => ({
        role: role as SlideContent['role'],
        headline: `Headline ${i + 1}`,
        body: '',
        imagePrompt: '',
        design: {
          layout: role === 'content' ? 'statement' : (role as 'cover' | 'cta')
        },
        altText: ''
      })
    )
    const prompt = buildSlidePrompt(
      ctx,
      idea,
      'linkedin.post',
      'Caption',
      slides,
      1,
      'shorter'
    )
    assert.match(prompt, /Write slide 2 only/)
    assert.match(prompt, /shorter/)
    assert.ok(prompt.includes('3. [cta, cta] Headline 3'))
  })
})
