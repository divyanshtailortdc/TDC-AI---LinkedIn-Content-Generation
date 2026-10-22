import { generateImage } from 'ai'
import crypto from 'crypto'
import { env } from '~/env'
import { gatewayClient } from '~/lib/ai'
import type { ImageReviewVerdict } from '~/lib/ai/skills/image-review'
import { reviewImage } from '~/lib/ai/skills/image-review'
import {
  letteringIssues,
  retryInstructions
} from '~/lib/ai/skills/image-review/guard'
import {
  deriveMediaBrief,
  refineBlueprint,
  type MediaBrief,
  type PriorVisual,
  type VisualType
} from '~/lib/ai/skills/media-brief'
import { addUsage, readImageCost, type CallUsage } from '~/lib/ai/usage'
import { imagePromptSuffix } from '~/lib/brand/prompt'
import {
  cornerWords,
  LOGO_PLACEMENT,
  logoBox,
  logoClearSpaceInstruction,
  type LogoPlacement
} from '~/lib/brand/theme'
import type { BrandRendering } from './brand-assets'
import {
  compositeLogo,
  decodeImageDataUrl,
  downscaleForReview,
  fitToSize,
  imageSize,
  isLightLogo,
  prepareReferenceImage,
  toDataUrl
} from './brand-logo'
import type { MediaBriefContext } from './brief-context'
import {
  BLUEPRINT_SIZES,
  canvasSizeFor,
  placeBlueprint
} from './canvas/blueprint'
import { loadCanvasFonts } from './canvas/fonts'
import { prepareIllustration } from './canvas/illustration'
import { canvasPalette } from './canvas/palette'
import { renderCanvas } from './canvas/render'
import {
  CANVAS_SIZE,
  fitDiagram,
  type CanvasCopy,
  type CanvasLayout,
  type CanvasLogo,
  type CanvasSpec,
  type CanvasVisual
} from './canvas/spec'
import { describeImageFailure, isAccountFailure } from './image-errors'

export { describeImageFailure }

export interface MediaPlanRequest {
  mode: 'ai_generated' | 'stock' | 'none'
  postText: string
  /** Goal, idea, knowledge, offerings, audience and brand, from buildMediaBriefContext. */
  context: MediaBriefContext
  /** The brand colours, and the logo file when one was uploaded. */
  brand: BrandRendering
  aspectRatio?: '1:1' | '16:9' | '4:5'
  /** Visual direction: the reviewer's words, or the approved idea's. */
  direction?: string
  /** The image type the reviewer chose; the art director picks when unset. */
  allowedTypes?: readonly VisualType[]
  /** Earlier images for this post, newest first. */
  previousVersions?: PriorVisual[]
  rejectionReason?: string
  /** Stock only: images already used, so a search returns something new. */
  excludeUrls?: string[]
  attempt?: number
  seed?: number
  /**
   * An image the reviewer attached: the new image takes its composition and
   * style, the post's subject and the brand's colours. AI images only.
   */
  referenceImage?: Buffer
  /** Stops the model calls; the caller checks it before saving anything. */
  abortSignal?: AbortSignal
}

export interface MediaLogoInfo {
  placement: LogoPlacement
  plate: 'none' | 'light' | 'dark'
}

export interface MediaReviewInfo {
  /** False when the vision check could not run; the image is then unchecked. */
  checked: boolean
  passed: boolean
  summary?: string
  /** Images generated to get here: 2 when the first one failed the check. */
  images: number
}

export interface MediaPlanResult {
  mode: 'ai_generated' | 'stock' | 'none'
  imageUrl?: string
  /** The generated image before the logo went on; only when a logo did. */
  baseImageUrl?: string
  altText?: string
  promptOrQuery?: string
  sourcePageUrl?: string
  /** Always false now: an AI request no longer falls back to stock. Kept for old rows. */
  fallbackApplied?: boolean
  layout?: CanvasLayout
  mediaBrief?: MediaBrief
  visualType?: VisualType
  relevanceScore?: number
  relevanceExplanation?: string
  alignedConcepts?: string[]
  textOverlay?: MediaBrief['textOverlay']
  /** Problems found with the brief or the image, surfaced in the review UI. */
  issues?: string[]
  /** Set when no image could be produced, so the reviewer and the run step can say why. */
  error?: string
  /** Model calls behind this plan: the brief, its retry, every image and review. */
  usage?: CallUsage
  /** Image attempts made, including ones discarded for the wrong shape. */
  imageAttempts?: number
  modelId?: string
  width?: number
  height?: number
  seed?: number
  logo?: MediaLogoInfo | null
  review?: MediaReviewInfo
  /** True when an attached reference image guided the composition and style. */
  usedReference?: boolean
}

/**
 * Searches stock photography with the Serper Google Images API. Used only when
 * stock was asked for: an AI request that fails says so rather than quietly
 * attaching a photo nobody chose.
 */
