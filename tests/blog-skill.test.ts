import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  cleanBlogDraft,
  isCompleteBlogDraft,
  ownLinksOf
} from '../src/lib/ai/skills/blog-drafting/guard'
import {
  buildBlogInstructions,
  buildBlogPrompt,
  buildBlogRegeneratePrompt,
  buildFixPrompt,
  buildSectionRewritePrompt,
  type BlogPromptInput
} from '../src/lib/ai/skills/blog-drafting/prompt'
import {
  BlogBlockSchema,
  type BlogDraft
} from '../src/lib/ai/skills/blog-drafting/schema'
import { docLinks } from '../src/lib/blogs/doc'
import type { BlogBrief, BlogPlan, BlogSource } from '../src/lib/blogs/types'
import {
  account,
  audience,
  context,
  goal,
  offering,
  voice
} from './fixtures/generation'

const brief = (overrides: Partial<BlogBrief> = {}): BlogBrief => ({
  topic: 'Reducing cart abandonment',
  primaryKeyword: 'cart abandonment',
  secondaryKeywords: ['checkout design'],
  length: 'medium',
  style: 'how_to',
  audience: { audienceId: null, note: '' },
  research: true,
  knowledge: true,
  faq: true,
  instructions: '',
  caseDetails: '',
  ...overrides
})

const ctx = () =>
  context({
    account: account({
      name: 'Northwind Studio',
      websiteUrl: 'https://northwind.test'
    }),
    audiences: [audience('Founders'), audience('Engineers')],
    offerings: [
      offering('Checkout kit', { url: 'https://northwind.test/kit' })
    ],
    voice: voice({ tone: 'candid', emojiPolicy: 'none' }),
    goal: goal({
      title: 'Win trials',
      desiredAction: 'Start a free trial',
      targetUrl: 'https://northwind.test/trial'
    })
  })

const SOURCES: BlogSource[] = [
  {
    id: 'S1',
    origin: 'web',
    title: 'Checkout study',
    url: 'https://example.com/study',
    publisher: 'Example News',
    quote: 'Seventy percent of carts are abandoned.',
    cited: false
  },
  {
    id: 'S2',
    origin: 'web',
    title: 'Shipping costs',
    url: 'https://example.com/shipping',
    quote: 'Surprise fees drive abandonment.',
    cited: false
  },
  {
    id: 'K1',
    origin: 'knowledge',
    title: 'Pricing guide',
    url: null,
    quote: 'Our checkout has three steps.',
    cited: false
  }
]

const input = (overrides: Partial<BlogPromptInput> = {}): BlogPromptInput => ({
  ctx: ctx(),
  kind: 'blog',
  brief: brief(),
  sources: SOURCES,
  idea: null,
  ownLinks: ownLinksOf(ctx()),
  plan: null,
  ...overrides
})

const draft = (overrides: Partial<BlogDraft> = {}): BlogDraft => ({
  title: '  Cart abandonment:   seven fixes ',
  slug: 'Cart Abandonment Fixes!',
  metaTitle: 'Cart abandonment: seven fixes for small shops',
  metaDescription: 'Why shoppers leave and what to change first.',
  primaryKeyword: 'cart abandonment',
  secondaryKeywords: [
    ' checkout  design ',
    'Checkout design',
    'cart abandonment'
  ],
  introduction: [
    'Fees cause it, says [the shipping study](https://example.com/shipping). See [this](https://unknown.test/x).'
  ],
  sections: [
    {
      heading: 'Why carts are left',
      lead: '',
      blocks: [
        {
          type: 'paragraph',
          text: 'Start a [free trial](https://northwind.test/trial).'
        }
      ]
    }
  ],
  searchIntent: 'informational',
  keyTakeaways: [],
  faq: Array.from({ length: 10 }, (_, i) => ({
    question: `Question ${i}?`,
    answer: `Answer ${i}.`
  })),
  sourcesUsed: ['S1', 'S9'],
  selfFlags: [],
  ...overrides
})

