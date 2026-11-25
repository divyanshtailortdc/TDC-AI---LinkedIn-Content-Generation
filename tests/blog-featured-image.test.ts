import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  FEATURED_IMAGE_SIZE,
  featuredImagePrompt,
  makeFeaturedImage,
  type FeaturedImageDeps
} from '../src/lib/blogs/featured-image'
import { DEFAULT_BRAND_THEME } from '../src/lib/brand/theme'
import { EMPTY_USAGE } from '../src/lib/ai/usage'

const INPUT = {
  blogId: '0b6f7c5e-2f4a-4c2b-9a51-6c3a0d2f9e11',
  title: 'B2B eCommerce ERP: what syncing really costs',
  concept: 'Two clipboards with different stock counts on a warehouse shelf',
  alt: 'Two clipboards on a shelf showing different stock counts',
  style: 'photo' as const,
  theme: DEFAULT_BRAND_THEME
}

const fakeDeps = (overrides: Partial<FeaturedImageDeps> = {}) => {
  const calls = { render: [] as string[], stored: 0 }
  const deps: FeaturedImageDeps = {
    render: async request => {
      calls.render.push(request.prompt)
      request.onUsage({ ...EMPTY_USAGE, calls: 1, costUsd: 0.06 })
      return {
        buffer: Buffer.from('png'),
        mediaType: 'image/png',
        modelId: 'google/gemini-nano-banana-2.1',
        width: request.target.width,
        height: request.target.height,
        seed: 1,
        attempts: 1
      }
    },
    review: async () => ({ issues: [], usage: { ...EMPTY_USAGE, calls: 1, costUsd: 0.01 } }),
    toWebp: async buffer => ({ buffer, mediaType: 'image/webp' }),
    store: async () => {
      calls.stored++
      return 'storage://blogs/x/1.webp'
    },
    now: () => new Date('2026-11-25T10:00:00.000Z'),
    ...overrides
  }
  return { deps, calls }
}

describe('the featured image', () => {
  it('asks for the concept, the style and no text', () => {
    const prompt = featuredImagePrompt({ ...INPUT })
    assert.ok(prompt.includes(INPUT.concept))
    assert.match(prompt, /photograph/i)
    assert.ok(prompt.includes('No text anywhere in the picture'))
  })

  it('adds the author’s direction', () => {
    const prompt = featuredImagePrompt({ ...INPUT, direction: 'Warmer light, no people' })
    assert.ok(prompt.includes('Warmer light, no people'))
  })

  it('makes, checks, converts and stores the image at 1600 by 900', async () => {
    const { deps, calls } = fakeDeps()
    const { image, usage } = await makeFeaturedImage(INPUT, deps)
    assert.deepStrictEqual(image, {
      status: 'ready',
      src: 'storage://blogs/x/1.webp',
      alt: INPUT.alt,
      caption: '',
      width: FEATURED_IMAGE_SIZE.width,
      height: FEATURED_IMAGE_SIZE.height,
      mediaType: 'image/webp',
      model: 'google/gemini-nano-banana-2.1',
      prompt: calls.render[0]!,
      createdAt: '2026-11-25T10:00:00.000Z'
    })
    assert.strictEqual(calls.stored, 1)
    assert.ok(Math.abs((usage.costUsd ?? 0) - 0.07) < 1e-9)
  })

  it('tries once more when the check finds lettering', async () => {
    let reviews = 0
    const { deps, calls } = fakeDeps({
      review: async () => {
        reviews++
        return {
          issues: reviews === 1 ? ['Has stray or misspelt lettering: "STOK".'] : [],
          usage: EMPTY_USAGE
        }
      }
    })
    const { image } = await makeFeaturedImage(INPUT, deps)
    assert.strictEqual(calls.render.length, 2)
    assert.ok(calls.render[1]!.includes('Has stray or misspelt lettering'))
    assert.strictEqual(image.status, 'ready')
  })

  it('turns a failed render into a failed image with the reason', async () => {
    const { deps, calls } = fakeDeps({
      render: async () => {
        throw new Error('No image model produced an image.')
      }
    })
    const { image } = await makeFeaturedImage(INPUT, deps)
    assert.strictEqual(image.status, 'failed')
    if (image.status !== 'failed') return
    assert.match(image.error, /No image model produced an image/)
    assert.strictEqual(image.alt, INPUT.alt)
    assert.strictEqual(calls.stored, 0)
  })
})
