import assert from 'node:assert'
import { describe, it } from 'node:test'
import { buildPrompt as buildDesignPrompt } from '../src/lib/ai/skills/look-design/prompt'
import { buildPrompt as buildSeriesPrompt } from '../src/lib/ai/skills/look-series/prompt'
import { slideLookOf, type SlideLook } from '../src/lib/carousel/rows'
import {
  numberRecentLooks,
  recentLookOf,
  type RecentLookInput
} from '../src/lib/visual-examples/recent'

const example = (platformName = 'Instagram') => ({
  data: new Uint8Array(),
  mediaType: 'image/jpeg',
  platformName,
  samePlatform: true,
  uploaded: false
})
const context = { accountName: 'Zomato', evidence: [], knowledge: [], offerings: [], brand: '' } as any

const recent: RecentLookInput[] = [
  {
    carousel: false,
    kind: 'graphic',
    styleNotes: 'Flat red card, big white lowercase type, wordmark bottom left.',
    concept: 'A mock legal clause card for just one bite.',
    examples: [1, 4]
  },
  {
    carousel: true,
    kind: 'graphic',
    styleNotes: 'Near-black grainy poster with red condensed caps.',
    concept: 'Sunday us against Wednesday us.',
    examples: []
  }
]

describe('a look made earlier, as stored', () => {
  it('reads an image’s look, its concept from the image, and the examples it followed', () => {
    assert.deepStrictEqual(
      recentLookOf(
        { kind: 'graphic', styleNotes: ' Red cards. ', text: [], examplesFollowed: 2, exampleIds: ['a', 7, 'b'] },
        { carousel: false, concept: ' A clause card. ' }
      ),
      { carousel: false, kind: 'graphic', styleNotes: 'Red cards.', concept: 'A clause card.', exampleIds: ['a', 'b'] }
    )
  })

  it('reads a carousel cover’s look, with its own concept, and none without a style', () => {
    assert.deepStrictEqual(
      recentLookOf({ kind: 'photo', styleNotes: 'Street photos.', concept: 'A rider at night.', examples: [2] }, { carousel: true }),
      { carousel: true, kind: 'photo', styleNotes: 'Street photos.', concept: 'A rider at night.', exampleIds: [] }
    )
    assert.strictEqual(recentLookOf({ kind: 'graphic', styleNotes: ' ' }, { carousel: false }), null)
    assert.strictEqual(recentLookOf(null, { carousel: false }), null)
    assert.strictEqual(recentLookOf(['x'], { carousel: false }), null)
  })

  it('names the examples it followed by their number in the list shown now, dropping ones gone', () => {
    const numbered = numberRecentLooks(
      [
        { carousel: false, kind: 'graphic', styleNotes: 'Red.', concept: 'One.', exampleIds: ['c', 'gone', 'a'] },
        { carousel: true, kind: 'photo', styleNotes: 'Photo.', concept: 'Two.', exampleIds: [] }
      ],
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, {}]
    )
    assert.deepStrictEqual(numbered, [
      { carousel: false, kind: 'graphic', styleNotes: 'Red.', concept: 'One.', examples: [1, 3] },
      { carousel: true, kind: 'photo', styleNotes: 'Photo.', concept: 'Two.', examples: [] }
    ])
  })
})

describe('the art director told what the latest images looked like', () => {
  const input = {
    postText: 'Just one bite, they said.',
    platform: { name: 'Instagram', shape: 'a 4:5 portrait' },
    context,
    examples: [example(), example(), example(), example(), example()],
    logoFile: false
  }

  it('lists them newest first, by the examples they followed, and asks for a different look', () => {
    const prompt = buildDesignPrompt({ ...input, recentLooks: recent })
    assert.match(prompt, /THE LATEST IMAGES MADE FOR THIS ACCOUNT'S INSTAGRAM POSTS, newest first/)
    assert.match(prompt, /1\. An image that followed examples 1 and 4 \(graphic\): Flat red card, big white lowercase type, wordmark bottom left\. It showed: A mock legal clause card for just one bite\./)
    assert.match(prompt, /2\. A carousel \(graphic\): Near-black grainy poster/)
    assert.match(prompt, /Vary the look from post to post/)
    assert.match(prompt, /Do not follow the same examples as the newest one above/)
  })

  it('with one example, asks only for another layout and subject', () => {
    const prompt = buildDesignPrompt({ ...input, examples: [example()], recentLooks: recent })
    assert.match(prompt, /Vary the look from post to post/)
    assert.doesNotMatch(prompt, /same examples as the newest/)
  })

  it('says nothing of them when there are none', () => {
    const prompt = buildDesignPrompt(input)
    assert.doesNotMatch(prompt, /THE LATEST IMAGES/)
    assert.doesNotMatch(prompt, /Vary the look/)
  })
})

describe('the carousel art director told what the latest images looked like', () => {
  const input = {
    caption: 'THE CAPTION',
    slides: [{ role: 'cover' as const, headline: 'just one bite', body: '', idea: '' }],
    platform: { name: 'Instagram', shape: 'a portrait 4:5' },
    context,
    examples: [example(), example(), example()],
    logoFile: false
  }

  it('lists them and asks the set for a different look', () => {
    const prompt = buildSeriesPrompt({ ...input, recentLooks: recent })
    assert.match(prompt, /THE LATEST IMAGES MADE FOR THIS ACCOUNT'S INSTAGRAM POSTS, newest first/)
    assert.match(prompt, /1\. An image that followed examples 1 and 4 \(graphic\)/)
    assert.match(prompt, /Vary the look from post to post/)
    assert.match(prompt, /Do not follow the same examples as the newest one above/)
    assert.doesNotMatch(buildSeriesPrompt(input), /THE LATEST IMAGES|Vary the look/)
  })
})

describe('a slide’s stored look', () => {
  const look: SlideLook = {
    kind: 'graphic',
    styleNotes: 'Red cards.',
    examples: [1],
    logoCorner: 'none',
    wordmark: false,
    scene: 'Words.',
    concept: 'Cover.'
  }

  it('keeps the ids of the examples it followed', () => {
    assert.deepStrictEqual(
      slideLookOf({ metadata: { look: { ...look, exampleIds: ['a', 3, 'b'] } } } as never),
      { ...look, exampleIds: ['a', 'b'] }
    )
    assert.deepStrictEqual(slideLookOf({ metadata: { look } } as never), look)
  })
})
