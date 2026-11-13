import 'server-only'

import sharp from 'sharp'
import { addUsage, EMPTY_USAGE, type CallUsage } from '~/lib/ai/usage'
import {
  isPictureStyle,
  type ImageStyle,
  type PictureStyle
} from '~/lib/brand/theme'
import { ImageGenerationAbortedError, producePicture } from '~/lib/media'
import type { BrandRendering } from '~/lib/media/brand-assets'
import {
  coverToSize,
  imageSize,
  isLightLogo,
  toDataUrl,
  type ImageBytes
} from '~/lib/media/brand-logo'
import { loadCanvasFonts, type LoadedFonts } from '~/lib/media/canvas/fonts'
import { canvasPalette, type CanvasPalette } from '~/lib/media/canvas/palette'
import type { CanvasLogo } from '~/lib/media/canvas/spec'
import {
  renderSlide,
  SLIDE_SIZE,
  slidePictureFrame
} from '~/lib/media/carousel/render'
import { buildPicturePrompt } from '~/lib/media/style-prompt'
import { PICTURE_LAYOUTS, type SlideContent } from './types'

/**
 * Drawing a carousel's slides: each slide's words set in real type in the
 * brand's colours, fonts and logo (src/lib/media/carousel/render), around
 * the generated picture on the slides that have one. Pictures come from the
 * same image model and vision check as a post's single image, in the
 * brand's image style; everything else is drawn by code, so a slide never
 * has a misspelt word.
 */

/** What every slide of one carousel is drawn with, loaded once. */
export interface SlideKit {
  fonts: LoadedFonts
  palette: CanvasPalette
  logo: CanvasLogo | null
  wordmark: string | null
  footer: string | null
  pattern: 'dots' | 'grid' | 'plain'
  style: ImageStyle
  brand: BrandRendering
}

export async function loadSlideKit(
  brand: BrandRendering,
  accountName: string | null
): Promise<SlideKit> {
  const theme = brand.theme
  let logo: CanvasLogo | null = null
  if (theme.showLogo && brand.logo) {
    const dimensions = await imageSize(brand.logo)
    if (dimensions) {
      logo = {
        dataUrl: toDataUrl(brand.logo, 'image/png'),
        width: dimensions.width,
        height: dimensions.height,
        plate: await isLightLogo(brand.logo)
      }
    }
  }
  return {
    fonts: await loadCanvasFonts(theme),
    palette: canvasPalette(theme),
    logo,
    // The account's name in the logo's place when the logo is on but none was uploaded.
    wordmark: !logo && theme.showLogo ? accountName : null,
    footer: theme.footerText?.trim() || null,
    // The brand's pattern; "auto" (the art director's pick for a single
    // image) is dots on slides, which carry no brief to choose from.
    pattern:
      theme.backgroundPattern === 'auto' ? 'dots' : theme.backgroundPattern,
    style: theme.visualStyle,
    brand
  }
}

/** Whether the brand's image style draws pictures on slides at all. */
export const drawsPictures = (kit: Pick<SlideKit, 'style'>) =>
  isPictureStyle(kit.style)

export interface SlidePictureResult {
  picture: ImageBytes
  /** What the vision check still found on it; empty when none. */
  issues: string[]
  prompt: string
  usage: CallUsage
}

/**
 * The picture for one slide, from its imagePrompt, at exactly the frame its
 * layout gives it, checked like a post's image. Throws
 * ImageGenerationAbortedError when stopped, and an Error when no picture
 * could be made.
 */
export async function makeSlidePicture(
  kit: SlideKit,
  slide: Pick<SlideContent, 'imagePrompt' | 'headline' | 'design'>,
  options: { caption: string; abortSignal?: AbortSignal }
): Promise<SlidePictureResult> {
  const style: PictureStyle = isPictureStyle(kit.style)
    ? kit.style
    : 'photorealistic'
  const layout = PICTURE_LAYOUTS.includes(slide.design.layout)
    ? slide.design.layout
    : 'photo'
  const frame = slidePictureFrame(layout, SLIDE_SIZE)
  const scene = slide.imagePrompt.trim() || slide.headline
  const prompt = buildPicturePrompt({
    style,
    scene,
    theme: kit.brand.theme,
    frame
  })
  let usage = EMPTY_USAGE
  const produced = await producePicture({
    prompt,
    style,
    target: frame,
    seed: Math.floor(Math.random() * 999_999) + 1,
    postText: options.caption,
    concept: [slide.headline, slide.imagePrompt].filter(Boolean).join(' — '),
    abortSignal: options.abortSignal,
    onUsage: u => {
      usage = addUsage(usage, u)
    }
  })
  const fitted = await coverToSize(produced.rendered.buffer, frame)
  return {
    picture: {
      buffer: fitted?.buffer ?? produced.rendered.buffer,
      mediaType: fitted?.resized ? 'image/jpeg' : produced.rendered.mediaType
    },
    issues: produced.issues,
    prompt: produced.prompt,
    usage
  }
}