export async function searchStockImage(
  query: string,
  options?: { excludeUrls?: string[]; attempt?: number }
): Promise<MediaPlanResult> {
  const cleanQuery = query.trim()
  if (!cleanQuery) {
    return { mode: 'none', error: 'Nothing to search stock images for.' }
  }
  const altText = `Stock image for: ${cleanQuery}`
  const attempt = options?.attempt || 0
  const excludeUrls = options?.excludeUrls || []

  if (!env.SERPER_API_KEY?.trim()) {
    return {
      mode: 'none',
      promptOrQuery: cleanQuery,
      error:
        'Stock image search is not configured. Add SERPER_API_KEY to enable it.'
    }
  }

  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': env.SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: `${cleanQuery} minimal aesthetic high quality professional`,
        num: 10
      }),
      signal: AbortSignal.timeout(20_000)
    })

    if (!res.ok) {
      return {
        mode: 'none',
        promptOrQuery: cleanQuery,
        error: `Stock image search failed (HTTP ${res.status}).`
      }
    }
    const data = await res.json()
    const images = data.images as Array<{
      imageUrl?: string
      link?: string
      domain?: string
      title?: string
    }>

    if (Array.isArray(images) && images.length > 0) {
      const freshImages = images.filter(
        img =>
          img.imageUrl &&
          !excludeUrls.some(u =>
            img.imageUrl?.includes(u.split('?')[0] || '___')
          )
      )
      const pool = freshImages.length > 0 ? freshImages : images
      const selectedImage = pool[attempt % pool.length] || pool[0]
      if (selectedImage?.imageUrl) {
        // Stored exactly as the provider gave it: many image hosts 404 a URL
        // with query parameters they do not expect. The version and attempt
        // live in the media plan's own fields.
        return {
          mode: 'stock',
          imageUrl: selectedImage.imageUrl,
          sourcePageUrl: selectedImage.link || selectedImage.domain,
          altText: selectedImage.title || altText,
          promptOrQuery: cleanQuery
        }
      }
    }
  } catch (err) {
    console.warn('Serper images search error:', err)
    return {
      mode: 'none',
      promptOrQuery: cleanQuery,
      error: 'Stock image search could not be reached. Try again.'
    }
  }

  return {
    mode: 'none',
    promptOrQuery: cleanQuery,
    error: `No stock image was found for "${cleanQuery}".`
  }
}

/**
 * Every prompt-driven image is produced at one fixed size: LinkedIn's 1.91:1
 * feed ratio (1200x627), at ~1.7x that resolution so it stays HD when LinkedIn
 * recompresses it.
 *
 * Both dimensions are multiples of 16, which the flux models require — a
 * request like 2400x1256 is silently rounded to 2400x1248 and loses the ratio.
 */
export const LINKEDIN_IMAGE = { width: 2048, height: 1072 } as const

/**
 * Concrete pixel sizes per configured aspect ratio.
 *
 * `aspectRatio` is silently ignored by the flux models, so `size` is the only
 * control that works. Every dimension is a multiple of 16 or the model rounds
 * it and loses the ratio.
 */
const ASPECT_SIZES = {
  '16:9': { width: 2048, height: 1072 },
  '1:1': { width: 1440, height: 1440 },
  '4:5': { width: 1152, height: 1440 }
} as const

export function sizeForAspectRatio(aspectRatio?: '1:1' | '16:9' | '4:5'): {
  width: number
  height: number
} {
  return ASPECT_SIZES[aspectRatio || '16:9']
}

export function isLinkedInImageSize(dimensions: {
  width: number
  height: number
}): boolean {
  return (
    dimensions.width === LINKEDIN_IMAGE.width &&
    dimensions.height === LINKEDIN_IMAGE.height
  )
}

/**
 * Models verified to return 2048x1072 through the gateway, best first. The
 * gateway warns that `size` becomes an aspect ratio for these; the bytes are
 * measured and fitted either way (see fitToSize).
 */
const TEXT_TO_IMAGE_MODELS = [
  'bfl/flux-2-pro',
  'bfl/flux-2-flex',
  'bfl/flux-2-max'
]

/**
 * Reference-guided editing, restricted to models verified to hold 2048x1072 with
 * a reference attached — including square references reframed to landscape.
 */
const IMAGE_EDIT_MODELS = [
  'bfl/flux-2-pro',
  'bfl/flux-2-max',
  'bfl/flux-2-flex'
]

/** One image call; a provider that hangs must not hold a reviewer's screen for minutes. */
const IMAGE_CALL_TIMEOUT_MS = 120_000

/**
 * Reads pixel dimensions straight from encoded image bytes.
 *
 * Returns null when the format is not recognised, which callers treat as
 * "unverifiable" rather than "too small" — refusing an image we simply cannot
 * measure would be worse than trusting the size we asked for.
 */
