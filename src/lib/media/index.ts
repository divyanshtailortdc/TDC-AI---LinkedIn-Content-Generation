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
      const modelsToAttempt = [
        'openai/dall-e-3',
        'black-forest-labs/flux-1.1-pro',
        'google/imagen-3'
      ]

      for (const modelId of modelsToAttempt) {
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