describe('blog instructions', () => {
  it('carry the identity, voice, reader, length, style, SEO and truth rules', () => {
    const text = buildBlogInstructions(ctx(), 'blog', brief())
    for (const part of [
      'Northwind Studio',
      'Tone: candid',
      'Founders',
      '120-160',
      'About 1500 words',
      'How-to guide',
      'If a number is not in',
      'No emoji.'
    ]) {
      assert.ok(text.includes(part), `missing ${part}`)
    }
  })

  it('keep source ratings out of the text', () => {
    const text = buildBlogInstructions(ctx(), 'blog', brief())
    assert.ok(
      text.includes(
        "A source's quality note is for you alone: rely on the stronger sources and put any doubt about one in selfFlags. Never mention a source's rating in the text"
      )
    )
  })

  it('read differently for a blog post and an article', () => {
    const blog = buildBlogInstructions(ctx(), 'blog', brief())
    const article = buildBlogInstructions(ctx(), 'article', brief())
    assert.ok(blog.includes('section heading every 150-300 words'))
    assert.ok(blog.includes('Conversational'))
    assert.ok(!blog.includes('section advances one point'))
    assert.ok(article.includes('section advances one point'))
    assert.ok(article.includes('Authoritative'))
    assert.ok(article.includes('strongest counter-argument'))
    assert.ok(!article.includes('Conversational'))
  })

  it('open every section with a self-contained answer and write facts to be quoted', () => {
    const text = buildBlogInstructions(ctx(), 'blog', brief())
    for (const part of [
      'Every section starts with its lead',
      'stands on its own if quoted alone',
      "The introduction's first paragraph answers the reader's need",
      'who measured it, among whom',
      'Name each entity in full at its first mention',
      'a real one from the sources first',
      'never in more than half the headings'
    ]) {
      assert.ok(text.includes(part), `missing: ${part}`)
    }
  })

  it('narrow the reader to the chosen audience', () => {
    const text = buildBlogInstructions(
      ctx(),
      'blog',
      brief({ audience: { audienceId: audience('Engineers').id, note: '' } })
    )
    assert.ok(text.includes('Engineers'))
    assert.ok(!text.includes('Founders'))
  })
})

const PLAN: BlogPlan = {
  searchIntent: 'commercial',
  primaryKeyword: 'cart abandonment',
  secondaryKeywords: ['checkout design'],
  readerNeed: 'Which fix pays back first?',
  angle: 'Fees cause more abandonment than design.',
  originality: 'A ranking of fixes by effort and payback.',
  workingTitle: 'Cart abandonment: the fixes that pay back first',
  sections: [
    {
      heading: 'Why carts are left',
      purpose: 'Name the causes',
      points: ['Fees', 'Account walls'],
      sourceIds: ['S1', 'S2'],
      element: 'chart',
      elementNote: 'Reasons shoppers give'
    },
    {
      heading: 'Start with the fees',
      purpose: 'The first fix',
      points: ['Show them early'],
      sourceIds: ['S2'],
      element: 'none',
      elementNote: ''
    }
  ],
  takeaways: true,
  faq: ['Does free shipping cut abandonment?'],
  product: { role: 'mention', where: 'Last section', note: 'The checkout kit, from its page' },
  cta: { kind: 'trial', text: 'Try the kit', url: 'https://northwind.test/trial' },
  featuredImage: { concept: 'A cart left in an aisle', alt: 'A cart left in an aisle', style: 'photo' },
  internalLinks: [
    { url: 'https://northwind.test/kit', anchor: 'our checkout kit', sectionIndex: 2, reason: '' }
  ],
  gaps: ['A figure for mobile abandonment'],
  cautions: ['S2 is a snippet']
}

