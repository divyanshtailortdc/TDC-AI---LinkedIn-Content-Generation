import crypto from 'crypto'
import { generateImage } from 'ai'
import { env } from '~/env'
import { gatewayClient } from '~/lib/ai'
import {
  deriveMediaBrief,
  guardMediaBrief,
  type BriefGuardResult,
  type EvidenceSource,
  type MediaBrief,
  type VisualType
} from './brief'

export * from './brief'

export interface MediaPlanRequest {
  mode: 'ai_generated' | 'stock' | 'none'
  brief?: string | null
  topic?: string | null
  hook?: string | null
  postText?: string | null
  coreArgument?: string | null
  thesis?: string | null
  evidence?: EvidenceSource[]
  aspectRatio?: '1:1' | '16:9' | '4:5'
  imagePrompt?: string | null
  /** The account's configured house style for generated images. */
  styleGuidance?: string
  accountName?: string
}

export interface MediaPlanResult {
  mode: 'ai_generated' | 'stock' | 'none'
  imageUrl?: string
  altText?: string
  promptOrQuery?: string
  sourcePageUrl?: string
  fallbackApplied?: boolean
  mediaBrief?: MediaBrief
  visualType?: VisualType
  relevanceScore?: number
  relevanceExplanation?: string
  alignedConcepts?: string[]
  textOverlay?: MediaBrief['textOverlay']
  /** Problems the guard found with the brief, surfaced in the review UI. */
  issues?: string[]
  /** Set when no image could be produced, so the run step can say why. */
  error?: string
}

interface CuratedStockCategory {
  keywords: string[]
  images: Array<{
    url: string
    altText: string
  }>
}

const CURATED_FALLBACK_CATALOG: CuratedStockCategory[] = [
  {
    keywords: [
      'automation',
      'decision',
      'rules',
      'judgment',
      'predictable',
      'comparison',
      'process',
      'workflow'
    ],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
        altText:
          'Streamlined technological workflow architecture representing structured automation'
      },
      {
        url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80',
        altText:
          'Conceptual network nodes illustrating decision pathways and systemic coordination'
      }
    ]
  },
  {
    keywords: [
      'ai',
      'tech',
      'software',
      'data',
      'algorithm',
      'cloud',
      'developer',
      'code',
      'model',
      'machine learning'
    ],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
        altText:
          'Modern glowing geometric network visualization representing AI and advanced technology'
      },
      {
        url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
        altText:
          'High-tech illuminated circuit board and processor architecture'
      },
      {
        url: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1200&q=80',
        altText:
          'Digital data streams and technological matrix visualization'
      }
    ]
  },
  {
    keywords: [
      'leadership',
      'management',
      'culture',
      'team',
      'executive',
      'founder',
      'strategy',
      'ceo',
      'people',
      'hiring'
    ],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1200&q=80',
        altText:
          'Modern professional corporate workplace and strategic leadership environment'
      },
      {
        url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
        altText:
          'Team collaboration and cross-functional strategic executive workshop'
      },
      {
        url: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80',
        altText:
          'Executive focus and modern corporate decision making in a skyline office'
      }
    ]
  },
  {
    keywords: [
      'growth',
      'marketing',
      'sales',
      'revenue',
      'finance',
      'business',
      'scale',
      'market',
      'commerce',
      'customer',
      'pricing'
    ],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
        altText:
          'Financial analytics, market graphs, and business growth trajectory'
      },
      {
        url: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1200&q=80',
        altText:
          'Strategic business presentation and market expansion planning'
      }
    ]
  },
  {
    keywords: [
      'product',
      'design',
      'ux',
      'productivity',
      'habits',
      'writing',
      'content',
      'workflow',
      'career',
      'focus'
    ],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1200&q=80',
        altText:
          'Clean minimalist creative workspace, journal, and digital workstation'
      },
      {
        url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
        altText:
          'Modern architectural skyscraper glass facade symbolizing structural innovation'
      }
    ]
  }
]

/**
 * Builds a clean, professional prompt suitable for LinkedIn.
 * Maintained for backwards compatibility; preferred approach is buildImagePromptFromBrief.
 */