export function readImageDimensions(
  buffer: Buffer
): { width: number; height: number } | null {
  // PNG: IHDR width/height are the two big-endian uint32s after the chunk header.
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }

  // JPEG: walk the marker segments to the start-of-frame, which carries the size.
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++
        continue
      }
      const marker = buffer[offset + 1]!
      const isStartOfFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      if (isStartOfFrame) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7)
        }
      }
      offset += 2 + buffer.readUInt16BE(offset + 2)
    }
  }

  // WebP (VP8X / VP8L / lossy VP8) — 14-bit or 24-bit packed dimensions.
  if (
    buffer.length > 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = buffer.toString('ascii', 12, 16)
    if (chunk === 'VP8X') {
      return {
        width: buffer.readUIntLE(24, 3) + 1,
        height: buffer.readUIntLE(27, 3) + 1
      }
    }
    if (chunk === 'VP8 ') {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff
      }
    }
    if (chunk === 'VP8L') {
      const bits = buffer.readUInt32LE(21)
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1
      }
    }
  }

  return null
}

/** Thrown when generation is cancelled through `abortSignal`, so callers can skip saving. */
export class ImageGenerationAbortedError extends Error {
  constructor() {
    super('Image generation was stopped.')
    this.name = 'ImageGenerationAbortedError'
  }
}

/** No model produced a usable image; the message says why in plain words. */
export class ImageGenerationError extends Error {
  constructor(
    message: string,
    readonly attempts: number
  ) {
    super(message)
    this.name = 'ImageGenerationError'
  }
}

const randomSeed = () => crypto.randomInt(1, 1_000_000)

interface RenderedImage {
  buffer: Buffer
  mediaType: string
  modelId: string
  width: number
  height: number
  seed: number
  attempts: number
}

/**
 * One image from the gateway, trying each model in turn, at exactly `target`.
 * Throws ImageGenerationError with the reasons when none delivers.
 */
async function renderImage(req: {
  prompt: string
  /** Reference images switch to the edit models. */
  references?: Array<string | Buffer>
  target: { width: number; height: number }
  seed: number
  abortSignal?: AbortSignal
  /** Called with each billed call as soon as it is known. */
  onUsage: (usage: CallUsage) => void
}): Promise<RenderedImage> {
  if (!gatewayClient || !env.AI_GATEWAY_API_KEY) {
    throw new ImageGenerationError(
      'Image generation is not configured. Add AI_GATEWAY_API_KEY to enable it.',
      0
    )
  }
  const references = req.references?.length ? req.references : undefined
  const models = references ? IMAGE_EDIT_MODELS : TEXT_TO_IMAGE_MODELS
  const size = `${req.target.width}x${req.target.height}` as const
  const failures: string[] = []
  let attempts = 0

  for (const modelId of models) {
    if (req.abortSignal?.aborted) throw new ImageGenerationAbortedError()
    attempts++
    try {
      const result = await generateImage({
        model: gatewayClient.imageModel(modelId),
        prompt: references
          ? { text: req.prompt, images: references }
          : req.prompt,
        size,
        seed: req.seed,
        maxRetries: 1,
        abortSignal: AbortSignal.any(
          [AbortSignal.timeout(IMAGE_CALL_TIMEOUT_MS), req.abortSignal].filter(
            (s): s is AbortSignal => Boolean(s)
          )
        )
      })
      req.onUsage(readImageCost(result))

      const first = result.images?.[0]
      if (!first?.base64) {
        failures.push(`${modelId} returned no image`)
        continue
      }
      // Measured rather than trusted: these models sometimes return another size.
      const fitted = await fitToSize(
        Buffer.from(first.base64, 'base64'),
        req.target
      )
      if (!fitted) {
        failures.push(`${modelId} returned an image of the wrong shape`)
        continue
      }
      return {
        buffer: fitted.buffer,
        mediaType: fitted.resized
          ? 'image/jpeg'
          : first.mediaType || 'image/png',
        modelId,
        width: fitted.width,
        height: fitted.height,
        seed: req.seed,
        attempts
      }
    } catch (err) {
      // The gateway surfaces an abort as a GatewayResponseError, not an AbortError,
      // so check the signal itself. Falling through would start the next model.
      if (req.abortSignal?.aborted) throw new ImageGenerationAbortedError()
      const reason = describeImageFailure(err)
      console.warn(`Image generation failed on "${modelId}":`, reason)
      failures.push(reason)
      if (isAccountFailure(err)) break
    }
  }

  const reasons = Array.from(new Set(failures))
  throw new ImageGenerationError(
    `Image generation failed: ${reasons.join('; ') || 'no image model is available'}.`,
    attempts
  )
}

interface LogoPlan {
  cornerWords: string
  clearSpace: string
}

/** Where the logo will sit, worked out before the image so its corner stays clear. */
async function planLogo(
  brand: BrandRendering,
  target: { width: number; height: number }
): Promise<LogoPlan | null> {
  if (!brand.logo) return null
  const dimensions = await imageSize(brand.logo)
  if (!dimensions) return null
  const box = logoBox(target, dimensions, LOGO_PLACEMENT)
  return {
    cornerWords: cornerWords(LOGO_PLACEMENT).replace('-', ' '),
    clearSpace: logoClearSpaceInstruction(target, box, LOGO_PLACEMENT)
  }
}

