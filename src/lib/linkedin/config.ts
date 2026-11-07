import 'server-only'

import { db } from '@/db'
import { env } from '~/env'
import { type LinkedInAppConfig, parseScopes } from './oauth'
import type { PublishDeps } from './publishing'
import { parseEncryptionKey } from './token-crypto'

/**
 * The LinkedIn publishing app, from the environment, or null when publishing
 * is not set up (no client id, secret or encryption key). Deliberately not
 * the sign-in credentials: see LINKEDIN_PUBLISH_CLIENT_ID in src/env.ts.
 */
export function linkedInPublishConfig(): LinkedInAppConfig | null {
  if (
    !env.LINKEDIN_PUBLISH_CLIENT_ID ||
    !env.LINKEDIN_PUBLISH_CLIENT_SECRET ||
    !env.LINKEDIN_TOKEN_ENCRYPTION_KEY
  ) {
    return null
  }
  const appUrl = env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL
  return {
    clientId: env.LINKEDIN_PUBLISH_CLIENT_ID,
    clientSecret: env.LINKEDIN_PUBLISH_CLIENT_SECRET,
    redirectUri:
      env.LINKEDIN_PUBLISH_REDIRECT_URI ??
      new URL('/api/linkedin/callback', appUrl).toString(),
    scopes: parseScopes(env.LINKEDIN_PUBLISH_SCOPES),
    apiVersion: env.LINKEDIN_API_VERSION,
    encryptionKey: parseEncryptionKey(env.LINKEDIN_TOKEN_ENCRYPTION_KEY)
  }
}

/** Everything publishing needs, against the app's database; null when not set up. */
export function publishDeps(): PublishDeps | null {
  const config = linkedInPublishConfig()
  return config ? { database: db, config } : null
}
