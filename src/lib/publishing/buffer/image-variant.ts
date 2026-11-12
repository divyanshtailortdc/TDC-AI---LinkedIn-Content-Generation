import sharp, { type Sharp } from 'sharp'
import type { MediaVariant } from '../media-token'

/**
 * A post's image as a network takes it, for the signed link Buffer fetches
 * (src/app/api/publishing-media). Instagram takes feed images only as JPEG
 * and only from 4:5 (portrait) to 1.91:1 (landscape); the image is padded
 * into that range, never cropped, so nothing on it is cut off. Facebook
 * takes no WebP. Server only (sharp).
 */

const INSTAGRAM_MIN_RATIO = 4 / 5
const INSTAGRAM_MAX_RATIO = 1.91
/** Instagram shows feed images at most this wide; larger ones are only bigger downloads. */
const INSTAGRAM_MAX_WIDTH = 1440
const PAD_COLOUR = '#ffffff'

type Image = { bytes: Buffer; mediaType: string }

const toJpeg = async (input: Sharp): Promise<Image> => ({
  bytes: await input
    .flatten({ background: PAD_COLOUR })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer(),
  mediaType: 'image/jpeg'
})

/** How much to add to each side to bring width / height within Instagram's range. */
export function instagramPadding(width: number, height: number) {
  let padX = 0
  let padY = 0
  if (width / height > INSTAGRAM_MAX_RATIO) {
    padY = Math.ceil(width / INSTAGRAM_MAX_RATIO) - height
  } else if (width / height < INSTAGRAM_MIN_RATIO) {
    padX = Math.ceil(height * INSTAGRAM_MIN_RATIO) - width
  }
  return {
    top: Math.floor(padY / 2),
    bottom: padY - Math.floor(padY / 2),
    left: Math.floor(padX / 2),
    right: padX - Math.floor(padX / 2)
  }
}

export async function imageForVariant(
  variant: MediaVariant,
  image: Image
): Promise<Image> {
  if (variant === 'facebook') {
    return image.mediaType === 'image/webp' ? toJpeg(sharp(image.bytes)) : image
  }
  // The first frame of a GIF; turned upright by its EXIF orientation.
  const { data, info } = await sharp(image.bytes)
    .rotate()
    .resize({ width: INSTAGRAM_MAX_WIDTH, withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true })
  return toJpeg(
    sharp(data).extend({
      ...instagramPadding(info.width, info.height),
      background: PAD_COLOUR
    })
  )
}