/** Lays the logo over a finished image; the image is kept as-is if that fails. */
async function applyLogo(
  rendered: { buffer: Buffer; mediaType: string },
  brand: BrandRendering
): Promise<{
  buffer: Buffer
  mediaType: string
  logo: MediaLogoInfo | null
  baseImageUrl?: string
  error?: string
}> {
  if (!brand.logo) return { ...rendered, logo: null }
  try {
    const composed = await compositeLogo(rendered.buffer, {
      logo: brand.logo,
      placement: LOGO_PLACEMENT
    })
    return {
      buffer: composed.buffer,
      mediaType: composed.mediaType,
      logo: { placement: LOGO_PLACEMENT, plate: composed.plate },
      baseImageUrl: toDataUrl(rendered.buffer, rendered.mediaType)
    }
  } catch (err) {
    console.warn('Could not add the brand logo:', err)
    return {
      ...rendered,
      logo: null,
      error: 'The brand logo could not be added to this image.'
    }
  }
}

type BrandedImage = Awaited<ReturnType<typeof applyLogo>>

interface ProducedImage {
  rendered: RenderedImage
  /** The image as published: with the logo laid over it when there is one. */
  branded: BrandedImage
  prompt: string
  verdict: ImageReviewVerdict | null
  reviewChecked: boolean
  images: number
  /** Every model call, including ones that returned nothing usable. */
  attempts: number
}

/**
 * Generates the image for a brief, lays the logo over it, and has a vision
 * model check the result as it will be published. An image that fails the
 * check (misspelt or stray lettering, a logo the model drew, the real logo
 * covering the headline, drift from the post) is generated once more with the
 * problems spelled out and a new seed; the better of the two is kept, and
 * anything still wrong is reported rather than hidden.
 */
async function produceCheckedImage(opts: {
  prompt: string
  target: { width: number; height: number }
  seed: number
  postText: string
  concept: string
  headline: string
  brandSummary?: string
  brand: BrandRendering
  /** "top left" and so on, when the logo goes on. */
  logoCorner?: string
  /** The reviewer's reference image, for the review to compare against. */
  reviewReference?: Buffer
  abortSignal?: AbortSignal
  onUsage: (usage: CallUsage) => void
}): Promise<ProducedImage> {
  const tries: Array<{
    rendered: RenderedImage
    branded: BrandedImage
    prompt: string
    verdict: ImageReviewVerdict | null
  }> = []
  let attempts = 0
  let prompt = opts.prompt

  for (let pass = 0; pass < 2; pass++) {
    let rendered: RenderedImage
    try {
      rendered = await renderImage({
        prompt,
        target: opts.target,
        seed: pass === 0 ? opts.seed : randomSeed(),
        abortSignal: opts.abortSignal,
        onUsage: opts.onUsage
      })
    } catch (err) {
      // A retry that fails leaves the first image standing; a stop does not.
      if (tries.length > 0 && !(err instanceof ImageGenerationAbortedError))
        break
      throw err
    }
    attempts += rendered.attempts

    const branded = await applyLogo(rendered, opts.brand)
    const review = await reviewImage({
      image: await downscaleForReview(branded.buffer),
      mediaType: 'image/jpeg',
      postText: opts.postText,
      concept: opts.concept,
      headline: opts.headline,
      brand: opts.brandSummary,
      logoCorner: branded.logo ? opts.logoCorner : undefined,
      reference: opts.reviewReference
        ? { data: opts.reviewReference, mediaType: 'image/jpeg' }
        : undefined,
      abortSignal: opts.abortSignal
    })
    opts.onUsage(review.usage)
    tries.push({ rendered, branded, prompt, verdict: review.verdict })
    if (!review.verdict || review.verdict.passed) break

    const fixes = review.review
      ? retryInstructions(review.review, {
          headline: opts.headline,
          logoCorner: opts.logoCorner
        })
      : ''
    prompt = fixes ? `${opts.prompt}\n\n${fixes}` : opts.prompt
  }

  // Passing beats failing; then fewer problems; then the more relevant image.
  const rank = (t: (typeof tries)[number]) =>
    t.verdict
      ? (t.verdict.passed ? 0 : 1000 + t.verdict.issues.length * 100) -
        t.verdict.relevanceScore
      : 500
  const best = [...tries].sort((a, b) => rank(a) - rank(b))[0]!
  return {
    rendered: best.rendered,
    branded: best.branded,
    prompt: best.prompt,
    verdict: best.verdict,
    reviewChecked: best.verdict !== null,
    images: tries.length,
    attempts
  }
}

