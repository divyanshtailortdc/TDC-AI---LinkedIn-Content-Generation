import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { crc32 } from 'node:zlib'
import sharp from 'sharp'
import {
  DEFAULT_BRAND_THEME,
  type ResolvedBrandTheme
} from '../src/lib/brand/theme'
import {
  SLIDE_LAYOUTS,
  type SlideContent,
  type SlideLayout,
  type SlideRole
} from '../src/lib/carousel/types'
import { loadCanvasFonts } from '../src/lib/media/canvas/fonts'
import { canvasPalette } from '../src/lib/media/canvas/palette'
import { slidesToPdf, slidesToZip } from '../src/lib/media/carousel/export'
import { jpegPagesToPdf, pdfString } from '../src/lib/media/carousel/pdf'
import {
  renderSlide,
  SLIDE_SIZE,
  slidePictureFrame,
  type SlideRenderInput
} from '../src/lib/media/carousel/render'
import { zipFiles } from '../src/lib/media/carousel/zip'

const solid = (
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
  channels: 1 | 3 = 3
) => {
  const image = sharp({ create: { width, height, channels: 3, background } })
  return (channels === 1 ? image.toColourspace('b-w') : image).jpeg().toBuffer()
}

/** Every object the xref lists, checked against where it really starts. */
function readXref(pdf: Buffer): Array<{ id: number; offset: number }> {
  const text = pdf.toString('latin1')
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1])
  assert.ok(Number.isFinite(start), 'startxref names an offset')
  assert.equal(text.slice(start, start + 5), 'xref\n')
  const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(start))!
  const entriesAt = start + `xref\n${first} ${count}\n`.length
  const entries: Array<{ id: number; offset: number }> = []
  for (let i = 0; i < Number(count); i++) {
    const entry = text.slice(entriesAt + i * 20, entriesAt + (i + 1) * 20)
    assert.match(entry, /^\d{10} \d{5} [nf] \n$/, `entry ${i} is 20 bytes`)
    if (entry[17] === 'n')
      entries.push({ id: i, offset: Number(entry.slice(0, 10)) })
  }
  return entries
}

describe('carousel PDF', () => {
  it('has one page per JPEG and an xref that points at every object', async () => {
    const pages = await Promise.all(
      [
        { r: 200, g: 40, b: 40 },
        { r: 40, g: 200, b: 40 },
        { r: 40, g: 40, b: 200 }
      ].map(async colour => ({
        jpeg: await solid(108, 135, colour),
        width: 1080,
        height: 1350
      }))
    )
    const pdf = jpegPagesToPdf(pages, { title: 'Quote speed (part 2)' })
    const text = pdf.toString('latin1')
    assert.ok(text.startsWith('%PDF-1.4\n'))
    assert.equal(text.match(/\/Type \/Page(?!s)/g)?.length, 3)
    assert.match(text, /\/Count 3/)
    assert.match(text, /\/MediaBox \[0 0 1080 1350\]/)
    // The JPEG's own pixel size, which may differ from the page's.
    assert.match(text, /\/Width 108 \/Height 135 \/ColorSpace \/DeviceRGB/)
    assert.match(text, /\/Title \(Quote speed \\\(part 2\\\)\)/)
    const entries = readXref(pdf)
    assert.equal(entries.length, 3 * 3 + 3)
    for (const { id, offset } of entries) {
      assert.equal(
        text.slice(offset, offset + `${id} 0 obj`.length),
        `${id} 0 obj`
      )
    }
    // Each image stream holds exactly its JPEG.
    for (const page of pages) assert.ok(pdf.includes(page.jpeg))
  })

  it('takes greyscale JPEGs and refuses anything else', async () => {
    const grey = await solid(20, 20, { r: 90, g: 90, b: 90 }, 1)
    const pdf = jpegPagesToPdf([{ jpeg: grey, width: 20, height: 20 }])
    assert.match(pdf.toString('latin1'), /\/ColorSpace \/DeviceGray/)
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#fff' }
    })
      .png()
      .toBuffer()
    assert.throws(
      () => jpegPagesToPdf([{ jpeg: png, width: 4, height: 4 }]),
      /JPEG/
    )
    assert.throws(() => jpegPagesToPdf([]), /at least one page/)
  })

  it('escapes titles, and writes non-ASCII ones as UTF-16', () => {
    assert.equal(pdfString('a (b) \\ c'), '(a \\(b\\) \\\\ c)')
    assert.equal(pdfString('Café'), '<FEFF00430061006600E9>')
    assert.equal(pdfString('→'), '<FEFF2192>')
  })

  it('makes a page of every slide image, whatever its format', async () => {
    const png = await sharp({
      create: {
        width: 54,
        height: 67,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .png()
      .toBuffer()
    const jpeg = await solid(54, 67, { r: 10, g: 120, b: 130 })
    const pdf = await slidesToPdf(
      [
        { bytes: png, mediaType: 'image/png' },
        { bytes: jpeg, mediaType: 'image/jpeg' }
      ],
      'Deck'
    )
    const text = pdf.toString('latin1')
    assert.equal(text.match(/\/Type \/Page(?!s)/g)?.length, 2)
    assert.match(text, /\/MediaBox \[0 0 54 67\]/)
    readXref(pdf)
  })
})

/** The archive's files, read back from its central directory. */
function readZip(zip: Buffer): Array<{ name: string; data: Buffer }> {
  const end = zip.length - 22
  assert.equal(zip.readUInt32LE(end), 0x06054b50)
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files: Array<{ name: string; data: Buffer }> = []
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50)
    assert.equal(
      zip.readUInt16LE(at + 8) & 0x0800,
      0x0800,
      'names are marked UTF-8'
    )
    const crc = zip.readUInt32LE(at + 16)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    assert.equal(zip.readUInt32LE(local), 0x04034b50)
    const dataAt =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(dataAt, dataAt + size)
    assert.equal(crc32(data) >>> 0, crc, `${name} CRC`)
    files.push({ name, data: Buffer.from(data) })
    at += 46 + nameLength
  }
  return files
}

