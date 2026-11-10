import assert from 'node:assert'
import { describe, it } from 'node:test'
import type { Account, Goal, Idea, VoiceConfig } from '../src/db/schema'
import {
  EMPTY_HISTORY,
  resolvePreferences,
  type GenerationContext
} from '../src/lib/ai/context-blocks'
import {
  articleSources,
  collectArticleFigureSources,
  isCompleteArticle,
  toArticleBlocks
} from '../src/lib/ai/skills/article-drafting/guard'
import {
  buildArticleInstructions,
  buildArticlePrompt
} from '../src/lib/ai/skills/article-drafting/prompt'
import {
  ArticleGenerationSchema,
  type ArticleGenerationResult
} from '../src/lib/ai/skills/article-drafting/schema'
import { buildArticleLintOptions } from '../src/lib/ai/pipeline/article-lint'
import {
  articleOutline,
  articleToMarkdown,
  articleToPlainText,
  blocksToHtml,
  countArticleWords,
  inlineFromPlainText,
  type ArticleBlock
} from '../src/lib/articles/blocks'
import {
  isLinkedInArticleUrl,
  linkCardOf,
  linkPostCommentary,
  validateArticleLink
} from '../src/lib/articles/link-post'
import { htmlToArticleBlocks } from '../src/lib/articles/sanitize'
import {
  ARTICLE_GENERATION_STALE_MS,
  canGenerateArticleFrom,
  isStaleGeneration
} from '../src/lib/articles/status'
import { blockingFindings, runArticleLinter } from '../src/lib/lint/article-linter'
import { createPost } from '../src/lib/publishing/linkedin/api'

/** Articles: everything that runs without a database or a model. */

const now = new Date('2026-11-07T10:00:00Z')

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc',
    userId: null,
    name: 'Meera Rao',
    handle: 'meera',
    headline: 'Head of growth at Kartly, a D2C ecommerce platform',
    bio: 'Meera runs growth for Kartly.',
    avatarUrl: null,
    accountType: 'personal',
    company: 'Kartly',
    websiteUrl: 'https://kartly.example',
    linkedinUrl: null,
    industry: 'Ecommerce',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function voice(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    id: 'voice',
    accountId: 'acc',
    tone: 'warm-analytical',
    perspective: 'I',
    formality: 2,
    directness: 4,
    emojiPolicy: 'none',
    hashtagPolicy: '0-3, end of post',
    bannedWords: ['synergize'],
    derivedStyleRubric: 'Short declarative openers. Numbers before adjectives.',
    rawSamplesText: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as VoiceConfig
}

const goal: Goal = {
  id: 'goal-1',
  accountId: 'acc',
  title: 'Win mid-market retailers',
  objective: 'leads',
  keyMessage: 'Personalisation only pays when the catalogue data is clean',
  desiredAction: 'Book a catalogue audit',
  targetUrl: 'https://kartly.example/audit',
  linkStrategy: 'first_comment',
  isActive: true,
  createdAt: now,
  updatedAt: now
} as Goal

function context(): GenerationContext {
  const v = voice()
  return {
    account: account(),
    voice: v,
    offerings: [],
    audiences: [],
    knowledgeDocs: [],
    samplePosts: [],
    goals: [goal],
    selectedGoals: [goal],
    primaryGoal: goal,
    preferencesId: null,
    prefs: resolvePreferences(
      {
        id: 'prefs',
        accountId: 'acc',
        pillars: [],
        ideasPerRun: 5,
        postConstraints: { cta_required: true },
        guardrails: { banned_topics: ['crypto'], compliance_notes: '' },
        createdAt: now,
        updatedAt: now
      } as any,
      v
    ),
    history: EMPTY_HISTORY
  }
}