describe('the new rules', () => {
  it('ask for depth without padding, labelled examples and no decoration', () => {
    const text = buildBlogInstructions(ctx(), 'blog', brief())
    for (const part of [
      'stop when the reader has what they need',
      'labels "Hypothetical example"',
      'show sample data',
      'Never present them as real orders',
      'Never for decoration',
      'Never mix measures, units or sources in one chart',
      'never summarises the sections, never lists caveats',
      'is never headed "Conclusion"',
      'the author makes them and stay fair',
      'A figure always links the source it came from, in the same sentence'
    ]) {
      assert.ok(text.includes(part), `missing ${part}`)
    }
  })

  it('keep the close to what a reader of a web page can do, and guess no one\'s gender', () => {
    // A live analysis closed on "tag whoever is paying", and a case study
    // called its named founder "her" though the case never said.
    const text = buildBlogInstructions(ctx(), 'article', brief())
    assert.ok(text.includes('cannot tag, mention or comment'), text)
    assert.ok(text.includes('never guess it from a name'), text)
  })

  it('write from the plan: its angle, sections, sources, elements, product role and CTA', () => {
    const text = buildBlogPrompt(input({ plan: PLAN }))
    for (const part of [
      'following its plan',
      'Search intent: Commercial — Which fix pays back first?',
      'Angle: Fees cause more abandonment than design.',
      '1. Why carts are left — Name the causes',
      'Sources: S1, S2',
      'Element: chart — Reasons shoppers give',
      'Products: Mentioned where it helps — Last section',
      'Call to action (trial): Try the kit — link https://northwind.test/trial',
      'Open with a key-takeaways box',
      'Leave these out, and do not mention that they are missing; no source supports them: A figure for mobile abandonment',
      '"our checkout kit" → https://northwind.test/kit (section 2)'
    ]) {
      assert.ok(text.includes(part), `missing ${part}`)
    }
  })

  it('without a plan, give the style blueprint', () => {
    const text = buildBlogPrompt(input())
    assert.ok(text.includes('HOW THIS STYLE IS USUALLY BUILT'))
    assert.ok(!text.includes('THE PLAN'))
  })

  it('say which sources were confirmed on the page and which only in a snippet', () => {
    const text = buildBlogPrompt(
      input({
        sources: [
          { ...SOURCES[0]!, verifiedOn: 'page' },
          { ...SOURCES[1]!, verifiedOn: 'snippet', quotes: ['Surprise fees drive abandonment.', 'Fees again.'] },
          { ...SOURCES[2]!, ownPage: true }
        ]
      })
    )
    assert.ok(text.includes('Checked: confirmed on the page'))
    assert.ok(text.includes('Checked: seen only in a search snippet'))
    assert.ok(text.includes('- "Fees again."'))
    assert.ok(text.includes("the company's own page"))
  })

  it('write with confidence, not about the research', () => {
    // A live article spent a sentence in four on its evidence ("we saw only
    // the abstract snippet", "no source we can cite") and said "in our view"
    // six times.
    const text = buildBlogInstructions(ctx(), 'article', brief())
    for (const part of [
      'CONFIDENT, NOT CAUTIOUS',
      'Never narrate the research or the writing',
      'at most twice in the piece',
      'Give each figure once in the body',
      'The lead\'s first sentence is the answer itself',
      '"It depends" is never an answer on its own',
      'a caption that states its takeaway',
      'never "Hypothetical example" or "Example"',
      'The closing section is the payoff'
    ]) {
      assert.ok(text.includes(part), `missing ${part}`)
    }
    assert.ok(!text.includes('attribute its figures by name'), 'snippets are no longer attributed')
  })

  it('keep products, pages and the call to action to what this reader needs', () => {
    const text = buildBlogInstructions(ctx(), 'blog', brief())
    for (const part of [
      'would use it for the problem the piece discusses',
      'never mention a page to say it is not used',
      'rather than forcing it',
      'never on a question to the reader'
    ]) {
      assert.ok(text.includes(part), `missing ${part}`)
    }
  })

  it('tell the writer to rely on nothing seen only in a snippet', () => {
    const text = buildBlogPrompt(
      input({ sources: [{ ...SOURCES[1]!, verifiedOn: 'snippet' }] })
    )
    assert.ok(text.includes('rely on it for nothing'), text)
  })

  it('ask fixes never to patch a sentence with a hedge', () => {
    const text = buildFixPrompt({
      kind: 'article',
      sources: SOURCES,
      fixes: [{ id: 'F1', sentence: 'Most shoppers quit.', problem: 'Unsupported.' }]
    })
    assert.ok(text.includes('Never patch a sentence with a hedge'), text)
    assert.ok(!text.includes("reword it as the author's view"), text)
  })

  it('give a case study its real case', () => {
    const text = buildBlogPrompt(
      input({ brief: brief({ style: 'case_study', caseDetails: 'A shop cut returns by 12% in 2025.' }) })
    )
    assert.ok(text.includes('THE REAL CASE'))
    assert.ok(text.includes('A shop cut returns by 12% in 2025.'))
  })

  it('ask a fix for the failing sentences only', () => {
    const text = buildFixPrompt({
      kind: 'blog',
      sources: SOURCES,
      fixes: [
        {
          id: 'F1',
          sentence: 'Seventy percent of shoppers quit at shipping.',
          problem: 'The cited source does not say shipping.',
          sourceId: 'S1'
        }
      ]
    })
    for (const part of [
      'Rewrite only those sentences',
      '[F1] Sentence: "Seventy percent of shoppers quit at shipping."',
      'Problem: The cited source does not say shipping.',
      'It links [S1] Checkout study',
      'return an empty replacement to drop it'
    ]) {
      assert.ok(text.includes(part), `missing ${part}`)
    }
  })
})

