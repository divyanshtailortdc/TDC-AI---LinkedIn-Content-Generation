import { RetryError } from 'ai'
import assert from 'node:assert'
import { describe, it } from 'node:test'
import { EMPTY_HISTORY, resolvePreferences } from '../src/lib/ai/context-blocks'
import {
  judgeImageReview,
  letteringIssues,
  retryInstructions
} from '../src/lib/ai/skills/image-review/guard'
import { buildPrompt as buildReviewPrompt } from '../src/lib/ai/skills/image-review/prompt'
import type { ImageReview } from '../src/lib/ai/skills/image-review/schema'
import { guardMediaBrief } from '../src/lib/ai/skills/media-brief/guard'
import { buildPrompt } from '../src/lib/ai/skills/media-brief/prompt'
import type { MediaBrief } from '../src/lib/ai/skills/media-brief/schema'
import { DEFAULT_BRAND_THEME } from '../src/lib/brand/theme'
import { buildMediaBriefContext } from '../src/lib/media/brief-context'
import {
  cleanProviderMessage,
  describeImageFailure,
  isAccountFailure
} from '../src/lib/media/image-errors'
import { mediaPlanMetadata, priorVisualsOf } from '../src/lib/media/plan-record'

const now = new Date('2026-10-01T00:00:00Z')

// The parts of a generation context the image brief reads.
const ctx = {
  account: {
    id: 'acc',
    name: 'Ledgerline',
    handle: 'ledgerline',
    headline: 'Quoting software for distributors',
    accountType: 'company',
    company: null,
    industry: 'B2B distribution software',
    isActive: true,
    createdAt: now,
    updatedAt: now
  },
  voice: null,
  offerings: [
    {
      id: 'o1',
      name: 'Ledgerline Quotes',
      tagline: 'Quotes from one set of records',
      description:
        'Builds quotes from catalog, contract and price tiers in one place.'
    }
  ],
  audiences: [
    { id: 'a1', name: 'Sales operations leads at wholesale distributors' }
  ],
  knowledgeDocs: [
    {
      id: 'doc-cited',
      title: 'Quote cycle study',
      summary:
        'Reps spend most of a quote looking up prices and terms in separate systems.'
    },
    {
      id: 'doc-other',
      title: 'Company history',
      summary: 'Founded as a payroll bureau.'
    }
  ],
  samplePosts: [],
  goals: [],
  selectedGoals: [],
  primaryGoal: {
    id: 'g1',
    title: 'Meet buyers at the B2B EA conference',
    objective: 'awareness',
    keyMessage: 'We are at the B2B EA conference this November, booth 14.',
    desiredAction: 'Book a slot at the booth'
  },
  preferencesId: null,
  prefs: resolvePreferences(null, null),
  history: EMPTY_HISTORY,
  brand: {
    ...DEFAULT_BRAND_THEME,
    saved: true,
    primaryColor: '#0e7c86',
    secondaryColor: '#1b2a4a'
  }
} as never

const idea = {
  title: 'Slow quotes are a data-location problem',
  angle: 'The rep is not slow; the records are scattered',
  hookConcept: 'A day-long quote',
  thesis:
    'Quotes are slow because price, terms and catalog live in three places.',
  coreArgument: 'One set of records turns hunting into assembly.',
  audienceTakeaway: 'For sales ops: count the systems a quote touches.',
  supportingEvidence: [
    {
      claim: 'Reps look up prices and terms in separate systems.',
      sourceId: 'doc-cited',
      sourceTitle: 'Quote cycle study'
    }
  ]
} as never

describe('what the art director is told about a post', () => {
  const context = buildMediaBriefContext(ctx, idea)

  it('carries the goal, the approved idea and the brand rules', () => {
    assert.equal(
      context.goal?.keyMessage,
      'We are at the B2B EA conference this November, booth 14.'
    )
    assert.equal(
      context.idea?.angle,
      'The rep is not slow; the records are scattered'
    )
    assert.equal(
      context.thesis,
      'Quotes are slow because price, terms and catalog live in three places.'
    )
    assert.match(
      context.brand || '',
      /#0e7c86 \(dark teal\) as the dominant colour and #1b2a4a \(very dark blue\) as the supporting colour/
    )
  })

  it("includes only the knowledge documents the post's facts came from", () => {
    assert.deepEqual(context.knowledge, [
      'Quote cycle study: Reps spend most of a quote looking up prices and terms in separate systems.'
    ])
  })

  it('lists what the account actually offers, and who reads the post', () => {
    assert.match(
      context.offerings![0]!,
      /^Ledgerline Quotes — Quotes from one set of records — Builds quotes/
    )
    assert.match(
      context.accountContext || '',
      /Seen by: Sales operations leads/
    )
  })

  it('works for a post with no idea behind it', () => {
    const bare = buildMediaBriefContext(ctx, null)
    assert.equal(bare.idea, null)
    assert.deepEqual(bare.knowledge, [])
    assert.equal(bare.thesis, null)
  })
})