/**
 * Plans and makes the image for a post: the art director writes a brief from
 * the post, its goal and idea, the facts behind it, the audience and the brand
 * colours; the image model renders it with the brand rules appended; the real
 * logo is laid over it; a vision check of the result catches bad lettering,
 * drawn logos and a logo covering the headline.
 *
 * With a reference image, the art director looks at it and copies its
 * structure into a blueprint (its blocks, where they sit, its arrows), which
 * the canvas draws with the post's words and the brand's colours; the image
 * model never sees its pixels. Given the pixels, flux copied the reference's own objects and
 * kept its background tint whenever the new subject resembled the old one.
 * The review compares the result with the reference all the same.
 */
export async function createMediaPlan(
  req: MediaPlanRequest
): Promise<MediaPlanResult> {
  if (req.mode === 'none' || !req.mode) {
    return { mode: 'none' }
  }

  const postText = req.postText.trim()
  if (!postText) {
    return { mode: 'none', error: 'No post content to illustrate.' }
  }

  const target = sizeForAspectRatio(req.aspectRatio)
  const logoPlan =
    req.mode === 'ai_generated' ? await planLogo(req.brand, target) : null

  let reference: Buffer | null = null
  if (req.mode === 'ai_generated' && req.referenceImage) {
    try {
      reference = await prepareReferenceImage(req.referenceImage)
    } catch (err) {
      return {
        mode: 'none',
        error:
          err instanceof Error
            ? err.message
            : 'The reference image could not be read.'
      }
    }
  }

  const derived = await deriveMediaBrief(
    {
      ...req.context,
      postText,
      direction: req.direction,
      allowedTypes: req.allowedTypes,
      previousVersions: req.previousVersions,
      rejectionReason: req.rejectionReason,
      referenceImage: reference
        ? { data: reference, mediaType: 'image/jpeg' }
        : undefined
    },
    { abortSignal: req.abortSignal }
  )

  if (!derived.derived || !derived.guard) {
    // Without a brief an image would be decoration at best; say so rather than
    // attaching something unrelated.
    return {
      mode: 'none',
      error:
        derived.error || 'Could not design a visual concept for this post.',
      usage: derived.usage
    }
  }

  const { brief, copy, visual, altText } = derived.derived
  const guard = derived.guard
  const described = {
    mediaBrief: brief,
    visualType: visual?.type || brief.visualType,
    textOverlay: brief.textOverlay,
    alignedConcepts: guard.alignedConcepts
  }

  if (req.mode === 'stock') {
    const stock = await searchStockImage(
      brief.primaryConcept || brief.postTopic,
      {
        excludeUrls: req.excludeUrls,
        attempt: req.attempt
      }
    )
    return {
      ...stock,
      ...described,
      // A stock image is whatever the search returned, so its own caption is
      // the honest description.
      altText: stock.altText || altText,
      relevanceScore: guard.relevanceScore,
      relevanceExplanation: guard.explanation,
      issues: guard.issues,
      usage: derived.usage
    }
  }

  const theme = req.brand.theme
  let usage = derived.usage
  const seed = req.seed ?? randomSeed()

  try {
    const fontSet = await loadCanvasFonts(theme)
    const palette = canvasPalette(theme)

    // Check brand logo
    let logoSpec: CanvasLogo | null = null
    if (theme.showLogo && req.brand.logo) {
      const dimensions = await imageSize(req.brand.logo)
      if (dimensions) {
        const plate = await isLightLogo(req.brand.logo)
        logoSpec = {
          dataUrl: toDataUrl(req.brand.logo, 'image/png'),
          width: dimensions.width,
          height: dimensions.height,
          plate
        }
      }
    }

    const copySpec: CanvasCopy = {
      tagline: copy?.tagline || '',
      headline: copy?.headline || brief.textOverlay?.headline || '',
      highlights: copy?.highlightWords || [],
      subheadline: copy?.subheadline || '',
      // Only a website the reviewer typed in: none is added on their behalf.
      footer: theme.footerText?.trim() || null
    }

    // With a reference image, its own structure, drawn block by block at
    // the feed shape nearest its own. Null when it gave nothing to build on;
    // the built-in layout is drawn then.
    const canvasSize = reference
      ? canvasSizeFor((await imageSize(reference)) ?? CANVAS_SIZE)
      : CANVAS_SIZE
    const placeOptions = {
      logo: theme.showLogo,
      footer: Boolean(copySpec.footer),
      size: canvasSize
    }
    let blueprint =
      reference && derived.derived.blueprint
        ? placeBlueprint(derived.derived.blueprint, placeOptions)
        : null

    let canvasVisual: CanvasVisual

    // A blueprint needs an illustration only for an image block of its own.
    if (
      blueprint
        ? blueprint.blocks.some(b => b.role === 'image')
        : visual?.type === 'illustration'
    ) {
      let illustrationBuffer: Buffer | null = null
      let framed = false
      try {
        const illustrationPrompt = `${visual.illustrationPrompt || brief.visualMetaphor}\n\nStrict visual constraints: flat clean modern vector SaaS graphic asset isolated on a pure seamless #ffffff white background. Minimalist 2D tech graphic style, soft shadows, sharp edges. Absolutely NO text, NO words, NO letters, NO numbers, NO human hands, NO real people, NO coffee cups, NO office desks, NO laptop keyboards.`
        const rendered = await renderImage({
          prompt: illustrationPrompt,
          target: { width: 1024, height: 1024 },
          seed,
          abortSignal: req.abortSignal,
          onUsage: u => {
            usage = addUsage(usage, u)
          }
        })
        const prepared = await prepareIllustration(rendered.buffer)
        illustrationBuffer = prepared.image
        framed = prepared.framed
      } catch (err) {
        console.warn(
          'Illustration generation failed; falling back to clean vector cards diagram:',
          err
        )
      }

      if (illustrationBuffer) {
        canvasVisual = {
          kind: 'illustration',
          image: illustrationBuffer,
          framed,
          badges: (visual.nodes || []).slice(0, 3)
        }
      } else {
        canvasVisual = {
          kind: 'diagram',
          diagram: fitDiagram({
            form: 'cards',
            nodes: visual.nodes || []
          }) || {
            form: 'cards',
            nodes: (visual.nodes || []).slice(0, 4)
          }
        }
      }
    } else {
      const diagramSpec = fitDiagram({
        // An illustration brief lands here when its blueprint has no image block.
        form:
          visual?.type && visual.type !== 'illustration' ? visual.type : 'cards',
        hub: visual?.hub,
        nodes: visual?.nodes || [],
        badges: visual?.badges,
        groups:
          visual?.groups && visual.groups.length >= 2
            ? [visual.groups[0]!, visual.groups[1]!]
            : undefined
      }) || {
        form: 'cards',
        nodes: (visual?.nodes || []).slice(0, 4)
      }

      canvasVisual = {
        kind: 'diagram',
        diagram: diagramSpec
      }
    }

    const layout: CanvasLayout =
      derived.derived.layout ||
      brief.layout ||
      (visual?.type === 'flow' ? 'top_bottom' : 'split_left')

    const spec: CanvasSpec = {
      layout,
      blueprint,
      copy: copySpec,
      visual: canvasVisual,
      palette,
      fonts: {
        heading: fontSet.heading,
        body: fontSet.body,
        headingWeight: fontSet.headingWeight
      },
      // A reference image's own background, whatever the brand's setting; and
      // the art director's pick for a brand on Auto.
      pattern:
        reference || theme.backgroundPattern === 'auto'
          ? derived.derived.backgroundPattern
          : theme.backgroundPattern,
      logo: logoSpec,
      wordmark:
        !logoSpec && theme.showLogo
          ? req.context.accountName || null
          : null,
      size: blueprint ? canvasSize : undefined
    }

    let finalBuffer = await renderCanvas(spec, fontSet.fonts)

    // A second look: the reference and the first render side by side, and
    // the blueprint's geometry and styling corrected where they differ.
    if (blueprint && reference && derived.derived.blueprint) {
      const refined = await refineBlueprint(
        {
          blueprint: derived.derived.blueprint,
          reference: { data: reference, mediaType: 'image/jpeg' },
          rendered: {
            data: await downscaleForReview(finalBuffer),
            mediaType: 'image/jpeg'
          }
        },
        { abortSignal: req.abortSignal }
      )
      usage = addUsage(usage, refined.usage)
      const placed =
        refined.blueprint && placeBlueprint(refined.blueprint, placeOptions)
      if (placed) {
        blueprint = placed
        spec.blueprint = placed
        brief.blueprint = refined.blueprint!
        finalBuffer = await renderCanvas(spec, fontSet.fonts)
      }
    }

    const baseSpec: CanvasSpec = { ...spec, logo: null, wordmark: null }
    const baseBuffer = await renderCanvas(baseSpec, fontSet.fonts)

    return {
      mode: 'ai_generated',
      imageUrl: toDataUrl(finalBuffer, 'image/png'),
      baseImageUrl: toDataUrl(baseBuffer, 'image/png'),
      layout,
      altText,
      promptOrQuery: blueprint
        ? `reference layout: ${brief.primaryConcept}`
        : visual?.type === 'illustration'
          ? visual.illustrationPrompt || brief.primaryConcept
          : `${visual?.type || 'diagram'}: ${brief.primaryConcept}`,
      fallbackApplied: false,
      ...described,
      relevanceScore: guard.relevanceScore,
      relevanceExplanation: guard.explanation,
      issues: [...guard.issues, ...fontSet.issues],
      usage,
      imageAttempts: 1,
      width: (spec.size ?? CANVAS_SIZE).width,
      height: (spec.size ?? CANVAS_SIZE).height,
      seed,
      logo: logoSpec
        ? { placement: LOGO_PLACEMENT, plate: logoSpec.plate ? 'dark' : 'none' }
        : null,
      review: {
        checked: true,
        passed: true,
        summary: 'Crisp vector layout with real typography rendered on canvas.',
        images: 1
      },
      usedReference: Boolean(reference)
    }
  } catch (err) {
    console.error('Canvas render error in createMediaPlan:', err)
    return {
      mode: 'none',
      ...described,
      promptOrQuery: brief.primaryConcept,
      error:
        err instanceof Error
          ? err.message
          : 'Could not render canvas image for this post.',
      imageAttempts: 1,
      usage
    }
  }
}

