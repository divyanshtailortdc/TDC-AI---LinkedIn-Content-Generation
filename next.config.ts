import createMDX from '@next/mdx'
import type { NextConfig } from 'next'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

/**
 * A package's own folder, relative to the project: pnpm links
 * node_modules/<name> to a folder under node_modules/.pnpm, and the package's
 * code runs from there. Naming the files through the link as well deploys
 * each binary twice, which would take a function past Vercel's 250 MB.
 */
function packageDir(name: string): string {
  const linked = path.join('node_modules', name)
  const real = existsSync(linked)
    ? path.relative(process.cwd(), realpathSync(linked))
    : linked
  return `./${real.split(path.sep).join('/')}`
}

// Reels and Shorts are recorded on the server (src/lib/video/render): a
// serverless Chromium, the ffmpeg binary ffmpeg-static downloads, and the
// bundled typeface. Neither binary is found by tracing, so they are deployed
// with the routes that record: the post's video route and the job pass
// (about 180 MB each with them).
const VIDEO_RECORDING_FILES = [
  `${packageDir('@sparticuz/chromium')}/bin/**`,
  `${packageDir('ffmpeg-static')}/ffmpeg`,
  './src/lib/media/canvas/fonts/**'
]

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.2.62'],
  // Loaded by Node as they are: the IMAP client opens raw TLS sockets and logs
  // through pino, and mailparser loads charset tables at run time. The
  // serverless Chromium unpacks itself from files beside its package.
  serverExternalPackages: [
    'postgres',
    'node-cron',
    'imapflow',
    'mailparser',
    '@sparticuz/chromium'
  ],
  // The help pages' text is read from disk for their "On this page" lists
  // and search (src/docs/content.ts); deploy the files with those routes.
  outputFileTracingIncludes: {
    '/docs/**': ['./src/docs/content/**/*.mdx'],
    '/api/docs/**': ['./src/docs/content/**/*.mdx'],
    '/api/posts/\\[id\\]/video': VIDEO_RECORDING_FILES,
    '/api/cron/jobs': VIDEO_RECORDING_FILES,
    // Create from media reads an uploaded video's frames with ffmpeg alone.
    '/api/media-posts/analyze': [`${packageDir('ffmpeg-static')}/ffmpeg`]
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
