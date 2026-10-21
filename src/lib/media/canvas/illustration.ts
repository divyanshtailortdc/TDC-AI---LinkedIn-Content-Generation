import sharp, { type Sharp } from 'sharp'

/**
 * Fits an illustration from the image model into the visual side of the
 * canvas. Asked for a pure white background, it usually gets one: that white
 * is turned transparent, so the illustration stands on the canvas's own
 * background and pattern. One whose edges are not white (a tinted backdrop, a
 * scene running off the edge) is kept whole and shown as a card instead.
 *
 * No `server-only` import, so tests can run it on real bytes.
 */

/** Side of the square the illustration is stored at; the canvas scales it. */
export const ILLUSTRATION_EDGE = 1000

/** Mean and spread of each channel over a band along the image's edges. */
async function edgeStats(image: Sharp, edge: number) {
  const band = Math.round(edge * 0.04)
  const strips = await Promise.all(
    [
      { left: 0, top: 0, width: edge, height: band },
      { left: 0, top: edge - band, width: edge, height: band },
      { left: 0, top: 0, width: band, height: edge },
      { left: edge - band, top: 0, width: band, height: edge }
    ].map(area => image.clone().extract(area).removeAlpha().stats())
  )
  const channels = [0, 1, 2].map(c => ({
    mean: strips.reduce((sum, s) => sum + s.channels[c]!.mean, 0) / strips.length,
    stdev: Math.max(...strips.map(s => s.channels[c]!.stdev))
  }))
  return channels
}

/** True when the edges are plain white or nearly so. */
export async function hasWhiteEdges(buffer: Buffer): Promise<boolean> {
  const image = sharp(buffer).resize(ILLUSTRATION_EDGE, ILLUSTRATION_EDGE, {
    fit: 'cover'
  })
  const stats = await edgeStats(image, ILLUSTRATION_EDGE)
  return stats.every(c => c.mean >= 238 && c.stdev <= 22)
}

/**
 * White becomes transparent and every other colour keeps exactly how it
 * looked over white (GIMP's "colour to alpha"), so soft shadows and
 * anti-aliased edges carry over onto any light background.
 */
export async function whiteToAlpha(buffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buffer)
    .resize(ILLUSTRATION_EDGE, ILLUSTRATION_EDGE, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const out = Buffer.alloc(info.width * info.height * 4)
  for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
    const r = data[p]!
    const g = data[p + 1]!
    const b = data[p + 2]!
    let alpha = Math.max(255 - r, 255 - g, 255 - b) / 255
    // Compression noise in the white would otherwise leave a faint haze.
    if (alpha < 0.035) alpha = 0
    if (alpha > 0) {
      const lift = 255 * (1 - alpha)
      out[q] = Math.round((r - lift) / alpha)
      out[q + 1] = Math.round((g - lift) / alpha)
      out[q + 2] = Math.round((b - lift) / alpha)
    }
    out[q + 3] = Math.round(alpha * 255)
  }
  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 }
  })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

export async function prepareIllustration(
  buffer: Buffer
): Promise<{ image: Buffer; framed: boolean }> {
  if (await hasWhiteEdges(buffer)) {
    return { image: await whiteToAlpha(buffer), framed: false }
  }
  const image = await sharp(buffer)
    .resize(ILLUSTRATION_EDGE, ILLUSTRATION_EDGE, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toBuffer()
  return { image, framed: true }
}