export function buildLinkedInImagePrompt(req: MediaPlanRequest): string {
  if (req.imagePrompt) return req.imagePrompt

  const subject = req.brief || req.topic || 'strategic technology leadership'
  const argumentHint = req.coreArgument
    ? ` Conceptually conveying: ${req.coreArgument.slice(0, 100)}.`
    : ''

  return `Minimalist editorial visual for LinkedIn publication about ${subject}.${argumentHint} Professional aesthetic, cinematic lighting, sleek corporate modernism, crisp architectural lines and conceptual geometric depth. Clean composition, 8k resolution, photorealistic studio lighting. No textual overlay, no text banners, no cluttered typography.`
}

/**
 * Picks a curated high-res Unsplash image matching topic keywords.
 * When called during regeneration, excludes previous image URLs and shifts offset by attempt.
 */
export function getCuratedFallbackImage(
  topicOrBrief: string,
  options?: { excludeUrls?: string[]; attemptOffset?: number }
): {
  imageUrl: string
  altText: string
} {
  const query = (topicOrBrief || '').toLowerCase()
  const excludeUrls = (options?.excludeUrls || []).map(u => u.split('?')[0])
  const offset = options?.attemptOffset || 0

  for (const cat of CURATED_FALLBACK_CATALOG) {
    if (cat.keywords.some(k => query.includes(k))) {
      const available = cat.images.filter(img => !excludeUrls.includes(img.url.split('?')[0]))
      const pool = available.length > 0 ? available : cat.images
      const index = (Math.abs(query.length) + offset) % pool.length
      const selected = pool[index] || pool[0]!
      return { imageUrl: selected.url, altText: selected.altText }
    }
  }

  // Default fallback: high-end modern business architecture
  const defaultImages = [
    {
      url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
      altText: 'Modern architectural business innovation visual for professional publication'
    },
    {
      url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
      altText: 'Clean modern corporate decision space'
    },
    {
      url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80',
      altText: 'Global connected strategic operational network'
    }
  ]
  const availableDefaults = defaultImages.filter(
    img => !excludeUrls.includes(img.url.split('?')[0])
  )
  const pool = availableDefaults.length > 0 ? availableDefaults : defaultImages
  const selected = pool[offset % pool.length] || pool[0]!
  return {
    imageUrl: selected.url,
    altText: selected.altText
  }
}

/**
 * Searches for high-quality stock photography using Serper Google Images API,
 * with graceful fallback to curated stock catalog.
 */
