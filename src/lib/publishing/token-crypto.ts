import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Platform tokens at rest: AES-256-GCM with a key only the server has
 * (TOKEN_ENCRYPTION_KEY). Each value gets its own random IV, and the
 * owning user's id is bound in as associated data, so a ciphertext copied
 * onto another user's row fails to decrypt instead of publishing as the
 * wrong member. A tampered value fails the same way.
 *
 * Stored as `v1:<iv>:<tag>:<ciphertext>` (base64url); the version leaves room
 * for a key rotation later. No `server-only` import, so tests can run it.
 */

const VERSION = 'v1'
const IV_BYTES = 12

export class TokenDecryptionError extends Error {
  constructor() {
    super('A stored platform token could not be decrypted.')
    this.name = 'TokenDecryptionError'
  }
}

/** The 32-byte key from its base64 form; throws on anything else. */
export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64')
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64.')
  }
  return key
}

export function encryptToken(
  plain: string,
  key: Buffer,
  userId: string
): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(userId, 'utf8'))
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url')
  ].join(':')
}

export function decryptToken(
  stored: string,
  key: Buffer,
  userId: string
): string {
  const [version, iv, tag, data] = stored.split(':')
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new TokenDecryptionError()
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64url')
    )
    decipher.setAAD(Buffer.from(userId, 'utf8'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    throw new TokenDecryptionError()
  }
}
