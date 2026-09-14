import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['postgres', 'node-cron'],
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb'
    }
  }
}

export default nextConfig
