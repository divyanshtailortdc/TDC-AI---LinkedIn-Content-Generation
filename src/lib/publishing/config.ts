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
  type PublishConfigs
} from './provider'
import { callbackPath } from './routes'
import { parseEncryptionKey } from './token-crypto'

const appUrl = () => env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL

/** LINKEDIN_PUBLISHING, X_PUBLISHING, THREADS_PUBLISHING, FACEBOOK_PUBLISHING or INSTAGRAM_PUBLISHING. */
const bufferSwitch = (platform: BufferPlatformId) =>
  ({
    linkedin: env.LINKEDIN_PUBLISHING,
    x: env.X_PUBLISHING,
    threads: env.THREADS_PUBLISHING,
    facebook: env.FACEBOOK_PUBLISHING,
    instagram: env.INSTAGRAM_PUBLISHING
  })[platform]

/**
 * Where Buffer sends the user back after they connect their Buffer account:
 * /api/integrations/buffer/callback, on BUFFER_REDIRECT_URI's origin (the
 * app's by default). It must be registered on the Buffer app client.
 */
const bufferRedirectUri = () =>
  new URL(callbackPath('buffer'), env.BUFFER_REDIRECT_URI ?? appUrl()).toString()

/**
 * Publishing to `platform` (X, Threads, Facebook or Instagram) through Buffer,
 * or null when it is off or there is no encryption key. With a Buffer app
 * client id (and its secret, for a confidential client), users connect their
 * Buffer account on Buffer's consent screen; without one, nobody can connect
 * Buffer, but connections made earlier with a pasted API key still publish.
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
            redirectUri: bufferRedirectUri(),
            scopes: parseScopes(env.BUFFER_SCOPES)
          }
        : null,
    tokenEncryptionKey: parseEncryptionKey(
      env.BUFFER_TOKEN_ENCRYPTION_KEY ?? env.TOKEN_ENCRYPTION_KEY
    ),
    apiUrl: env.BUFFER_API_URL,
    // Where Buffer downloads post images from: a tunnel in local development.
    appUrl: env.PUBLISHING_MEDIA_URL ?? appUrl(),
    encryptionKey: parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY)
  }
}

/**
 * Any Buffer platform's config: they share the key that signs image links,
 * and the app client the Buffer connection is made with.
 */
export function anyBufferConfig(): BufferConfig | null {
  for (const platform of BUFFER_PLATFORM_IDS) {
    const config = bufferConfig(platform)
    if (config) return config
  }
  return null
}

/** The networks publishing through Buffer is on for, in Settings' order. */
export const enabledBufferPlatforms = (): BufferPlatformId[] =>
  BUFFER_PLATFORM_IDS.filter(platform => bufferConfig(platform) !== null)

/**
 * The config users connect their Buffer account with, or null when they
 * cannot: no network goes through Buffer, or there is no Buffer app client.
 */
export function bufferConnectConfig():
  | (BufferConfig & { oauth: NonNullable<BufferConfig['oauth']> })
  | null {
  const config = anyBufferConfig()
  return config?.oauth ? { ...config, oauth: config.oauth } : null
}

/** The config of every platform publishing is set up for: all through Buffer. */
export function publishConfigs(): PublishConfigs {
  const configs: PublishConfigs = {}
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

/** Everything publishing needs, against the app's database; null when nothing is set up. */
export function publishDeps(): PublishDeps | null {
  const configs = publishConfigs()
  return Object.keys(configs).length > 0 ? { database: db, configs } : null
}
