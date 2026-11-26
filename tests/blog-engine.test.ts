import assert from 'node:assert'
import { describe, it } from 'node:test'
import { gatherSearchQuestions } from '../src/lib/ai/pipeline/blog-questions'
import { SkillError } from '../src/lib/ai/run-skill'
import { cleanPlan } from '../src/lib/ai/skills/blog-planning/guard'
import { buildPlanPrompt } from '../src/lib/ai/skills/blog-planning/prompt'
import type { BlogPlanDraft } from '../src/lib/ai/skills/blog-planning/schema'
import { cleanSearchPhrases } from '../src/lib/ai/skills/blog-search-phrases/prompt'
import { EMPTY_USAGE } from '../src/lib/ai/usage'
import { docFromDraft, type BlogDoc, type DraftDocInput } from '../src/lib/blogs/doc'
import {
  featuredImagePrompt,
  makeSupportingImage,
  SUPPORTING_IMAGE_SIZE,
  type FeaturedImageDeps
} from '../src/lib/blogs/featured-image'
import { KIND_PROFILES, pictureRange, registerRules, renderKindRules } from '../src/lib/blogs/kinds'
import {
  carryPictures,
  keepKnownPictures,
  keepSectionPicture,
  placePictures
} from '../src/lib/blogs/pictures'
import {
  checkGroup,
  closingQuestion,
  findDatedClaims,
  findEchoedSentences,
  findFaqNonAnswers,
  findRepeatedFigures,
  findResearchNarration,
  findStackedQualifiers,
  findGenericWording,
  findInventedAttributions,
  findRepeatedOpeners,
  findRepeatedPhrases,
  findUnverifiedQuotes,
  findWeakLeads,
  findWeakSourceClaims,
  keywordStuffing,
  runQualityChecks,
  type QualityInput
} from '../src/lib/blogs/quality'
import {
  isQuestionHeading,
  matchSearchQuestion,
  mergeSearchQuestions,
  topicSearchPhrase
} from '../src/lib/blogs/questions'
import {
  blogArticleHtml,
  blogJsonLd,
  blogToMarkdown,
  blogToStandaloneHtml,
  blogToText,
  entitySameAs,
  figureFiles
} from '../src/lib/blogs/render'
import type {
  BlogBrief,
  BlogContent,
  BlogSource,
  PlanEntity,
  SearchQuestion
} from '../src/lib/blogs/types'
import { DEFAULT_BRAND_THEME } from '../src/lib/brand/theme'
import { parseQuestionResults } from '../src/lib/research/search-questions'
import { account, context } from './fixtures/generation'

const doc = (draft: Partial<DraftDocInput>): BlogDoc =>
  docFromDraft({ introduction: [], sections: [], ...draft }, null).doc

const paragraph = (text: string) => ({ type: 'paragraph' as const, text })

const source = (overrides: Partial<BlogSource> & { id: string }): BlogSource => ({
  origin: 'web',
  title: 'A study',
  url: `https://example.com/${overrides.id}`,
  quote: '',
  cited: false,
  ...overrides
})

const BRIEF: BlogBrief = {
  topic: 'Why mid-size distributors lose orders when their ERP and online store are separate systems',
  primaryKeyword: '',
  secondaryKeywords: ['ERP integration', 'B2B ordering'],
  length: 'medium',
  style: 'explainer',
  audience: { audienceId: null, note: 'Operations leads at distributors' },
  research: true,
  knowledge: false,
  faq: true,
  instructions: '',
  caseDetails: ''
}

// ---------------------------------------------------------------------------
// Search questions
// ---------------------------------------------------------------------------

describe('search questions', () => {
  it('reads "People also ask" and related searches from a results page, nothing else', () => {
    const parsed = parseQuestionResults({
      organic: [{ title: 'x', link: 'https://x.test' }],
      peopleAlsoAsk: [
        { question: 'What is ERP integration?', snippet: 'ERP integration is…', link: 'https://weak.test' },
        { question: '' },
        { nothing: true }
      ],
      relatedSearches: [{ query: 'erp integration examples' }, { query: 'x' }]
    })
    assert.deepStrictEqual(parsed, {
      questions: ['What is ERP integration?'],
      related: ['erp integration examples']
    })
    assert.deepStrictEqual(parseQuestionResults(null), { questions: [], related: [] })
  })

  it('merges searches, each question once whatever its case or punctuation', () => {
    const merged = mergeSearchQuestions(
      [
        { questions: ['What is ERP integration?', 'How long does it take?'], related: ['erp cost'] },
        { questions: ['what is ERP integration', 'Why integrate ERP?'], related: ['ERP cost', 'erp vendors'] }
      ],
      { questions: 3, related: 1 }
    )
    assert.deepStrictEqual(merged, [
      { text: 'What is ERP integration?', origin: 'people_also_ask' },
      { text: 'How long does it take?', origin: 'people_also_ask' },
      { text: 'Why integrate ERP?', origin: 'people_also_ask' },
      { text: 'erp cost', origin: 'related' }
    ])
  })

  it('matches a question copied or tidied, and nothing else', () => {
    const questions: SearchQuestion[] = [
      { text: 'How does ERP integration work with eCommerce?', origin: 'people_also_ask' },
      { text: 'What is B2B eCommerce?', origin: 'people_also_ask' }
    ]
    assert.strictEqual(matchSearchQuestion('how does erp integration work with ecommerce', questions)?.text, questions[0]!.text)
    assert.strictEqual(matchSearchQuestion('How does ERP integration work with an eCommerce store?', questions)?.text, questions[0]!.text)
    assert.strictEqual(matchSearchQuestion('Why do distributors lose orders?', questions), null)
    assert.strictEqual(matchSearchQuestion('', questions), null)
  })

  it('knows a question heading', () => {
    assert.ok(isQuestionHeading('How long does ERP integration take?'))
    assert.ok(isQuestionHeading('What a unified system changes'))
    assert.ok(!isQuestionHeading('The cost of keeping two systems'))
  })

  it('turns a topic sentence into a short search phrase when nothing better is known', () => {
    assert.strictEqual(
      topicSearchPhrase('"Why mid-size distributors lose orders when their ERP and online store are separate."'),
      'Why mid-size distributors lose orders when their ERP'
    )
  })

  it('keeps search phrases of 2-6 words, each once, at most three', () => {
    assert.deepStrictEqual(
      cleanSearchPhrases(['ERP', 'erp ecommerce integration', 'ERP eCommerce integration', '"b2b order sync"', 'one two three four five six seven', 'unified commerce platform', 'fourth phrase here']),
      ['erp ecommerce integration', 'b2b order sync', 'unified commerce platform']
    )
  })
})