export async function searchStockImage(
  query: string,
  options?: { excludeUrls?: string[]; attempt?: number }
): Promise<MediaPlanResult> {
  const cleanQuery = query.trim() || 'professional business insight'
  const altText = `Professional editorial image representing: ${cleanQuery}`
  const attempt = options?.attempt || 0
  const excludeUrls = options?.excludeUrls || []

  if (env.SERPER_API_KEY && env.SERPER_API_KEY.trim().length > 0) {
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
        })
      })

      if (res.ok) {
        const data = await res.json()
        const images = data.images as Array<{
          imageUrl?: string
          link?: string
          domain?: string
          title?: string
        }>

        if (Array.isArray(images) && images.length > 0) {
          const freshImages = images.filter(
            img => img.imageUrl && !excludeUrls.some(u => img.imageUrl?.includes(u.split('?')[0] || '___'))
          )
          const pool = freshImages.length > 0 ? freshImages : images
          const selectedImage = pool[attempt % pool.length] || pool[0]
          if (selectedImage?.imageUrl) {
            const sep = selectedImage.imageUrl.includes('?') ? '&' : '?'
            const finalUrl = `${selectedImage.imageUrl}${sep}v=${Date.now()}&attempt=${attempt}`

            return {
              mode: 'stock',
              imageUrl: finalUrl,
              sourcePageUrl: selectedImage.link || selectedImage.domain,
              altText: selectedImage.title || altText,
              promptOrQuery: cleanQuery
            }
          }
        }
      }
    } catch (err) {
      console.warn('Serper images search error, falling back to curated stock:', err)
    }
  }

  // Curated stock fallback with cache buster
  const curated = getCuratedFallbackImage(cleanQuery, { excludeUrls, attemptOffset: attempt })
  const sep = curated.imageUrl.includes('?') ? '&' : '?'
  const finalUrl = `${curated.imageUrl}${sep}v=${Date.now()}&attempt=${attempt}`

  return {
    mode: 'stock',
    imageUrl: finalUrl,
    sourcePageUrl: `https://unsplash.com/s/photos/${encodeURIComponent(cleanQuery.slice(0, 30))}`,
    altText: curated.altText,
    promptOrQuery: cleanQuery,
    fallbackApplied: true
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
const LINKEDIN_IMAGE_SIZE =
  `${LINKEDIN_IMAGE.width}x${LINKEDIN_IMAGE.height}` as const

/**
 * True when decoded dimensions are exactly the LinkedIn size.
 *
 * Checked on the returned bytes rather than trusted from the request: models
 * silently return something else when asked (kontext downscales to 1024,
 * flux-pro-1.1-ultra ignores size and returns 2816x1472), so asking is not
 * the same as getting.
 */
/**
 * Concrete pixel sizes per configured aspect ratio.
 *
 * `aspectRatio` is silently ignored by the flux models, so `size` is the only
 * control that works — the same lesson generateCustomImage already encodes.
 * Every dimension is a multiple of 16 or the model rounds it and loses the ratio.
 */
const ASPECT_SIZES = {
  '16:9': { width: 2048, height: 1072 },
  '1:1': { width: 1440, height: 1440 },
  '4:5': { width: 1152, height: 1440 }
} as const

export function sizeForAspectRatio(
  aspectRatio?: '1:1' | '16:9' | '4:5'
): { width: number; height: number } {
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
 * Models verified to return exactly 2048x1072 through the gateway.
 *
 * `aspectRatio` is silently ignored by these models, so `size` is the only
 * control that works.
 */
const TEXT_TO_IMAGE_MODELS = ['bfl/flux-2-pro', 'bfl/flux-2-max', 'bfl/flux-2-flex']

/**
 * Reference-guided editing, restricted to models verified to hold 2048x1072 with
 * a reference attached — including square references reframed to landscape.
 */
const IMAGE_EDIT_MODELS = ['bfl/flux-2-pro', 'bfl/flux-2-max', 'bfl/flux-2-flex']

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

/**
 * Generates an image using AI SDK via AI Gateway (Tier 1),
 * with automatic fallback to Serper Stock Search (Tier 2),
 * and Curated High-Res Fallback (Tier 3).
 */
export async function generateAIImage(
  req: MediaPlanRequest & {
    excludeUrls?: string[]
    attempt?: number
    seed?: number
  }
): Promise<MediaPlanResult> {
  const prompt = req.imagePrompt || buildLinkedInImagePrompt(req)
  const query =
    req.brief || req.topic || req.hook || 'professional business insight'
  const attempt = req.attempt || 0
  const seed = req.seed ?? Math.floor(Math.random() * 1_000_000)
  const target = sizeForAspectRatio(req.aspectRatio)
  const size = `${target.width}x${target.height}` as const

  if (gatewayClient && env.AI_GATEWAY_API_KEY) {
    for (const modelId of TEXT_TO_IMAGE_MODELS) {
      try {
        const result = await generateImage({
          model: gatewayClient.imageModel(modelId),
          prompt,
          size,
          seed
        })

        const first = result.images?.[0]
        if (!first?.base64) continue

        // Verify the bytes rather than trusting the request: these models
        // silently return a different size when they feel like it.
        const dimensions = readImageDimensions(Buffer.from(first.base64, 'base64'))
        if (
          dimensions &&
          (dimensions.width !== target.width || dimensions.height !== target.height)
        ) {
          console.warn(
            `Discarding "${modelId}" result: got ${dimensions.width}x${dimensions.height}, need ${size}.`
          )
          continue
        }

        const mediaType = first.mediaType || 'image/png'
        return {
          mode: 'ai_generated',
          imageUrl: `data:${mediaType};base64,${first.base64}`,
          // The caller supplies alt text written from the brief, which
          // describes the actual composition far better than the query does.
          altText: `Illustration for: ${query}`,
          promptOrQuery: prompt
        }
      } catch (err: any) {
        console.warn(
          `AI image generation failed on "${modelId}":`,
          err?.message || err
        )
      }
    }
  }

  // Falling back to stock. Report it as stock — labelling a stock photo
  // "ai_generated" made the review UI and the run log both lie about it.
  console.info('AI image generation unavailable; falling back to stock search.')
  const stockResult = await searchStockImage(query, {
    excludeUrls: req.excludeUrls,
    attempt
  })
  return {
    ...stockResult,
    fallbackApplied: true,
    promptOrQuery: prompt
  }
}

export interface CustomImageRequest {
  /** Exactly what the user asked for, used verbatim as the generation prompt. */
  prompt: string
  /** Optional reference images as data URLs or public http(s) URLs. Presence switches to edit mode. */
  referenceImages?: string[]
  seed?: number
  /** Cancels the in-flight provider call; no further models are tried once it fires. */
  abortSignal?: AbortSignal
}

/** Thrown when generation is cancelled through `abortSignal`, so callers can skip saving. */
export class ImageGenerationAbortedError extends Error {
  constructor() {
    super('Image generation was stopped.')
    this.name = 'ImageGenerationAbortedError'
  }
}

export interface CustomImageResult {
  imageUrl: string
  altText: string
  promptOrQuery: string
  /** 'generate' from a prompt alone, 'edit' when reference images were supplied. */
  workflow: 'generate' | 'edit'
  modelId: string
  /** Measured from the returned bytes, not the size that was requested. */
  width: number | null
  height: number | null
  mediaType: string
  bytes: number
  referenceImageCount: number
  seed: number
}

/**
 * Wraps an edit instruction so the model changes only what was asked and leaves
 * the rest of the reference untouched.
 *
 * The instruction is quoted rather than merged so a style request ("make it
 * watercolour") still wins — only elements the instruction does not mention are
 * pinned. Without this, edit models tend to redraw the whole scene.
 */
function buildEditPrompt(instruction: string): string {
  return [
    `Edit the provided reference image. Apply only this change: "${instruction}".`,
    'Keep every element the instruction does not mention exactly as it appears in the reference:',
    'composition, layout, proportions, colours, typography, lighting and background.',
    'Do not redraw, restyle or reinterpret unchanged areas, and reproduce any text you were',
    'not asked to change with its original wording and spelling.',
    // The output is a fixed 1.91:1 landscape, so a reference of another shape has
    // to be reframed. Without this the model invents a new background to fill it.
    'The output is a wide 1.91:1 landscape image. If the reference has a different shape,',
    'keep the main subject whole and undistorted, and extend the existing background in the',
    'same colour, texture and style to fill the frame rather than stretching or cropping it.'
  ].join(' ')
}

/**
 * Two workflows over one entry point:
 *
 * - generate: a prompt alone produces a new HD image.
 * - edit: a prompt plus reference images modifies that image in place, preserving
 *   the original design (see buildEditPrompt).
 *
 * Unlike createMediaPlan/regenerateMediaPlan this skips media-brief derivation and
 * semantic validation — the user stated what they want, so the prompt is honoured
 * as written. It also never falls back to stock imagery: an unrelated stock photo
 * is not a useful answer to an explicit prompt, so failures surface as errors.
 */
export async function generateCustomImage(
  req: CustomImageRequest
): Promise<CustomImageResult> {
  const prompt = (req.prompt || '').trim()
  if (!prompt) {
    throw new Error('Describe the image you want before generating.')
  }

  if (!gatewayClient || !env.AI_GATEWAY_API_KEY) {
    throw new Error(
      'Image generation is not configured. Add AI_GATEWAY_API_KEY to enable it.'
    )
  }

  const references = (req.referenceImages || []).filter(
    (img): img is string => typeof img === 'string' && img.trim().length > 0
  )
  const workflow: 'generate' | 'edit' = references.length > 0 ? 'edit' : 'generate'
  const models = workflow === 'edit' ? IMAGE_EDIT_MODELS : TEXT_TO_IMAGE_MODELS
  const seed = req.seed ?? Math.floor(Math.random() * 1000000)

  const finalPrompt = workflow === 'edit' ? buildEditPrompt(prompt) : prompt

  let firstFailure: string | undefined

  for (const modelId of models) {
    if (req.abortSignal?.aborted) throw new ImageGenerationAbortedError()

    try {
      const result = await generateImage({
        model: gatewayClient.imageModel(modelId),
        prompt:
          workflow === 'edit'
            ? { text: finalPrompt, images: references }
            : finalPrompt,
        size: LINKEDIN_IMAGE_SIZE,
        seed,
        abortSignal: req.abortSignal
      })

      const first = result.images?.[0]
      if (!first?.base64) {
        firstFailure = firstFailure || `${modelId} returned no image`
        continue
      }

      const buffer = Buffer.from(first.base64, 'base64')
      const dimensions = readImageDimensions(buffer)

      // A model that returned any other size has not met the brief; move to the next.
      if (dimensions && !isLinkedInImageSize(dimensions)) {
        const got = `${dimensions.width}x${dimensions.height}`
        console.warn(
          `Discarding "${modelId}" result: got ${got}, need exactly ${LINKEDIN_IMAGE_SIZE}.`
        )
        firstFailure = firstFailure || `${modelId} returned ${got}, not ${LINKEDIN_IMAGE_SIZE}`
        continue
      }

      if (!dimensions) {
        console.warn(
          `Could not verify dimensions of "${first.mediaType}" from "${modelId}"; accepting the requested ${LINKEDIN_IMAGE_SIZE}.`
        )
      }

      const mediaType = first.mediaType || 'image/png'
      return {
        imageUrl: `data:${mediaType};base64,${first.base64}`,
        altText: prompt.slice(0, 300),
        promptOrQuery: prompt,
        workflow,
        modelId,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        mediaType,
        bytes: buffer.length,
        referenceImageCount: references.length,
        seed
      }
    } catch (err: any) {
      // The gateway surfaces an abort as a GatewayResponseError, not an AbortError,
      // so check the signal itself. Falling through would start the next model.
      if (req.abortSignal?.aborted) throw new ImageGenerationAbortedError()

      const message = err?.message || 'request failed'
      firstFailure = firstFailure || `${modelId}: ${message}`
      console.warn(`Custom image ${workflow} failed on "${modelId}":`, message)
    }
  }

  throw new Error(
    workflow === 'edit'
      ? `Could not edit the reference image. ${firstFailure || ''}`.trim()
      : `Could not generate an image from your prompt. ${firstFailure || ''}`.trim()
  )
}

/**
 * Plans the image for a post.
 *
 * The brief is written by the model from the post itself and then checked by a
 * small domain-neutral guard. The old flow derived the brief from a fixed
 * keyword table and demanded a 90/100 keyword-overlap score, which almost every
 * post failed, so nearly every image came from the same generic fallback set.
 */
export async function createMediaPlan(
  req: MediaPlanRequest
): Promise<MediaPlanResult> {
  if (req.mode === 'none' || !req.mode) {
    return { mode: 'none' }
  }

  const postContent = (
    req.postText || `${req.hook || ''}\n\n${req.coreArgument || ''}`
  ).trim()

  if (!postContent) {
    return { mode: 'none', error: 'No post content to illustrate.' }
  }

  const derived = await deriveMediaBrief({
    postText: postContent,
    thesis: req.thesis,
    hook: req.hook,
    evidence: req.evidence,
    styleGuidance: req.styleGuidance,
    aspectRatio: req.aspectRatio,
    accountName: req.accountName
  })

  if (!derived) {
    // Without a brief an image would be decoration at best; say so rather than
    // attaching something unrelated.
    return {
      mode: 'none',
      error:
        'Could not derive a visual concept for this post. Check that an AI provider key is configured.'
    }
  }

  const { brief, imagePrompt, altText } = derived.derived
  const guard = derived.guard

  const searchQuery = brief.primaryConcept || brief.postTopic

  let result: MediaPlanResult
  if (req.mode === 'stock') {
    result = await searchStockImage(searchQuery)
  } else {
    result = await generateAIImage({
      ...req,
      imagePrompt,
      brief: brief.primaryConcept,
      topic: brief.postTopic
    })
  }

  return {
    ...result,
    // A generated image was made from the brief, so the brief's alt text
    // describes it accurately. A stock image is whatever the search returned,
    // so its own caption is the honest description.
    altText: result.mode === 'ai_generated' ? altText : result.altText || altText,
    mediaBrief: brief,
    visualType: brief.visualType,
    textOverlay: brief.textOverlay,
    relevanceScore: guard.relevanceScore,
    relevanceExplanation: guard.explanation,
    alignedConcepts: guard.alignedConcepts,
    issues: guard.issues
  }
}

export interface RegenerateMediaPlanRequest {
  draftId?: string
  postText?: string
  thesis?: string
  previousMediaId?: string
  previousConcept?: string
  previousImagePrompt?: string
  previousImageUrl?: string
  rejectionReason?: string
  blockedConcepts?: string[]
  regenerationAttempt?: number
  version?: number
  evidence?: EvidenceSource[]
  aspectRatio?: '1:1' | '16:9' | '4:5'
  styleGuidance?: string
  accountName?: string
  mode?: 'ai_generated' | 'stock'
}

export interface RegenerateMediaPlanResult extends MediaPlanResult {
  version: number
  regenerationAttempt: number
  previousMediaId?: string
  rejectionReason?: string
  providerRequestId?: string
  seed?: number
}

/**
 * Produces a genuinely different visual after a rejection, seeding the brief
 * with what was rejected and why so the model does not land in the same place.
 */
export async function regenerateMediaPlan(
  req: RegenerateMediaPlanRequest
): Promise<RegenerateMediaPlanResult> {
  const postContent = (req.postText || '').trim()
  const attempt = (req.regenerationAttempt ?? 0) + 1
  const version = (req.version ?? 1) + 1
  const seed = Math.floor(Math.random() * 1_000_000)
  const providerRequestId = crypto.randomUUID()

  const rejected = [
    ...(req.blockedConcepts || []),
    req.previousConcept || ''
  ].filter(Boolean)

  const steer = [
    rejected.length > 0
      ? `These concepts were already rejected, do not return to them: ${rejected.join('; ')}.`
      : '',
    req.rejectionReason ? `The reviewer said: "${req.rejectionReason}".` : '',
    'Choose a different visual form and a different central metaphor.'
  ]
    .filter(Boolean)
    .join(' ')

  const derived = await deriveMediaBrief({
    postText: postContent,
    thesis: req.thesis,
    evidence: req.evidence,
    aspectRatio: req.aspectRatio,
    accountName: req.accountName,
    styleGuidance: [req.styleGuidance, steer].filter(Boolean).join(' ')
  })

  if (!derived) {
    return {
      mode: 'none',
      version,
      regenerationAttempt: attempt,
      previousMediaId: req.previousMediaId,
      rejectionReason: req.rejectionReason,
      providerRequestId,
      seed,
      error: 'Could not derive a new visual concept.'
    }
  }

  const { brief, imagePrompt, altText } = derived.derived
  const guard = derived.guard
  const excludeUrls = req.previousImageUrl ? [req.previousImageUrl] : []

  const imageResult =
    req.mode === 'stock'
      ? await searchStockImage(brief.primaryConcept || brief.postTopic, {
          excludeUrls,
          attempt
        })
      : await generateAIImage({
          mode: 'ai_generated',
          brief: brief.primaryConcept,
          topic: brief.postTopic,
          postText: postContent,
          thesis: req.thesis,
          imagePrompt,
          aspectRatio: req.aspectRatio,
          excludeUrls,
          attempt,
          seed
        })

  return {
    ...imageResult,
    altText:
      imageResult.mode === 'ai_generated'
        ? altText
        : imageResult.altText || altText,
    version,
    regenerationAttempt: attempt,
    previousMediaId: req.previousMediaId,
    rejectionReason: req.rejectionReason,
    providerRequestId,
    seed,
    mediaBrief: brief,
    visualType: brief.visualType,
    textOverlay: brief.textOverlay,
    relevanceScore: guard.relevanceScore,
    relevanceExplanation: guard.explanation,
    alignedConcepts: guard.alignedConcepts,
    issues: guard.issues
  }
}
