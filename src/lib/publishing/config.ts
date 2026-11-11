import 'server-only'

import { db } from '@/db'
import { env } from '~/env'
import type { PublishDeps } from './engine'
import type { PublishingPlatformId } from './platform'
import {
  type BufferConfig,
  parseScopes,
  type PublishConfigs,
  type PublishingAppConfig
} from './provider'
import { callbackPath } from './routes'
import { parseEncryptionKey } from './token-crypto'

const appUrl = () => env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL

/**
 * LinkedIn's publishing app, from the environment, or null when it is not set
 * up (no client id, secret or encryption key). Deliberately not the sign-in
 * credentials: see LINKEDIN_PUBLISH_CLIENT_ID in src/env.ts.
 */
export function linkedInConfig(): PublishingAppConfig | null {
  if (
    !env.LINKEDIN_PUBLISH_CLIENT_ID ||
    !env.LINKEDIN_PUBLISH_CLIENT_SECRET ||
    !env.TOKEN_ENCRYPTION_KEY
  ) {
    return null
  }
  return {
    clientId: env.LINKEDIN_PUBLISH_CLIENT_ID,
    clientSecret: env.LINKEDIN_PUBLISH_CLIENT_SECRET,
    redirectUri:
      env.LINKEDIN_PUBLISH_REDIRECT_URI ??
      new URL(callbackPath('linkedin'), appUrl()).toString(),
    scopes: parseScopes(env.LINKEDIN_PUBLISH_SCOPES),
    apiVersion: env.LINKEDIN_API_VERSION,
    encryptionKey: parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY)
  }
}

/**
 * X through Buffer, or null when it is off or there is no encryption key.
 * With a Buffer app client id (and its secret, for a confidential client),
 * customers connect through Buffer's consent screen; without one, each
 * pastes a Buffer API key.
 */
export function bufferConfig(): BufferConfig | null {
  if (env.X_PUBLISHING === 'off' || !env.TOKEN_ENCRYPTION_KEY) return null
  return {
    oauth:
      env.BUFFER_CLIENT_ID
        ? {
            clientId: env.BUFFER_CLIENT_ID,
            clientSecret: env.BUFFER_CLIENT_SECRET,
            redirectUri:
              env.BUFFER_REDIRECT_URI ??
              new URL(callbackPath('x'), appUrl()).toString(),
            scopes: parseScopes(env.BUFFER_SCOPES)
          }
        : null,
    apiUrl: env.BUFFER_API_URL,
    appUrl: appUrl(),
    encryptionKey: parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY)
  }
}

/** The config of every platform publishing is set up for. */
export function publishConfigs(): PublishConfigs {
  const linkedin = linkedInConfig()
  const x = bufferConfig()
  return { ...(linkedin && { linkedin }), ...(x && { x }) }
}

/**
 * Whether publishing to `platform` is set up on this server; without one,
 * whether any platform is (then the app reads its publishing tables).
 */
export function isPublishingConfigured(platform?: PublishingPlatformId): boolean {
  const configs = publishConfigs()
  return platform ? Boolean(configs[platform]) : Object.keys(configs).length > 0
}

/** The config for `platform`, or null when it is not set up. */
export function configFor(platform: PublishingPlatformId) {
  return publishConfigs()[platform] ?? null
}

/** Everything publishing needs, against the app's database; null when nothing is set up. */
export function publishDeps(): PublishDeps | null {
  const configs = publishConfigs()
  return Object.keys(configs).length > 0 ? { database: db, configs } : null
}