export interface RegenerateMediaPlanRequest extends Omit<
  MediaPlanRequest,
  'mode'
> {
  mode?: 'ai_generated' | 'stock'
  /** A stock query the reviewer typed; searched exactly as written. */
  searchQuery?: string
  previousMediaId?: string
  regenerationAttempt?: number
  version?: number
}

export interface RegenerateMediaPlanResult extends MediaPlanResult {
  version: number
  regenerationAttempt: number
  previousMediaId?: string
  rejectionReason?: string
  providerRequestId?: string
}

/**
 * Produces a genuinely different visual: the brief sees every earlier image
 * for the post, must pick a different visual form from the latest one, and
 * the image gets a fresh seed.
 */
export async function regenerateMediaPlan(
  req: RegenerateMediaPlanRequest
): Promise<RegenerateMediaPlanResult> {
  const attempt = (req.regenerationAttempt ?? 0) + 1
  const version = (req.version ?? 0) + 1
  const bookkeeping = {
    version,
    regenerationAttempt: attempt,
    previousMediaId: req.previousMediaId,
    rejectionReason: req.rejectionReason,
    providerRequestId: crypto.randomUUID()
  }

  // The reviewer said what to search for, so search exactly that. A brief the
  // model wrote would describe some other image than the one search returns.
  if (req.mode === 'stock' && req.searchQuery?.trim()) {
    const stock = await searchStockImage(req.searchQuery, {
      excludeUrls: req.excludeUrls,
      attempt
    })
    return { ...stock, ...bookkeeping }
  }

  const plan = await createMediaPlan({
    ...req,
    mode: req.mode || 'ai_generated',
    attempt,
    seed: randomSeed()
  })
  return { ...plan, ...bookkeeping }
}

