/**
 * Input rules for prompt-driven image generation and the other media inputs.
 *
 * Shared by the posts client — to disable buttons and say why — and by the API
 * route and server actions, which must re-check because the client can be
 * bypassed. Kept free of Node APIs so client components can import it.
 */

import type { VisualType } from '~/lib/ai/skills/media-brief/schema'

export const IMAGE_PROMPT_MIN_LENGTH = 3
export const IMAGE_PROMPT_MAX_WORDS = 1000
export const IMAGE_PROMPT_MAX_CHARACTERS = 10000

export const REFERENCE_IMAGE_MAX_BYTES = 3 * 1024 * 1024
/** Anything smaller cannot usefully guide a 2048x1072 edit. */
export const REFERENCE_IMAGE_MIN_EDGE = 256
export const REFERENCE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const MAX_REFERENCE_IMAGES = 1

export const STOCK_QUERY_MAX_LENGTH = 200
export const IMAGE_URL_MAX_LENGTH = 2048

/**
 * The kinds of image a reviewer can ask for when one is designed from the
 * post, in plain words. Optional: without a choice the art director picks.
 */
export const IMAGE_TYPE_CHOICES = [
  {
    value: 'hub_spoke',
    label: 'Hub & spoke',
    description: 'One idea in the middle, linked to the parts around it.'
  },
  {
    value: 'flow',
    label: 'Steps',
    description: 'A process from start to finish, step by step.'
  },
  {
    value: 'stack',
    label: 'Layers',
    description: 'Building blocks stacked, each resting on the one below.'
  },
  {
    value: 'cards',
    label: 'Key points',
    description: '2 to 4 takeaways side by side, each with a short detail.'
  },
  {
    value: 'comparison',
    label: 'Comparison',
    description: 'Two sides next to each other, like before and after.'
  },
  {
    value: 'illustration',
    label: 'Illustration',
    description: 'A drawn scene instead of a diagram, for a story or a moment.'
  }
] as const satisfies readonly {
  value: VisualType
  label: string
  description: string
}[]
export type ImageTypeChoice = (typeof IMAGE_TYPE_CHOICES)[number]['value']

const formatMegabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export function countWords(value: string): number {
  const trimmed = value.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/** Returns a user-facing problem with the prompt, or null when it is usable. */
export function validateImagePrompt(value: string): string | null {
  const length = value.trim().length
  if (length === 0) return 'Describe the image you want.'
  if (length < IMAGE_PROMPT_MIN_LENGTH) {
    return `Add a little more detail — at least ${IMAGE_PROMPT_MIN_LENGTH} characters.`
  }
  const words = countWords(value)
  if (words > IMAGE_PROMPT_MAX_WORDS) {
    return `Keep the prompt under ${IMAGE_PROMPT_MAX_WORDS} words (currently ${words}).`
  }
  if (length > IMAGE_PROMPT_MAX_CHARACTERS) {
    return `Prompt is too long — keep it under ${IMAGE_PROMPT_MAX_CHARACTERS.toLocaleString()} characters.`
  }
  return null
}

/** Checks what a File (or pasted clipboard image) declares, before reading it. */
export function validateReferenceFile(file: { type: string; size: number }): string | null {
  if (!(REFERENCE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return `Use a PNG, JPEG or WebP image${file.type ? ` (this file is ${file.type})` : ''}.`
  }
  if (file.size === 0) return 'That image file is empty.'
  if (file.size > REFERENCE_IMAGE_MAX_BYTES) {
    return `Reference image must be under ${formatMegabytes(REFERENCE_IMAGE_MAX_BYTES)} (this one is ${formatMegabytes(file.size)}).`
  }
  return null
}

export function validateReferenceDimensions(width: number, height: number): string | null {
  if (Math.min(width, height) < REFERENCE_IMAGE_MIN_EDGE) {
    return `Reference image is too small (${width}×${height}). Use one at least ${REFERENCE_IMAGE_MIN_EDGE}px on each side.`
  }
  return null
}

export function validateStockQuery(value: string): string | null {
  const length = value.trim().length
  if (length === 0) return 'Enter something to search for.'
  if (length > STOCK_QUERY_MAX_LENGTH) {
    return `Keep the search under ${STOCK_QUERY_MAX_LENGTH} characters.`
  }
  return null
}

/** Only absolute http(s) links: anything else would be stored and rendered as-is. */
export function validateImageUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Paste an image URL.'
  if (trimmed.length > IMAGE_URL_MAX_LENGTH) return 'That URL is too long.'
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return 'That is not a valid URL.'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Use an http or https image link.'
  }
  return null
}

const REFERENCE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/

/** Splits a base64 image data URL, or returns null if it is not one we accept. */
export function parseReferenceDataUrl(
  value: string
): { mediaType: string; base64: string } | null {
  const match = REFERENCE_DATA_URL.exec(value)
  return match ? { mediaType: match[1]!, base64: match[2]! } : null
}
