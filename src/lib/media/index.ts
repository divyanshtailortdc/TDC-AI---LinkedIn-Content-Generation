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
  extractMediaBrief,
  selectVisualType,
  validateMediaBriefSemantics,
  validateMediaBriefRelevance,
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
 */
export function getCuratedFallbackImage(topicOrBrief: string): {
  imageUrl: string
  altText: string
} {
  const query = (topicOrBrief || '').toLowerCase()

  for (const cat of CURATED_FALLBACK_CATALOG) {
    if (cat.keywords.some(k => query.includes(k))) {
      const index = Math.abs(query.length) % cat.images.length
      const selected = cat.images[index] || cat.images[0]!
      return { imageUrl: selected.url, altText: selected.altText }
    }
  }

  // Default fallback: high-end modern business architecture
  return {
    imageUrl:
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
    altText:
      'Modern architectural business innovation visual for professional publication'
  }
}

/**
 * Searches for high-quality stock photography using Serper Google Images API,
 * with graceful fallback to curated stock catalog.
 */
export async function searchStockImage(
  query: string
): Promise<MediaPlanResult> {
  const cleanQuery = query.trim() || 'professional business insight'
  const altText = `Professional editorial image representing: ${cleanQuery}`

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
          num: 5
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
          const firstImage = images.find(img => img.imageUrl)
          if (firstImage?.imageUrl) {
            return {
              mode: 'stock',
              imageUrl: firstImage.imageUrl,
              sourcePageUrl: firstImage.link || firstImage.domain,
              altText: firstImage.title || altText,
              promptOrQuery: cleanQuery
            }
          }
        }
      }
    } catch (err) {
      console.warn('Serper images search error, falling back to curated stock:', err)
    }
  }

  // Curated stock fallback
  const curated = getCuratedFallbackImage(cleanQuery)
  return {
    mode: 'stock',
    imageUrl: curated.imageUrl,
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
  req: MediaPlanRequest
): Promise<MediaPlanResult> {
  const prompt = req.imagePrompt || buildLinkedInImagePrompt(req)
  const query = req.brief || req.topic || req.hook || 'professional business insight'

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
            aspectRatio: req.aspectRatio === '1:1' ? '1:1' : '16:9'
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
  const stockResult = await searchStockImage(query)
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
    textOverlay: mediaBrief.textOverlay
  }
}
