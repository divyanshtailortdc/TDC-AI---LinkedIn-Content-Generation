import type { MetadataRoute } from 'next'

/**
 * An internal tool: nothing here is meant for search engines. A route group
 * such as "(app)" never appears in a URL, so disallowing it blocked nothing.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/'
    }
  }
}