describe('the image brief prompt', () => {
  const context = buildMediaBriefContext(ctx, idea)
  const prompt = buildPrompt({
    ...context,
    postText:
      'A quote that takes a day is rarely slow because the rep is slow.',
    logoCorner: 'top left',
    previousVersions: [
      {
        concept: 'Desk split in two halves',
        visualType: 'comparison',
        metaphor: 'scattered papers vs one record'
      },
      {
        concept: 'Bridge between two screens',
        visualType: 'conceptual_illustration'
      }
    ],
    rejectionReason: 'Too busy'
  })

  it('puts the goal, idea, facts, knowledge, offerings, audience and brand in front of the art director', () => {
    assert.match(
      prompt,
      /WHAT THE POST IS FOR[^\n]*\nGoal: Meet buyers at the B2B EA conference/
    )
    assert.match(
      prompt,
      /The one message to land: We are at the B2B EA conference this November, booth 14\./
    )
    assert.match(
      prompt,
      /THE APPROVED IDEA BEHIND THE POST\nIdea: Slow quotes are a data-location problem/
    )
    assert.match(
      prompt,
      /FACTS THE POST RELIES ON\n- Reps look up prices and terms in separate systems\. \(Quote cycle study\)/
    )
    assert.match(
      prompt,
      /FROM THE KNOWLEDGE BASE THESE FACTS CAME FROM\n- Quote cycle study:/
    )
    assert.match(
      prompt,
      /WHAT THE ACCOUNT ACTUALLY OFFERS[^\n]*\n- Ledgerline Quotes/
    )
    assert.match(prompt, /WHO POSTS IT AND WHO SEES IT\nPosted by: Ledgerline/)
    assert.match(
      prompt,
      /BRAND THEME\nBrand colours: #0e7c86 \(dark teal\) as the dominant colour/
    )
  })

  it('demands a new idea and a different visual form from the latest image', () => {
    assert.match(
      prompt,
      /- Most recent \(comparison\): Desk split in two halves — scattered papers vs one record/
    )
    assert.match(
      prompt,
      /- Earlier \(conceptual illustration\): Bridge between two screens/
    )
    assert.match(prompt, /a visual type other than comparison/)
    assert.match(prompt, /The reviewer said about the last one: "Too busy"/)
  })

  it('applies the layout rules and forbids generic imagery and photorealistic scenes', () => {
    assert.match(prompt, /THE LAYOUT \(fixed, drawn by code\)/)
    assert.match(prompt, /Left: the brand logo, then the tagline/)
    assert.match(prompt, /Right: the visual, on a light background/)
    assert.match(
      prompt,
      /No generic business, AI or technology filler/
    )
    assert.match(
      prompt,
      /Never state a statistic, date, venue, price or offer/
    )
    assert.match(
      prompt,
      /never text, labels, logos, screens full of words, real people's faces, hands, desks, coffee cups/
    )
  })

  it('leaves out every block it has nothing for', () => {
    const bare = buildPrompt({ postText: 'A post.' })
    for (const heading of [
      'WHAT THE POST IS FOR',
      'APPROVED IDEA',
      'KNOWLEDGE BASE',
      'ACTUALLY OFFERS',
      'BRAND THEME',
      'EARLIER IMAGES'
    ]) {
      assert.ok(!bare.includes(heading), heading)
    }
    assert.match(bare, /THE LAYOUT \(fixed, drawn by code\)/)
    assert.ok(!bare.includes('REFERENCE IMAGE'))
  })

  it('with a reference image, takes its layout and style but the post\'s subject and the brand\'s colours', () => {
    const withReference = buildPrompt({
      ...context,
      postText: 'A post.',
      referenceImage: { data: new Uint8Array([1]), mediaType: 'image/jpeg' },
      previousVersions: [{ concept: 'Booth', visualType: 'scene' }]
    })
    assert.match(withReference, /REFERENCE IMAGE \(attached\)/)
    assert.match(withReference, /Let it guide the choice of visual type/)
    assert.match(withReference, /Take none of its objects, wording or logos/)
    assert.match(withReference, /THE LAYOUT \(fixed, drawn by code\)/)
  })
})

