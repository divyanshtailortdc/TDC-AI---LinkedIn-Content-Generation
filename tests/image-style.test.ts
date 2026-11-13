import assert from 'node:assert'
import { describe, it } from 'node:test'
import sharp from 'sharp'
import {
  pictureIssues,
  pictureRetryInstructions
} from '../src/lib/ai/skills/image-review/guard'
import { buildPrompt as buildReviewPrompt } from '../src/lib/ai/skills/image-review/prompt'
import type { ImageReview } from '../src/lib/ai/skills/image-review/schema'
import { guardMediaBrief } from '../src/lib/ai/skills/media-brief/guard'
import {
  mediaBriefSchema,
  normalizeVisualType,
  visualTypesFor,
  type MediaBrief
} from '../src/lib/ai/skills/media-brief/schema'
import {
  BrandThemePayloadSchema,
  DEFAULT_BRAND_THEME,
  DEFAULT_IMAGE_STYLE,
  resolveBrandTheme,
  resolveImageStyle,
  type ResolvedBrandTheme
} from '../src/lib/brand/theme'
import { loadCanvasFonts } from '../src/lib/media/canvas/fonts'
import { canvasPalette } from '../src/lib/media/canvas/palette'
import { renderCanvas } from '../src/lib/media/canvas/render'
import {
  CANVAS_SIZE,
  pictureGenerationSize,
  picturePanel,
  SHAPE_SIZES,
  type CanvasLayout,
  type CanvasSpec
} from '../src/lib/media/canvas/spec'
import {
  buildPicturePrompt,
  customStyleSuffix,
  styleClashes
} from '../src/lib/media/style-prompt'

const brand: ResolvedBrandTheme = {
  ...DEFAULT_BRAND_THEME,
  saved: true,
  primaryColor: '#0e7c86',
  accentColor: '#e4572e',
  secondaryColor: '#e4572e'
}

describe('the image style a brand is drawn in', () => {
  it('is photorealistic unless the brand chose otherwise', () => {
    assert.equal(DEFAULT_IMAGE_STYLE, 'photorealistic')
    assert.equal(DEFAULT_BRAND_THEME.visualStyle, 'photorealistic')
    assert.equal(resolveBrandTheme(null).visualStyle, 'photorealistic')
  })

  it('reads the values saved before image styles existed', () => {
    // 'auto' was the column default and never offered in the form.
    assert.equal(resolveImageStyle('auto'), 'photorealistic')
    assert.equal(resolveImageStyle('diagram'), 'minimal_graphic')
    assert.equal(resolveImageStyle('illustration'), 'illustration')
    assert.equal(resolveImageStyle(null), 'photorealistic')
    assert.equal(resolveImageStyle('watercolour'), 'photorealistic')
    assert.equal(resolveBrandTheme({ visualStyle: '3d_render' }).visualStyle, '3d_render')
  })

  it('saves one of the listed styles, photorealistic when none is sent', () => {
    assert.equal(BrandThemePayloadSchema.parse({}).visualStyle, 'photorealistic')
    assert.equal(
      BrandThemePayloadSchema.parse({ visualStyle: 'minimal_graphic' }).visualStyle,
      'minimal_graphic'
    )
    assert.equal(
      BrandThemePayloadSchema.safeParse({ visualStyle: 'auto' }).success,
      false
    )
  })
})