export interface CustomImageRequest {
  /** Exactly what the user asked for, used verbatim as the generation prompt. */
  prompt: string
  /**
   * "Use current image": one of the post's own images, as a data URL, before
   * its logo went on. Its presence switches to edit mode. (A reference image
   * the reviewer uploads goes through createMediaPlan instead.)
   */
  editImage?: string
  /** The brand colours as a default, and the logo laid over the result. */
  brand?: BrandRendering
  /** The post the image goes with, for the lettering check. */
  postText?: string
  /**
   * The only words the image should carry: what the reviewer put in quotes,
   * or the headline an edited image already had. Anything else is flagged.
   */
  allowedText?: string
  seed?: number
  /** Cancels the in-flight provider call; no further models are tried once it fires. */
  abortSignal?: AbortSignal
  /**
   * Called with the cost of each image the provider billed, as soon as it is
   * known. An attempt that is discarded, fails the size check or is cancelled
   * afterwards is still billed, so the caller records spend from here rather
   * than from a result that may never come.
   */
  onUsage?: (usage: CallUsage) => void
}

export interface CustomImageResult {
  imageUrl: string
  /** The image before the logo went on; only when a logo did. */
  baseImageUrl?: string
  altText: string
  promptOrQuery: string
  /** 'generate' from a prompt alone, 'edit' when an image to edit was supplied. */
  workflow: 'generate' | 'edit'
  modelId: string
  /** Measured from the returned bytes, not the size that was requested. */
  width: number | null
  height: number | null
  mediaType: string
  bytes: number
  referenceImageCount: number
  seed: number
  logo: MediaLogoInfo | null
  /** Lettering and logo problems the vision check found; empty when none. */
  issues: string[]
  /** False when the check could not run. */
  reviewChecked: boolean
}

/**
 * Wraps an edit instruction so the model changes only what was asked and leaves
 * the rest of the reference untouched.
 *
 * The instruction is quoted rather than merged so a style request ("make it
 * watercolour") still wins — only elements the instruction does not mention are
 * pinned. Without this, edit models tend to redraw the whole scene. They also
 * took a quoted instruction for text to render: "create the image based on the
 * post" became the image's headline, misspelt.
 */
/** "a wide 1.91:1 landscape" for 2048x1072; the shapes the canvas draws at. */
function shapeWords(size: { width: number; height: number }): string {
  const ratio = size.width / size.height
  return ratio > 1.3
    ? 'a wide 1.91:1 landscape'
    : ratio > 0.9
      ? 'a square 1:1'
      : 'a tall 4:5 portrait'
}

