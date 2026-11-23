import createMDX from '@next/mdx'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.2.62'],
  // Loaded by Node as they are: the IMAP client opens raw TLS sockets and logs
  // through pino, and mailparser loads charset tables at run time.
  serverExternalPackages: ['postgres', 'node-cron', 'imapflow', 'mailparser'],
  // The help pages' text is read from disk for their "On this page" lists
  // and search (src/docs/content.ts); deploy the files with those routes.
  outputFileTracingIncludes: {
    '/docs/**': ['./src/docs/content/**/*.mdx'],
    '/api/docs/**': ['./src/docs/content/**/*.mdx']
  },
  // Inbox became a tab of Newsletters, and the Library moved into the
  // Knowledge base (/newsletters/library redirects there); keep old links working.
  async redirects() {
    return [
      { source: '/inbox', destination: '/newsletters/inbox', permanent: true },
      {
        source: '/library',
        destination: '/newsletters/library',
        permanent: true
      }
    ]
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb'
    }
  }
}

// The help pages under /docs are MDX files in src/docs/content, imported by
// the docs route (never routes of their own, so pageExtensions stays as it
// is). Plugins are named rather than imported: Turbopack cannot take
// functions. remark-gfm adds tables, strikethrough and task lists.
const withMDX = createMDX({
  options: {
    remarkPlugins: ['remark-gfm']
  }
})

export default withMDX(nextConfig)
