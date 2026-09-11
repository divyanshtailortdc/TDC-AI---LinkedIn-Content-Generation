import type { MetadataRoute } from 'next'
import { env } from '~/env'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = env.NEXT_PUBLIC_APP_URL

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1
    }
  ]
}
