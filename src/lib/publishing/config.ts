import 'server-only'

import { db } from '@/db'
import { env } from '~/env'
import { parseScopes, type PublishingAppConfig } from './provider'
import type { PublishDeps } from './engine'
import { CALLBACK_PATH } from './routes'
import { parseEncryptionKey } from './token-crypto'

/**
 * The publishing platform's app, from the environment, or null when
 * publishing is not set up (no client id, secret or encryption key). Deliberately not
 * the sign-in credentials: see LINKEDIN_PUBLISH_CLIENT_ID in src/env.ts.
 */
export function publishingConfig(): PublishingAppConfig | null {
  if (
    !env.LINKEDIN_PUBLISH_CLIENT_ID ||
    !env.LINKEDIN_PUBLISH_CLIENT_SECRET ||
    !env.TOKEN_ENCRYPTION_KEY
  ) {
    return null
  }
  const appUrl = env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL
  return {
    clientId: env.LINKEDIN_PUBLISH_CLIENT_ID,
    clientSecret: env.LINKEDIN_PUBLISH_CLIENT_SECRET,
    redirectUri:
      env.LINKEDIN_PUBLISH_REDIRECT_URI ??
      new URL(CALLBACK_PATH, appUrl).toString(),
    scopes: parseScopes(env.LINKEDIN_PUBLISH_SCOPES),
    apiVersion: env.LINKEDIN_API_VERSION,
    encryptionKey: parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY)
  }
}

/** Everything publishing needs, against the app's database; null when not set up. */
export function publishDeps(): PublishDeps | null {
  const config = publishingConfig()
  return config ? { database: db, config } : null
}
