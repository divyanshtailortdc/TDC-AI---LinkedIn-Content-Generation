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
import { decodeImageDataUrl, toDataUrl, type ImageBytes } from './brand-logo'

/**
 * Where post images live. Generation hands over the image's bytes; with
 * STORAGE_BUCKET set they are uploaded and the `post_media` row keeps only
 * `storage://<key>`, so the database never holds the bytes. Without a bucket
 * they are stored as a data URL. Stock and reviewer-pasted images are already
 * https links and are left alone.
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
 * object for image bytes or a data URL, a link as it is. Each upload gets a
 * new key, so an object never changes once written and can be cached for good.
 *
 * Without a bucket, or when the upload fails, the image is kept as a data URL,
 * so it is not lost; the move script (scripts/move-media-images-to-storage.ts)
 * uploads it later.
 */
export async function storeImage(
  value: ImageBytes | string | null | undefined,
  draftId: string
): Promise<string | null> {
  if (!value) return null
  const inline = () =>
    typeof value === 'string' ? value : toDataUrl(value.buffer, value.mediaType)
  if (!env.STORAGE_BUCKET) return inline()
  const image = typeof value === 'string' ? decodeImageDataUrl(value) : value
  if (!image) return inline()

  const extension = EXTENSION_BY_TYPE[image.mediaType] ?? 'png'
  const key = `${draftPrefix(draftId)}${randomUUID()}.${extension}`
  try {
    await client().send(
      new PutObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: key,
        Body: image.buffer,
        ContentType: image.mediaType,
        CacheControl: 'private, max-age=31536000, immutable'
      })
    )
  } catch (err) {
    console.error(`Could not upload an image for draft ${draftId}:`, err)
    return inline()
  }
  return `${PREFIX}${key}`
}

/**
 * Both images of a media row, uploaded together: a generated image's bytes or
 * a stock link, and the image before the logo went on, when there is one.
 */
export async function storeMediaImages(
  draftId: string,
  images: { image?: ImageBytes; imageUrl?: string | null; baseImage?: ImageBytes }
) {
  const [imageUrl, baseImageUrl] = await Promise.all([
    storeImage(images.image ?? images.imageUrl, draftId),
    storeImage(images.baseImage, draftId)
  ])
  return { imageUrl, baseImageUrl }
}

/**
 * An identity's example post (src/lib/visual-examples), stored under its own
 * prefix. Like storeImage, it is kept as a data URL when there is no bucket
 * or the upload fails.
 */
export async function storeExampleImage(
  image: ImageBytes,
  accountId: string
): Promise<string> {
  const inline = () => toDataUrl(image.buffer, image.mediaType)
  if (!env.STORAGE_BUCKET) return inline()
  const extension = EXTENSION_BY_TYPE[image.mediaType] ?? 'jpg'
  const key = `examples/${accountId}/${randomUUID()}.${extension}`
  try {
    await client().send(
      new PutObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: key,
        Body: image.buffer,
        ContentType: image.mediaType,
        CacheControl: 'private, max-age=31536000, immutable'
      })
    )
  } catch (err) {
    console.error(`Could not upload an example image for ${accountId}:`, err)
    return inline()
  }
  return `${PREFIX}${key}`
}

/**
 * A blog's image (its featured image), stored under the blog's own prefix.
 * Like storeImage, it is kept as a data URL when there is no bucket or the
 * upload fails.
 */
export async function storeBlogImage(
  image: ImageBytes,
  blogId: string
): Promise<string> {
  const inline = () => toDataUrl(image.buffer, image.mediaType)
  if (!env.STORAGE_BUCKET) return inline()
  const extension = EXTENSION_BY_TYPE[image.mediaType] ?? 'webp'
  const key = `blogs/${blogId}/${randomUUID()}.${extension}`
  try {
    await client().send(
      new PutObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: key,
        Body: image.buffer,
        ContentType: image.mediaType,
        CacheControl: 'private, max-age=31536000, immutable'
      })
    )
  } catch (err) {
    console.error(`Could not upload an image for blog ${blogId}:`, err)
    return inline()
  }
  return `${PREFIX}${key}`
}

/** A stored image's bytes, or a data URL's; null for a link or an unreadable value. */
export async function loadImageBytes(
  value: string
): Promise<ImageBytes | null> {
  if (!isStoredImage(value)) return decodeImageDataUrl(value)
  return decodeImageDataUrl(await loadImageDataUrl(value))
}