const brief = (overrides: Partial<MediaBrief> = {}): MediaBrief => ({
  postTopic: 'slow quotes',
  coreThesis: 'quotes are slow because records are scattered',
  readerTakeaway: 'count the systems',
  primaryConcept: 'A rep assembling a quote from scattered records',
  visualMetaphor: 'Scattered quote records pulled into one tidy stack',
  visualType: 'process',
  textOverlay: { headline: 'Slow quotes are a records problem' },
  avoidConcepts: [],
  whyItFits: 'It shows the scattered records',
  ...overrides
})
const postText =
  'A quote is slow when the records are scattered. The rep pulls price, terms and catalog records from three places to assemble one quote.'

describe('the image brief guard', () => {
  it('passes a grounded brief', () => {
    const result = guardMediaBrief(
      brief(),
      'A flat illustration of scattered quote records, no logos, no watermarks.',
      postText
    )
    assert.deepEqual(result.issues, [])
    assert.equal(result.isAcceptable, true)
  })

  it("rejects a regeneration that reuses the replaced image's visual form", () => {
    const result = guardMediaBrief(
      brief({ visualType: 'comparison' }),
      'scene',
      postText,
      undefined,
      {
        previousVisualTypes: ['comparison', 'process']
      }
    )
    assert.match(result.issues.join(' '), /same visual form \(comparison\)/)
    assert.equal(result.isAcceptable, false)
  })

  it('rejects a headline that is too long', () => {
    const long = guardMediaBrief(
      brief({
        textOverlay: {
          headline: 'one two three four five six seven eight nine'
        }
      }),
      'scene',
      postText
    )
    assert.match(long.issues.join(' '), /longer than 8 words/)
  })

  it('rejects a prompt that asks the model to draw a logo, but not one that forbids it', () => {
    const asks = guardMediaBrief(
      brief(),
      'Put the company logo in the corner.',
      postText
    )
    assert.match(asks.issues.join(' '), /draw a logo/)
    const forbids = guardMediaBrief(
      brief(),
      'A desk scene. No logos or wordmarks anywhere.',
      postText
    )
    assert.ok(!forbids.issues.join(' ').includes('draw a'))
  })

  it("accepts a figure from the goal's message, and only from there or the post", () => {
    const overlay = { headline: 'Quotes 40% faster' }
    const without = guardMediaBrief(
      brief({ textOverlay: overlay }),
      'scene',
      postText
    )
    assert.match(without.issues.join(' '), /figure \("40%"\)/)
    const withGoal = guardMediaBrief(
      brief({ textOverlay: overlay }),
      'scene',
      postText,
      undefined,
      {
        extraSourceText: 'Show distributors they can quote 40% faster.'
      }
    )
    assert.ok(!withGoal.issues.join(' ').includes('figure'))
  })
})

const review = (overrides: Partial<ImageReview> = {}): ImageReview => ({
  visibleText: ['Slow quotes are a records problem'],
  headlineCorrect: true,
  unintendedText: [],
  brandMarks: [],
  unsupportedDetails: [],
  logoCoversContent: false,
  logoCovers: [],
  copiesReference: false,
  keepsReferenceColors: false,
  conveysPost: true,
  genericStock: false,
  followsBrand: true,
  relevanceScore: 86,
  summary: 'Scattered records pulled into one stack.',
  ...overrides
})

