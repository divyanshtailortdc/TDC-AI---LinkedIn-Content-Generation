import 'server-only'

import { db } from '@/db'
import { env } from '~/env'
import type { PublishDeps } from './engine'
import {
  BUFFER_PLATFORM_IDS,
  type BufferPlatformId,
  type PublishingPlatformId
} from './platform'
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

/** X_PUBLISHING, THREADS_PUBLISHING, FACEBOOK_PUBLISHING or INSTAGRAM_PUBLISHING. */
const bufferSwitch = (platform: BufferPlatformId) =>
  ({
    x: env.X_PUBLISHING,
    threads: env.THREADS_PUBLISHING,
    facebook: env.FACEBOOK_PUBLISHING,
    instagram: env.INSTAGRAM_PUBLISHING
  })[platform]

/**
 * Where Buffer sends the user back after connecting `platform`. X keeps
 * BUFFER_REDIRECT_URI as set; the others use their own callback on its
 * origin. Each must be registered on the Buffer app client.
 */
function bufferRedirectUri(platform: BufferPlatformId): string {
  if (platform === 'x' && env.BUFFER_REDIRECT_URI) return env.BUFFER_REDIRECT_URI
  return new URL(
    callbackPath(platform),
    env.BUFFER_REDIRECT_URI ?? appUrl()
  ).toString()
}

/**
 * Publishing to `platform` (X, Facebook or Instagram) through Buffer, or null
 * when it is off or there is no encryption key. With a Buffer app client id
 * (and its secret, for a confidential client), customers connect through
 * Buffer's consent screen; without one, each pastes a Buffer API key.
 */
export function bufferConfig(
  platform: BufferPlatformId = 'x'
): BufferConfig | null {
  if (bufferSwitch(platform) === 'off' || !env.TOKEN_ENCRYPTION_KEY) {
    return null
  }
  return {
    oauth:
      env.BUFFER_CLIENT_ID
        ? {
            clientId: env.BUFFER_CLIENT_ID,
            clientSecret: env.BUFFER_CLIENT_SECRET,
            redirectUri: bufferRedirectUri(platform),
            scopes: parseScopes(env.BUFFER_SCOPES)
          }
        : null,
    apiUrl: env.BUFFER_API_URL,
    // Where Buffer downloads post images from: a tunnel in local development.
    appUrl: env.PUBLISHING_MEDIA_URL ?? appUrl(),
    encryptionKey: parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY)
  }
}

/** Any Buffer platform's config: they share the key that signs image links. */
export function anyBufferConfig(): BufferConfig | null {
  for (const platform of BUFFER_PLATFORM_IDS) {
    const config = bufferConfig(platform)
    if (config) return config
  }
  return null
}

/** The config of every platform publishing is set up for. */
export function publishConfigs(): PublishConfigs {
  const configs: PublishConfigs = {}
  const linkedin = linkedInConfig()
  if (linkedin) configs.linkedin = linkedin
  for (const platform of BUFFER_PLATFORM_IDS) {
    const config = bufferConfig(platform)
    if (config) configs[platform] = config
  }
  return configs
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
