import { generateImage, generateText, type createGateway } from 'ai'
import { decodeImageDataUrl } from './brand-logo'

/**
 * The image models, best first, and how each is called through the AI
 * Gateway. Chosen by a side-by-side run on 2026-11-23 (the same photo, an
 * infographic and a quote card, each with an account's own post as the
 * style reference):
 *
 * - Nano Banana 2.1 made the most believable photograph (wear, clutter, no
 *   gibberish lettering), copied each account's design closely and spelled
 *   every requested word; about $0.06 and 40 s an image.
 * - Nano Banana Pro is as good at designs, at twice the price.
 * - GPT Image 2 makes the best photographs but takes 75 to 150 s.
 * - FLUX.2 Pro, the model used before, is the last resort.
 *
 * Seedream 5.5 stamps "AI generated" on its images and FLUX 3 refused a
 * brand's quote card, so neither is used.
 */
export const IMAGE_MODELS = [
  'google/gemini-nano-banana-2.1',
  'google/gemini-3-pro-image',
  'openai/gpt-image-2',
  'bfl/flux-2-pro'
] as const

export type ImageModelId = (typeof IMAGE_MODELS)[number]

type ModelFamily = 'gemini' | 'openai' | 'flux'

export const modelFamily = (modelId: string): ModelFamily =>
  modelId.startsWith('google/')
    ? 'gemini'
    : modelId.startsWith('openai/')
      ? 'openai'
      : 'flux'

/**
 * The shapes Gemini draws at. It takes a ratio, not a size, so the picture
 * is drawn at the nearest one and cut to the exact target afterwards.
 */
const GEMINI_ASPECTS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9'
] as const

/** GPT Image 2 draws at one of three sizes only. */
const OPENAI_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const

const ratioOf = (value: string) => {
  const [w, h] = value.split(/[:x]/).map(Number)
  return w! / h!
}

/** The listed shape closest to the target's, compared on a log scale. */
function nearest<T extends string>(
  target: { width: number; height: number },
  options: readonly T[]
): T {
  const want = Math.log(target.width / target.height)
  return options.reduce((best, option) =>
    Math.abs(Math.log(ratioOf(option)) - want) <
    Math.abs(Math.log(ratioOf(best)) - want)
      ? option
      : best
  )
}

export const geminiAspectFor = (target: { width: number; height: number }) =>
  nearest(target, GEMINI_ASPECTS)

export const openAiSizeFor = (target: { width: number; height: number }) =>
  nearest(target, OPENAI_SIZES)

/**
 * Whether the model draws exactly the size asked for. The others draw at
 * the nearest shape they have, and the result is cut to the target, so the
 * prompt asks them to keep everything that matters away from the edges.
 */
export const drawsExactSize = (modelId: string) =>
  modelFamily(modelId) === 'flux'

/** A reference as bytes, for the models that take files rather than data URLs. */
function referenceBytes(
  reference: string | Buffer
): { data: Buffer; mediaType: string } | null {
  if (Buffer.isBuffer(reference)) {
    // Sniffed rather than assumed: the stored examples are JPEG, logos PNG.
    const png = reference[0] === 0x89 && reference[1] === 0x50
    const webp = reference.toString('ascii', 8, 12) === 'WEBP'
    return {
      data: reference,
      mediaType: png ? 'image/png' : webp ? 'image/webp' : 'image/jpeg'
    }
  }
  const decoded = decodeImageDataUrl(reference)
  return decoded ? { data: decoded.buffer, mediaType: decoded.mediaType } : null
}

type GatewayProvider = ReturnType<typeof createGateway>

export type ModelImage = {
  /** The bytes as the model returned them, not yet cut to the target; null when none came back. */
  image: { buffer: Buffer; mediaType: string } | null
  /** The call's metadata, for its billed cost (readImageCost), image or not. */
  providerMetadata?: unknown
}

/**
 * One call to one model: a prompt and, for an edit or a design that follows
 * examples, reference images. Throws what the provider throws.
 */
export async function callImageModel(opts: {
  gateway: GatewayProvider
  modelId: string
  prompt: string
  references?: Array<string | Buffer>
  target: { width: number; height: number }
  seed: number
  abortSignal: AbortSignal
}): Promise<ModelImage> {
  const references = opts.references ?? []
  const family = modelFamily(opts.modelId)

  if (family === 'gemini') {
    const files = references
      .map(referenceBytes)
      .filter((r): r is NonNullable<typeof r> => r !== null)
    const result = await generateText({
      model: opts.gateway(opts.modelId),
      messages: [
        {
          role: 'user',
          content: [
            ...files.map(f => ({
              type: 'file' as const,
              data: f.data,
              mediaType: f.mediaType
            })),
            { type: 'text' as const, text: opts.prompt }
          ]
        }
      ],
      providerOptions: {
        google: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: geminiAspectFor(opts.target),
            imageSize: '2K'
          }
        }
      },
      maxRetries: 1,
      abortSignal: opts.abortSignal
    })
    const file = result.files.find(f => f.mediaType.startsWith('image/'))
    return {
      image: file
        ? { buffer: Buffer.from(file.uint8Array), mediaType: file.mediaType }
        : null,
      providerMetadata: result.providerMetadata
    }
  }

  const size =
    family === 'openai'
      ? openAiSizeFor(opts.target)
      : (`${opts.target.width}x${opts.target.height}` as const)
  const result = await generateImage({
    model: opts.gateway.imageModel(opts.modelId),
    prompt: references.length
      ? { text: opts.prompt, images: references }
      : opts.prompt,
    size,
    ...(family === 'flux' ? { seed: opts.seed } : {}),
    ...(family === 'openai'
      ? { providerOptions: { openai: { quality: 'high' } } }
      : {}),
    maxRetries: 1,
    abortSignal: opts.abortSignal
  })
  const first = result.images?.[0]
  return {
    image: first?.base64
      ? {
          buffer: Buffer.from(first.base64, 'base64'),
          mediaType: first.mediaType || 'image/png'
        }
      : null,
    providerMetadata: result.providerMetadata
  }
}

/**
 * Said to the models that draw at a nearby shape: the picture is trimmed to
 * the platform's exact shape afterwards, a few percent off two edges.
 */
export const EDGE_SAFETY_LINE =
  'Keep every word and every important element well inside the frame, clear of all four edges: the image may be trimmed slightly to its final shape.'
