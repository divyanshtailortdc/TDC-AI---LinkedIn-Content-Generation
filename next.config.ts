import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.2.62'],
  // Loaded by Node as they are: the IMAP client opens raw TLS sockets and logs
  // through pino, and mailparser loads charset tables at run time.
  serverExternalPackages: ['postgres', 'node-cron', 'imapflow', 'mailparser'],
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb'
    }
  }
}

export default nextConfig
