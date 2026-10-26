import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import { env } from '~/env'
import { decodeImageDataUrl, toDataUrl } from './brand-logo'

/**
 * Where post images live. Generation hands over a base64 data URL; with
 * STORAGE_BUCKET set it is uploaded and the `post_media` row keeps only
 * `storage://<key>`, so the database never holds the bytes. Without a bucket
 * the data URL is stored as before. Stock and reviewer-pasted images are
 * already https links and are left alone.
 *
 * Any S3-compatible store works: Google Cloud Storage (with HMAC keys),
 * Cloudflare R2, AWS S3, or LocalStack/MinIO locally. Which one is set by the
 * STORAGE_* variables alone, so the app moves between hosts without code
 * changes. Rows hold no bucket name: copying the objects to another bucket
 * under the same keys and changing the variables is the whole move.
 *
 * The bucket can stay private: the browser gets a signed link, and the server
 * reads the bytes itself when it needs them (editing an image).
 *
 * No `server-only` import, so tests can run the parts that need no bucket.
 */

const PREFIX = 'storage://'

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
}
const TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp'
}

let s3: S3Client | undefined
const client = () =>
  (s3 ??= new S3Client({
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT,
    // Path-style addressing is the one every S3-compatible store accepts.
    forcePathStyle: true,
    credentials:
      env.STORAGE_ACCESS_KEY_ID && env.STORAGE_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.STORAGE_ACCESS_KEY_ID,
            secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY
          }
        : undefined,
    // The SDK adds CRC checksums to every request by default, which Google
    // Cloud Storage rejects; send them only where an operation requires one.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
  }))

const requireBucket = () => {
  if (!env.STORAGE_BUCKET) {
    throw new Error(
      'This image is in object storage, but STORAGE_BUCKET is not set'
    )
  }
  return env.STORAGE_BUCKET
}

/** True when the value is an object in the bucket rather than a link or data. */
export const isStoredImage = (
  value: string | null | undefined
): value is string => Boolean(value?.startsWith(PREFIX))

export const storedImageKey = (value: string) => value.slice(PREFIX.length)

/** Every image of a draft sits under one prefix, so they can be deleted together. */
const draftPrefix = (draftId: string) => `drafts/${draftId}/`

/**
 * What a `post_media` image column should hold for this value: the stored
 * object for a data URL, the value itself otherwise. Each upload gets a new
 * key, so an object never changes once written and can be cached for good.
 *
 * An upload that fails keeps the data URL, so the image is not lost; the move
 * script (scripts/move-media-images-to-storage.ts) uploads it later.
 */
export async function storeImage(
  value: string | null | undefined,
  draftId: string
): Promise<string | null> {
  if (!value) return null
  if (!env.STORAGE_BUCKET) return value
  const decoded = decodeImageDataUrl(value)
  if (!decoded) return value

  const extension = EXTENSION_BY_TYPE[decoded.mediaType] ?? 'png'
  const key = `${draftPrefix(draftId)}${randomUUID()}.${extension}`
  try {
    await client().send(
      new PutObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: key,
        Body: decoded.buffer,
        ContentType: decoded.mediaType,
        CacheControl: 'private, max-age=31536000, immutable'
      })
    )
  } catch (err) {
    console.error(`Could not upload an image for draft ${draftId}:`, err)
    return value
  }
  return `${PREFIX}${key}`
}

/** Both images of a media row, uploaded together. */
export async function storeMediaImages(
  draftId: string,
  images: { imageUrl?: string | null; baseImageUrl?: string | null }
) {
  const [imageUrl, baseImageUrl] = await Promise.all([
    storeImage(images.imageUrl, draftId),
    storeImage(images.baseImageUrl, draftId)
  ])
  return { imageUrl, baseImageUrl }
}

// Links are signed for a fixed window rather than from the moment they are
// asked for, so every request in the same half hour gets the same link and the
// browser serves a reopened post from its cache. A link is good for at least
// an hour after it is handed out.
const SIGNING_WINDOW_MS = 30 * 60 * 1000
const LINK_LIFETIME_SECONDS = 90 * 60
let signedWindow = 0
const signedLinks = new Map<string, string>()

/** A link the browser can load: signed for a stored image, the value itself otherwise. */
export async function viewableImageUrl(value: string): Promise<string> {
  if (!isStoredImage(value)) return value

  const windowStart =
    Math.floor(Date.now() / SIGNING_WINDOW_MS) * SIGNING_WINDOW_MS
  if (windowStart !== signedWindow) {
    signedWindow = windowStart
    signedLinks.clear()
  }
  const cached = signedLinks.get(value)
  if (cached) return cached

  const url = await getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: requireBucket(),
      Key: storedImageKey(value)
    }),
    { expiresIn: LINK_LIFETIME_SECONDS, signingDate: new Date(windowStart) }
  )
  signedLinks.set(value, url)
  return url
}

/** The image as a data URL, for code that needs the bytes (an image edit). */
export async function loadImageDataUrl(value: string): Promise<string> {
  if (!isStoredImage(value)) return value
  const key = storedImageKey(value)
  const object = await client().send(
    new GetObjectCommand({ Bucket: requireBucket(), Key: key })
  )
  if (!object.Body) throw new Error(`Stored image ${key} is empty`)
  const bytes = Buffer.from(await object.Body.transformToByteArray())
  const extension = key.slice(key.lastIndexOf('.') + 1)
  return toDataUrl(bytes, TYPE_BY_EXTENSION[extension] ?? 'image/png')
}

/**
 * Deletes every stored image of a draft, after its media rows are gone. One
 * request per object, since Google Cloud Storage has no batch delete in its
 * S3 API. A failure is only logged: a leftover object costs storage, not
 * correctness.
 */
export async function deleteDraftImages(draftId: string) {
  const bucket = env.STORAGE_BUCKET
  if (!bucket) return
  try {
    let token: string | undefined
    do {
      const page = await client().send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: draftPrefix(draftId),
          ContinuationToken: token
        })
      )
      await Promise.all(
        (page.Contents ?? []).map(object =>
          client().send(
            new DeleteObjectCommand({ Bucket: bucket, Key: object.Key })
          )
        )
      )
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
  } catch (err) {
    console.error(`Could not delete the images of draft ${draftId}:`, err)
  }
}
