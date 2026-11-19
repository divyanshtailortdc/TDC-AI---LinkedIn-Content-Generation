import { createHash } from 'node:crypto'

/**
 * What is embedded for one section of a help page, and its fingerprint.
 * src/docs/scripts/build-search-index.ts embeds each section once and
 * stores the vector with this hash in src/docs/search-embeddings.json; the
 * docs search (src/docs/semantic-search.ts) uses a stored vector only while
 * its section still hashes the same, so an edited page is never matched on
 * its old text.
 */

/** Long sections are cut: their opening says what they are about. */
const MAX_INPUT_CHARS = 6000

export function sectionEmbeddingInput(
  page: { title: string; trail: string[] },
  section: { heading: string; text: string }
): string {
  const where = [...page.trail, page.title].join(' › ')
  return `${where}\n${section.heading}\n${section.text}`.slice(
    0,
    MAX_INPUT_CHARS
  )
}

export function sectionEmbeddingHash(modelId: string, input: string): string {
  return createHash('sha256').update(`${modelId}\n${input}`).digest('hex')
}

/** The stored file: one vector per section, as base64 float32. */
export type StoredDocEmbeddings = {
  model: string
  sections: Array<{
    /** `<slug>#<section id>`, for reading the file; matching is by hash. */
    key: string
    hash: string
    vector: string
  }>
}

export function encodeVector(vector: number[]): string {
  return Buffer.from(new Float32Array(vector).buffer).toString('base64')
}

export function decodeVector(encoded: string): number[] {
  // Copied, so the floats start on an aligned offset.
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64'))
  return Array.from(new Float32Array(bytes.buffer))
}
