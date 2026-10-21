import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  imagePromptSuffix,
  referenceImageInstruction,
  renderBrandForArtDirector,
  TEXT_RULE
} from '../src/lib/brand/prompt'
import {
  brandColors,
  BrandThemePayloadSchema,
  DEFAULT_BRAND_THEME,
  describeColor,
  LOGO_PLACEMENT,
  logoBox,
  logoClearSpaceInstruction,
  normalizeHex,
  resolveBrandTheme,
  type ResolvedBrandTheme
} from '../src/lib/brand/theme'

const CANVAS = { width: 2048, height: 1072 }

const theme = (
  overrides: Partial<ResolvedBrandTheme> = {}
): ResolvedBrandTheme => ({
  ...DEFAULT_BRAND_THEME,
  saved: true,
  ...overrides
})

describe('resolving a saved brand theme', () => {
  it('uses the defaults when nothing is saved', () => {
    const resolved = resolveBrandTheme(null)
    assert.equal(resolved.saved, false)
    assert.equal(resolved.primaryColor, null)
    assert.equal(resolved.secondaryColor, null)
    assert.equal(resolved.hasLogo, false)
  })

  it('keeps valid colours, normalised, and drops anything that is not a hex colour', () => {
    const resolved = resolveBrandTheme({
      primaryColor: '#0E7C86',
      secondaryColor: 'teal',
      hasLogo: true
    })
    assert.equal(resolved.primaryColor, '#0e7c86')
    assert.equal(resolved.secondaryColor, null)
    assert.equal(resolved.hasLogo, true)
    assert.equal(resolved.saved, true)
  })

  it('lists the colours that are set, the primary first', () => {
    assert.deepEqual(
      brandColors(theme({ primaryColor: '#111111', secondaryColor: '#eeeeee' })),
      [
        { role: 'primary', hex: '#111111' },
        { role: 'secondary', hex: '#eeeeee' }
      ]
    )
    assert.deepEqual(brandColors(theme({ secondaryColor: '#eeeeee' })), [
      { role: 'secondary', hex: '#eeeeee' }
    ])
    assert.deepEqual(brandColors(DEFAULT_BRAND_THEME), [])
  })

  it('normalises hex colours and rejects the rest', () => {
    assert.equal(normalizeHex(' #ABC '), '#aabbcc')
    assert.equal(normalizeHex('#12345'), null)
    assert.equal(normalizeHex('rgb(0,0,0)'), null)
    assert.equal(normalizeHex(undefined), null)
  })

  it('names colours the way a person would', () => {
    assert.equal(describeColor('#e4572e'), 'bright red')
    assert.equal(describeColor('#1b2a4a'), 'very dark blue')
    assert.equal(describeColor('#0a66c2'), 'bright blue')
    assert.equal(describeColor('#0e7c86'), 'dark teal')
    assert.equal(describeColor('#ff8800'), 'bright orange')
    assert.equal(describeColor('#6b3e1e'), 'dark brown')
    assert.equal(describeColor('#f9c6d0'), 'pale pink')
    assert.equal(describeColor('#ffffff'), 'white')
    assert.equal(describeColor('#111111'), 'black')
    assert.equal(describeColor('#7f7f7f'), 'grey')
    assert.equal(describeColor('nope'), 'unknown colour')
  })
})

describe('the brand theme save payload', () => {
  it('accepts two colours, normalised, and keeps the saved logo when none is sent', () => {
    const parsed = BrandThemePayloadSchema.parse({
      primaryColor: '#0E7C86',
      secondaryColor: '#F80'
    })
    assert.equal(parsed.primaryColor, '#0e7c86')
    assert.equal(parsed.secondaryColor, '#ff8800')
    assert.equal(parsed.logo, undefined)
  })

  it('clears a colour sent empty or null', () => {
    const parsed = BrandThemePayloadSchema.parse({
      primaryColor: '',
      secondaryColor: null
    })
    assert.equal(parsed.primaryColor, null)
    assert.equal(parsed.secondaryColor, null)
  })

  it('says which colour is wrong', () => {
    const result = BrandThemePayloadSchema.safeParse({
      primaryColor: '#0e7c86',
      secondaryColor: 'orange'
    })
    assert.equal(result.success, false)
    assert.match(
      result.error!.issues[0]!.message,
      /Secondary colour must be a hex colour/
    )
  })

  it('only takes an image as a logo, and null to remove one', () => {
    assert.equal(
      BrandThemePayloadSchema.safeParse({
        logo: 'data:text/html;base64,PGgxPg=='
      }).success,
      false
    )
    assert.equal(BrandThemePayloadSchema.parse({ logo: null }).logo, null)
  })
})