describe('gathering the questions for a piece', () => {
  const ctx = context({ account: account() })
  const searched: string[] = []
  const searchQuestions = async (query: string) => {
    searched.push(query)
    return { questions: [`What about ${query}?`], related: [`${query} cost`] }
  }

  it('searches the keyword and the secondary keywords, without a phrase call', async () => {
    searched.length = 0
    let phraseCalls = 0
    const result = await gatherSearchQuestions(
      ctx,
      { ...BRIEF, primaryKeyword: 'ERP eCommerce integration' },
      {
        searchConfigured: true,
        searchQuestions,
        makeSearchPhrases: async () => {
          phraseCalls++
          return { phrases: [], usage: EMPTY_USAGE }
        }
      }
    )
    assert.strictEqual(phraseCalls, 0)
    assert.deepStrictEqual(searched, ['ERP eCommerce integration', 'ERP integration', 'B2B ordering'])
    assert.deepStrictEqual(result.phrases, ['ERP eCommerce integration'])
    assert.strictEqual(result.questions.filter(q => q.origin === 'people_also_ask').length, 3)
  })

  it('makes search phrases for a topic without a keyword, and searches those', async () => {
    searched.length = 0
    const result = await gatherSearchQuestions(ctx, BRIEF, {
      searchConfigured: true,
      searchQuestions,
      makeSearchPhrases: async () => ({
        phrases: ['erp ecommerce integration', 'b2b order errors'],
        usage: { ...EMPTY_USAGE, calls: 1, costUsd: 0.002 }
      })
    })
    assert.deepStrictEqual(searched, ['erp ecommerce integration', 'b2b order errors', 'ERP integration'])
    assert.strictEqual(result.usage.costUsd, 0.002)
  })

  it("searches the topic's first words when the phrases cannot be made", async () => {
    searched.length = 0
    await gatherSearchQuestions(ctx, { ...BRIEF, secondaryKeywords: [] }, {
      searchConfigured: true,
      searchQuestions,
      makeSearchPhrases: async () => {
        throw new SkillError('down', 'failed', { usage: EMPTY_USAGE })
      }
    })
    assert.deepStrictEqual(searched, ['Why mid-size distributors lose orders when their ERP'])
  })

  it('asks nothing with research off or no search key', async () => {
    searched.length = 0
    const off = await gatherSearchQuestions(ctx, { ...BRIEF, research: false }, { searchConfigured: true, searchQuestions })
    const unset = await gatherSearchQuestions(ctx, BRIEF, { searchConfigured: false, searchQuestions })
    assert.deepStrictEqual([off.questions, unset.questions, searched], [[], [], []])
  })
})

// ---------------------------------------------------------------------------
// Blog and article profiles
// ---------------------------------------------------------------------------

describe('blog and article profiles', () => {
  it("keep the author's own perspective in an article", () => {
    const rules = registerRules('article', { perspective: 'I', formality: 2 }).join(' ')
    assert.ok(rules.includes('Write as "I"'))
    assert.ok(rules.includes('never casual'))
    assert.ok(!rules.includes('third person'))
  })

  it("use contractions in a blog post only when the voice is not formal", () => {
    assert.ok(registerRules('blog', { perspective: 'we', formality: 2 }).join(' ').includes('Contractions are fine'))
    const formal = registerRules('blog', { perspective: 'we', formality: 5 }).join(' ')
    assert.ok(!formal.includes('Contractions are fine'))
    assert.ok(formal.includes('The voice is formal'))
  })

  it('research an article deeper than a blog post', () => {
    const { blog, article } = KIND_PROFILES
    assert.ok(article.research.maxPageReads > blog.research.maxPageReads)
    assert.ok(article.research.maxFindings > blog.research.maxFindings)
    assert.strictEqual(pictureRange('blog', 'medium'), '1-2')
    assert.strictEqual(pictureRange('article', 'long'), '2-3')
  })

  it('render each kind with its own register', () => {
    assert.ok(renderKindRules('blog', null).includes('Address them as "you"'))
    assert.ok(renderKindRules('article', null).includes('strongest counter-argument'))
  })
})

// ---------------------------------------------------------------------------
// The plan's new parts
// ---------------------------------------------------------------------------

