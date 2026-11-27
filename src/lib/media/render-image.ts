import crypto from 'crypto'
import { env } from '~/env'
import { gatewayClient } from '~/lib/ai'
import {
  AiSpendLimitError,
  assertWithinAiSpendLimit,
  recordAiSpend
} from '~/lib/ai/spend'
import { readImageCost, type CallUsage } from '~/lib/ai/usage'
import { coverToSize, fitToSize, padToSize } from './brand-logo'
import { describeImageFailure, isAccountFailure } from './image-errors'
import {
  callImageModel,
  drawsExactSize,
  EDGE_SAFETY_LINE,
  IMAGE_MODELS
} from './image-models'

/**
 * One image from the image models, tried best first (./image-models.ts), at
 * exactly the size asked for. Shared by the designed image (./index.ts) and
 * the image made like the account's own posts (./learned-look.ts).
 */

/** One image call; a provider that hangs must not hold a reviewer's screen for minutes. */
const IMAGE_CALL_TIMEOUT_MS = 120_000

/** Thrown when generation is cancelled through `abortSignal`, so callers can skip saving. */
export class ImageGenerationAbortedError extends Error {
  constructor() {
    super('Image generation was stopped.')
    this.name = 'ImageGenerationAbortedError'
  }
}

/** No model produced a usable image; the message says why in plain words. */
export class ImageGenerationError extends Error {
  constructor(
    message: string,
    readonly attempts: number
  ) {
    super(message)
    this.name = 'ImageGenerationError'
  }
}

export const randomSeed = () => crypto.randomInt(1, 1_000_000)

export interface RenderedImage {
  buffer: Buffer
  mediaType: string
  modelId: string
  width: number
  height: number
  seed: number
  attempts: number
}

/**
 * One image from the gateway, trying each model in turn, at exactly `target`.
 * Throws ImageGenerationError with the reasons when none delivers.
 */
export async function renderImage(req: {
  prompt: string
  /** Images to edit or to follow, sent with the prompt. */
  references?: Array<string | Buffer>
  target: { width: number; height: number }
  seed: number
  /**
   * Crop whatever shape comes back to the target, rather than refusing one
   * more than 2% off: for a picture inside a design, where a near miss
   * still fills its panel.
   */
  crop?: boolean
  /**
   * For a whole designed image: when a model draws a nearby shape, fill the
   * margins rather than cut its edges, where its words often sit.
   */
  pad?: boolean
  abortSignal?: AbortSignal
  /** Called with each billed call as soon as it is known. */
  onUsage: (usage: CallUsage) => void
  /**
   * The name the usage ledger records it under, when not 'image': a second
   * try after a failed check is 'image_retry', so how often that happens
   * shows in a post's cost.
   */
  recordAs?: string
}): Promise<RenderedImage> {
  if (!gatewayClient || !env.AI_GATEWAY_API_KEY) {
    throw new ImageGenerationError(
      'Image generation is not configured. Add AI_GATEWAY_API_KEY to enable it.',
      0
    )
  }
  // Once per image: the models after the first are fallbacks for the same one.
  try {
    await assertWithinAiSpendLimit()
  } catch (err) {
    if (err instanceof AiSpendLimitError) {
      throw new ImageGenerationError(err.message, 0)
    }
    throw err
  }
  const references = req.references?.length ? req.references : undefined
  const failures: string[] = []
  let attempts = 0

  for (const modelId of IMAGE_MODELS) {
    if (req.abortSignal?.aborted) throw new ImageGenerationAbortedError()
    attempts++
    try {
      const result = await callImageModel({
        gateway: gatewayClient,
        modelId,
        // The models that draw at a nearby shape are trimmed to the target.
        prompt: drawsExactSize(modelId)
          ? req.prompt
          : `${req.prompt}\n\n${EDGE_SAFETY_LINE}`,
        references,
        target: req.target,
        seed: req.seed,
        abortSignal: AbortSignal.any(
          [AbortSignal.timeout(IMAGE_CALL_TIMEOUT_MS), req.abortSignal].filter(
            (s): s is AbortSignal => Boolean(s)
          )
        )
      })
      const cost = readImageCost(result)
      req.onUsage(cost)
      await recordAiSpend({ stage: req.recordAs ?? 'image', modelId, usage: cost })

      if (!result.image) {
        failures.push(`${modelId} returned no image`)
        continue
      }
      // Measured rather than trusted: these models sometimes return another
      // size, and most draw at the nearest shape they have. A picture inside
      // a layout is cut around its subject; a whole image (a design with
      // words near its edges) evenly from both sides.
      const bytes = result.image.buffer
      const fitted = req.crop
        ? await coverToSize(bytes, req.target)
        : drawsExactSize(modelId)
          ? await fitToSize(bytes, req.target)
          : req.pad
            ? await padToSize(bytes, req.target)
            : await coverToSize(bytes, req.target, 'centre')
      if (!fitted) {
        failures.push(`${modelId} returned an image of the wrong shape`)
        continue
      }
      return {
        buffer: fitted.buffer,
        mediaType: fitted.resized ? 'image/jpeg' : result.image.mediaType,
        modelId,
        width: fitted.width,
        height: fitted.height,
        seed: req.seed,
        attempts
      }
    } catch (err) {
      // The gateway surfaces an abort as a GatewayResponseError, not an AbortError,
      // so check the signal itself. Falling through would start the next model.
      if (req.abortSignal?.aborted) throw new ImageGenerationAbortedError()
      const reason = describeImageFailure(err)
      console.warn(`Image generation failed on "${modelId}":`, reason)
      failures.push(reason)
      if (isAccountFailure(err)) break
    }
  }

  const reasons = Array.from(new Set(failures))
  throw new ImageGenerationError(
    `Image generation failed: ${reasons.join('; ') || 'no image model is available'}.`,
    attempts
  )
}
