import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.2.62'],
  serverExternalPackages: ['postgres', 'node-cron'],
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb'
    }
  }
}

export default nextConfig
