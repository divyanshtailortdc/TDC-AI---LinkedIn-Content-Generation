import assert from 'node:assert'
import { describe, it } from 'node:test'
import { cleanLookDesign } from '../src/lib/ai/skills/look-design'
import { buildPrompt as buildDesignPrompt } from '../src/lib/ai/skills/look-design/prompt'
import type { LookDesign } from '../src/lib/ai/skills/look-design/schema'
import { lookIssues, lookRetryLines } from '../src/lib/ai/skills/look-review/prompt'
import type { LookReview } from '../src/lib/ai/skills/look-review/schema'
import { SHAPE_SIZES } from '../src/lib/media/canvas/spec'
import { buildLookPrompt, exampleAspect } from '../src/lib/media/learned-look'

const design: LookDesign = {
  examples: [1],
  kind: 'graphic',
  styleNotes: 'A flat brand-red square with large white bold capitals centred and pale quotation marks.',
  concept: 'A quote card about Sunday-night ice cream orders.',
  scene: 'Flat red background; the quote in heavy white capitals in the middle; the attribution below in smaller white type.',
  text: [
    { part: 'quote', text: "WE DON'T DELIVER BREAKUPS. JUST THE ICE CREAM AFTER." },
    { part: 'attribution', text: '- every Sunday night, ever' }
  ],
  logoCorner: 'bottom-right',
  altText: 'A red quote card.'
}