const idea = {
  id: 'idea-1',
  accountId: 'acc',
  title: 'How AI is transforming the ecommerce industry',
  hook: 'Most AI pilots in retail stall on catalogue data',
  thesis: 'AI in ecommerce pays off where the product data is already clean.',
  angle: 'Data before models',
  whyNow: 'Marketplaces now rank listings with generative search.',
  hookConcept: 'A recommendation engine that recommended out-of-stock items',
  coreArgument: 'Fix catalogue attributes first; personalisation follows.',
  audienceTakeaway: 'Audit product attributes before buying an AI tool.',
  supportingEvidence: [
    {
      claim: '42% of retailers say poor product data blocks AI projects',
      quote: 'poor product data blocks AI projects',
      sourceTitle: 'Retail Data Report 2026',
      sourceUrl: 'https://report.example/2026',
      factType: 'sourced' as const
    }
  ],
  goalId: 'goal-1',
  goalIds: ['goal-1'],
  goalSnapshot: null,
  status: 'approved'
} as unknown as Idea

const passages = [
  {
    documentId: 'doc-1',
    title: 'Kartly catalogue playbook',
    url: 'https://kartly.example/playbook',
    content: 'Kartly cut returns by 18% after normalising size attributes.'
  }
]

function generated(overrides: Partial<ArticleGenerationResult> = {}): ArticleGenerationResult {
  return {
    title: 'AI in ecommerce starts with your catalogue',
    subtitle: 'Why clean product data decides which AI projects pay off.',
    introduction: [
      'A recommendation engine once pushed a sold-out jacket to every visitor.',
      'The model was fine. The catalogue was not.'
    ],
    sections: [
      {
        heading: 'Where AI projects stall',
        blocks: [
          { type: 'paragraph', text: 'The Retail Data Report 2026 found **42%** of retailers blame product data.' },
          { type: 'bullets', items: ['Missing sizes', 'Duplicate SKUs'] }
        ]
      },
      {
        heading: 'Fix the attributes first',
        blocks: [
          { type: 'subheading', text: 'Start with returns' },
          { type: 'paragraph', text: 'Our own playbook shows returns fell 18% after sizes were normalised.' },
          { type: 'numbered', items: ['Audit', 'Normalise', 'Measure'] },
          { type: 'quote', text: 'poor product data blocks AI projects' }
        ]
      }
    ],
    conclusionHeading: 'What to do on Monday',
    conclusion: ['Pick one category and clean its attributes before any pilot.'],
    callToAction: 'Which attribute would you fix first?',
    coverImage: { concept: 'A tidy warehouse shelf', altText: 'Neatly labelled shelves' },
    promoPost: 'A sold-out jacket taught me where AI in ecommerce really starts.\n\nIt is not the model.',
    sourcesUsed: ['E1', 'K1'],
    selfFlags: [],
    ...overrides
  }
}

