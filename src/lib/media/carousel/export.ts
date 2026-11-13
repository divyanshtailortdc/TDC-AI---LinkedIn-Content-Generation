import sharp from 'sharp'
import { jpegPagesToPdf } from './pdf'
import { zipFiles } from './zip'

/**
 * A carousel's slides as one file: a PDF (LinkedIn's document post, and
 * "Download PDF") or a ZIP of the slide images ("Download all slides").
 * Server only (sharp).
 */

export interface SlideImage {
  bytes: Buffer
  mediaType: string
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

/**
 * Every slide as a JPEG page: a PDF embeds JPEG as it is. Transparency is
 * flattened onto white, and chroma is kept at full resolution so the slide's
 * small type stays sharp.
 */
export async function slidesToPdf(
  images: SlideImage[],
  title?: string
): Promise<Buffer> {
  const pages = await Promise.all(
    images.map(async image => {
      const { data, info } = await sharp(image.bytes)
        .flatten({ background: '#ffffff' })
        .toColourspace('srgb')
        .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
        .toBuffer({ resolveWithObject: true })
      return { jpeg: data, width: info.width, height: info.height }
    })
  )
  return jpegPagesToPdf(pages, { title })
}

/** A name safe as a file name on every system: no paths or reserved characters. */
function safeBaseName(baseName: string): string {
  const clean = baseName
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
  return clean || 'slide'
}

/**
 * The slides in order as `${baseName}-01.png`, `-02.jpg`…, each in its own
 * format; an image in any other format is converted to PNG.
 */
export async function slidesToZip(
  images: SlideImage[],
  baseName: string
): Promise<Buffer> {
  const base = safeBaseName(baseName)
  const digits = Math.max(2, String(images.length).length)
  const files = await Promise.all(
    images.map(async (image, i) => {
      const known = EXTENSIONS[image.mediaType]
      const data = known
        ? image.bytes
        : await sharp(image.bytes).png().toBuffer()
      return {
        name: `${base}-${String(i + 1).padStart(digits, '0')}.${known ?? 'png'}`,
        data
      }
    })
  )
  return zipFiles(files)
}