describe('carousel ZIP', () => {
  const files = [
    { name: 'slide-01.png', data: Buffer.from('first slide') },
    { name: 'diapositive-02-é.jpg', data: Buffer.alloc(5000, 7) },
    { name: 'empty.txt', data: Buffer.alloc(0) }
  ]

  it('round-trips every file, byte for byte', () => {
    const read = readZip(zipFiles(files))
    assert.deepEqual(
      read.map(f => f.name),
      files.map(f => f.name)
    )
    read.forEach((file, i) => assert.ok(file.data.equals(files[i]!.data)))
  })

  it('passes unzip -t, where unzip is installed', t => {
    if (spawnSync('unzip', ['-v']).status !== 0) {
      t.skip('unzip is not installed')
      return
    }
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'))
    try {
      const path = join(dir, 'slides.zip')
      writeFileSync(path, zipFiles(files))
      const result = spawnSync('unzip', ['-t', path], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /No errors detected/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('names slides in order by their format, with a safe base name', async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#fff' }
    })
      .png()
      .toBuffer()
    const jpeg = await solid(2, 2, { r: 0, g: 0, b: 0 })
    const webp = await sharp(png).webp().toBuffer()
    const zip = await slidesToZip(
      [
        { bytes: png, mediaType: 'image/png' },
        { bytes: jpeg, mediaType: 'image/jpeg' },
        { bytes: webp, mediaType: 'image/x-unknown' }
      ],
      '../Quote speed: a/b'
    )
    const read = readZip(zip)
    assert.deepEqual(
      read.map(f => f.name),
      [
        'Quote-speed-a-b-01.png',
        'Quote-speed-a-b-02.jpg',
        'Quote-speed-a-b-03.png'
      ]
    )
    // An image of an unknown type is converted to PNG.
    assert.equal((await sharp(read[2]!.data).metadata()).format, 'png')
  })
})

describe('drawing a carousel slide', () => {
  const brand: ResolvedBrandTheme = {
    ...DEFAULT_BRAND_THEME,
    saved: true,
    primaryColor: '#0e7c86',
    accentColor: '#e4572e',
    secondaryColor: '#e4572e'
  }
  const palette = canvasPalette(brand)
  const PHOTO = { r: 200, g: 40, b: 40 }
  const fontsReady = loadCanvasFonts(brand)

  const slide = (
    layout: SlideLayout,
    overrides: Partial<SlideContent> = {}
  ): SlideContent => {
    const role: SlideRole =
      layout === 'cover' ? 'cover' : layout === 'cta' ? 'cta' : 'content'
    return {
      role,
      headline: 'Slow quotes are a records problem',
      body:
        layout === 'list'
          ? '- Pricing spreadsheet\n- Contract terms PDF\n- ERP catalog'
          : 'Price, terms and catalog live in three places, so every quote waits on someone.',
      imagePrompt: 'A sales desk with three binders',
      altText: 'A slide',
      design: {
        layout,
        icon: layout === 'icon' || layout === 'cover' ? 'database' : null,
        stat: layout === 'stat' ? '1 in 20' : null,
        emphasis: ['records problem'],
        picture: layout === 'cover' || layout === 'photo'
      },
      ...overrides
    }
  }

  async function draw(
    content: SlideContent,
    options: Partial<SlideRenderInput> & {
      withPicture?: boolean
      number?: number
    } = {}
  ) {
    const fonts = await fontsReady
    const size = options.size ?? SLIDE_SIZE
    const frame = slidePictureFrame(content.design.layout, size)
    const picture = options.withPicture
      ? {
          image: await solid(frame.width, frame.height, PHOTO),
          mediaType: 'image/jpeg' as const
        }
      : null
    const png = await renderSlide(
      {
        slide: { ...content, number: options.number ?? 2, total: 6 },
        picture,
        palette,
        fonts: {
          heading: fonts.heading,
          body: fonts.body,
          headingWeight: fonts.headingWeight
        },
        pattern: 'dots',
        logo: options.logo ?? null,
        wordmark:
          options.wordmark === undefined ? 'Ledgerly' : options.wordmark,
        footer:
          options.footer === undefined
            ? 'ledgerly.example.com'
            : options.footer,
        size
      },
      fonts.fonts
    )
    const { data, info } = await sharp(png)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => {
      const i = (Math.round(y) * info.width + Math.round(x)) * 3
      return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! }
    }
    return { png, info, at }
  }

  const near = (
    a: { r: number; g: number; b: number },
    b: { r: number; g: number; b: number },
    tolerance = 14
  ) =>
    Math.abs(a.r - b.r) <= tolerance &&
    Math.abs(a.g - b.g) <= tolerance &&
    Math.abs(a.b - b.b) <= tolerance

  const hex = (value: string) => ({
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16)
  })

  for (const layout of SLIDE_LAYOUTS) {
    for (const withPicture of [false, true]) {
      it(`draws a ${layout} slide ${withPicture ? 'with' : 'without'} a picture at the slide size`, async () => {
        const { png, info } = await draw(slide(layout), { withPicture })
        assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG')
        assert.equal(info.width, SLIDE_SIZE.width)
        assert.equal(info.height, SLIDE_SIZE.height)
      })
    }
  }

  it('fills the cover with its picture, and the photo slide across its top', async () => {
    const cover = await draw(slide('cover'), { withPicture: true })
    // Between the top shade and the bottom fade the photo shows as it is.
    assert.ok(near(cover.at(900, SLIDE_SIZE.height * 0.33), PHOTO, 20))
    const photo = await draw(slide('photo'), { withPicture: true })
    assert.ok(near(photo.at(540, 400), PHOTO))
    assert.ok(near(photo.at(4, 4), PHOTO))
    // Under the picture, the brand background.
    assert.ok(!near(photo.at(540, SLIDE_SIZE.height - 200), PHOTO, 60))
    const noPicture = await draw(slide('photo'))
    assert.ok(!near(noPicture.at(540, 400), PHOTO, 60))
  })

  it('shows the swipe arrow on every slide but the last', async () => {
    // Inside the arrow's circle, beside its icon: the primary colour.
    const point: [number, number] = [970, SLIDE_SIZE.height - 68 - 28 - 18]
    const middle = await draw(slide('statement'), { number: 3 })
    assert.ok(near(middle.at(...point), hex(palette.primary), 24))
    const last = await draw(slide('cta'), { number: 6 })
    assert.ok(!near(last.at(...point), hex(palette.primary), 60))
  })

  it('draws long text, logos and other sizes without failing', async () => {
    const logo = await sharp({
      create: {
        width: 400,
        height: 100,
        channels: 4,
        background: { r: 14, g: 124, b: 134, alpha: 1 }
      }
    })
      .png()
      .toBuffer()
    const dataUrl = `data:image/png;base64,${logo.toString('base64')}`
    const long = slide('list', {
      headline:
        'Why every finance team should rethink their quarterly invoice audit process now, before close',
      body: Array.from(
        { length: 6 },
        (_, i) => `- Point ${i + 1} that runs on for a while to fill the line`
      ).join('\n')
    })
    for (const plate of [false, true]) {
      const { info } = await draw(long, {
        logo: { dataUrl, width: 400, height: 100, plate },
        withPicture: false
      })
      assert.equal(info.width, SLIDE_SIZE.width)
    }
    const square = await draw(slide('cover'), {
      withPicture: true,
      size: { width: 1080, height: 1080 },
      wordmark: null,
      footer: null
    })
    assert.equal(square.info.height, 1080)
    const bigger = await draw(slide('stat'), {
      size: { width: 1440, height: 1800 }
    })
    assert.equal(bigger.info.width, 1440)
  })

  it('gives the image model a frame in multiples of 16 that covers the area', () => {
    for (const size of [
      SLIDE_SIZE,
      { width: 1080, height: 1080 },
      { width: 1200, height: 1500 }
    ]) {
      for (const layout of SLIDE_LAYOUTS) {
        const frame = slidePictureFrame(layout, size)
        assert.equal(frame.width % 16, 0, `${layout} width`)
        assert.equal(frame.height % 16, 0, `${layout} height`)
        assert.ok(frame.width >= size.width)
        if (layout === 'photo') {
          assert.ok(
            frame.height >= size.height * 0.52 && frame.height < size.height
          )
        } else {
          assert.ok(frame.height >= size.height)
        }
      }
    }
    assert.deepEqual(slidePictureFrame('cover'), { width: 1088, height: 1360 })
  })
})