describe('the prompt for an image made like the account\'s posts', () => {
  it('asks for the examples\' look, the exact words and nothing copied', () => {
    const prompt = buildLookPrompt({
      design,
      platformName: 'Instagram',
      target: SHAPE_SIZES['4:5'],
      exampleCount: 2
    })
    assert.match(prompt, /^Create a new Instagram post image in the style of the 2 attached images, posts from this account/)
    assert.match(prompt, /made by the same designer: A flat brand-red square/)
    assert.match(prompt, /Do not copy their words, numbers, people, products or logos/)
    assert.match(prompt, /Use exactly these words, spelled exactly as written/)
    assert.match(prompt, /quote: "WE DON'T DELIVER BREAKUPS\. JUST THE ICE CREAM AFTER\."/)
    assert.match(prompt, /attribution: "- every Sunday night, ever"/)
    assert.match(prompt, /a tall 4:5 portrait image/)
    assert.match(prompt, /Draw no logo, brand name or watermark other than any wordmark listed above/)
  })

  it('keeps the logo corner clear when the real logo goes on afterwards', () => {
    const prompt = buildLookPrompt({
      design,
      platformName: 'Instagram',
      target: SHAPE_SIZES['4:5'],
      exampleCount: 1,
      logoClearSpace: 'Leave the bottom-right corner as plain background.'
    })
    assert.match(prompt, /the attached image, a post from this account/)
    assert.match(prompt, /the brand's own logo is added afterwards\. Leave the bottom-right corner/)
  })

  it('asks a photo for real photography and no lettering when it carries no words', () => {
    const prompt = buildLookPrompt({
      design: { ...design, kind: 'photo', text: [] },
      platformName: 'LinkedIn',
      target: SHAPE_SIZES['1.91:1'],
      exampleCount: 1
    })
    assert.match(prompt, /same photographer/)
    assert.match(prompt, /No text anywhere in the image/)
    assert.match(prompt, /It must look like a real photograph/)
  })
})

describe("the art director's design", () => {
  it('keeps example numbers that exist, three at most, none twice', () => {
    const cleaned = cleanLookDesign({ ...design, examples: [2, 2, 9, 0, 3, 1, 4] }, 4)!
    assert.deepStrictEqual(cleaned.examples, [2, 3, 1])
  })

  it('falls back to the first example when it named none that exists', () => {
    assert.deepStrictEqual(cleanLookDesign({ ...design, examples: [7] }, 3)!.examples, [1])
  })

  it('drops empty text parts and, over the word limit, the last parts first', () => {
    const long = Array.from({ length: 10 }, (_, i) => ({
      part: `point ${i + 1}`,
      text: 'one two three four five six'
    }))
    const cleaned = cleanLookDesign(
      { ...design, text: [{ part: 'title', text: '  Records first  ' }, { part: 'x', text: ' ' }, ...long] },
      1
    )!
    assert.strictEqual(cleaned.text[0]!.text, 'Records first')
    assert.ok(!cleaned.text.some(t => t.part === 'x'))
    const words = cleaned.text.reduce((n, t) => n + t.text.split(' ').length, 0)
    assert.ok(words <= 45, `${words} words`)
  })

  it('tells the art director where each example came from and who sets the logo', () => {
    const prompt = buildDesignPrompt({
      postText: 'Sunday nights are for ice cream.',
      platform: { name: 'Facebook', shape: 'a tall 4:5 portrait' },
      context: { accountName: 'Zomato', evidence: [], knowledge: [], offerings: [], brand: '' } as any,
      examples: [
        { data: new Uint8Array(), mediaType: 'image/jpeg', platformName: 'Instagram', samePlatform: false, uploaded: false, aspect: '1:1' },
        { data: new Uint8Array(), mediaType: 'image/jpeg', platformName: 'Instagram', samePlatform: false, uploaded: true }
      ],
      logoFile: false
    })
    assert.match(prompt, /1\. Posted on Instagram \(another platform\), 1:1/)
    assert.match(prompt, /2\. Chosen by the account on Instagram \(another platform\)/)
    assert.match(prompt, /None was posted on Facebook/)
    assert.match(prompt, /a "wordmark" part that reads exactly "Zomato"/)
  })
})

describe('the check on an image made like the account\'s posts', () => {
  const clean: LookReview = {
    visibleText: [],
    textErrors: [],
    extraText: [],
    extraTextNoticeable: true,
    inventedFacts: [],
    foreignMarks: [],
    copiedFromExamples: [],
    artifacts: [],
    artifactsNoticeable: false,
    matchesExamples: true,
    summary: 'Fine.'
  }

  it('finds nothing wrong with a clean image', () => {
    assert.deepStrictEqual(lookIssues(clean), [])
    assert.strictEqual(lookRetryLines(clean), '')
  })

  it('names each problem and asks the retry to fix it', () => {
    const review = {
      ...clean,
      textErrors: ['title reads "Recods"'],
      inventedFacts: ['"40% faster"'],
      matchesExamples: false
    }
    const issues = lookIssues(review)
    assert.ok(issues.includes('Text: title reads "Recods"'))
    assert.ok(issues.includes('Not in the post: "40% faster"'))
    assert.ok(issues.some(i => /does not look like the example posts/.test(i)))
    const retry = lookRetryLines(review)
    assert.match(retry, /letter for letter/)
    assert.match(retry, /Leave out these, which the post does not support: "40% faster"/)
    assert.match(retry, /Follow the attached examples more closely/)
  })

  it('leaves minor flaws alone: no warning and no second image', () => {
    const minor = {
      ...clean,
      artifacts: ['the tiffin handle is a little wobbly, but it reads clearly'],
      artifactsNoticeable: false
    }
    assert.deepStrictEqual(lookIssues(minor), [])
    assert.strictEqual(lookRetryLines(minor), '')
    const real = { ...minor, artifacts: ['six fingers on the left hand'], artifactsNoticeable: true }
    assert.deepStrictEqual(lookIssues(real), ['Looks generated: six fingers on the left hand'])
    assert.match(lookRetryLines(real), /correctly formed/)
  })

  it('makes no second image for faint texture lettering, but does for readable gibberish', () => {
    const faint = {
      ...clean,
      extraText: ['faint scribbles on the order pad'],
      extraTextNoticeable: false
    }
    assert.deepStrictEqual(lookIssues(faint), [])
    assert.strictEqual(lookRetryLines(faint), '')
    const readable = { ...faint, extraText: ['stahlHug'], extraTextNoticeable: true }
    assert.deepStrictEqual(lookIssues(readable), ['Unintended lettering: "stahlHug"'])
    assert.match(lookRetryLines(readable), /letter for letter/)
  })
})

describe('the shape of an example', () => {
  it('names common shapes and nothing else', () => {
    assert.strictEqual(exampleAspect(1080, 1350), '4:5')
    assert.strictEqual(exampleAspect(447, 447), '1:1')
    assert.strictEqual(exampleAspect(452, 678), '2:3')
    assert.strictEqual(exampleAspect(1000, 300), undefined)
    assert.strictEqual(exampleAspect(null, 10), undefined)
  })
})
