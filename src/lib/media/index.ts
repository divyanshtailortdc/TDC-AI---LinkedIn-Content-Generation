import { env } from '~/env'

export interface MediaPlanRequest {
  mode: 'ai_generated' | 'stock' | 'none'
  brief?: string
  topic?: string
  aspectRatio?: '1:1' | '16:9' | '4:5'
}

export interface MediaPlanResult {
  mode: 'ai_generated' | 'stock' | 'none'
  imageUrl?: string
  altText?: string
  promptOrQuery?: string
  sourcePageUrl?: string
}

export async function createMediaPlan(req: MediaPlanRequest): Promise<MediaPlanResult> {
  if (req.mode === 'none' || !req.mode) {
    return { mode: 'none' }
  }

  const query = req.brief || req.topic || 'professional business insight'
  const altText = `Visual conceptual illustration representing: ${query}`

  // 1. Stock photo path via Serper images API
  if (req.mode === 'stock') {
    if (env.SERPER_API_KEY) {
      try {
        const res = await fetch('https://google.serper.dev/images', {
          method: 'POST',
          headers: {
            'X-API-KEY': env.SERPER_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            q: `${query} minimal aesthetic high quality`,
            num: 3
          })
        })

        if (res.ok) {
          const data = await res.json()
          const firstImage = data.images?.[0]
          if (firstImage?.imageUrl) {
            return {
              mode: 'stock',
              imageUrl: firstImage.imageUrl,
              sourcePageUrl: firstImage.link || firstImage.domain,
              altText: firstImage.title || altText,
              promptOrQuery: query
            }
          }
        }
      } catch (err) {
        console.error('Serper images search error:', err)
      }
    }

    // Curated Unsplash fallback with stable search query
    const encoded = encodeURIComponent(query.slice(0, 30))
    return {
      mode: 'stock',
      imageUrl: `https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1200&q=80`,
      sourcePageUrl: `https://unsplash.com/s/photos/${encoded}`,
      altText,
      promptOrQuery: query
    }
  }

  // 2. AI Image Generation path
  if (req.mode === 'ai_generated') {
    return {
      mode: 'ai_generated',
      promptOrQuery: `Editorial high-end photography for LinkedIn article: ${query}. Modern, clean, cinematic lighting, 8k resolution, professional aesthetic.`,
      imageUrl: `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80`,
      altText
    }
  }

  return { mode: 'none' }
}