describe('planning with questions, entities and pictures', () => {
  const QUESTIONS: SearchQuestion[] = [
    { text: 'How does ERP integration work?', origin: 'people_also_ask' },
    { text: 'erp integration cost', origin: 'related' }
  ]
  const raw = (overrides: Partial<BlogPlanDraft> = {}): BlogPlanDraft => ({
    searchIntent: 'informational',
    readerNeed: 'Why orders go wrong',
    angle: 'Two systems drift apart.',
    originality: 'A test for your setup.',
    primaryKeyword: 'ERP integration',
    secondaryKeywords: [],
    definition: 'ERP integration connects the ERP to other systems so data moves without retyping.',
    entities: [
      { name: 'Sana Commerce', type: 'organization', note: 'B2B eCommerce vendor', sourceId: 'S1' },
      { name: 'sana commerce', type: 'organization', note: 'dupe', sourceId: 'S1' },
      { name: 'EDI', type: 'bogus' as never, note: 'Electronic data interchange', sourceId: 'S9' }
    ],
    mainEntity: 'Sana Commerce',
    workingTitle: 'ERP integration for distributors',
    takeaways: false,
    sections: [
      { question: 'How does ERP integration work', heading: 'How does ERP integration work?', purpose: '', points: [], sourceIds: ['S1'], example: 'S1: a distributor', element: 'none', elementNote: '' },
      { question: 'What is the meaning of life?', heading: 'The cost of drift', purpose: '', points: [], sourceIds: [], example: '', element: 'table', elementNote: 'costs' },
      { question: '', heading: 'Where to start', purpose: '', points: [], sourceIds: [], example: 'hypothetical: a buyer', element: 'none', elementNote: '' }
    ],
    faq: ['Is ERP integration expensive?'],
    productRole: 'none',
    productWhere: '',
    productNote: '',
    ctaKind: 'none',
    ctaText: '',
    ctaUrl: '',
    imageConcept: 'A loading dock at dawn',
    imageAlt: 'A loading dock at dawn',
    imageStyle: 'photo',
    imageCaption: 'Orders leave from here.',
    imageDirection: 'Soft daylight, muted teal',
    supportingImages: [
      { sectionIndex: 1, concept: 'A picker with a scanner', alt: 'A picker scanning a shelf', caption: 'c', style: 'photo' },
      { sectionIndex: 1, concept: 'Duplicate section', alt: 'x', caption: '', style: 'photo' },
      { sectionIndex: 2, concept: 'Has a table already', alt: 'x', caption: '', style: 'photo' },
      { sectionIndex: 9, concept: 'Out of range', alt: 'x', caption: '', style: 'photo' },
      { sectionIndex: 3, concept: 'No alt text', alt: '', caption: '', style: 'photo' }
    ],
    internalLinks: [],
    gaps: [],
    cautions: [],
    ...overrides
  })
  const options = (more: Partial<Parameters<typeof cleanPlan>[1]> = {}) => ({
    sourceIds: ['S1'],
    candidateUrls: [],
    allowedLinks: [],
    faqWanted: true,
    keyword: '',
    briefKeywords: [],
    questions: QUESTIONS,
    maxPictures: 2,
    ...more
  })

  it('keeps a section question only when people search it', () => {
    const plan = cleanPlan(raw(), options())
    assert.deepStrictEqual(plan.sections.map(s => s.question), ['How does ERP integration work?', '', ''])
    assert.deepStrictEqual(plan.sections.map(s => s.example), ['S1: a distributor', '', 'hypothetical: a buyer'])
  })

  it('keeps each entity once, with a known source and a known type', () => {
    const plan = cleanPlan(raw(), options())
    assert.deepStrictEqual(plan.entities, [
      { name: 'Sana Commerce', type: 'organization', note: 'B2B eCommerce vendor', sourceId: 'S1' },
      { name: 'EDI', type: 'concept', note: 'Electronic data interchange', sourceId: '' }
    ])
    assert.strictEqual(plan.mainEntity, 'Sana Commerce')
    assert.strictEqual(cleanPlan(raw({ mainEntity: 'Gartner' }), options()).mainEntity, '')
  })

  it('keeps pictures only in real sections that show nothing else, one each, within the allowance', () => {
    const plan = cleanPlan(raw(), options())
    assert.deepStrictEqual(plan.supportingImages?.map(i => i.sectionIndex), [1])
    assert.deepStrictEqual(cleanPlan(raw(), options({ maxPictures: 0 })).supportingImages, [])
    assert.strictEqual(plan.featuredImage.caption, 'Orders leave from here.')
    assert.strictEqual(plan.imageDirection, 'Soft daylight, muted teal')
    assert.ok(plan.definition?.startsWith('ERP integration connects'))
  })

  it('shows the planner the questions, the phrases readers type and the picture allowance', () => {
    const prompt = buildPlanPrompt({
      ctx: context({ account: account() }),
      kind: 'article',
      brief: BRIEF,
      sources: [],
      idea: null,
      candidates: [],
      allowedLinks: [],
      questions: QUESTIONS,
      phrases: ['erp ecommerce integration']
    })
    assert.ok(prompt.includes('- How does ERP integration work?'))
    assert.ok(prompt.includes('Related searches:\n- erp integration cost'))
    assert.ok(prompt.includes('"erp ecommerce integration"'))
    assert.ok(prompt.includes('1-2 pictures inside sections'))
    const keeping = buildPlanPrompt({
      ctx: context({ account: account() }),
      kind: 'blog',
      brief: BRIEF,
      sources: [],
      idea: null,
      candidates: [],
      allowedLinks: [],
      newPictures: false
    })
    assert.ok(keeping.includes('supportingImages: none'))
  })
})

// ---------------------------------------------------------------------------
// Quality checks
// ---------------------------------------------------------------------------

describe('checking for invented attributions and quotations', () => {
  const sources = [
    source({ id: 'S1', title: 'B2B buyer survey 2024', publisher: 'Sana Commerce', quote: '46% say real-time inventory updates are essential.' }),
    source({ id: 'S2', title: 'Worldwide ERP spending guide', url: 'https://www.idc.com/getdoc', quote: 'Spending will grow.' })
  ]
  const check = (text: string, extra: Partial<DraftDocInput> = {}) =>
    findInventedAttributions({ doc: doc({ introduction: [text], ...extra }), faq: [], sources, authorText: 'Northwind Studio' })

  it('flags an authority no source mentions', () => {
    assert.deepStrictEqual(
      check('According to Forrester, most buyers want live stock levels.').map(f => f.name),
      ['Forrester']
    )
    assert.deepStrictEqual(check('McKinsey found that integration pays back in a year.').map(f => f.name), ['McKinsey'])
    assert.deepStrictEqual(check('A 2023 study by the Aberdeen Group shows the same.').map(f => f.name), ['Aberdeen Group'])
  })

  it('accepts sources the piece has and words that are not names', () => {
    assert.deepStrictEqual(check("Sana Commerce's 2024 survey found that 46% want live stock."), [])
    assert.deepStrictEqual(check('IDC estimates that spending will grow.'), [])
    assert.deepStrictEqual(check('Retailers found that surprise fees hurt.'), [])
    assert.deepStrictEqual(check('According to Northwind Studio, teams move faster.'), [])
  })

  it('flags a quotation no source has, outside example boxes', () => {
    const found = findUnverifiedQuotes({
      doc: doc({
        introduction: [
          'One buyer put it bluntly: "we stopped trusting the stock numbers last year entirely."',
          'The survey says "46% say real-time inventory updates are essential."',
          'People call it "the sync tax".'
        ],
        sections: [
          {
            heading: 'An example',
            blocks: [{ type: 'example', title: 'A buyer', paragraphs: ['She said "we will never order from a static price list again, never ever."'] }]
          }
        ]
      }),
      faq: [],
      sources,
      authorText: ''
    })
    assert.deepStrictEqual(found.map(f => f.quote), ['we stopped trusting the stock numbers last year entirely.'])
  })
})