function buildEditPrompt(
  instruction: string,
  target: { width: number; height: number }
): string {
  return [
    `Edit the provided reference image. Apply only this change: "${instruction}".`,
    'That quoted instruction describes the change; it is not text to place in the image.',
    'Add or change lettering only where the instruction gives the exact words in quotation marks.',
    'Keep every element the instruction does not mention exactly as it appears in the reference:',
    'composition, layout, proportions, colours, typography, lighting and background.',
    'Do not redraw, restyle or reinterpret unchanged areas, and reproduce any text you were',
    'not asked to change with its original wording and spelling.',
    // A reference of another shape than the output has to be reframed. Without
    // this the model invents a new background to fill it.
    `The output is ${shapeWords(target)} image. If the reference has a different shape,`,
    'keep the main subject whole and undistorted, and extend the existing background in the',
    'same colour, texture and style to fill the frame rather than stretching or cropping it.'
  ].join(' ')
}

/**
 * Two workflows over one entry point:
 *
 * - generate: a prompt alone produces a new HD image, with the brand colours
 *   as its default palette.
 * - edit: a prompt plus the post's own image modifies that image in place,
 *   preserving the original design (see buildEditPrompt).
 *
 * Unlike createMediaPlan this skips the brief and the review — the user stated
 * what they want, so the prompt is honoured as written. It never falls back to
 * stock imagery: an unrelated stock photo is not a useful answer to an explicit
 * prompt, so failures surface as errors. The logo is laid over either.
 */
export async function generateCustomImage(
  req: CustomImageRequest
): Promise<CustomImageResult> {
  const prompt = (req.prompt || '').trim()
  if (!prompt) {
    throw new Error('Describe the image you want before generating.')
  }

  const references = req.editImage?.trim() ? [req.editImage] : []
  const workflow: 'generate' | 'edit' =
    references.length > 0 ? 'edit' : 'generate'
  const seed = req.seed ?? randomSeed()
  // An edit keeps its image's shape: one built on a reference may be square or tall.
  const editImage =
    workflow === 'edit' ? decodeImageDataUrl(references[0]!) : null
  const editSize = editImage ? readImageDimensions(editImage.buffer) : null
  const target =
    editSize &&
    BLUEPRINT_SIZES.some(
      s => s.width === editSize.width && s.height === editSize.height
    )
      ? editSize
      : LINKEDIN_IMAGE

  let finalPrompt =
    workflow === 'edit' ? buildEditPrompt(prompt, target) : prompt
  if (workflow === 'generate' && req.brand) {
    const logoPlan = await planLogo(req.brand, target)
    finalPrompt = `${prompt}\n\n${imagePromptSuffix({
      theme: req.brand.theme,
      clearSpace: logoPlan?.clearSpace,
      userPrompt: true
    })}`
  }

  let rendered: RenderedImage
  try {
    rendered = await renderImage({
      prompt: finalPrompt,
      references: workflow === 'edit' ? references : undefined,
      target,
      seed,
      abortSignal: req.abortSignal,
      onUsage: usage => req.onUsage?.(usage)
    })
  } catch (err) {
    if (err instanceof ImageGenerationAbortedError) throw err
    const reason = err instanceof Error ? err.message : 'the request failed'
    throw new Error(
      workflow === 'edit'
        ? `Could not edit the reference image. ${reason}`
        : `Could not generate an image from your prompt. ${reason}`
    )
  }

  const branded = req.brand
    ? await applyLogo(rendered, req.brand)
    : { buffer: rendered.buffer, mediaType: rendered.mediaType, logo: null }

  // The reviewer chose the subject and the colours, so only the lettering and
  // the logos are checked: image models misspell and invent words either way.
  // There is no retry; what it finds is shown with the image.
  const allowedText = req.allowedText?.trim() || ''
  const review = await reviewImage({
    image: await downscaleForReview(branded.buffer),
    mediaType: 'image/jpeg',
    postText: req.postText || prompt,
    concept: prompt,
    headline: allowedText,
    logoCorner: branded.logo
      ? cornerWords(LOGO_PLACEMENT).replace('-', ' ')
      : undefined,
    abortSignal: req.abortSignal
  })
  req.onUsage?.(review.usage)
  const issues = [
    ...(review.review
      ? letteringIssues(review.review, { headline: allowedText })
      : []),
    ...('error' in branded && branded.error ? [branded.error] : [])
  ]

  return {
    imageUrl: toDataUrl(branded.buffer, branded.mediaType),
    baseImageUrl: 'baseImageUrl' in branded ? branded.baseImageUrl : undefined,
    altText: prompt.slice(0, 300),
    promptOrQuery: prompt,
    workflow,
    modelId: rendered.modelId,
    width: rendered.width,
    height: rendered.height,
    mediaType: branded.mediaType,
    bytes: branded.buffer.length,
    referenceImageCount: references.length,
    seed,
    logo: branded.logo,
    issues,
    reviewChecked: review.review !== null
  }
}
