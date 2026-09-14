import { generateImage } from 'ai'
import { env } from '~/env'
import { gatewayClient } from '~/lib/ai'

export interface MediaPlanRequest {
  mode: 'ai_generated' | 'stock' | 'none'
  brief?: string
  topic?: string
  hook?: string
  coreArgument?: string
  aspectRatio?: '1:1' | '16:9' | '4:5'
}

export interface MediaPlanResult {
  mode: 'ai_generated' | 'stock' | 'none'
  imageUrl?: string
  altText?: string
  promptOrQuery?: string
  sourcePageUrl?: string
  fallbackApplied?: boolean
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
      'customer'
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
 * Never inserts long post copy or text blocks inside the image.
 */
export function buildLinkedInImagePrompt(req: MediaPlanRequest): string {
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
      // Pick based on a deterministic hash of the query
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
          // Select first valid image URL
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
  const prompt = buildLinkedInImagePrompt(req)
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
          // Continue to next model if available
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
 * - 'none': returns text-only mode
 * - 'ai_generated': runs AI generation -> Serper -> Curated fallback
 * - 'stock': runs Serper search -> Curated fallback
 */
export async function createMediaPlan(
  req: MediaPlanRequest
): Promise<MediaPlanResult> {
  if (req.mode === 'none' || !req.mode) {
    return { mode: 'none' }
  }

  if (req.mode === 'stock') {
    const query = req.brief || req.topic || req.hook || 'professional business insight'
    return searchStockImage(query)
  }

  if (req.mode === 'ai_generated') {
    return generateAIImage(req)
  }

  return { mode: 'none' }
}