describe('blog prompts', () => {
  it('list the sources with their ids and links', () => {
    const text = buildBlogPrompt(input())
    assert.ok(text.includes('[S1]'))
    assert.ok(text.includes('https://example.com/study'))
    assert.ok(text.includes('[K1] "Pricing guide", the author\'s knowledge base:'))
  })

  it('say so when there are no sources', () => {
    assert.ok(
      buildBlogPrompt(input({ sources: [] })).includes(
        "No sources were gathered for this piece: argue from reasoning and the author's own details, and state no figures that are not in them."
      )
    )
  })

  it('ask for no FAQ when it is off', () => {
    assert.ok(
      buildBlogPrompt(input({ brief: brief({ faq: false }) })).includes(
        'Return an empty faq list.'
      )
    )
  })

  it('name the keyword, or ask for one', () => {
    assert.ok(
      buildBlogPrompt(input()).includes('Primary keyword: "cart abandonment"')
    )
    assert.ok(
      buildBlogPrompt(input({ brief: brief({ primaryKeyword: '' }) })).includes(
        'Choose the primary keyword'
      )
    )
  })

  it("allow the goal's link and the identity's own", () => {
    const text = buildBlogPrompt(input())
    assert.ok(text.includes('https://northwind.test/trial'))
  })

  it('carry the instruction when regenerating', () => {
    const current = { title: 'Old title', outline: ['Why carts are left'] }
    const withInstruction = buildBlogRegeneratePrompt(
      input(),
      current,
      'Make it shorter'
    )
    assert.ok(withInstruction.includes('Write a new version of this piece.'))
    assert.ok(withInstruction.includes('Make it shorter'))
    assert.ok(
      buildBlogRegeneratePrompt(input(), current, null).includes(
        'Write a fresh take with a different structure.'
      )
    )
  })

  it('give a section rewrite the outline, the section and the instruction', () => {
    const text = buildSectionRewritePrompt({
      ...input(),
      outline: ['Why carts are left', 'What to change first'],
      section: { heading: 'Why carts are left', text: 'Fees cause it.' },
      instruction: 'Add an example'
    })
    for (const part of [
      'What to change first',
      'Fees cause it.',
      'Add an example'
    ]) {
      assert.ok(text.includes(part), `missing ${part}`)
    }
  })
})