describe('where the logo goes', () => {
  const wordmark = { width: 400, height: 100 }
  const mark = { width: 300, height: 300 }

  it('goes in the bottom-right corner by default', () => {
    assert.equal(LOGO_PLACEMENT, 'bottom_right')
    const box = logoBox(CANVAS, mark)
    assert.ok(box.left > CANVAS.width / 2)
    assert.ok(box.top > CANVAS.height / 2)
  })

  it('stays inside the image with the same margin from both edges of its corner', () => {
    for (const placement of [
      'top_left',
      'top_right',
      'bottom_left',
      'bottom_right'
    ] as const) {
      const box = logoBox(CANVAS, wordmark, placement)
      assert.ok(box.left >= 0 && box.top >= 0, placement)
      assert.ok(box.left + box.width <= CANVAS.width, placement)
      assert.ok(box.top + box.height <= CANVAS.height, placement)
      const right = CANVAS.width - box.left - box.width
      const bottom = CANVAS.height - box.top - box.height
      const horizontal = placement.endsWith('left') ? box.left : right
      const vertical = placement.startsWith('top') ? box.top : bottom
      assert.equal(horizontal, vertical, placement)
    }
  })

  it('gives a wordmark and a square mark the same visual weight', () => {
    const a = logoBox(CANVAS, wordmark)
    const b = logoBox(CANVAS, mark)
    const ratio = (a.width * a.height) / (b.width * b.height)
    assert.ok(ratio > 0.95 && ratio < 1.05, `areas differ by ${ratio}`)
    assert.ok(a.width > b.width, 'the wordmark is wider')
  })

  it('never lets a long wordmark span a third of the image', () => {
    const box = logoBox(CANVAS, { width: 2000, height: 100 })
    assert.ok(box.width <= CANVAS.width * 0.32 + 1)
  })

  it('asks the image model to keep that corner empty, sized from the logo', () => {
    const box = logoBox(CANVAS, wordmark)
    const instruction = logoClearSpaceInstruction(CANVAS, box)
    assert.match(instruction, /bottom-right corner/)
    const [, across, down] =
      /rightmost (\d+)% of the width and the bottom (\d+)% of the height/.exec(
        instruction
      ) ?? []
    // Measured from the corner's own edges: a right-hand logo once asked for
    // the 40% cap because its distance from the left edge was counted.
    assert.ok(Number(across) > 10 && Number(across) < 35, `across ${across}`)
    assert.ok(Number(down) > 10 && Number(down) < 35, `down ${down}`)
    assert.match(instruction, /logo is placed there afterwards/)
  })

  it('measures a top-left corner the same way', () => {
    const right = logoClearSpaceInstruction(
      CANVAS,
      logoBox(CANVAS, mark, 'bottom_right'),
      'bottom_right'
    )
    const left = logoClearSpaceInstruction(
      CANVAS,
      logoBox(CANVAS, mark, 'top_left'),
      'top_left'
    )
    const sizes = (text: string) => text.match(/\d+%/g)
    assert.deepEqual(sizes(right), sizes(left))
  })
})

describe('the brand theme in prompts', () => {
  const branded = theme({ primaryColor: '#e4572e', secondaryColor: '#1b2a4a' })

  it('says nothing for an empty theme', () => {
    assert.equal(renderBrandForArtDirector(DEFAULT_BRAND_THEME), '')
  })

  it('gives the art director both colours, by role and by name', () => {
    const text = renderBrandForArtDirector(branded)
    assert.match(
      text,
      /#e4572e \(bright red\) as the dominant colour and #1b2a4a \(very dark blue\) as the supporting colour/
    )
    assert.match(text, /no other strong colours/)
  })

  it('works with only one colour set', () => {
    const text = renderBrandForArtDirector(theme({ secondaryColor: '#0e7c86' }))
    assert.match(text, /#0e7c86 \(dark teal\) as the dominant colour\./)
  })

  it('appends fixed rules to every image prompt: palette, lettering, logo space, no drawn logos', () => {
    const suffix = imagePromptSuffix({
      theme: branded,
      headline: 'Slow quotes are a data problem',
      clearSpace: 'Leave the bottom-right corner empty.'
    })
    assert.match(
      suffix,
      /Colour palette: #e4572e \(bright red\) as the dominant colour and #1b2a4a/
    )
    assert.match(suffix, /Give the supporting colour a visible share too/)
    assert.match(
      suffix,
      /The only text in the image is the headline "Slow quotes are a data problem"/
    )
    assert.match(suffix, /never letters or numbers/)
    assert.match(suffix, /Leave the bottom-right corner empty\./)
    assert.match(suffix, /Never draw a logo, emblem, wordmark/)
  })

  it('asks for no text at all when the brief chose no headline', () => {
    const suffix = imagePromptSuffix({ theme: branded, headline: '' })
    assert.match(suffix, /contains no text at all/)
  })

  it('keeps the headline on the side away from the logo', () => {
    const right = imagePromptSuffix({
      theme: theme(),
      headline: 'Ship it',
      logoPlacement: 'bottom_right'
    })
    assert.match(
      right,
      /left-hand side of the image, well clear of the bottom-right corner/
    )
    const left = imagePromptSuffix({
      theme: theme(),
      headline: 'Ship it',
      logoPlacement: 'top_left'
    })
    assert.match(left, /right-hand side of the image/)
    assert.ok(
      !imagePromptSuffix({ theme: theme(), headline: 'Ship it' }).includes(
        'hand side'
      )
    )
  })

  it('tells the art director the one lettering rule', () => {
    assert.match(TEXT_RULE, /at most one headline of up to 8 words/)
  })

  it('lets a prompt the reviewer wrote override the brand colours', () => {
    const suffix = imagePromptSuffix({ theme: branded, userPrompt: true })
    assert.match(
      suffix,
      /^Unless the description above names other colours, use the brand colours: #e4572e/
    )
    assert.ok(
      !suffix.includes('no text at all'),
      'the reviewer decides about text'
    )
    assert.match(suffix, /Never draw a logo/)
  })

  it('takes only layout and style from a reference image, and its colours only without brand colours', () => {
    const withBrand = referenceImageInstruction(branded)
    assert.match(withBrand, /a guide to arrangement and rendering style only/)
    assert.match(
      withBrand,
      /None of the objects, props, devices, icons, people, wording or logos in the reference may appear/
    )
    assert.match(withBrand, /colours come only from the palette below/)
    assert.ok(
      !referenceImageInstruction(DEFAULT_BRAND_THEME).includes('palette below')
    )
  })
})