describe('checking the sources behind claims', () => {
  it('flags figures resting only on a forum, a bare snippet or an unnamed newsletter', () => {
    const sources = [
      source({ id: 'S1', url: 'https://reddit.com/r/x', rating: { tier: 'forum', label: 'Forum', score: 1 } as never }),
      source({ id: 'S2', url: 'https://snip.example/a', verifiedOn: 'snippet' }),
      source({ id: 'S3', url: 'https://www.sana-commerce.com/report', publisher: 'Sana Commerce', rating: { tier: 'unrated', label: 'Unrated', score: 2 } as never })
    ]
    const found = findWeakSourceClaims(
      doc({
        introduction: [
          'Some [62% of buyers](https://reddit.com/r/x) switch suppliers.',
          'Orders fail [30% of the time](https://snip.example/a).',
          'According to [one report](https://snip.example/a), 30% fail.',
          'In [Sana Commerce research](https://www.sana-commerce.com/report), 46% want live stock.'
        ]
      }),
      sources
    )
    assert.deepStrictEqual(found.map(f => f.why), ['a forum source', 'a search snippet, stated as plain fact'])
  })

  it('flags an old figure stated without its year', () => {
    const sources = [source({ id: 'S1', publishedAt: '2015-03-01' })]
    const now = new Date('2026-11-26T00:00:00Z')
    const without = findDatedClaims(doc({ introduction: ['Some [38% of orders](https://example.com/S1) ship late.'] }), sources, now)
    const withYear = findDatedClaims(doc({ introduction: ['In 2015, [38% of orders](https://example.com/S1) shipped late.'] }), sources, now)
    assert.deepStrictEqual([without.map(f => f.year), withYear], [[2015], []])
  })
})

describe('checking the writing', () => {
  it('finds four-word phrases used three times, keywords aside', () => {
    const paragraphs = [
      'Real-time inventory sync keeps the numbers right. It keeps the numbers right for buyers.',
      'When it keeps the numbers right, orders flow. ERP integration matters. ERP integration helps. ERP integration works.'
    ]
    const found = findRepeatedPhrases(paragraphs, ['ERP integration'])
    assert.deepStrictEqual(found.map(f => f.phrase), ['keeps the numbers right'])
  })

  it('finds sentences that keep opening the same way', () => {
    assert.match(findRepeatedOpeners(['Orders drift.', 'Orders stall.', 'Orders vanish.']) ?? '', /Three sentences in a row open with "orders"/)
    assert.strictEqual(findRepeatedOpeners(['The stock drifts.', 'The orders stall.', 'The buyers leave.']), null)
  })

  it("finds generic AI wording the author's own posts do not use", () => {
    const sentences = ['Let us delve into the ever-evolving landscape of ERP.', 'It is a game-changer for teams.']
    assert.deepStrictEqual(findGenericWording(sentences, '').flatMap(f => f.phrases), ['delve', 'ever-evolving landscape', 'game-changer'])
    assert.deepStrictEqual(findGenericWording(sentences, 'This is a game-changer, honestly.').flatMap(f => f.phrases), ['delve', 'ever-evolving landscape'])
  })
})

describe('checking how the piece answers', () => {
  it('finds sections that do not open with a direct answer', () => {
    const weak = findWeakLeads(
      doc({
        sections: [
          { heading: 'Good', lead: 'ERP integration connects the ERP to the online store so orders, stock and prices move between them without anyone retyping them.', blocks: [] },
          { heading: 'Points back', lead: 'This is why the second system costs more than it seems, because every order has to be copied by hand.', blocks: [] },
          { heading: 'A list first', blocks: [{ type: 'bullets', items: ['one', 'two', 'three'] }] },
          { heading: 'Too short', lead: 'It depends.', blocks: [] }
        ]
      })
    )
    assert.deepStrictEqual(weak.map(w => w.heading), ['Points back', 'A list first', 'Too short'])
  })

  it('finds keyword stuffing in a section, the headings and runs of sentences', () => {
    const stuffed = keywordStuffing({
      doc: doc({
        sections: [
          {
            heading: 'ERP integration basics',
            blocks: [paragraph(`ERP integration is useful. ERP integration saves time. ERP integration cuts errors. ${'Teams like fewer steps and cleaner data. '.repeat(14)}ERP integration pays.`)]
          },
          { heading: 'ERP integration costs', blocks: [paragraph('It costs less than you think.')] },
          { heading: 'Where to start', blocks: [paragraph('Start small.')] }
        ]
      }),
      primaryKeyword: 'ERP integration',
      keywords: []
    })
    assert.strictEqual(stuffed.problems.length, 3, stuffed.problems.join('\n'))
    assert.ok(stuffed.sentences.length > 0)
  })
})

describe('the quality checks together', () => {
  const sources = [
    source({ id: 'S1', title: 'Buyer survey', publisher: 'Sana Commerce', url: 'https://www.sana-commerce.com/s', quote: '46% say real-time inventory updates are essential.' })
  ]
  const input = (content: BlogDoc, more: Partial<QualityInput> = {}): QualityInput => ({
    kind: 'blog',
    content,
    faq: [],
    sources,
    primaryKeyword: 'ERP integration',
    keywords: [],
    searchIntent: 'informational',
    authorText: '',
    researchUsed: true,
    ...more
  })
  const rules = (findings: ReturnType<typeof runQualityChecks>) =>
    findings.filter(f => !f.passed).map(f => f.rule)

  it('ask for question headings, planned entities and an early definition', () => {
    const content = doc({
      introduction: ['Distributors that run two systems retype every order, and the copies drift apart within a week of launch.'],
      sections: [{ heading: 'The cost of drift', lead: 'Drift costs distributors orders because buyers stop trusting stock numbers that are wrong more often than they are right.', blocks: [] }]
    })
    const failing = rules(
      runQualityChecks(
        input(content, {
          questions: [{ text: 'What is ERP integration?', origin: 'people_also_ask' }],
          entities: [{ name: 'Sana Commerce', type: 'organization', note: '', sourceId: 'S1' } as PlanEntity],
          definition: 'ERP integration connects systems.'
        })
      )
    )
    for (const rule of ['question_headings', 'entity_coverage', 'definition_early']) {
      assert.ok(failing.includes(rule), `${rule} not flagged: ${failing.join(', ')}`)
    }
  })

  it('pass a piece that answers first, cites its source and names what it covers', () => {
    const content = doc({
      introduction: [
        'ERP integration is the link that moves orders, stock and prices between the ERP and the online store, so nobody retypes them.',
        'In [Sana Commerce\'s survey](https://www.sana-commerce.com/s), 46% of buyers said real-time inventory updates are essential.'
      ],
      sections: [
        {
          heading: 'What is ERP integration?',
          lead: 'ERP integration connects the ERP to the online store so that each order, stock count and price exists once and both systems read it.',
          blocks: [paragraph('A buyer who sees live stock orders with confidence.')]
        }
      ]
    })
    const failing = rules(
      runQualityChecks(
        input(content, {
          questions: [{ text: 'What is ERP integration?', origin: 'people_also_ask' }],
          entities: [{ name: 'Sana Commerce', type: 'organization', note: '', sourceId: 'S1' } as PlanEntity],
          definition: 'ERP integration connects systems.'
        })
      )
    )
    for (const rule of ['invented_attribution', 'unverified_quote', 'weak_source_claim', 'answer_first', 'question_headings', 'entity_coverage', 'definition_early', 'generic_wording']) {
      assert.ok(!failing.includes(rule), `${rule} flagged`)
    }
  })

  it("expect an article's main sections to carry evidence", () => {
    const content = doc({
      introduction: ['In [Sana Commerce\'s survey](https://www.sana-commerce.com/s), 46% of buyers want live stock.'],
      sections: [
        { heading: 'Context', lead: 'Distributors have run separate systems for decades because each grew out of a different department and budget.', blocks: [paragraph('That history still shapes how orders move today in most firms.')] },
        { heading: 'Evidence', lead: 'The evidence points one way: live stock matters to buyers more than price lists or delivery promises do.', blocks: [] },
        { heading: 'Next', lead: 'Start by listing where an order is typed twice, then measure how often those copies disagree in a month.', blocks: [] }
      ]
    })
    const findings = runQualityChecks(input(content, { kind: 'article' }))
    assert.ok(findings.some(f => f.rule === 'voice_fit' && !f.passed && f.message.includes('no sourced point')))
    assert.ok(findings.some(f => f.rule === 'source_diversity' && !f.passed))
  })

  it('sort every check into one of four groups', () => {
    assert.deepStrictEqual(
      ['invented_attribution', 'unsupported_figures', 'weak_source_claim', 'repeated_phrase', 'contrast_overuse', 'answer_first', 'seo_keyword_stuffing', 'seo_title'].map(checkGroup),
      ['accuracy', 'accuracy', 'sources', 'writing', 'writing', 'search', 'search', 'search']
    )
  })
})