/**
 * Uploads a draft's file that is not an image (a Reel's video) under the
 * draft's prefix, so deleting the draft's images deletes it too. Unlike an
 * image it is never kept inline: it throws when there is no bucket or the
 * upload fails.
 */
export async function storeDraftFile(
  draftId: string,
  file: { buffer: Buffer; mediaType: string; extension: string }
): Promise<string> {
  const bucket = requireBucket()
  const key = `${draftPrefix(draftId)}${randomUUID()}.${file.extension}`
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mediaType,
      CacheControl: 'private, max-age=31536000, immutable'
    })
  )
  return `${PREFIX}${key}`
}

/**
 * A signed link to a stored file, good for `expiresInSeconds` (at most 7
 * days, as S3 signs): for a service that fetches it later, such as Buffer
 * downloading a Reel's video.
 */
export async function signedStoredUrl(
  value: string,
  expiresInSeconds: number
): Promise<string> {
  if (!isStoredImage(value)) return value
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: requireBucket(), Key: storedImageKey(value) }),
    { expiresIn: Math.min(expiresInSeconds, 7 * 24 * 60 * 60) }
  )
}

/**
 * A stored file as a stream, whole or the byte range asked for ("bytes=0-1023"),
 * for a route that serves it on (a Reel's video to Buffer). Throws when the
 * bucket has no such file.
 */
export async function openStoredFile(
  value: string,
  range?: string | null
): Promise<{
  body: ReadableStream
  contentType: string | null
  contentLength: number | null
  /** Set for a range: "bytes 0-1023/9590574". */
  contentRange: string | null
}> {
  const object = await client().send(
    new GetObjectCommand({
      Bucket: requireBucket(),
      Key: storedImageKey(value),
      ...(range && { Range: range })
    })
  )
  if (!object.Body) throw new Error(`Stored file ${value} is empty`)
  return {
    body: object.Body.transformToWebStream(),
    contentType: object.ContentType ?? null,
    contentLength: object.ContentLength ?? null,
    contentRange: object.ContentRange ?? null
  }
}

/** A signed link that saves the stored file as `fileName` instead of opening it. */
export async function downloadableStoredUrl(value: string, fileName: string): Promise<string> {
  if (!isStoredImage(value)) return value
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: requireBucket(),
      Key: storedImageKey(value),
      ResponseContentDisposition: `attachment; filename="${fileName.replace(/[^\w.-]/g, '-')}"`
    }),
    { expiresIn: LINK_LIFETIME_SECONDS }
  )
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
    new GetObjectCommand({ Bucket: requireBucket(), Key: key }),
    // Covers reading the body too: a stalled read must not hold up a publish.
    { abortSignal: AbortSignal.timeout(30_000) }
  )
  if (!object.Body) throw new Error(`Stored image ${key} is empty`)
  const bytes = Buffer.from(await object.Body.transformToByteArray())
  const extension = key.slice(key.lastIndexOf('.') + 1)
  return toDataUrl(bytes, TYPE_BY_EXTENSION[extension] ?? 'image/png')
}

/**
 * Deletes stored images no row points at any more (a carousel slide drawn
 * again). Links and data URLs are left alone; a failure is only logged.
 */
export async function deleteStoredImages(values: Array<string | null | undefined>) {
  const bucket = env.STORAGE_BUCKET
  if (!bucket) return
  await Promise.all(
    values.filter(isStoredImage).map(value =>
      client()
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: storedImageKey(value) }))
        .catch(err => console.error(`Could not delete stored image ${value}:`, err))
    )
  )
}

/**
 * Deletes every stored object under a prefix. One request per object, since
 * Google Cloud Storage has no batch delete in its S3 API. A failure is only
 * logged: a leftover object costs storage, not correctness.
 */
async function deletePrefix(prefix: string, what: string) {
  const bucket = env.STORAGE_BUCKET
  if (!bucket) return
  try {
    let token: string | undefined
    do {
      const page = await client().send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
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
    console.error(`Could not delete the images of ${what}:`, err)
  }
}

/** Deletes every stored image of a draft, after its media rows are gone. */
export async function deleteDraftImages(draftId: string) {
  await deletePrefix(draftPrefix(draftId), `draft ${draftId}`)
}

/** Deletes every stored image of a blog (its featured images), after it is gone. */
export async function deleteBlogImages(blogId: string) {
  await deletePrefix(`blogs/${blogId}/`, `blog ${blogId}`)
}
