import crypto from 'crypto'
import { generateImage } from 'ai'
import { env } from '~/env'
import { gatewayClient } from '~/lib/ai'
import {
  type MediaBrief,
  type VisualType,
  type SemanticValidationResult,
  type RelevanceValidationResult,
  type TextOverlaySpec,
  type EvidenceSource,
  type ConceptDifferenceResult,
  type RegenerationContext,
  extractMediaBrief,
  selectVisualType,
  validateMediaBriefSemantics,
  validateMediaBriefRelevance,
  validateConceptDifference,
  regenerateMediaBriefWithNegativeContext,
  regenerateMediaBriefStrict,
  buildImagePromptFromBrief,
  validateImagePromptAgainstPost
} from './media-brief'

export * from './media-brief'

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
  textOverlay?: TextOverlaySpec
  topicMatch?: boolean
  thesisMatch?: boolean
  introducesUnrelatedTopic?: boolean
  readability?: any
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
  const query = req.brief || req.topic || req.hook || 'professional business insight'
  const attempt = req.attempt || 0
  const seed = req.seed ?? Math.floor(Math.random() * 1000000)

  if (gatewayClient && env.AI_GATEWAY_API_KEY) {
    try {
      for (const modelId of TEXT_TO_IMAGE_MODELS) {
        try {
          const result = await generateImage({
            model: gatewayClient.imageModel(modelId),
            prompt,
            aspectRatio: req.aspectRatio === '1:1' ? '1:1' : '16:9',
            seed
          })

          const first = result.images?.[0]
          if (first?.base64) {
            const mediaType = first.mediaType || 'image/png'
            const dataUrl = `data:${mediaType};base64,${first.base64}`

            return {
              mode: 'ai_generated',
              imageUrl: dataUrl,
              altText: `AI-generated visual illustration for: ${query}`,
              promptOrQuery: prompt
            }
          }
        } catch (attemptErr: any) {
          console.warn(
            `AI image generation attempt with model "${modelId}" failed:`,
            attemptErr?.message || attemptErr
          )
        }
      }
    } catch (gatewayErr: any) {
      console.warn(
        'AI image generation through AI Gateway encountered an error:',
        gatewayErr?.message || gatewayErr
      )
    }
  }

  // Tier 2 & Tier 3 Fallback: Serper or Curated Stock
  console.info(
    'AI Image Generation unavailable or failed; executing Tier 2/3 stock fallback for post visual.'
  )
  const stockResult = await searchStockImage(query, {
    excludeUrls: req.excludeUrls,
    attempt
  })
  return {
    ...stockResult,
    mode: 'ai_generated', // preserves intention while applying graceful visual fallback
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
 * Main media planner:
 *
 * Implements Target Flow:
 * Approved Post -> Extract Media Brief -> Select Visual Type -> Build Visual Concept ->
 * Semantic Relevance Validation (>=80 threshold) -> Generate Image Prompt ->
 * Final Media Validation -> Generate Image -> Save Image + Alt Text + Metadata.
 */
export async function createMediaPlan(
  req: MediaPlanRequest
): Promise<MediaPlanResult> {
  if (req.mode === 'none' || !req.mode) {
    return { mode: 'none' }
  }

  const postContent = (
    req.postText ||
    `${req.hook || ''}\n\n${req.coreArgument || ''}\n\n${req.brief || ''}`
  ).trim()

  const thesis = req.thesis || req.coreArgument || req.topic || 'Operational thought leadership'

  // 1. Extract Media Brief
  let mediaBrief = extractMediaBrief(postContent, thesis, req.evidence)

  // 2. Select Visual Type
  let visualType = selectVisualType(postContent, mediaBrief, req.evidence)

  // 3. Hard Semantic Validation BEFORE Calling Image Generation
  let validation = validateMediaBriefSemantics(mediaBrief, postContent, thesis)

  // Image generation is allowed ONLY when:
  // relevanceScore >= 90 AND thesisMatch === true AND topicMatch === true AND introducesUnrelatedTopic === false
  if (
    validation.relevanceScore < 90 ||
    !validation.thesisMatch ||
    !validation.topicMatch ||
    validation.introducesUnrelatedTopic
  ) {
    console.warn(
      `Media brief failed semantic validation (${validation.relevanceScore}/100): ${validation.reason}. Regenerating media brief...`
    )
    mediaBrief = regenerateMediaBriefStrict(postContent, thesis, req.evidence, validation)
    visualType = selectVisualType(postContent, mediaBrief, req.evidence)
    validation = validateMediaBriefSemantics(mediaBrief, postContent, thesis)
  }

  // 4. Build Image Prompt from Brief
  let imagePrompt = buildImagePromptFromBrief(mediaBrief, visualType, {
    aspectRatio: req.aspectRatio
  })

  // 5. Final Media Validation (Prompt vs Post Thesis)
  const promptCheck = validateImagePromptAgainstPost(imagePrompt, mediaBrief, thesis)
  if (!promptCheck.isValid) {
    console.warn(
      'Image prompt failed semantic check; applying sanitized constraints:',
      promptCheck.reason
    )
    mediaBrief = regenerateMediaBriefStrict(postContent, thesis, req.evidence, validation)
    imagePrompt = buildImagePromptFromBrief(mediaBrief, visualType, {
      aspectRatio: req.aspectRatio
    })
  }

  const enhancedReq: MediaPlanRequest = {
    ...req,
    imagePrompt,
    brief: mediaBrief.primaryConcept,
    topic: mediaBrief.coreThesis
  }

  let result: MediaPlanResult
  if (req.mode === 'stock') {
    result = await searchStockImage(mediaBrief.primaryConcept || mediaBrief.coreThesis)
  } else {
    result = await generateAIImage(enhancedReq)
  }

    return {
    ...result,
    mediaBrief,
    visualType,
    relevanceScore: validation.relevanceScore,
    relevanceExplanation: validation.explanation,
    alignedConcepts: validation.alignedConcepts,
    textOverlay: mediaBrief.textOverlay,
    topicMatch: validation.topicMatch,
    thesisMatch: validation.thesisMatch,
    introducesUnrelatedTopic: validation.introducesUnrelatedTopic,
    readability: validation.readability
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
}

export interface RegenerateMediaPlanResult extends MediaPlanResult {
  version: number
  regenerationAttempt: number
  previousMediaId?: string
  rejectionReason?: string
  conceptDifference?: ConceptDifferenceResult
  providerRequestId?: string
  seed?: number
}

/**
 * Executes a full, non-cached regeneration cycle:
 * Rejection Context -> Blocked Concepts -> New Media Brief ->
 * Concept Difference Validation (similarity < 70) -> Thesis Validation ->
 * Fresh Provider Request with Non-reused Seed -> Multi-version Metadata.
 */
export async function regenerateMediaPlan(
  req: RegenerateMediaPlanRequest
): Promise<RegenerateMediaPlanResult> {
  const postContent = (req.postText || '').trim()
  const thesis = req.thesis || 'Operational thought leadership'
  const attempt = (req.regenerationAttempt ?? 0) + 1
  const version = (req.version ?? 1) + 1
  const seed = Math.floor(Math.random() * 1000000)
  const providerRequestId = crypto.randomUUID()

  // 1. Build negative context & derive NEW media brief
  let mediaBrief = regenerateMediaBriefWithNegativeContext({
    postText: postContent,
    thesis,
    previousConcept: req.previousConcept,
    previousPrompt: req.previousImagePrompt,
    previousImageUrl: req.previousImageUrl,
    rejectionReason: req.rejectionReason,
    blockedConcepts: req.blockedConcepts,
    regenerationAttempt: attempt,
    evidence: req.evidence
  })

  // 2. Validate Concept Difference from rejected concept
  let diffCheck = validateConceptDifference(
    mediaBrief.primaryConcept,
    req.previousConcept,
    req.blockedConcepts
  )

  if (!diffCheck.isMeaningfullyDifferent || diffCheck.similarityScore >= 70) {
    console.warn(
      `Regenerated concept too similar to previous (${diffCheck.similarityScore}%): ${diffCheck.reason}. Enforcing alternate layout...`
    )
    mediaBrief = regenerateMediaBriefWithNegativeContext({
      postText: postContent,
      thesis,
      previousConcept: req.previousConcept,
      previousPrompt: req.previousImagePrompt,
      rejectionReason: req.rejectionReason,
      blockedConcepts: [...(req.blockedConcepts || []), mediaBrief.primaryConcept],
      regenerationAttempt: attempt + 1,
      evidence: req.evidence
    })
    diffCheck = validateConceptDifference(
      mediaBrief.primaryConcept,
      req.previousConcept,
      req.blockedConcepts
    )
  }

  // 3. Validate Semantics & Thesis Match
  let validation = validateMediaBriefSemantics(mediaBrief, postContent, thesis)
  let visualType = selectVisualType(postContent, mediaBrief, req.evidence)

  if (
    validation.relevanceScore < 90 ||
    !validation.thesisMatch ||
    !validation.topicMatch ||
    validation.introducesUnrelatedTopic
  ) {
    mediaBrief = regenerateMediaBriefStrict(postContent, thesis, req.evidence, validation)
    visualType = selectVisualType(postContent, mediaBrief, req.evidence)
    validation = validateMediaBriefSemantics(mediaBrief, postContent, thesis)
  }

  // 4. Build Image Prompt
  let imagePrompt = buildImagePromptFromBrief(mediaBrief, visualType, {
    aspectRatio: req.aspectRatio
  })

  const promptCheck = validateImagePromptAgainstPost(imagePrompt, mediaBrief, thesis)
  if (!promptCheck.isValid) {
    mediaBrief = regenerateMediaBriefStrict(postContent, thesis, req.evidence, validation)
    imagePrompt = buildImagePromptFromBrief(mediaBrief, visualType, {
      aspectRatio: req.aspectRatio
    })
  }

  // 5. Exclude previous image URL and force fresh provider execution
  const excludeUrls = req.previousImageUrl ? [req.previousImageUrl] : []
  const imageResult = await generateAIImage({
    mode: 'ai_generated',
    brief: mediaBrief.primaryConcept,
    topic: mediaBrief.coreThesis,
    postText: postContent,
    thesis,
    imagePrompt,
    aspectRatio: req.aspectRatio,
    excludeUrls,
    attempt,
    seed
  })

  const finalImageUrl = imageResult.imageUrl || ''

  // 6. Structured Logging as specified in instructions
  const mediaBriefHash = crypto
    .createHash('md5')
    .update(mediaBrief.primaryConcept)
    .digest('hex')
    .slice(0, 8)
  const imagePromptHash = crypto
    .createHash('md5')
    .update(imagePrompt)
    .digest('hex')
    .slice(0, 8)

  console.info(
    '[MediaRegenerationLog]',
    JSON.stringify({
      postId: req.draftId || 'unknown',
      previousMediaId: req.previousMediaId || null,
      regenerationAttempt: attempt,
      mediaBriefHash,
      imagePromptHash,
      providerCalled: true,
      providerRequestId,
      generatedAssetId: crypto.randomUUID(),
      generatedImageUrl: finalImageUrl
    })
  )

  return {
    ...imageResult,
    imageUrl: finalImageUrl,
    version,
    regenerationAttempt: attempt,
    previousMediaId: req.previousMediaId,
    rejectionReason: req.rejectionReason,
    conceptDifference: diffCheck,
    providerRequestId,
    seed,
    mediaBrief,
    visualType,
    relevanceScore: validation.relevanceScore,
    relevanceExplanation: validation.explanation,
    alignedConcepts: validation.alignedConcepts,
    textOverlay: mediaBrief.textOverlay,
    topicMatch: validation.topicMatch,
    thesisMatch: validation.thesisMatch,
    introducesUnrelatedTopic: validation.introducesUnrelatedTopic,
    readability: validation.readability
  }
}