describe('article blocks', () => {
  it('turns the model\'s plain text into escaped inline HTML', () => {
    assert.strictEqual(
      inlineFromPlainText('A **bold** <script>x</script> & [link](https://a.example/?q=1&r=2)'),
      'A <strong>bold</strong> &lt;script&gt;x&lt;/script&gt; &amp; <a href="https://a.example/?q=1&amp;r=2">link</a>'
    )
    // An unsafe link stays literal text.
    assert.ok(!inlineFromPlainText('[x](javascript:alert(1))').includes('<a'))
  })

  it('renders HTML, Markdown and plain text from the same blocks', () => {
    const blocks: ArticleBlock[] = [
      { type: 'paragraph', text: 'Intro with <strong>bold</strong>.' },
      { type: 'heading', level: 2, text: 'Section' },
      { type: 'list', ordered: true, items: ['One', 'Two'] },
      { type: 'quote', text: 'Quoted' }
    ]
    assert.strictEqual(
      blocksToHtml(blocks),
      '<p>Intro with <strong>bold</strong>.</p>\n<h2>Section</h2>\n<ol><li>One</li><li>Two</li></ol>\n<blockquote>Quoted</blockquote>'
    )
    const md = articleToMarkdown({ title: 'T', subtitle: 'S', content: blocks })
    assert.match(md, /^# T\n\n\*S\*\n\nIntro with \*\*bold\*\*\.\n\n## Section\n\n1\. One\n2\. Two\n\n> Quoted\n$/)
    assert.strictEqual(
      articleToPlainText({ content: blocks }),
      'Intro with bold.\n\nSection\n\n1. One\n2. Two\n\nQuoted'
    )
    // "Intro with bold." (3), "Section", "One", "Two", "Quoted"
    assert.strictEqual(countArticleWords(blocks), 7)
    assert.deepStrictEqual(articleOutline(blocks), [{ level: 2, text: 'Section' }])
  })
})

describe('the editor HTML is reduced to safe blocks on save', () => {
  it('keeps structure and inline formatting, drops everything else', () => {
    const blocks = htmlToArticleBlocks(
      '<h1>Title</h1><div>Loose <b>bold</b> <i>it</i> <span style="color:red">span</span></div>' +
        '<h4>Small</h4><ul><li>A<ul><li>A1</li></ul></li><li>B</li></ul>' +
        '<script>alert(1)</script><img src=x onerror=alert(1)>' +
        '<p onclick="x()">P <a href="javascript:alert(1)">bad</a> <a href="https://ok.example" onclick="y">good</a></p>' +
        '<blockquote><p>Q1</p><p>Q2</p></blockquote>'
    )
    assert.deepStrictEqual(blocks, [
      { type: 'heading', level: 2, text: 'Title' },
      { type: 'paragraph', text: 'Loose <strong>bold</strong> <em>it</em> span' },
      { type: 'heading', level: 3, text: 'Small' },
      { type: 'list', ordered: false, items: ['A', 'A1', 'B'] },
      { type: 'paragraph', text: 'P bad <a href="https://ok.example">good</a>' },
      { type: 'quote', text: 'Q1<br>Q2' }
    ])
    assert.ok(!JSON.stringify(blocks).match(/script|onerror|onclick|javascript/))
  })

  it('escapes text that looks like markup and merges split lists', () => {
    assert.deepStrictEqual(
      htmlToArticleBlocks('<p>&lt;b&gt;not bold&lt;/b&gt;</p><ol><li>1</li></ol><ol><li>2</li></ol>'),
      [
        { type: 'paragraph', text: '&lt;b&gt;not bold&lt;/b&gt;' },
        { type: 'list', ordered: true, items: ['1', '2'] }
      ]
    )
  })
})

describe('a generated article', () => {
  it('needs a title, an introduction and two filled sections', () => {
    assert.ok(isCompleteArticle(generated()))
    assert.ok(!isCompleteArticle(generated({ title: ' ' })))
    assert.ok(!isCompleteArticle(generated({ sections: [generated().sections[0]!] })))
    assert.ok(!isCompleteArticle(generated({ introduction: [] })))
  })

  it('becomes blocks: introduction, sections under headings, then the closing', () => {
    const blocks = toArticleBlocks(generated())
    assert.deepStrictEqual(
      blocks.map(b => (b.type === 'heading' ? `h${b.level}` : b.type)),
      ['paragraph', 'paragraph', 'h2', 'paragraph', 'list', 'h2', 'h3', 'paragraph', 'list', 'quote', 'h2', 'paragraph']
    )
    assert.ok(blocks.some(b => b.type === 'paragraph' && b.text.includes('<strong>42%</strong>')))
  })

  it('validates against the output schema', () => {
    assert.ok(ArticleGenerationSchema.safeParse(generated()).success)
  })

  it('keeps every source, marking the ones the model used', () => {
    const sources = articleSources(idea, passages, ['E1'])
    assert.deepStrictEqual(
      sources.map(s => [s.kind, s.used]),
      [
        ['evidence', true],
        ['knowledge', false]
      ]
    )
    // Naming nothing counts the approved evidence as used.
    assert.strictEqual(articleSources(idea, passages, [])[0]!.used, true)
  })
})

describe('the article prompt uses the identity and its knowledge', () => {
  const ctx = context()

  it('carries the identity, voice, goal and guardrails', () => {
    const instructions = buildArticleInstructions(ctx)
    for (const expected of [
      'Meera Rao',
      'Kartly',
      'warm-analytical',
      'Short declarative openers',
      'Win mid-market retailers',
      'synergize',
      'crypto',
      'long-form LinkedIn article'
    ]) {
      assert.ok(instructions.includes(expected), `instructions mention ${expected}`)
    }
  })

  it('carries the idea, its evidence and the knowledge passages', () => {
    const prompt = buildArticlePrompt(ctx, idea, {
      passages,
      guidance: 'Use a retail example',
      previous: null
    })
    for (const expected of [
      'How AI is transforming the ecommerce industry',
      '[E1] 42% of retailers',
      '[K1] From "Kartly catalogue playbook"',
      'returns by 18%',
      'Use a retail example',
      'https://kartly.example/audit'
    ]) {
      assert.ok(prompt.includes(expected), `prompt mentions ${expected}`)
    }
  })
})

describe('article checks', () => {
  const ctx = context()
  const lint = (overrides: Partial<ArticleGenerationResult> = {}) => {
    const out = generated(overrides)
    return runArticleLinter(
      buildArticleLintOptions(ctx, idea, passages, {
        title: out.title,
        subtitle: out.subtitle,
        content: toArticleBlocks(out),
        callToAction: out.callToAction
      })
    )
  }
  const failed = (findings: ReturnType<typeof lint>) =>
    findings.filter(f => !f.passed).map(f => f.rule)

  it('passes figures found in the evidence or the knowledge base', () => {
    const findings = lint()
    assert.ok(!failed(findings).includes('unsupported_figures'))
    assert.ok(collectArticleFigureSources(ctx, idea, passages).includes('18%'))
  })

  it('blocks an invented figure and a banned topic', () => {
    const findings = lint({
      conclusion: ['Retailers who do this grow revenue 73% and talk about crypto.']
    })
    assert.deepStrictEqual(
      blockingFindings(findings).map(f => f.rule).sort(),
      ['banned_topics', 'unsupported_figures']
    )
  })

  it('flags thin structure, a long title and a repeated paragraph', () => {
    const para = 'Clean catalogue data decides whether personalisation pays, because every recommendation reads attributes that teams rarely audit before buying new tools for the store.'
    const rules = failed(
      lint({
        title: 'x'.repeat(130),
        introduction: [para],
        sections: [
          { heading: 'One', blocks: [{ type: 'paragraph', text: para }] },
          { heading: 'One', blocks: [{ type: 'paragraph', text: 'Short.' }] }
        ]
      })
    )
    for (const rule of ['title', 'word_count', 'repeated_paragraphs', 'duplicate_headings']) {
      assert.ok(rules.includes(rule), `flags ${rule}`)
    }
  })

  it('flags the author\'s banned words and machine-written habits', () => {
    const rules = failed(
      lint({ conclusion: ['Studies show teams synergize. Let me be honest about it.'] })
    )
    for (const rule of ['banned_words', 'vague_attribution', 'filler_phrase']) {
      assert.ok(rules.includes(rule), `flags ${rule}`)
    }
  })
})

describe('article-link posts', () => {
  it('accept only public http(s) addresses', () => {
    assert.deepStrictEqual(validateArticleLink(' https://kartly.example/blog/ai '), {
      url: 'https://kartly.example/blog/ai'
    })
    for (const bad of ['', 'javascript:alert(1)', 'ftp://x.example/a', 'https://user:pw@x.example', 'http://localhost/a', 'not a url']) {
      assert.ok('error' in validateArticleLink(bad), bad)
    }
    assert.ok(isLinkedInArticleUrl('https://www.linkedin.com/pulse/ai-ecommerce-meera'))
    assert.ok(!isLinkedInArticleUrl('https://kartly.example/pulse/x'))
  })

  it('build the card and the commentary from the article', () => {
    assert.deepStrictEqual(linkCardOf({ title: ` ${'T'.repeat(250)} `, subtitle: 'Sub' }).title.length, 200)
    assert.deepStrictEqual(
      linkPostCommentary({ title: 'T', promoPost: 'First line.\n\nSecond paragraph.' }),
      { hook: 'First line.', body: 'Second paragraph.' }
    )
    const long = linkPostCommentary({ title: 'T', promoPost: `${'word '.repeat(60)}end` })
    assert.ok(long.hook.length <= 200 && long.body.length > 0)
    assert.strictEqual(linkPostCommentary({ title: 'T', subtitle: 'S' }).hook, 'S')
  })

  it('send content.article with the card, and no media', async () => {
    let body: any
    await createPost(
      {
        accessToken: 'AT',
        apiVersion: '202610',
        fetchFn: (async (_url: string, init: RequestInit) => {
          body = JSON.parse(String(init.body))
          return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:7' } })
        }) as typeof fetch
      },
      {
        authorUrn: 'urn:li:person:1',
        commentary: 'Read it',
        image: { urn: 'urn:li:image:IGNORED' },
        article: {
          source: 'https://kartly.example/blog/ai',
          title: 'AI in ecommerce',
          description: 'Why data first',
          thumbnailUrn: 'urn:li:image:THUMB'
        }
      }
    )
    assert.deepStrictEqual(body.content, {
      article: {
        source: 'https://kartly.example/blog/ai',
        title: 'AI in ecommerce',
        description: 'Why data first',
        thumbnail: 'urn:li:image:THUMB'
      }
    })
  })

  it('leave a plain post\'s request exactly as before', async () => {
    const bodies: any[] = []
    const ctx = {
      accessToken: 'AT',
      apiVersion: '202610',
      fetchFn: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)))
        return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:8' } })
      }) as typeof fetch
    }
    await createPost(ctx, { authorUrn: 'urn:li:person:1', commentary: 'Text only' })
    await createPost(ctx, {
      authorUrn: 'urn:li:person:1',
      commentary: 'With image',
      image: { urn: 'urn:li:image:1', altText: 'Alt' }
    })
    assert.ok(!('content' in bodies[0]))
    assert.deepStrictEqual(bodies[1].content, { media: { id: 'urn:li:image:1', altText: 'Alt' } })
  })
})

