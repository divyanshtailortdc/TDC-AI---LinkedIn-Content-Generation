import type { MetadataRoute } from 'next'
import { SITE_PATH } from '@/lib/site'

/**
 * Search engines may read the public website (shown at / to signed-out
 * visitors) and the help pages; everything else is the signed-in app. `/$`
 * matches the home page alone, not every path under it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/$', SITE_PATH, '/docs'],
      disallow: '/'
    }
  }
}