describe('the image review verdict', () => {
  const options = {
    headline: 'Slow quotes are a records problem',
    brandGiven: true
  }

  it('passes a clean image', () => {
    const verdict = judgeImageReview(review(), options)
    assert.equal(verdict.passed, true)
    assert.deepEqual(verdict.issues, [])
    assert.equal(verdict.relevanceScore, 86)
  })

  it('fails a drawn logo, garbled lettering and a misspelt headline', () => {
    const verdict = judgeImageReview(
      review({
        brandMarks: ['"Smssune" wordmark on a card'],
        unintendedText: ['Steume', 'Werehouse'],
        headlineCorrect: false
      }),
      options
    )
    assert.equal(verdict.passed, false)
    const text = verdict.issues.join(' ')
    assert.match(
      text,
      /Draws a logo or brand name of its own: ""Smssune" wordmark on a card"/
    )
    assert.match(text, /stray or misspelt lettering: "Steume", "Werehouse"/)
    assert.match(text, /headline is not spelled as intended/)
  })

  it('fails an image whose logo was laid over the headline', () => {
    const verdict = judgeImageReview(
      review({
        logoCoversContent: true,
        logoCovers: ['the first word of the headline']
      }),
      options
    )
    assert.equal(verdict.passed, false)
    assert.match(
      verdict.issues.join(' '),
      /The logo covers part of the image: the first word of the headline/
    )
  })

  it('does not count a note that the logo covers nothing', () => {
    const verdict = judgeImageReview(
      review({
        logoCoversContent: false,
        logoCovers: ['sits on empty background, overlaps nothing']
      }),
      options
    )
    assert.equal(verdict.passed, true)
  })

  it('retries with positive rules and never repeats the misspelt words', () => {
    const fixes = retryInstructions(
      review({
        unintendedText: ['Quotee', 'Product Cattaloge'],
        brandMarks: ['Smssune'],
        logoCoversContent: true
      }),
      { headline: 'Slow quotes are a data problem', logoCorner: 'top left' }
    )
    assert.match(
      fixes,
      /draw no other lettering anywhere: every document, book/
    )
    assert.match(fixes, /Show no logos, emblems, wordmarks or brand names/)
    assert.match(fixes, /Keep the top left corner completely empty/)
    for (const word of ['Quotee', 'Cattaloge', 'Smssune'])
      assert.ok(!fixes.includes(word), word)
    assert.equal(
      retryInstructions(review(), {
        headline: 'Slow quotes are a data problem'
      }),
      ''
    )
  })

  it('fails generic stock imagery and an image that misses the post', () => {
    assert.equal(
      judgeImageReview(review({ genericStock: true }), options).passed,
      false
    )
    assert.equal(
      judgeImageReview(review({ relevanceScore: 40 }), options).passed,
      false
    )
    assert.equal(
      judgeImageReview(review({ conveysPost: false }), options).passed,
      false
    )
  })

  it('only holds an image to brand colours when a brand was given', () => {
    assert.equal(
      judgeImageReview(review({ followsBrand: false }), {
        ...options,
        brandGiven: false
      }).passed,
      true
    )
    assert.equal(
      judgeImageReview(review({ followsBrand: false }), options).passed,
      false
    )
  })

  it('fails an image that copies the reference image or keeps its colours, only when there was one', () => {
    const withReference = { ...options, referenceGiven: true }
    const copied = judgeImageReview(
      review({ copiesReference: true }),
      withReference
    )
    assert.equal(copied.passed, false)
    assert.match(copied.issues.join(' '), /Repeats the reference image's own objects/)
    const tinted = judgeImageReview(
      review({ keepsReferenceColors: true, followsBrand: false }),
      withReference
    )
    assert.deepEqual(tinted.issues, [
      "Keeps the reference image's colours instead of the brand's."
    ])
    // Without a reference the fields mean nothing, whatever the model said.
    assert.equal(
      judgeImageReview(
        review({ copiesReference: true, keepsReferenceColors: true }),
        options
      ).passed,
      true
    )
    const fixes = retryInstructions(
      review({ copiesReference: true, keepsReferenceColors: true }),
      { headline: 'Ship it' }
    )
    assert.match(fixes, /none of its objects, props, devices or icons appear/)
    assert.match(fixes, /white or very light grey background/)
  })

  it("checks only lettering and logos on an image the reviewer described", () => {
    const issues = letteringIssues(
      review({
        unintendedText: ['Approvtuer'],
        genericStock: true,
        followsBrand: false,
        relevanceScore: 20
      }),
      { headline: '' }
    )
    assert.deepEqual(issues, [
      'Has stray or misspelt lettering: "Approvtuer".'
    ])
  })

  it('shows the reviewer the reference second and says what may carry over', () => {
    const prompt = buildReviewPrompt({
      postText: 'p',
      concept: 'c',
      headline: 'Ship it',
      brand: 'Brand colours: #0e9aa7 (dark teal).',
      reference: { data: new Uint8Array([1]), mediaType: 'image/jpeg' }
    })
    assert.match(prompt, /^Check the first attached image/)
    assert.match(prompt, /The second attached image is a reference/)
    assert.match(prompt, /replaced by the brand colours above/)
    assert.ok(
      !buildReviewPrompt({ postText: 'p', concept: 'c', headline: '' }).includes(
        'REFERENCE IMAGE'
      )
    )
  })

  it('tells the reviewer exactly what lettering is allowed, and that any drawn logo is a defect', () => {
    const withHeadline = buildReviewPrompt({
      postText: 'p',
      concept: 'c',
      headline: 'Ship it'
    })
    assert.match(withHeadline, /Only the headline "Ship it", spelled exactly/)
    assert.match(
      withHeadline,
      /any logo, emblem, wordmark, brand or company name already drawn in the image is a defect/
    )
    assert.match(
      buildReviewPrompt({ postText: 'p', concept: 'c', headline: '' }),
      /None\. Any lettering at all is unintended/
    )
  })

  it('checks the published image: the real logo is expected, and what it covers is reported', () => {
    const prompt = buildReviewPrompt({
      postText: 'p',
      concept: 'c',
      headline: 'Ship it',
      logoCorner: 'top left'
    })
    assert.match(
      prompt,
      /real logo has been laid over the top left corner\. That logo is expected/
    )
    assert.match(
      prompt,
      /Say whether it overlaps or hides part of the headline/
    )
  })
})

describe('stored media plans', () => {
  it('lists earlier images newest first, leaving out failed attempts', () => {
    const rows = [
      {
        status: 'superseded',
        version: 1,
        promptOrQuery: 'x',
        metadata: {
          mediaBrief: {
            primaryConcept: 'Old desk',
            visualType: 'comparison',
            visualMetaphor: 'two halves'
          }
        }
      },
      {
        status: 'failed',
        version: 2,
        promptOrQuery: null,
        metadata: { error: 'budget' }
      },
      {
        status: 'active',
        version: 3,
        promptOrQuery: 'A watercolour harbour at dawn',
        metadata: { source: 'user_prompt' }
      }
    ]
    assert.deepEqual(priorVisualsOf(rows), [
      { concept: 'A watercolour harbour at dawn' },
      { concept: 'Old desk', visualType: 'comparison', metaphor: 'two halves' }
    ])
  })

  it('saves what the review screen and the next regeneration read', () => {
    const metadata = mediaPlanMetadata(
      {
        mode: 'ai_generated',
        relevanceScore: 88,
        width: 2048,
        height: 1072,
        logo: { placement: 'bottom_right', plate: 'none' },
        review: { checked: true, passed: true, images: 1 },
        usedReference: true
      },
      { source: 'reviewer_search' }
    )
    assert.equal(metadata.relevanceScore, 88)
    assert.equal(metadata.width, 2048)
    assert.deepEqual(metadata.logo, {
      placement: 'bottom_right',
      plate: 'none'
    })
    assert.equal(metadata.usedReference, true)
    assert.equal(metadata.fallbackApplied, false)
    assert.equal(metadata.source, 'reviewer_search')
  })
})

describe('image provider failures', () => {
  const withStatus = (statusCode: number, message = 'failed') =>
    Object.assign(new Error(message), { statusCode })

  it('names the cause a reviewer can act on', () => {
    assert.match(
      describeImageFailure(withStatus(402)),
      /credit or spend limit is used up/
    )
    assert.match(describeImageFailure(withStatus(401)), /rejected the API key/)
    assert.match(describeImageFailure(withStatus(429)), /rate-limited/)
    assert.match(
      describeImageFailure(new Error('Request flagged by content moderation')),
      /safety filter/
    )
    assert.match(
      describeImageFailure(
        Object.assign(new Error('x'), { name: 'TimeoutError' })
      ),
      /took too long/
    )
    assert.equal(
      describeImageFailure(new Error('  upstream   exploded ')),
      'upstream exploded'
    )
    // The gateway's own wording, terminal colour codes included.
    const gateway = new Error(
      '\u001b[1m\u001b[31mUnauthenticated request to AI Gateway.\u001b[0m To authenticate, set the key'
    )
    assert.match(describeImageFailure(gateway), /rejected the API key/)
    assert.equal(
      cleanProviderMessage('\u001b[33mAI_GATEWAY_API_KEY\u001b[0m  missing'),
      'AI_GATEWAY_API_KEY missing'
    )
  })

  it('reads the status through a retry wrapper, and stops trying models on account failures', () => {
    const wrapped = new RetryError({
      message: 'retried',
      reason: 'maxRetriesExceeded',
      errors: [withStatus(402)]
    })
    assert.match(describeImageFailure(wrapped), /spend limit/)
    assert.equal(isAccountFailure(wrapped), true)
    assert.equal(isAccountFailure(withStatus(500)), false)
  })
})