/**
 * One slide drawn. With a picture it is a JPEG kept at full colour
 * resolution (a photograph as PNG runs to megabytes); without, a PNG.
 */
export async function drawSlide(
  kit: SlideKit,
  slide: SlideContent,
  position: { number: number; total: number },
  picture: ImageBytes | null
): Promise<ImageBytes> {
  const shown =
    picture && PICTURE_LAYOUTS.includes(slide.design.layout) ? picture : null
  const png = await renderSlide(
    {
      slide: { ...slide, ...position },
      picture: shown
        ? {
            image: shown.buffer,
            mediaType:
              shown.mediaType === 'image/png' ? 'image/png' : 'image/jpeg'
          }
        : null,
      palette: kit.palette,
      fonts: {
        heading: kit.fonts.heading,
        body: kit.fonts.body,
        headingWeight: kit.fonts.headingWeight
      },
      pattern: kit.pattern,
      logo: kit.logo,
      wordmark: kit.wordmark,
      footer: kit.footer,
      size: SLIDE_SIZE
    },
    kit.fonts.fonts
  )
  if (!shown) return { buffer: png, mediaType: 'image/png' }
  return {
    buffer: await sharp(png)
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer(),
    mediaType: 'image/jpeg'
  }
}

export interface DrawnCarouselSlide {
  slide: SlideContent
  image: ImageBytes | null
  picture: ImageBytes | null
  /** Why it could not be drawn; null when it was. */
  error: string | null
  /** What the reviewer should know about its picture. */
  issues: string[]
  picturePrompt?: string
}

/**
 * Every slide drawn, pictures made first for the slides that ask for one
 * (at most two at a time, so a stop is felt quickly). A picture that cannot
 * be made leaves its slide drawn without one, saying why; a stop throws
 * ImageGenerationAbortedError.
 */
export async function drawCarousel(
  kit: SlideKit,
  slides: SlideContent[],
  options: {
    caption: string
    abortSignal?: AbortSignal
    /** Pictures already made, by index, kept instead of made again. */
    pictures?: Array<ImageBytes | null>
  }
): Promise<{ slides: DrawnCarouselSlide[]; usage: CallUsage }> {
  let usage = EMPTY_USAGE
  const pictures: Array<ImageBytes | null> = slides.map(
    (_, i) => options.pictures?.[i] ?? null
  )
  const issues: string[][] = slides.map(() => [])
  const prompts: Array<string | undefined> = slides.map(() => undefined)

  const wanted = slides
    .map((slide, i) => ({ slide, i }))
    .filter(
      ({ slide, i }) =>
        slide.design.picture && !pictures[i] && drawsPictures(kit)
    )
  for (let start = 0; start < wanted.length; start += 2) {
    await Promise.all(
      wanted.slice(start, start + 2).map(async ({ slide, i }) => {
        try {
          const made = await makeSlidePicture(kit, slide, options)
          usage = addUsage(usage, made.usage)
          pictures[i] = made.picture
          issues[i]!.push(...made.issues)
          prompts[i] = made.prompt
        } catch (err) {
          if (err instanceof ImageGenerationAbortedError) throw err
          const reason =
            err instanceof Error ? err.message : 'the image model failed'
          issues[i]!.push(
            `The picture could not be made (${reason.replace(/\.$/, '')}), so this slide is drawn without one.`
          )
          slide.design.picture = false
        }
      })
    )
  }

  const total = slides.length
  const drawn = await Promise.all(
    slides.map(async (slide, i): Promise<DrawnCarouselSlide> => {
      try {
        const image = await drawSlide(
          kit,
          slide,
          { number: i + 1, total },
          pictures[i] ?? null
        )
        return {
          slide,
          image,
          picture: pictures[i] ?? null,
          error: null,
          issues: issues[i]!,
          picturePrompt: prompts[i]
        }
      } catch (err) {
        console.error(`Could not draw slide ${i + 1}:`, err)
        return {
          slide,
          image: null,
          picture: pictures[i] ?? null,
          error:
            err instanceof Error
              ? err.message
              : 'The slide could not be drawn.',
          issues: issues[i]!,
          picturePrompt: prompts[i]
        }
      }
    })
  )
  return { slides: drawn, usage }
}