// ---------------------------------------------------------------------------
// Pictures in the document
// ---------------------------------------------------------------------------

const imageNode = (imageId: string, alt = 'alt') => ({
  type: 'image' as const,
  attrs: { imageId, alt, caption: `Caption ${imageId}` }
})

describe('placing section pictures', () => {
  const base = doc({
    introduction: ['Intro.'],
    sections: [
      { heading: 'How stock drifts', lead: 'Stock drifts when two systems each keep their own count.', blocks: [paragraph('Then buyers see the wrong number.'), paragraph('Third.')] },
      { heading: 'What to fix first', lead: 'Fix the order flow first.', blocks: [{ type: 'bullets', items: ['a', 'b', 'c'] }] }
    ]
  })

  it("puts a picture after the section's answer and the paragraph after it", () => {
    const placed = placePictures(base, [
      { sectionIndex: 1, node: imageNode('a') },
      { sectionIndex: 2, node: imageNode('b') },
      { sectionIndex: 7, node: imageNode('c') }
    ])
    const types = placed.content.map(block => (block.type === 'image' ? `image:${block.attrs.imageId}` : block.type))
    assert.deepStrictEqual(types, [
      'paragraph',
      'heading', 'paragraph', 'paragraph', 'image:a', 'paragraph',
      'heading', 'paragraph', 'image:b', 'bulletList'
    ])
  })

  it('carries pictures into the regenerated sections they match', () => {
    const previous = placePictures(base, [
      { sectionIndex: 1, node: imageNode('drift') },
      { sectionIndex: 2, node: imageNode('fix') }
    ])
    const next = doc({
      sections: [
        { heading: 'Where to begin', lead: 'Begin with orders.', blocks: [] },
        { heading: 'Why stock counts drift apart', lead: 'Counts drift.', blocks: [] }
      ]
    })
    const carried = carryPictures(previous, next)
    const order = carried.content.flatMap(block =>
      block.type === 'heading' ? [`h:${block.content?.[0]?.type === 'text' ? block.content[0].text : ''}`] : block.type === 'image' ? [block.attrs.imageId] : []
    )
    // "drift" matches its section by words; "fix" matches none and its old
    // place is taken, so it is left out (its file stays with the blog).
    assert.deepStrictEqual(order, ['h:Where to begin', 'h:Why stock counts drift apart', 'drift'])
  })

  it("keeps a section's picture through a rewrite, and leaves out pictures the blog does not have", () => {
    const kept = keepSectionPicture(
      [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] }, imageNode('x')],
      [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'New lead.' }] }]
    )
    assert.deepStrictEqual(kept.map(block => block.type), ['heading', 'paragraph', 'image'])
    const filtered = keepKnownPictures({ type: 'doc', content: [imageNode('mine'), imageNode('theirs')] }, ['mine'])
    assert.deepStrictEqual(filtered.content.map(block => (block.type === 'image' ? block.attrs.imageId : '')), ['mine'])
  })
})

// ---------------------------------------------------------------------------
// Rendering pictures, the byline and the structured data
// ---------------------------------------------------------------------------

