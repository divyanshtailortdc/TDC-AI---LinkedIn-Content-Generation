import assert from 'node:assert'
import { describe, it } from 'node:test'
import { getStageSettings } from '../src/lib/ai'
import { cleanPlan, isUsablePlan } from '../src/lib/ai/skills/blog-planning/guard'
import { buildPlanPrompt } from '../src/lib/ai/skills/blog-planning/prompt'
import type { BlogPlanDraft } from '../src/lib/ai/skills/blog-planning/schema'
import { ownLinksOf } from '../src/lib/ai/skills/blog-drafting/guard'
import type { BlogBrief, BlogSource, LinkCandidate } from '../src/lib/blogs/types'
import { account, context, goal, offering } from './fixtures/generation'

const brief = (overrides: Partial<BlogBrief> = {}): BlogBrief => ({
  topic: 'Why B2B eCommerce and ERP should run on one set of records',
  primaryKeyword: 'B2B eCommerce ERP',
  secondaryKeywords: ['ERP integration'],
  length: 'medium',
  style: 'explainer',
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
    account: account({ name: 'TDCCommerce', websiteUrl: 'https://www.tdccommerce.com' }),
    offerings: [offering('Catalog AI', { url: 'https://www.tdccommerce.com/catalog-ai' })],
    goal: goal({
      title: 'Book demos',
      desiredAction: 'Request a demo',
      targetUrl: 'https://www.tdccommerce.com/demo'
    })
  })

const SOURCES: BlogSource[] = [
  {
    id: 'S1',
    origin: 'web',
    title: 'Gartner sales survey',
    url: 'https://www.gartner.com/en/newsroom/x',
    publisher: 'Gartner',
    quote: '61% of B2B buyers prefer a rep-free buying experience.',
    verifiedOn: 'page',
    cited: false
  },
  {
    id: 'S2',
    origin: 'web',
    title: 'Integration failures',
    url: 'https://webalize.me/blog/x',
    quote: 'The store keeps selling after ERP stock has changed.',
    verifiedOn: 'snippet',
    cited: false
  },
  {
    id: 'K1',
    origin: 'knowledge',
    title: 'TDCCommerce home',
    url: 'https://www.tdccommerce.com/',
    quote: 'Sales, inventory, purchasing and accounting run on one system.',
    ownPage: true,
    cited: false
  }
]

const CANDIDATES: LinkCandidate[] = [
  { url: 'https://www.tdccommerce.com/integrations', title: 'Integrations', kind: 'page' },
  {
    url: 'https://www.tdccommerce.com/blog/erp-basics',
    title: 'ERP basics',
    kind: 'blog'
  }
]

const draft = (overrides: Partial<BlogPlanDraft> = {}): BlogPlanDraft => ({
  searchIntent: 'informational',
  readerNeed: 'Is running two systems costing me money?',
  angle: 'Syncing is a cost centre that grows with order volume.',
  originality: 'A five-question test for whether the sync is costing you.',
  primaryKeyword: 'B2B eCommerce ERP',
  secondaryKeywords: ['ERP integration', 'real-time inventory'],
  definition: '',
  entities: [],
  mainEntity: '',
  workingTitle: 'B2B eCommerce ERP: what syncing really costs',
  takeaways: true,
  sections: [
    {
      question: '',
      heading: 'Where the copies drift',
      example: '',
      purpose: 'Show the failure points',
      points: ['Orders', 'Stock'],
      sourceIds: ['S2', 'S9'],
      element: 'diagram',
      elementNote: 'Flow of one order across two systems'
    },
    {
      question: '',
      heading: 'A test for your own setup',
      example: '',
      purpose: 'Decision rule',
      points: ['Five questions'],
      sourceIds: [],
      element: 'checklist',
      elementNote: ''
    }
  ],
  faq: ['What is a B2B eCommerce ERP?'],
  productRole: 'mention',
  productWhere: 'In the last section',
  productNote: 'One record, from its own page',
  ctaKind: 'demo',
  ctaText: 'Bring a real order to a demo',
  ctaUrl: 'https://www.tdccommerce.com/demo',
  imageConcept: 'Two clipboards with different stock counts on a warehouse shelf',
  imageAlt: 'Two clipboards on a shelf showing different stock counts',
  imageStyle: 'photo',
  imageCaption: '',
  imageDirection: '',
  supportingImages: [],
  internalLinks: [
    {
      url: 'https://tdccommerce.com/integrations/',
      anchor: 'connected services',
      sectionIndex: 2,
      reason: 'Shows what still connects'
    },
    { url: 'https://unknown.example/x', anchor: 'x', sectionIndex: 1, reason: '' }
  ],
  gaps: ['A measured cost of re-entry'],
  cautions: ['S2 was seen only in a search snippet'],
  ...overrides
})

const options = (overrides: Partial<Parameters<typeof cleanPlan>[1]> = {}) => ({
  sourceIds: SOURCES.map(s => s.id),
  candidateUrls: CANDIDATES.map(c => c.url),
  allowedLinks: ownLinksOf(ctx()),
  faqWanted: true,
  keyword: 'B2B eCommerce ERP',
  briefKeywords: ['ERP integration'],
  ...overrides
})

