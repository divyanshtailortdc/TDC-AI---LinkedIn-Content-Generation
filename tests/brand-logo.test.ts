import assert from 'node:assert'
import { describe, it } from 'node:test'
import sharp from 'sharp'
import { logoBox } from '../src/lib/brand/theme'
import {
  compositeLogo,
  decodeImageDataUrl,
  fitToSize,
  normalizeLogo,
  prepareReferenceImage,
  toDataUrl
} from '../src/lib/media/brand-logo'

const solid = (width: number, height: number, rgb: [number, number, number]) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: rgb[0], g: rgb[1], b: rgb[2] }
    }
  })
    .jpeg()
    .toBuffer()

/** A black 400x100 bar on a transparent canvas with a wide empty margin. */
const paddedLogo = () =>
  sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect x="100" y="100" width="400" height="100" fill="#111111"/></svg>'
    )
  )
    .png()
    .toBuffer()

const pixel = async (image: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(image)
    .extract({ left: Math.floor(x), top: Math.floor(y), width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return [...data.subarray(0, info.channels)]
}

describe('preparing an uploaded logo', () => {
  it('trims empty margins and stores a PNG', async () => {
    const normalized = await normalizeLogo(
      toDataUrl(await paddedLogo(), 'image/png')
    )
    assert.match(normalized.dataUrl, /^data:image\/png;base64,/)
    assert.deepEqual([normalized.width, normalized.height], [400, 100])
  })

  it('rasterises an SVG upload', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#0e7c86"/></svg>'
    )
    const normalized = await normalizeLogo(toDataUrl(svg, 'image/svg+xml'))
    assert.match(normalized.dataUrl, /^data:image\/png;base64,/)
    assert.ok(
      normalized.width > 120,
      'rendered above its nominal size, then capped'
    )
    assert.ok(normalized.width <= 1024)
  })

  it('refuses files that are not images, or are too small to use', async () => {
    await assert.rejects(
      normalizeLogo(
        'data:image/png;base64,' + Buffer.from('not a png').toString('base64')
      ),
      /could not be read/
    )
    await assert.rejects(
      normalizeLogo('data:text/plain;base64,aGk='),
      /PNG, SVG, WebP or JPEG/
    )
    const tiny = await sharp({
      create: { width: 20, height: 10, channels: 4, background: '#000' }
    })
      .png()
      .toBuffer()
    await assert.rejects(
      normalizeLogo(toDataUrl(tiny, 'image/png')),
      /too small/
    )
  })

  it('round-trips data URLs', () => {
    const decoded = decodeImageDataUrl(
      toDataUrl(Buffer.from([1, 2, 3]), 'image/png')
    )
    assert.equal(decoded?.mediaType, 'image/png')
    assert.deepEqual([...decoded!.buffer], [1, 2, 3])
    assert.equal(decodeImageDataUrl('https://example.com/a.png'), null)
  })
})

describe('laying the logo over a generated image', () => {
  it('puts the uploaded logo exactly where the geometry says, with no plate on a contrasting corner', async () => {
    const image = await solid(2048, 1072, [245, 245, 245])
    const logo = (
      await normalizeLogo(toDataUrl(await paddedLogo(), 'image/png'))
    ).dataUrl
    const logoBuffer = decodeImageDataUrl(logo)!.buffer
    const result = await compositeLogo(image, {
      logo: logoBuffer,
      placement: 'top_right'
    })

    const expected = logoBox(
      { width: 2048, height: 1072 },
      { width: 400, height: 100 },
      'top_right'
    )
    assert.deepEqual(result.box, expected)
    assert.equal(result.plate, 'none')
    const centre = await pixel(
      result.buffer,
      expected.left + expected.width / 2,
      expected.top + expected.height / 2
    )
    assert.ok(
      centre.every(c => c < 60),
      `logo pixels are dark, got ${centre}`
    )
    const elsewhere = await pixel(result.buffer, 100, 900)
    assert.ok(
      elsewhere.every(c => c > 220),
      'the rest of the image is untouched'
    )
  })

  it('draws a light plate when a dark logo would sink into a dark corner', async () => {
    const image = await solid(2048, 1072, [20, 24, 30])
    const logo = await paddedLogo()
    const result = await compositeLogo(image, {
      logo,
      placement: 'bottom_left'
    })
    assert.equal(result.plate, 'light')
    const nearEdge = await pixel(
      result.buffer,
      result.box.left - Math.floor(result.box.padding / 2),
      result.box.top + 2
    )
    assert.ok(
      nearEdge.every(c => c > 200),
      `the plate shows around the logo, got ${nearEdge}`
    )
  })

  it('draws a dark plate behind a white logo on a light corner', async () => {
    const image = await solid(2048, 1072, [240, 240, 240])
    const white = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="400" height="100" fill="#ffffff"/></svg>'
      )
    )
      .png()
      .toBuffer()
    const result = await compositeLogo(image, {
      logo: white,
      placement: 'bottom_right'
    })
    assert.equal(result.plate, 'dark')
  })
})

describe('preparing a reference image', () => {
  it('scales it down and keeps a greyscale copy with no colour left in it', async () => {
    const orange = await solid(2400, 1600, [228, 87, 46])
    const { colour, greyscale } = await prepareReferenceImage(orange)

    const colourMeta = await sharp(colour).metadata()
    assert.deepEqual([colourMeta.width, colourMeta.height], [1280, 853])
    const [r, , b] = await pixel(colour, 10, 10)
    assert.ok(r! - b! > 120, 'the colour copy keeps the colour')

    const grey = await pixel(greyscale, 10, 10)
    assert.ok(
      Math.max(...grey) - Math.min(...grey) <= 2,
      `greyscale pixels have no hue, got ${grey}`
    )
  })

  it('says so when the bytes are not an image', async () => {
    await assert.rejects(
      prepareReferenceImage(Buffer.from('not an image')),
      /could not be read/
    )
  })
})

describe('making an image exactly the requested size', () => {
  it('keeps an exact image as it is', async () => {
    const image = await solid(2048, 1072, [10, 10, 10])
    const fitted = await fitToSize(image, { width: 2048, height: 1072 })
    assert.equal(fitted?.resized, false)
    assert.equal(fitted?.buffer, image)
  })

  it('resizes a near miss and refuses a different shape', async () => {
    const near = await fitToSize(await solid(2816, 1472, [10, 10, 10]), {
      width: 2048,
      height: 1072
    })
    assert.equal(near?.resized, true)
    const meta = await sharp(near!.buffer).metadata()
    assert.deepEqual([meta.width, meta.height], [2048, 1072])
    assert.equal(
      await fitToSize(await solid(1024, 1024, [10, 10, 10]), {
        width: 2048,
        height: 1072
      }),
      null
    )
  })
})