describe('rendering pictures and structured data', () => {
  const content: BlogDoc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Intro.' }] },
      imageNode('pic-1', 'A loading dock at dawn'),
      { type: 'diagram', attrs: { kind: 'flow', title: 'Flow', items: ['a', 'b'], values: [], unit: '', caption: '', alt: 'flow', sourceId: '' } },
      imageNode('missing')
    ]
  }
  const blog: BlogContent = {
    kind: 'article',
    title: 'ERP integration explained',
    slug: 'erp-integration',
    metaTitle: 'ERP integration explained',
    metaDescription: 'What ERP integration is and why distributors need it.',
    primaryKeyword: 'ERP integration',
    keywords: [],
    searchIntent: 'informational',
    content,
    faq: [],
    sources: [
      source({ id: 'S1', title: 'Gartner', url: 'https://www.gartner.com/' }),
      source({ id: 'S2', title: 'ERP', url: 'https://en.wikipedia.org/wiki/Enterprise_resource_planning' })
    ],
    featuredImage: null,
    verification: null,
    images: { 'pic-1': { src: 'https://cdn.test/pic-1.webp', width: 1200, height: 800 } },
    entities: [
      { name: 'Enterprise resource planning', type: 'concept', note: 'Business management software', sourceId: 'S2' },
      { name: 'Gartner', type: 'organization', note: 'IT research firm', sourceId: '' },
      { name: 'Acme', type: 'organization', note: '', sourceId: '' }
    ],
    mainEntity: 'Enterprise resource planning'
  }

  it('renders a picture as a sized, lazily loaded figure with its caption, and nothing for a missing one', () => {
    const html = blogArticleHtml(blog)
    assert.ok(
      html.includes('<figure class="image"><img src="https://cdn.test/pic-1.webp" alt="A loading dock at dawn" width="1200" height="800" loading="lazy" decoding="async"><figcaption>Caption pic-1</figcaption></figure>'),
      html
    )
    assert.ok(!html.includes('missing'))
  })

  it('names picture files apart from diagrams, and refers to them in Markdown and text', () => {
    assert.deepStrictEqual(
      figureFiles(blog).map(f => [f.kind, f.name]),
      [['picture', 'erp-integration-picture-1.webp'], ['diagram', 'erp-integration-figure-1.png']]
    )
    const md = blogToMarkdown(blog, { frontMatter: false })
    assert.ok(md.includes('![A loading dock at dawn](erp-integration-picture-1.webp)\n\n_Caption pic-1_'), md)
    assert.ok(blogToText(blog).includes('[Picture: A loading dock at dawn — Caption pic-1]'))
  })

  it('lists what the piece is about and mentions, with same-as pages only from its own links', () => {
    const [main] = blogJsonLd(blog, { featuredImageUrl: 'data:image/webp;base64,AAAA', imageUrls: ['https://cdn.test/pic-1.webp'] }) as Array<Record<string, unknown>>
    assert.deepStrictEqual(main!.about, {
      '@type': 'Thing',
      name: 'Enterprise resource planning',
      description: 'Business management software',
      sameAs: ['https://en.wikipedia.org/wiki/Enterprise_resource_planning']
    })
    assert.deepStrictEqual(main!.mentions, [
      { '@type': 'Organization', name: 'Gartner', description: 'IT research firm', sameAs: ['https://www.gartner.com/'] },
      { '@type': 'Organization', name: 'Acme' }
    ])
    assert.deepStrictEqual(main!.image, ['https://cdn.test/pic-1.webp'])
  })

  it('finds same-as pages only on Wikipedia or an organisation’s own homepage', () => {
    const urls = ['https://gartner.com/en/articles/x', 'https://example.com/', 'https://en.wikipedia.org/wiki/Gartner']
    assert.deepStrictEqual(entitySameAs({ name: 'Gartner', type: 'organization', note: '', sourceId: '' }, urls), ['https://en.wikipedia.org/wiki/Gartner'])
    assert.deepStrictEqual(entitySameAs({ name: 'Example', type: 'concept', note: '', sourceId: '' }, urls), [])
  })

  it('shows who wrote the page and when it was updated', () => {
    const page = blogToStandaloneHtml(blog, {
      author: { name: 'Northwind Studio', type: 'Organization' },
      datePublished: '2026-11-20T10:00:00.000Z',
      dateModified: '2026-11-26T10:00:00.000Z'
    })
    assert.ok(
      page.includes('<p class="byline">By Northwind Studio · <time datetime="2026-11-20T10:00:00.000Z">20 November 2026</time> · Updated <time datetime="2026-11-26T10:00:00.000Z">26 November 2026</time></p>'),
      page
    )
  })
})

// ---------------------------------------------------------------------------
// Section pictures
// ---------------------------------------------------------------------------

describe('making a section picture', () => {
  const request = {
    blogId: '0b6f7c5e-2f4a-4c2b-9a51-6c3a0d2f9e11',
    title: 'ERP integration explained',
    section: 'How stock drifts',
    concept: 'A picker scanning a shelf in a warehouse aisle',
    alt: 'A picker scanning a shelf',
    caption: 'Counts start on the shelf.',
    style: 'photo' as const,
    theme: DEFAULT_BRAND_THEME,
    look: 'Soft daylight, muted teal accents'
  }
  const deps = (reviews: string[][], render?: FeaturedImageDeps['render']) => {
    let review = 0
    const prompts: string[] = []
    const value: FeaturedImageDeps & { newId: () => string } = {
      render:
        render ??
        (async input => {
          prompts.push(input.prompt)
          return { buffer: Buffer.from('png'), mediaType: 'image/png', modelId: 'stub', width: input.target.width, height: input.target.height, seed: 1, attempts: 1 }
        }),
      review: async () => ({ issues: reviews[review++] ?? [], usage: EMPTY_USAGE }),
      toWebp: async buffer => ({ buffer, mediaType: 'image/webp' }),
      store: async () => 'storage://blogs/x/2.webp',
      now: () => new Date('2026-11-26T10:00:00.000Z'),
      newId: () => 'pic-new'
    }
    return { value, prompts }
  }

  it("asks for a picture inside the article, in the piece's shared look, at its own size", () => {
    const prompt = featuredImagePrompt(request, 'supporting')
    assert.ok(prompt.includes('An editorial picture inside an article, showing: A picker scanning a shelf'))
    assert.ok(prompt.includes('Every picture in this article shares this look: Soft daylight, muted teal accents'))
    assert.deepStrictEqual(SUPPORTING_IMAGE_SIZE, { width: 1200, height: 800 })
  })

  it('flags a picture whose second try still has problems, and keeps it', async () => {
    const { value } = deps([['Has lettering'], ['Still has lettering']])
    const { image } = await makeSupportingImage(request, value)
    assert.strictEqual(image?.id, 'pic-new')
    assert.strictEqual(image?.flagged, true)
    assert.strictEqual(image?.width, 1200)
    assert.strictEqual(image?.concept, request.concept)
  })

  it('gives no picture, with the reason, when none can be made', async () => {
    const { value } = deps([], async () => {
      throw new Error('No image model produced an image.')
    })
    const result = await makeSupportingImage(request, value)
    assert.strictEqual(result.image, null)
    assert.match(result.error ?? '', /No image model/)
  })
})