describe('planning a blog', () => {
  it('plans fast and writes with more thought, inside the time limit', () => {
    // Measured 2026-11-25 on one medium blog: Opus 5.5 took 85 s to plan and
    // 86 s to write, too slow beside research under the 300 s function limit;
    // Sonnet 5.5 planned in 33 s and wrote in 34 s at medium; at high effort a
    // complete medium piece took 130-150 s and two of six live runs timed out.
    assert.deepStrictEqual(getStageSettings('blog_planning'), { model: 'claude-sonnet-5-5', effort: 'medium' })
    assert.deepStrictEqual(getStageSettings('blog_drafting'), { model: 'claude-sonnet-5-5', effort: 'medium' })
    assert.deepStrictEqual(getStageSettings('blog_editing'), { model: 'claude-sonnet-5-5', effort: 'medium' })
    assert.deepStrictEqual(getStageSettings('blog_verification'), { model: 'claude-sonnet-5-5', effort: 'low' })
  })

  it('sizes the outline to the length asked for', () => {
    const prompt = (length: 'short' | 'medium' | 'long') =>
      buildPlanPrompt({
        ctx: ctx(),
        kind: 'blog',
        brief: brief({ length }),
        sources: SOURCES,
        idea: null,
        candidates: [],
        allowedLinks: []
      })
    assert.ok(prompt('short').includes('3-4 sections'))
    assert.ok(prompt('medium').includes('4-6 sections'))
    assert.ok(prompt('long').includes('6-8 sections'))
  })

  it('asks for a search phrase, not the topic, when it chooses the keyword', () => {
    const prompt = buildPlanPrompt({
      ctx: ctx(),
      kind: 'blog',
      brief: brief({ primaryKeyword: '', secondaryKeywords: [] }),
      sources: SOURCES,
      idea: null,
      candidates: [],
      allowedLinks: []
    })
    assert.ok(prompt.includes('2-5 words'), prompt)
    assert.ok(prompt.includes('not the topic'), prompt)
    // A live comparison was planned for "unified ERP and eCommerce platform vs
    // separate online store", which the piece then never used.
    const plan = cleanPlan(
      draft({
        primaryKeyword: 'unified ERP and eCommerce platform vs separate online store',
        secondaryKeywords: ['ERP eCommerce integration', 'should a growing distributor buy one platform or two']
      }),
      options({ keyword: '', briefKeywords: [] })
    )
    assert.strictEqual(plan.primaryKeyword, '')
    assert.deepStrictEqual(plan.secondaryKeywords, ['ERP eCommerce integration'])
  })

  it('carries the style blueprint, the sources, the link candidates and the rules', () => {
    const prompt = buildPlanPrompt({
      ctx: ctx(),
      kind: 'blog',
      brief: brief(),
      sources: SOURCES,
      idea: null,
      candidates: CANDIDATES,
      allowedLinks: ownLinksOf(ctx())
    })
    for (const part of [
      'Answer the core question in plain words',
      '[S1]',
      'confirmed on the page',
      'seen only in a search snippet',
      "the company's own page",
      'Integrations — https://www.tdccommerce.com/integrations',
      'ERP basics — https://www.tdccommerce.com/blog/erp-basics',
      'what this piece adds that the typical articles',
      'Never a sales pitch',
      'cannot tag, mention or comment',
      'sample data',
      'https://www.tdccommerce.com/demo'
    ]) {
      assert.ok(prompt.includes(part), `missing ${part}`)
    }
  })

  it('gives a case study its real case as the only case facts', () => {
    const prompt = buildPlanPrompt({
      ctx: ctx(),
      kind: 'article',
      brief: brief({
        style: 'case_study',
        caseDetails: 'Northwind Valves cut credit notes from 42 to 9 a month.'
      }),
      sources: SOURCES,
      idea: null,
      candidates: [],
      allowedLinks: []
    })
    assert.ok(prompt.includes('THE REAL CASE'))
    assert.ok(prompt.includes('Northwind Valves cut credit notes from 42 to 9 a month.'))
  })

  it('drops unknown sources and links, and keeps known candidates as listed', () => {
    const plan = cleanPlan(draft(), options())
    assert.deepStrictEqual(plan.sections[0]!.sourceIds, ['S2'])
    assert.deepStrictEqual(plan.internalLinks, [
      {
        url: 'https://www.tdccommerce.com/integrations',
        anchor: 'connected services',
        sectionIndex: 2,
        reason: 'Shows what still connects'
      }
    ])
    assert.strictEqual(plan.cta.url, 'https://www.tdccommerce.com/demo')
    assert.deepStrictEqual(plan.featuredImage, {
      concept: 'Two clipboards with different stock counts on a warehouse shelf',
      alt: 'Two clipboards on a shelf showing different stock counts',
      style: 'photo',
      caption: ''
    })
  })

  it('keeps the CTA link only when it is allowed', () => {
    const plan = cleanPlan(draft({ ctaUrl: 'https://evil.example/' }), options())
    assert.strictEqual(plan.cta.url, null)
  })

  it("keeps the brief's keywords and empties the FAQ when it was not asked for", () => {
    const plan = cleanPlan(
      draft({ primaryKeyword: 'something else', faq: ['Q?'] }),
      options({ faqWanted: false })
    )
    assert.strictEqual(plan.primaryKeyword, 'B2B eCommerce ERP')
    assert.deepStrictEqual(plan.secondaryKeywords.slice(0, 1), ['ERP integration'])
    assert.deepStrictEqual(plan.faq, [])
  })

  it('reads unknown values safely and knows an unusable plan', () => {
    const plan = cleanPlan(
      draft({
        searchIntent: 'curious' as never,
        productRole: 'pitch' as never,
        ctaKind: 'shout' as never,
        sections: [
          { question: '', heading: 'Only', example: '', purpose: '', points: [], sourceIds: [], element: 'poster' as never, elementNote: '' }
        ]
      }),
      options()
    )
    assert.strictEqual(plan.searchIntent, 'informational')
    assert.strictEqual(plan.product.role, 'none')
    assert.strictEqual(plan.cta.kind, 'none')
    assert.strictEqual(plan.sections[0]!.element, 'none')
    assert.strictEqual(isUsablePlan(plan), false)
    assert.strictEqual(isUsablePlan(cleanPlan(draft(), options())), true)
  })
})
