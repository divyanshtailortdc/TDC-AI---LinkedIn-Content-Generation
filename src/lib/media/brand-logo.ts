import sharp, {
  type Metadata,
  type OutputInfo,
  type OverlayOptions
} from 'sharp'
import {
  LOGO_MAX_EDGE,
  LOGO_MIN_EDGE,
  LOGO_UPLOAD_MAX_BYTES,
  LOGO_UPLOAD_TYPES,
  logoBox,
  type LogoBox,
  type LogoPlacement
} from '~/lib/brand/theme'

/**
 * Pixel work on generated images: the brand logo laid over them, and sizes
 * made exact. The logo is always the uploaded file, composited here; image
 * models are never asked to draw it, because they draw it wrong.
 *
 * No database or `server-only` import, so tests can run it on real bytes.
 */

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i

export function decodeImageDataUrl(
  value: string
): { mediaType: string; buffer: Buffer } | null {
  const match = DATA_URL.exec(value.trim())
  if (!match) return null
  return {
    mediaType: match[1]!.toLowerCase(),
    buffer: Buffer.from(match[2]!, 'base64')
  }
}

export const toDataUrl = (buffer: Buffer, mediaType: string) =>
  `data:${mediaType};base64,${buffer.toString('base64')}`

/**
 * Turns an uploaded logo into the stored PNG: decoded (which proves it is an
 * image), SVGs rasterised, empty margins trimmed so every logo sits the same
 * distance from the edge, and scaled to at most LOGO_MAX_EDGE. Throws a
 * message fit to show the user.
 */
export async function normalizeLogo(
  dataUrl: string
): Promise<{ dataUrl: string; width: number; height: number }> {
  const decoded = decodeImageDataUrl(dataUrl)
  if (
    !decoded ||
    !(LOGO_UPLOAD_TYPES as readonly string[]).includes(decoded.mediaType)
  ) {
    throw new Error('Upload the logo as a PNG, SVG, WebP or JPEG file.')
  }
  if (decoded.buffer.length === 0) throw new Error('That logo file is empty.')
  if (decoded.buffer.length > LOGO_UPLOAD_MAX_BYTES) {
    throw new Error('The logo file is too large. Use one under 5 MB.')
  }

  const isSvg = decoded.mediaType === 'image/svg+xml'
  // SVGs carry no pixel size worth trusting; render them large and scale down.
  const source = () =>
    sharp(decoded.buffer, isSvg ? { density: 300 } : {}).rotate()

  let meta: Metadata
  try {
    meta = await source().metadata()
  } catch {
    throw new Error('That logo could not be read. The file may be damaged.')
  }
  if (!meta.width || !meta.height) {
    throw new Error('That logo could not be read. The file may be damaged.')
  }
  if (Math.max(meta.width, meta.height) < LOGO_MIN_EDGE) {
    throw new Error(
      `The logo is too small (${meta.width}×${meta.height}). Use one at least ${LOGO_MIN_EDGE}px wide.`
    )
  }

  const encode = (trim: boolean) => {
    let pipeline = source().ensureAlpha()
    // Trimming takes the corner colour as background: transparent margins on a
    // PNG, white ones on a JPEG.
    if (trim) pipeline = pipeline.trim({ threshold: 12 })
    return pipeline
      .resize(LOGO_MAX_EDGE, LOGO_MAX_EDGE, {
        fit: 'inside',
        withoutEnlargement: !isSvg
      })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true })
  }
  let out: { data: Buffer; info: OutputInfo }
  try {
    out = await encode(true)
  } catch {
    // A logo that is one flat colour leaves nothing after trimming.
    out = await encode(false)
  }

  return {
    dataUrl: toDataUrl(out.data, 'image/png'),
    width: out.info.width,
    height: out.info.height
  }
}

/** Below this an aspect mismatch is rounding, and cropping loses nothing visible. */
const ASPECT_TOLERANCE = 0.02

/**
 * Makes an image exactly `target`. A model that returned nearly the right
 * shape is resized and cropped by a few pixels; a different shape returns null
 * so the caller can try another model rather than crop the subject away.
 */