describe('the fix pass', () => {
  it('fixes invented attributions and quotes before weak sources, and wording last', async () => {
    const { fixesFor } = await import('../src/lib/ai/pipeline/blog-run')
    const fixes = fixesFor({
      judged: null,
      problems: [],
      invented: [],
      copied: [{ sentence: 'Copied sentence.', text: 'copied words' }],
      quality: {
        attributions: [{ sentence: 'Forrester says so.', name: 'Forrester' }],
        quotes: [{ sentence: 'He said "a quote that nobody ever wrote down".', quote: 'a quote that nobody ever wrote down' }],
        weak: [{ sentence: 'A forum says 60%.', sourceId: 'S1', why: 'a forum source' }],
        generic: [{ sentence: 'A game-changer.', phrases: ['game-changer'] }],
        stuffed: ['Keyword again.'],
        experience: [{ sentence: 'We have seen this often.', phrases: ['we have seen'] }]
      }
    })
    assert.deepStrictEqual(fixes.map(f => f.sentence), [
      'Forrester says so.',
      'He said "a quote that nobody ever wrote down".',
      'We have seen this often.',
      'A forum says 60%.',
      'Copied sentence.',
      'A game-changer.',
      'Keyword again.'
    ])
    assert.deepStrictEqual(fixes.map(f => f.id), ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'])
  })

  it('rewrites research narration, FAQ non-answers, restated figures, extra qualifiers and a closing question', async () => {
    const { fixesFor } = await import('../src/lib/ai/pipeline/blog-run')
    const fixes = fixesFor({
      judged: null,
      problems: [],
      invented: [],
      copied: [],
      quality: {
        attributions: [],
        quotes: [],
        weak: [],
        generic: [],
        stuffed: [],
        narration: [{ sentence: 'We saw only the abstract snippet.', phrases: ['we saw only the abstract'] }],
        nonAnswers: [{ question: 'Will it last?', sentence: "We can't say." }],
        restated: [{ sentence: 'The $13 billion figure again.', figure: '$13b', first: 'GMV was $13 billion.' }],
        qualifiers: [{ sentence: 'In our view, speed wins.', phrase: 'in our view' }],
        closingQuestion: 'What does your count show?'
      }
    })
    assert.deepStrictEqual(fixes.map(f => f.sentence), [
      'We saw only the abstract snippet.',
      "We can't say.",
      'The $13 billion figure again.',
      'In our view, speed wins.',
      'What does your count show?'
    ])
    assert.match(fixes[1]!.problem, /direct answer/)
    assert.match(fixes[3]!.problem, /without the qualifier/)
  })
})

describe('matching figures and terms the way sources write them', () => {
  it('reads "Bn" and "Mn" as billion and million, and a percentage cut off before its sign', async () => {
    const { statesFigure } = await import('../src/lib/blogs/citations')
    assert.ok(statesFigure("India's $80 Bn Online Retail Story", '80 billion'))
    assert.ok(statesFigure('towards USD 90 Bn by FY31P', '90 billion'))
    assert.ok(statesFigure('orders rose to 1,970 Mn', '1,970 million'))
    assert.ok(statesFigure('The average deferral rate was 7.6%, and the median rate was 6.6', '6.6%'))
    assert.ok(!statesFigure('the median rate was 6.6 points lower', '6.6%'))
    assert.ok(!statesFigure('rates rose 16.6%', '6.6%'))
  })

  it('finds the term a definition defines, and the short names of long entities', async () => {
    const { definedTerm, entityNames, definesEarly } = await import('../src/lib/blogs/quality')
    assert.strictEqual(
      definedTerm('According to the NHS, a high temperature (fever) in a child is a temperature of 38C or more.'),
      'high temperature (fever) in a child'
    )
    assert.strictEqual(definedTerm('Termintreue is the share of orders delivered on time.'), 'Termintreue')
    assert.deepStrictEqual(entityNames('National Institute for Health and Care Excellence (NICE)'), [
      'national institute for health and care excellence nice',
      'national institute for health and care excellence',
      'nice'
    ])
    const content = doc({
      introduction: ['A fever is a temperature of 38C or more, and most fevers in children are caused by infections.']
    })
    assert.ok(definesEarly(content, 'high temperature (fever) in a child'))
  })
})

describe('telling statistics and research talk apart', () => {
  it('does not call an age from an old guideline a dated figure', () => {
    const sources = [source({ id: 'S1', publishedAt: '2019-11-07' })]
    const found = findDatedClaims(
      doc({ introduction: ['The [guideline](https://example.com/S1) covers fever in children under 5 with no obvious cause.'] }),
      sources,
      new Date('2026-11-26T00:00:00Z')
    )
    assert.deepStrictEqual(found, [])
  })

  it('treats writing about its own sources as generic wording', () => {
    const found = findGenericWording(['The pages we rely on define the threshold.', 'The sources we use give no dose.'], '')
    assert.strictEqual(found.length, 2)
  })
})

describe('names written as one word in a site address', () => {
  it('knows "the Economic Times" from economictimes.indiatimes.com', () => {
    const found = findInventedAttributions({
      doc: doc({ introduction: ['According to the Economic Times, store closures rose.'] }),
      faq: [],
      sources: [source({ id: 'S1', url: 'https://economictimes.indiatimes.com/news/x', title: 'Kirana closures' })],
      authorText: ''
    })
    assert.deepStrictEqual(found, [])
  })
})

// ---------------------------------------------------------------------------
// Confidence, repetition and endings (2026-11-26 review of live pieces)
// ---------------------------------------------------------------------------

describe('a confident piece about its subject', () => {
  it('finds sentences about the research instead of the subject', () => {
    const found = findResearchNarration([
      'We saw only the abstract snippet of the study.',
      'The Economic Times item is available only as a search snippet, so its detail is limited.',
      'No source we can cite gives order frequency per user.',
      'The quotation is cut off at that point on the page, so we use only what is shown.',
      'We skip a chart here.',
      'This section is our analysis, not sourced fact.',
      'Dark stores are small warehouses close to dense neighbourhoods.',
      'We could not confirm the original release.'
    ])
    assert.deepStrictEqual(
      found.map(f => f.sentence.slice(0, 20)),
      [
        'We saw only the abst',
        'The Economic Times i',
        'No source we can cit',
        'The quotation is cut',
        'We skip a chart here',
        'This section is our ',
        'We could not confirm'
      ]
    )
  })

  it('allows two "in our view"s and flags the rest', () => {
    const stacked = findStackedQualifiers([
      'In our view, speed is the habit.',
      'We think discounts are an accelerant.',
      'Kirana owners copied delivery.',
      'In our view, the test is simple.',
      'This is our judgment, since prices differ.'
    ])
    assert.deepStrictEqual(
      stacked.map(s => s.phrase),
      ['in our view', 'this is our judgment']
    )
  })

  it('flags a statistic stated a third time, not the takeaways box', () => {
    const body = doc({
      keyTakeaways: ['GMV was about $13 billion in FY26.'],
      introduction: ['India\'s quick commerce GMV was about $13 billion in FY26.'],
      sections: [
        {
          heading: 'The scale',
          lead: 'The $13 billion figure counts orders, not revenue.',
          blocks: [
            paragraph('Monthly users rose 95% year on year.'),
            paragraph('A $13 billion GMV figure therefore describes what shoppers ordered.')
          ]
        }
      ]
    })
    const found = findRepeatedFigures(body)
    assert.strictEqual(found.length, 1)
    assert.ok(found[0]!.sentence.startsWith('A $13 billion GMV'), found[0]!.sentence)
    assert.ok(found[0]!.first.startsWith("India's quick commerce"), found[0]!.first)
  })

  it('finds FAQ answers that open without an answer', () => {
    const found = findFaqNonAnswers([
      { question: 'Will ERP be replaced by AI?', answer: "We can't say, and no source we know of settles it. AI features are being added." },
      { question: 'What does it cost?', answer: 'It varies, and we have no reliable published figure to give. Cost depends on the ERP.' },
      { question: 'Can ERP manage inventory?', answer: 'Yes. Inventory is a core ERP function.' },
      { question: 'How long does it take?', answer: 'It depends on three things: the ERP, the store and the data mapped.' }
    ])
    assert.deepStrictEqual(
      found.map(f => f.question),
      ['Will ERP be replaced by AI?', 'What does it cost?']
    )
  })

  it('finds a piece that ends on a question to the reader', () => {
    const asking = doc({
      sections: [
        {
          heading: 'What to check this week',
          lead: 'Compare site and ERP counts on your five fastest-moving products.',
          blocks: [paragraph('See how TDCCommerce runs both on one record. What does your own count show?')]
        }
      ]
    })
    assert.strictEqual(closingQuestion(asking), 'What does your own count show?')
    const telling = doc({
      sections: [{ heading: 'Next', lead: 'Start with the five products that sell fastest this week.', blocks: [] }]
    })
    assert.strictEqual(closingQuestion(telling), null)
  })

  it('puts the new findings in the checks panel', () => {
    const findings = runQualityChecks({
      kind: 'article',
      content: doc({
        introduction: ['Quick commerce GMV reached about $13 billion in FY26, according to Redseer.'],
        sections: [
          {
            heading: 'The scale',
            lead: 'The $13 billion figure counts orders, not revenue. We saw only the abstract snippet of the study.',
            blocks: [paragraph('A $13 billion GMV figure describes what shoppers ordered. Is that growth durable?')]
          }
        ]
      }),
      faq: [{ question: 'Will it last?', answer: "We can't say. Discounts may fall." }],
      sources: [],
      primaryKeyword: '',
      keywords: [],
      searchIntent: 'informational',
      authorText: '',
      researchUsed: false
    })
    const failed = new Set(findings.filter(f => !f.passed).map(f => f.rule))
    for (const rule of ['research_narration', 'repeated_figure', 'faq_non_answer', 'closing_question']) {
      assert.ok(failed.has(rule), `missing ${rule}`)
    }
    assert.strictEqual(checkGroup('faq_non_answer'), 'search')
    assert.strictEqual(checkGroup('research_narration'), 'writing')
  })
})

describe('labelled boxes', () => {
  it("drops a box title that only repeats the box's label", () => {
    const body = doc({
      sections: [
        {
          heading: 'A section',
          lead: 'A lead that answers the heading in a sentence or two of plain words.',
          blocks: [
            { type: 'example', title: 'Hypothetical example', paragraphs: ['A household runs out of milk at 8 pm.'] },
            { type: 'example', title: "A distributor's month-end count", paragraphs: ['Say, 200 orders a day.'] },
            { type: 'callout', variant: 'tip', title: 'Tip:', text: 'Count the five fastest movers.' }
          ]
        }
      ]
    })
    const boxes = body.content.filter(block => block.type === 'callout')
    const firstLine = (box: (typeof boxes)[number]) =>
      box.type === 'callout' && box.content[0]?.type === 'paragraph'
        ? (box.content[0].content ?? []).map(n => (n.type === 'text' ? n.text : '')).join('')
        : ''
    assert.deepStrictEqual(boxes.map(firstLine), [
      'A household runs out of milk at 8 pm.',
      "A distributor's month-end count",
      'Count the five fastest movers.'
    ])
  })
})

describe('fixes from the second live review', () => {
  it('writes a currency unit before the number', async () => {
    const { formatValue } = await import('../src/lib/blogs/diagram')
    assert.strictEqual(formatValue(11821, '₹ crore'), '₹11,821 crore')
    assert.strictEqual(formatValue(13, '$'), '$13')
    assert.strictEqual(formatValue(13, '$ billion'), '$13 billion')
    assert.strictEqual(formatValue(45, '%'), '45%')
    assert.strictEqual(formatValue(3, 'days'), '3 days')
  })

  it('keeps a fixed FAQ answer plain text, "$" and all', async () => {
    const { applySentenceFixes } = await import('../src/lib/blogs/citations')
    const { faq } = applySentenceFixes(
      {
        doc: doc({}),
        faq: [{ question: 'Has the CCI ruled?', answer: "We can't say. It is a complaint." }]
      },
      [
        {
          sentence: "We can't say.",
          replacement: 'No: [Blooprint reports](https://blooprint.in/x) the CCI asked for $13 of evidence.'
        }
      ],
      null
    )
    assert.strictEqual(
      faq[0]!.answer,
      'No: Blooprint reports the CCI asked for $13 of evidence. It is a complaint.'
    )
  })

  it('finds a sentence that says again what the one before it said', () => {
    const body = doc({
      sections: [
        {
          heading: 'The counter-view',
          lead: 'The Economic Times report gives the other side of the argument in plain terms.',
          blocks: [
            paragraph(
              'The report quotes a view that a price floor may hurt investment in e-commerce and startups and works against containing inflation. It quotes a view that a floor on prices may affect investment in e-commerce and startup activity and is counter-intuitive to containing inflation. Similar allegations were raised when e-commerce first entered India.'
            )
          ]
        }
      ]
    })
    const found = findEchoedSentences(body)
    assert.strictEqual(found.length, 1)
    assert.ok(found[0]!.sentence.startsWith('It quotes a view'), found[0]!.sentence)
  })

  it('counts "our reading is" and "our judgment is" as qualifiers', () => {
    const stacked = findStackedQualifiers([
      'Our reading of the mechanism is that access lowers the cost.',
      'Our judgment is that kirana owners should read it as competition.',
      'Our reading is that branding is separable from the network.'
    ])
    assert.deepStrictEqual(stacked.map(s => s.phrase), ['our reading is'])
  })
})