describe('cleaning a drafted blog', () => {
  const options = {
    sources: SOURCES,
    ownLinks: ownLinksOf(ctx()),
    faqWanted: true,
    keyword: 'cart abandonment'
  }

  it("keeps links to sources and the identity's own pages, and drops the rest", () => {
    const clean = cleanBlogDraft(draft(), options)
    assert.deepStrictEqual(docLinks(clean.doc), [
      'https://example.com/shipping',
      'https://northwind.test/trial'
    ])
    assert.ok(
      clean.flags.includes(
        'Removed a link to https://unknown.test/x that was not among the sources.'
      ),
      clean.flags.join('\n')
    )
  })

  it('marks the sources it used and the ones it linked as cited', () => {
    const clean = cleanBlogDraft(draft(), options)
    assert.deepStrictEqual(
      clean.sources.map(s => [s.id, s.cited]),
      [
        ['S1', true],
        ['S2', true],
        ['K1', false]
      ]
    )
  })

  it('normalizes the title, slug, keywords and FAQ', () => {
    const clean = cleanBlogDraft(draft(), options)
    assert.strictEqual(clean.title, 'Cart abandonment: seven fixes')
    assert.strictEqual(clean.slug, 'cart-abandonment-fixes')
    assert.deepStrictEqual(clean.keywords, ['checkout design'])
    assert.strictEqual(clean.faq.length, 8)
    assert.strictEqual(
      cleanBlogDraft(draft({ slug: '' }), options).slug,
      'cart-abandonment'
    )
    assert.deepStrictEqual(
      cleanBlogDraft(draft(), { ...options, faqWanted: false }).faq,
      []
    )
  })

  it("keeps the brief's keyword over the model's", () => {
    assert.strictEqual(
      cleanBlogDraft(draft({ primaryKeyword: 'abandoned carts' }), options)
        .primaryKeyword,
      'cart abandonment'
    )
    assert.strictEqual(
      cleanBlogDraft(draft({ primaryKeyword: 'abandoned carts' }), {
        ...options,
        keyword: ''
      }).primaryKeyword,
      'abandoned carts'
    )
  })

  it('keeps the keywords the user typed, before the ones the model added', () => {
    const clean = cleanBlogDraft(
      draft({ secondaryKeywords: ['abandoned cart email'] }),
      {
        ...options,
        briefKeywords: ['checkout design', 'payment options']
      }
    )
    assert.deepStrictEqual(clean.keywords, [
      'checkout design',
      'payment options',
      'abandoned cart email'
    ])
  })

  it('builds tables, boxes and diagrams, and keeps the plan internal links', () => {
    const clean = cleanBlogDraft(
      draft({
        sections: [
          {
            heading: 'Compare the fixes',
            lead: '',
            blocks: [
              { type: 'paragraph', text: 'See [our pricing](https://northwind.test/pricing).' },
              { type: 'table', columns: ['Fix', 'Effort'], rows: [['Show fees early', 'Low']] },
              { type: 'example', title: 'A shop', paragraphs: ['Say a shop gets 200 orders a day.'] },
              { type: 'callout', variant: 'tip', text: 'Start with fees.' },
              {
                type: 'diagram',
                diagram: 'flow',
                title: 'Checkout',
                items: ['Cart', 'Pay'],
                alt: 'Two steps'
              }
            ]
          }
        ]
      }),
      {
        ...options,
        plan: {
          ...PLAN,
          internalLinks: [
            { url: 'https://northwind.test/pricing', anchor: 'our pricing', sectionIndex: 1, reason: '' }
          ]
        }
      }
    )
    assert.deepStrictEqual(
      clean.doc.content.map(block => block.type),
      ['paragraph', 'heading', 'paragraph', 'table', 'callout', 'callout', 'diagram']
    )
    assert.ok(docLinks(clean.doc).includes('https://northwind.test/pricing'))
    assert.strictEqual(clean.searchIntent, 'informational')
  })

  it('leaves out a chart whose values do not match and says so', () => {
    const clean = cleanBlogDraft(
      draft({
        sections: [
          {
            heading: 'Numbers',
            lead: '',
            blocks: [
              { type: 'paragraph', text: 'Text.' },
              { type: 'diagram', diagram: 'bar', title: 'Rates', items: ['A', 'B'], values: [1] }
            ]
          }
        ]
      }),
      options
    )
    assert.ok(!clean.doc.content.some(block => block.type === 'diagram'))
    assert.ok(clean.flags.some(flag => /chart "Rates"/.test(flag)), clean.flags.join('\n'))
  })

  it('counts a section that holds only a table as written', () => {
    assert.strictEqual(
      isCompleteBlogDraft(
        draft({
          sections: [
            { heading: 'Table', lead: '', blocks: [{ type: 'table', columns: ['a'], rows: [['b']] }] }
          ]
        })
      ),
      true
    )
  })

  it('knows an incomplete draft', () => {
    assert.strictEqual(isCompleteBlogDraft(draft()), true)
    assert.strictEqual(isCompleteBlogDraft(draft({ sections: [] })), false)
    assert.strictEqual(
      isCompleteBlogDraft(draft({ metaDescription: ' ' })),
      false
    )
  })
})

describe('the block schema', () => {
  it('orders each block kind before its content, so constrained output can fill it', () => {
    // Structured output writes properties in schema order: a box's variant or a
    // diagram's kind must come before the text, title and items that fill it.
    const keys = Object.keys(BlogBlockSchema.shape)
    const before = (a: string, b: string) =>
      assert.ok(keys.indexOf(a) < keys.indexOf(b), `${a} must come before ${b}: ${keys.join(', ')}`)
    before('type', 'variant')
    before('variant', 'title')
    before('variant', 'text')
    before('diagram', 'title')
    before('diagram', 'items')
    before('title', 'text')
    before('title', 'paragraphs')
    before('items', 'values')
    before('values', 'unit')
    before('columns', 'rows')
    before('caption', 'alt')
  })
})

describe('FAQ answers', () => {
  it('keep the words of links and bold, not their Markdown', () => {
    const clean = cleanBlogDraft(
      draft({
        faq: [
          {
            question: 'How often should a store sync?',
            answer: 'According to [VarStreet](https://example.com/study), **stock** syncs in real time.'
          }
        ]
      }),
      { sources: SOURCES, ownLinks: [], faqWanted: true, keyword: 'cart abandonment' }
    )
    assert.strictEqual(clean.faq[0]!.answer, 'According to VarStreet, stock syncs in real time.')
  })
})