describe('article status', () => {
  it('can be generated only from ideas that were approved', () => {
    assert.ok(canGenerateArticleFrom('approved'))
    assert.ok(canGenerateArticleFrom('drafted'))
    assert.ok(canGenerateArticleFrom('drafting'))
    assert.ok(!canGenerateArticleFrom('proposed'))
    assert.ok(!canGenerateArticleFrom('rejected'))
  })

  it('treats an old generation claim as stale', () => {
    const started = new Date(now.getTime() - ARTICLE_GENERATION_STALE_MS - 1)
    assert.ok(isStaleGeneration({ generationStatus: 'generating', generationStartedAt: started }, now))
    assert.ok(!isStaleGeneration({ generationStatus: 'generating', generationStartedAt: now }, now))
    assert.ok(!isStaleGeneration({ generationStatus: 'ready', generationStartedAt: started }, now))
  })
})

describe('very long blocks', () => {
  it('are cut as plain text, never through a tag', () => {
    const long = `<p>${'<strong>bold</strong> word '.repeat(600)}</p>`
    const [block] = htmlToArticleBlocks(long)
    assert.ok(block && block.type === 'paragraph')
    assert.ok(block.text.length <= 8000)
    assert.ok(!/<[^>]*$/.test(block.text), 'no cut tag')
    assert.ok(!block.text.includes('<strong>'))
  })
})