export async function fitToSize(
  buffer: Buffer,
  target: { width: number; height: number }
): Promise<{
  buffer: Buffer
  width: number
  height: number
  resized: boolean
} | null> {
  const meta = await sharp(buffer).metadata()
  if (!meta.width || !meta.height) return null
  if (meta.width === target.width && meta.height === target.height) {
    return { buffer, width: meta.width, height: meta.height, resized: false }
  }
  const got = meta.width / meta.height
  const want = target.width / target.height
  if (Math.abs(got - want) / want > ASPECT_TOLERANCE) return null
  const resized = await sharp(buffer)
    .resize(target.width, target.height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer()
  return {
    buffer: resized,
    width: target.width,
    height: target.height,
    resized: true
  }
}

const luminance = (r: number, g: number, b: number) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/** Mean luminance (0–1) and busyness of an image area. */
async function regionTone(
  image: Buffer,
  area: { left: number; top: number; width: number; height: number }
): Promise<{ luminance: number; busy: boolean }> {
  const stats = await sharp(image).extract(area).removeAlpha().stats()
  const [r, g, b] = stats.channels
  const lum = luminance(r!.mean, g!.mean, b!.mean)
  // A strongly textured corner swallows a logo even when its average contrasts.
  const spread = (r!.stdev + g!.stdev + b!.stdev) / 3
  return { luminance: lum, busy: spread > 55 }
}

/** Mean luminance (0–1) of a logo's visible pixels, weighted by opacity. */
async function logoTone(logo: Buffer): Promise<number> {
  const { data, info } = await sharp(logo)
    .resize(96, 96, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let sum = 0
  let weight = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const alpha = data[i + 3]! / 255
    sum += luminance(data[i]!, data[i + 1]!, data[i + 2]!) * alpha
    weight += alpha
  }
  return weight > 0 ? sum / weight : 0.5
}

/** Below this luminance difference a logo is hard to read against its corner. */
const MIN_LOGO_CONTRAST = 0.3

export interface CompositeLogoResult {
  buffer: Buffer
  mediaType: 'image/jpeg'
  box: LogoBox
  /** A plate is drawn behind the logo when the corner would swallow it. */
  plate: 'none' | 'light' | 'dark'
}

/**
 * Lays the brand logo over a finished image. The corner is measured first,
 * and one that would swallow the logo (too close in tone, or too busy) gets a
 * soft plate behind it.
 */
export async function compositeLogo(
  image: Buffer,
  options: { logo: Buffer; placement: LogoPlacement }
): Promise<CompositeLogoResult> {
  const meta = await sharp(image).metadata()
  if (!meta.width || !meta.height)
    throw new Error('The generated image could not be read.')
  const canvas = { width: meta.width, height: meta.height }

  const logoMeta = await sharp(options.logo).metadata()
  const box = logoBox(
    canvas,
    { width: logoMeta.width || 1, height: logoMeta.height || 1 },
    options.placement
  )
  const left = Math.max(0, box.left - box.padding)
  const top = Math.max(0, box.top - box.padding)
  const plateArea = {
    left,
    top,
    width: Math.min(canvas.width - left, box.width + box.padding * 2),
    height: Math.min(canvas.height - top, box.height + box.padding * 2)
  }

  const corner = await regionTone(image, plateArea)
  const resizedLogo = await sharp(options.logo)
    .resize(box.width, box.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer()
  const logoLum = await logoTone(resizedLogo)

  let plate: CompositeLogoResult['plate'] = 'none'
  if (Math.abs(logoLum - corner.luminance) < MIN_LOGO_CONTRAST || corner.busy) {
    plate = logoLum < 0.5 ? 'light' : 'dark'
  }

  const layers: OverlayOptions[] = []
  if (plate !== 'none') {
    const radius = Math.round(
      Math.min(plateArea.height, plateArea.width) * 0.18
    )
    const fill =
      plate === 'light' ? 'rgba(255,255,255,0.92)' : 'rgba(17,17,17,0.82)'
    layers.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${plateArea.width}" height="${plateArea.height}"><rect width="100%" height="100%" rx="${radius}" ry="${radius}" fill="${fill}"/></svg>`
      ),
      left: plateArea.left,
      top: plateArea.top
    })
  }
  layers.push({ input: resizedLogo, left: box.left, top: box.top })

  const buffer = await sharp(image)
    .composite(layers)
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer()
  return { buffer, mediaType: 'image/jpeg', box, plate }
}

/**
 * A reference image as the models receive it: upright, at most 1280px on its
 * long edge, as JPEG. The greyscale copy is what the image model gets when
 * brand colours are set: it keeps the layout and the look, and leaves the
 * model no colours of the reference's to carry over.
 */
export async function prepareReferenceImage(
  buffer: Buffer
): Promise<{ colour: Buffer; greyscale: Buffer }> {
  let colour: Buffer
  try {
    colour = await sharp(buffer)
      .rotate()
      .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88 })
      .toBuffer()
  } catch {
    throw new Error('The reference image could not be read.')
  }
  const greyscale = await sharp(colour)
    .grayscale()
    .jpeg({ quality: 88 })
    .toBuffer()
  return { colour, greyscale }
}

/** A smaller copy for a vision model to judge: enough to read a headline. */
export async function downscaleForReview(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
}

/** Pixel size of an encoded image, or null when it cannot be decoded. */
export async function imageSize(
  buffer: Buffer
): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(buffer).metadata()
    return meta.width && meta.height
      ? { width: meta.width, height: meta.height }
      : null
  } catch {
    return null
  }
}