describe('the prompt a picture is generated from', () => {
  const frame = { width: 1072, height: 1072 }

  it('asks for a real photograph, with the brand colour on real things, not as a tint', () => {
    const prompt = buildPicturePrompt({
      style: 'photorealistic',
      scene: 'A sales rep at a warehouse desk comparing three printed price lists.',
      styleDirection: 'Crisp cool daylight; the teal shows on the rep\'s lanyard.',
      theme: brand,
      frame
    })
    assert.ok(prompt.startsWith('A sales rep at a warehouse desk'))
    assert.match(prompt, /an authentic photograph, indistinguishable from professional editorial photography/)
    assert.match(prompt, /35mm or 50mm prime lens/)
    assert.match(prompt, /It must not look generated: no illustration, cartoon/)
    assert.match(prompt, /Art direction for this brand: Crisp cool daylight/)
    assert.match(prompt, /#0e7c86 \(dark teal\) on one or two prominent objects/)
    assert.match(prompt, /#e4572e \(bright red\) as a smaller accent/)
    assert.match(prompt, /Never tint, filter or colour-grade the whole photograph/)
    assert.match(prompt, /a square 1:1 frame/)
    assert.match(prompt, /No text anywhere in the picture/)
    // A photographed "blank" screen comes back lettered: it must leave the shot.
    assert.match(prompt, /No screen, monitor, document, sign, label or packaging faces the camera/)
    assert.match(prompt, /device makers' names or watermarks/)
    assert.ok(!prompt.includes('white (#ffffff) background'))
  })

  it('composes a wide band panoramically', () => {
    const prompt = buildPicturePrompt({
      style: 'photorealistic',
      scene: 'A loading dock.',
      theme: brand,
      frame: { width: 2048, height: 624 }
    })
    assert.match(prompt, /a wide panoramic frame/)
  })

  it('renders a 3D scene in brand-coloured materials', () => {
    const prompt = buildPicturePrompt({
      style: '3d_render',
      scene: 'Three parcels on a conveyor.',
      theme: brand,
      frame
    })
    assert.match(prompt, /a high-end 3D render/)
    assert.match(prompt, /physically based materials/)
    assert.match(prompt, /main objects and materials in #0e7c86/)
    assert.match(prompt, /no human figures/)
  })

  it('draws an illustration on white, to be cut out onto the brand background', () => {
    const prompt = buildPicturePrompt({
      style: 'illustration',
      scene: 'Three binders merging into one.',
      theme: brand,
      frame: { width: 1024, height: 1024 }
    })
    assert.match(prompt, /editorial illustration in flat vector style/)
    assert.match(prompt, /pure seamless white \(#ffffff\) background/)
    assert.match(prompt, /Colour palette: #0e7c86/)
    // No longer pinned to one industry's look.
    assert.ok(!/SaaS|tech graphic/i.test(prompt))
  })

  it('leaves the colours out when the brand has none', () => {
    const prompt = buildPicturePrompt({
      style: 'photorealistic',
      scene: 'A bakery counter at dawn.',
      theme: DEFAULT_BRAND_THEME,
      frame
    })
    assert.ok(!prompt.includes('Brand colours'))
  })

  it('gives a typed prompt the style as a default its own words can override', () => {
    const suffix = customStyleSuffix('photorealistic')
    assert.match(suffix, /^Unless the description above asks for a different look, render it in the Photorealistic style\./)
    assert.match(suffix, /appear on real objects in the scene rather than as a tint/)
    assert.match(customStyleSuffix('minimal_graphic'), /minimal graphic design/)
    assert.match(customStyleSuffix('3d_render'), /3D Render style/)
  })
})

describe('a brief whose picture does not match its style', () => {
  const brief = (overrides: Partial<MediaBrief> = {}): MediaBrief => ({
    postTopic: 'slow quotes',
    coreThesis: 'quotes are slow because records are scattered',
    readerTakeaway: 'count the systems',
    primaryConcept: 'A rep assembling a quote from scattered records',
    visualMetaphor: 'A rep pulling price, terms and catalog records together',
    visualType: 'picture',
    textOverlay: { headline: 'Slow quotes are a records problem' },
    avoidConcepts: [],
    whyItFits: 'It shows the scattered records',
    ...overrides
  })
  const post =
    'A quote is slow when the records are scattered. The rep pulls price, terms and catalog records from three places to assemble one quote.'

  it('finds the words that ask for another medium, but not a ruled-out one', () => {
    assert.deepEqual(
      styleClashes('photorealistic', 'A flat vector illustration of a rep'),
      ['illustration', 'vector']
    )
    assert.deepEqual(
      styleClashes('photorealistic', 'A rep at a desk, not a cartoon, no 3D render look'),
      []
    )
    // Whole words only.
    assert.deepEqual(styleClashes('photorealistic', 'An iconic loading dock at dawn'), [])
    assert.deepEqual(styleClashes('illustration', 'A photograph of a desk'), ['photograph'])
    assert.deepEqual(styleClashes('minimal_graphic', 'anything at all'), [])
  })

  it('sends the brief back once, naming the clash', () => {
    const clashing = guardMediaBrief(
      brief(),
      'A flat vector illustration of a rep with scattered quote records.',
      post,
      undefined,
      { imageStyle: 'photorealistic' }
    )
    assert.equal(clashing.isAcceptable, false)
    assert.match(
      clashing.issues.join(' '),
      /Describes the picture as "illustration", "vector", but the image style is Photorealistic/
    )

    const empty = guardMediaBrief(brief(), '', post, undefined, {
      imageStyle: 'photorealistic'
    })
    assert.match(empty.issues.join(' '), /Leaves imagePrompt empty/)

    const clean = guardMediaBrief(
      brief(),
      'A sales rep at a warehouse desk pulling price, terms and catalog records from three binders, morning light, 35mm.',
      post,
      undefined,
      { imageStyle: 'photorealistic' }
    )
    assert.deepEqual(clean.issues, [])
  })

  it('accepts a picture brief regenerated after another picture', () => {
    // allowedTypes as deriveMediaBrief passes them for a picture style: the
    // form cannot change, so repeating it is no fault.
    const result = guardMediaBrief(
      brief(),
      'A rep at a desk with three binders.',
      post,
      undefined,
      { imageStyle: 'photorealistic', allowedTypes: ['picture'], previousVisualTypes: [] }
    )
    assert.ok(!result.issues.some(i => i.includes('same visual form')))
  })
})

describe('the brief schema for each style', () => {
  const layouts = (schema: ReturnType<typeof mediaBriefSchema>) =>
    (schema.shape.layout as any).unwrap().options as string[]
  const types = (schema: ReturnType<typeof mediaBriefSchema>) =>
    schema.shape.visualType.options as string[]

  it('offers a picture style only the picture and the layouts with room for one', () => {
    const photo = mediaBriefSchema({ style: 'photorealistic' })
    assert.deepEqual(types(photo), ['picture'])
    assert.deepEqual(layouts(photo), ['split_left', 'split_right', 'top_bottom'])
    assert.match(photo.shape.imagePrompt.description ?? '', /photographer's shot description/)
    assert.ok(!('illustrationPrompt' in photo.shape))
    assert.ok(!('blueprint' in photo.shape))
  })

  it('offers minimal graphic design the diagram forms, or the one chosen', () => {
    const diagram = mediaBriefSchema({ style: 'minimal_graphic' })
    assert.deepEqual(types(diagram), ['hub_spoke', 'flow', 'stack', 'cards', 'comparison'])
    assert.ok(layouts(diagram).includes('centered_hero'))
    assert.deepEqual(
      types(mediaBriefSchema({ style: 'minimal_graphic', allowedTypes: ['flow'] })),
      ['flow']
    )
    // A picture style ignores a diagram form sent alongside it.
    assert.deepEqual(visualTypesFor('photorealistic', ['flow']), ['picture'])
  })

  it('adds the blueprint for a reference image', () => {
    assert.ok('blueprint' in mediaBriefSchema({ style: 'illustration', reference: true }).shape)
  })

  it('reads the visual type stored before image styles', () => {
    assert.equal(normalizeVisualType('illustration'), 'picture')
    assert.equal(normalizeVisualType('picture'), 'picture')
    assert.equal(normalizeVisualType('flow'), 'flow')
    assert.equal(normalizeVisualType('conceptual_illustration'), undefined)
  })
})

describe('where a photograph goes in the layout', () => {
  it('fills the visual side to the image edges', () => {
    assert.deepEqual(picturePanel('split_left', CANVAS_SIZE), {
      left: 976,
      top: 0,
      width: 1072,
      height: 1072
    })
    assert.deepEqual(picturePanel('split_right', SHAPE_SIZES['16:9']), {
      left: 0,
      top: 0,
      width: 1072,
      height: 1152
    })
    assert.deepEqual(picturePanel('top_bottom', CANVAS_SIZE), {
      left: 0,
      top: 456,
      width: 2048,
      height: 616
    })
    // A tall image: the full width under the text, or over it.
    assert.deepEqual(picturePanel('split_left', SHAPE_SIZES['4:5']), {
      left: 0,
      top: 752,
      width: 1536,
      height: 1168
    })
    assert.equal(picturePanel('split_right', SHAPE_SIZES['4:5']).top, 0)
  })

  it('is generated at the panel shape in the sizes the models take', () => {
    for (const panel of [
      { width: 1072, height: 1072 },
      { width: 2048, height: 616 },
      { width: 1536, height: 1168 },
      { width: 300, height: 200 },
      { width: 3000, height: 1000 }
    ]) {
      const size = pictureGenerationSize(panel)
      assert.equal(size.width % 16, 0)
      assert.equal(size.height % 16, 0)
      const long = Math.max(size.width, size.height)
      assert.ok(long >= 1024 && long <= 2048 + 16, `${long}`)
      const ratio = (a: { width: number; height: number }) => a.width / a.height
      assert.ok(Math.abs(ratio(size) - ratio(panel)) / ratio(panel) < 0.05)
    }
    assert.deepEqual(pictureGenerationSize({ width: 2048, height: 616 }), {
      width: 2048,
      height: 624
    })
  })
})

describe('checking a picture before it goes into the layout', () => {
  const review = (overrides: Partial<ImageReview> = {}): ImageReview => ({
    visibleText: [],
    headlineCorrect: true,
    unintendedText: [],
    brandMarks: [],
    unsupportedDetails: [],
    logoCoversContent: false,
    logoCovers: [],
    copiesReference: false,
    keepsReferenceColors: false,
    conveysPost: false,
    genericStock: true,
    followsBrand: false,
    artifacts: [],
    matchesStyle: true,
    relevanceScore: 40,
    summary: 'A rep at a desk.',
    ...overrides
  })

  it('judges only lettering, logos, artefacts and the style', () => {
    // Relevance and the brand are judged on the whole design, not the picture.
    assert.deepEqual(pictureIssues(review(), 'photorealistic'), [])
    const issues = pictureIssues(
      review({
        unintendedText: ['QUOTF'],
        artifacts: ['six fingers on the left hand'],
        matchesStyle: false
      }),
      'photorealistic'
    )
    assert.equal(issues.length, 3)
    assert.match(issues.join(' '), /stray or misspelt lettering/)
    assert.match(issues.join(' '), /Looks generated: six fingers on the left hand/)
    assert.match(issues.join(' '), /Does not look like the Photorealistic style/)
  })

  it('tells the second attempt how to fix just that', () => {
    const fixes = pictureRetryInstructions(
      review({ artifacts: ['warped shelf'], matchesStyle: false }),
      'photorealistic'
    )
    assert.match(fixes, /unmistakably a real photograph/)
    assert.match(fixes, /nothing is warped, melted, duplicated or merged/)
    assert.ok(!fixes.includes('generic business scene'))
    assert.ok(!fixes.includes('brand colours'))
    assert.ok(!fixes.includes('warped shelf'))
  })

  it('takes lettered screens out of a photograph rather than asking for blank ones', () => {
    const fixes = pictureRetryInstructions(
      review({ unintendedText: ['QUOTF'], brandMarks: ['AVILL on the monitor'] }),
      'photorealistic'
    )
    assert.match(fixes, /Reframe the shot so that no screen, monitor, document/)
    assert.ok(!fixes.includes('QUOTF') && !fixes.includes('AVILL'))
    // An illustration can draw a blank screen.
    assert.ok(
      !pictureRetryInstructions(review({ unintendedText: ['QUOTF'] }), 'illustration').includes('Reframe')
    )
  })

  it('tells the reviewer which style to expect', () => {
    const prompt = buildReviewPrompt({
      postText: 'A post.',
      concept: 'A rep at a desk',
      headline: '',
      style: 'photorealistic'
    })
    assert.match(prompt, /INTENDED STYLE\nPhotorealistic: it should look like a real photograph/)
    assert.ok(
      !buildReviewPrompt({ postText: 'A post.', concept: 'x', headline: '' }).includes(
        'INTENDED STYLE'
      )
    )
  })
})

describe('drawing a photograph into the layout', () => {
  const PHOTO = { r: 200, g: 40, b: 40 }

  async function draw(layout: CanvasLayout, size: { width: number; height: number }) {
    const panel = picturePanel(layout, size)
    const photo = await sharp({
      create: { width: panel.width, height: panel.height, channels: 3, background: PHOTO }
    })
      .jpeg()
      .toBuffer()
    const fonts = await loadCanvasFonts(brand)
    const spec: CanvasSpec = {
      layout,
      copy: {
        tagline: 'Quote speed',
        headline: 'Slow quotes are a records problem',
        highlights: ['records problem'],
        subheadline: 'Price, terms and catalog live in three places.',
        footer: null
      },
      visual: {
        kind: 'picture',
        image: photo,
        mediaType: 'image/jpeg',
        display: 'bleed',
        badges: []
      },
      palette: canvasPalette(brand),
      fonts: { heading: fonts.heading, body: fonts.body, headingWeight: fonts.headingWeight },
      pattern: 'plain',
      logo: null,
      size
    }
    const png = await renderCanvas(spec, fonts.fonts)
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => {
      const i = (Math.round(y) * info.width + Math.round(x)) * 3
      return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! }
    }
    const isPhoto = (p: { r: number; g: number; b: number }) =>
      Math.abs(p.r - PHOTO.r) < 12 && Math.abs(p.g - PHOTO.g) < 12 && Math.abs(p.b - PHOTO.b) < 12
    return { info, panel, at, isPhoto }
  }

  for (const [layout, size, shape] of [
    ['split_left', CANVAS_SIZE, '1.91:1'],
    ['split_right', SHAPE_SIZES['16:9'], '16:9'],
    ['top_bottom', CANVAS_SIZE, '1.91:1'],
    ['split_left', SHAPE_SIZES['4:5'], '4:5']
  ] as const) {
    it(`fills the ${layout} panel to the edges at ${shape}`, async () => {
      const { info, panel, at, isPhoto } = await draw(layout, size)
      assert.equal(info.width, size.width)
      assert.equal(info.height, size.height)
      // Its corners and centre, right out to the image's edge.
      for (const [x, y] of [
        [panel.left + 2, panel.top + 2],
        [panel.left + panel.width - 2, panel.top + panel.height - 2],
        [panel.left + panel.width / 2, panel.top + panel.height / 2]
      ]) {
        assert.ok(isPhoto(at(x!, y!)), `${layout} ${shape} at ${x},${y}: ${JSON.stringify(at(x!, y!))}`)
      }
      // The text side keeps the brand background.
      const textX = panel.left === 0 && panel.width < size.width ? size.width - 40 : 40
      const textY = panel.top === 0 && panel.height < size.height ? size.height - 40 : 40
      assert.ok(!isPhoto(at(textX, textY)), `${layout} ${shape} text side`)
    })
  }
})
