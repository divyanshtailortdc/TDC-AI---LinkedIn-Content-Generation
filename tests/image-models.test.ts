import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  drawsExactSize,
  geminiAspectFor,
  IMAGE_MODELS,
  modelFamily,
  openAiSizeFor
} from '../src/lib/media/image-models'
import sharp from 'sharp'
import { padToSize } from '../src/lib/media/brand-logo'
import { SHAPE_SIZES } from '../src/lib/media/canvas/spec'

describe('image models', () => {
  it('tries Nano Banana 2.1 first and keeps FLUX.2 Pro as the last resort', () => {
    assert.strictEqual(IMAGE_MODELS[0], 'google/gemini-nano-banana-2.1')
    assert.strictEqual(IMAGE_MODELS.at(-1), 'bfl/flux-2-pro')
    // Seedream stamps "AI generated" on its images.
    assert.ok(!IMAGE_MODELS.some(m => m.includes('seedream')))
  })

  it('knows which family each model is called as', () => {
    assert.strictEqual(modelFamily('google/gemini-3-pro-image'), 'gemini')
    assert.strictEqual(modelFamily('openai/gpt-image-2'), 'openai')
    assert.strictEqual(modelFamily('bfl/flux-2-pro'), 'flux')
    assert.strictEqual(drawsExactSize('bfl/flux-2-pro'), true)
    assert.strictEqual(drawsExactSize('google/gemini-nano-banana-2.1'), false)
  })

  it('asks Gemini for the shape nearest each platform shape', () => {
    assert.strictEqual(geminiAspectFor(SHAPE_SIZES['1.91:1']), '16:9')
    assert.strictEqual(geminiAspectFor(SHAPE_SIZES['16:9']), '16:9')
    assert.strictEqual(geminiAspectFor(SHAPE_SIZES['4:5']), '4:5')
    assert.strictEqual(geminiAspectFor({ width: 1440, height: 1440 }), '1:1')
    // A tall panel in a layout.
    assert.strictEqual(geminiAspectFor({ width: 1072, height: 1600 }), '2:3')
  })

  it('asks GPT Image for its nearest size', () => {
    assert.strictEqual(openAiSizeFor(SHAPE_SIZES['1.91:1']), '1536x1024')
    assert.strictEqual(openAiSizeFor(SHAPE_SIZES['4:5']), '1024x1536')
    assert.strictEqual(openAiSizeFor({ width: 1000, height: 1000 }), '1024x1024')
  })
})

describe('a design brought to the platform shape', () => {
  it('keeps all of it, filling the margins with its own edge colour', async () => {
    // A 16:9 design, navy with a white top band, padded to LinkedIn's 1.91:1.
    const design = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: '#0b2a5b' }
    })
      .composite([
        {
          input: await sharp({
            create: { width: 1600, height: 200, channels: 3, background: '#ffffff' }
          })
            .png()
            .toBuffer(),
          top: 0,
          left: 0
        }
      ])
      .png()
      .toBuffer()
    const padded = (await padToSize(design, SHAPE_SIZES['1.91:1']))!
    assert.strictEqual(padded.width, 2048)
    assert.strictEqual(padded.height, 1072)
    const { data, info } = await sharp(padded.buffer).raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels
      return [data[i]!, data[i + 1]!, data[i + 2]!]
    }
    // The left margin continues the design: white at the top, navy below.
    assert.ok(at(2, 50).every(v => v > 240), `top margin ${at(2, 50)}`)
    const navy = at(2, 900)
    assert.ok(navy[2]! > navy[0]! && navy[0]! < 40, `lower margin ${navy}`)
  })
})
