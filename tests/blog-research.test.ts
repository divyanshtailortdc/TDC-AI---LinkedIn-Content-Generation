import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  BLOG_RESEARCH_INSTRUCTIONS,
  BLOG_RESEARCH_LIMITS,
  blogFreshnessDays,
  buildBlogResearchPrompt
} from '../src/lib/ai/agents/research/blog-prompt'
import {
  keepVerifiedFindings,
  usablePage
} from '../src/lib/ai/agents/research/guard'
import {
  MAX_FINDINGS,
  MAX_PAGE_READS,
  MAX_SEARCHES,
  MAX_STEPS
} from '../src/lib/ai/agents/research/limits'
import { INSTRUCTIONS } from '../src/lib/ai/agents/research/prompt'
import {
  cleanKnowledgePassage,
  cleanSourceTitle,
  confirmSnippetFigures,
  figureSourcesText,
  ideaSourcesFrom,
  knowledgeSourcesFrom,
  numberSources,
  pickSourceTitle,
  thirdPartyTexts,
  webSourcesFrom
} from '../src/lib/ai/pipeline/blog-sources'
import type { BlogSource } from '../src/lib/blogs/types'
import type { Finding } from '../src/lib/research/web-search'
import {
  account,
  audience,
  context,
  idea,
  offering
} from './fixtures/generation'

const finding = (url: string, title: string): Finding => ({
  url,
  title,
  snippet: `Verbatim words from ${title}.`,
  provider: 'serper_search'
})

/** A knowledge passage long enough to keep (25 words or more). */
const PASSAGE =
  'Our pricing guide explains each plan: Starter for a single store, Growth for teams that sell on several channels, and Scale for businesses that run their own warehouses and need purchasing too.'

const source = (
  id: string,
  url: string | null,
  origin: BlogSource['origin'] = 'web'
): BlogSource => ({
  id,
  origin,
  title: `Title ${id}`,
  url,
  quote: `Quote ${id}`,
  cited: false
})

describe('research for a blog', () => {
  it("leaves the runs' research prompt as it was", () => {
    assert.ok(
      INSTRUCTIONS.startsWith(
        "You research evidence for one account's upcoming social media posts."
      )
    )
  })

  it("names the topic, the keywords and the readers' country", () => {
    const ctx = context({
      account: account({ name: 'Northwind Studio' }),
      audiences: [audience('Shop owners', { geography: 'India' })]
    })
    const prompt = buildBlogResearchPrompt(ctx, {
      topic: 'Reducing cart abandonment',
      primaryKeyword: 'cart abandonment',
      secondaryKeywords: ['checkout design'],
      style: 'how_to',
      freshnessDays: 0
    })
    for (const part of [
      'Reducing cart abandonment',
      '"cart abandonment"',
      '"checkout design"',
      'Readers are in: India.'
    ]) {
      assert.ok(prompt.includes(part), `missing ${part}`)
    }
  })

  it('looks back 30 days for news analysis and has no date limit otherwise', () => {
    assert.strictEqual(blogFreshnessDays('news_analysis'), 30)
    assert.strictEqual(blogFreshnessDays('how_to'), 0)
    assert.strictEqual(blogFreshnessDays('thought_leadership'), 0)
  })
})

describe('the evidence pool', () => {
  it('drops pages written to rank, puts the best sources first and keeps eight', () => {
    const sources = webSourcesFrom(
      [
        finding(
          'https://www.grandviewresearch.com/industry/cart',
          'Market report'
        ),
        finding('https://someblog.example/post', 'A blog post'),
        finding('https://www.reuters.com/business/retail/cart', 'Reuters story')
      ],
      { ownHosts: [] }
    )
    assert.deepStrictEqual(
      sources.map(s => s.title),
      ['Reuters story', 'A blog post']
    )
    assert.strictEqual(sources[0]!.rating?.tier, 'news')
    assert.strictEqual(sources[0]!.quote, 'Verbatim words from Reuters story.')
    assert.strictEqual(sources[0]!.origin, 'web')

    const many = webSourcesFrom(
      Array.from({ length: 12 }, (_, i) =>
        finding(`https://site${i}.example/page`, `Page ${i}`)
      ),
      { ownHosts: [] }
    )
    assert.strictEqual(many.length, 10)
  })

  it('titles knowledge passages by their document', () => {
    assert.deepStrictEqual(
      knowledgeSourcesFrom(
        [{ documentId: 'd1', content: PASSAGE, similarity: 0.8 }],
        [{ id: 'd1', title: 'Pricing guide', sourceUrl: null }]
      ),
      [
        {
          id: '',
          origin: 'knowledge',
          title: 'Pricing guide',
          url: null,
          quote: PASSAGE,
          quotes: [PASSAGE],
          cited: false
        }
      ]
    )
  })

  it("keeps an idea's evidence that has a link", () => {
    const sources = ideaSourcesFrom(
      idea({
        supportingEvidence: [
          {
            claim: 'Fees cause abandonment.',
            sourceUrl: 'https://example.com/fees',
            sourceTitle: 'Fees study'
          },
          { claim: 'An unsourced thought.' }
        ]
      })
    )
    assert.deepStrictEqual(
      sources.map(s => [s.origin, s.url, s.title, s.quote]),
      [
        [
          'idea',
          'https://example.com/fees',
          'Fees study',
          'Fees cause abandonment.'
        ]
      ]
    )
    assert.deepStrictEqual(ideaSourcesFrom(null), [])
  })

  it('numbers web and idea sources S1…, knowledge K1…, each link once', () => {
    const numbered = numberSources(
      [source('', 'https://a.example/x'), source('', 'https://b.example/y')],
      [
        source('', 'https://www.a.example/x/', 'idea'),
        source('', 'https://d.example/z', 'idea')
      ],
      [source('', null, 'knowledge')]
    )
    assert.deepStrictEqual(
      numbered.map(s => [s.id, s.url]),
      [
        ['S1', 'https://a.example/x'],
        ['S2', 'https://b.example/y'],
        ['S3', 'https://d.example/z'],
        ['K1', null]
      ]
    )
  })

  it("lets figures come from the sources and the author's own details", () => {
    const ctx = context({
      account: account({ name: 'Northwind Studio' }),
      offerings: [
        offering('Checkout kit', {
          proofPoints: [{ label: 'Used by 1,200 shops' }]
        })
      ]
    })
    const text = figureSourcesText(ctx, [
      {
        ...source('S1', 'https://a.example'),
        quote: '70% of carts are abandoned.'
      }
    ])
    assert.ok(text.includes('70% of carts are abandoned.'))
    assert.ok(text.includes('1,200 shops'))
  })

  it('treats only web and idea sources as third-party text', () => {
    assert.deepStrictEqual(
      thirdPartyTexts([
        source('S1', 'https://a.example'),
        source('S2', 'https://b.example', 'idea'),
        source('K1', null, 'knowledge')
      ]),
      ['Quote S1', 'Quote S2']
    )
  })
})

describe('figures the author asked for', () => {
  it("lets figures come from the author's own instructions", () => {
    const text = figureSourcesText(
      context({ account: account() }),
      [],
      ['Mention our 20% discount on first orders.']
    )
    assert.ok(text.includes('20% discount'), text)
  })
})

describe('deeper research for a blog', () => {
  it("keeps the runs' research limits and gives blogs larger ones", () => {
    assert.deepStrictEqual(
      [MAX_STEPS, MAX_SEARCHES, MAX_PAGE_READS, MAX_FINDINGS],
      [8, 5, 4, 10]
    )
    assert.deepStrictEqual(BLOG_RESEARCH_LIMITS, {
      maxSteps: 12,
      maxSearches: 8,
      maxPageReads: 6,
      maxFindings: 16
    })
    for (const part of [
      'at most 8 searches',
      'at most 6 pages',
      'up to 16 findings',
      'original publisher',
      'before you quote a statistic'
    ]) {
      assert.ok(BLOG_RESEARCH_INSTRUCTIONS.includes(part), `missing ${part}`)
    }
  })

  it("asks for what the style needs, never for a case study's own facts", () => {
    const prompt = buildBlogResearchPrompt(context({ account: account() }), {
      topic: 'How a distributor cut credit notes',
      primaryKeyword: '',
      secondaryKeywords: [],
      style: 'case_study',
      freshnessDays: 0
    })
    assert.ok(prompt.includes('never facts about the case itself'))
  })

  it('says which quotes were read on the page itself', () => {
    const page = 'https://news.example/survey'
    const snippetOnly = 'https://other.example/post'
    const seen = new Map([
      [
        page,
        {
          finding: finding(page, 'Survey'),
          text: 'Snippet.\n61% of buyers prefer to order online without a rep.',
          pageText: '61% of buyers prefer to order online without a rep.'
        }
      ],
      [
        snippetOnly,
        {
          finding: finding(snippetOnly, 'Post'),
          text: 'Most buyers now research suppliers online before calling.'
        }
      ]
    ])
    const { findings, pageVerified } = keepVerifiedFindings(
      [
        { url: page, quote: '61% of buyers prefer to order online without a rep.' },
        {
          url: snippetOnly,
          quote: 'Most buyers now research suppliers online before calling.'
        }
      ],
      seen
    )
    assert.strictEqual(findings.length, 2)
    assert.deepStrictEqual(pageVerified, [true, false])
  })

  it('merges quotes from one page into one source', () => {
    const sources = webSourcesFrom(
      [
        { ...finding('https://www.reuters.com/a', 'Story'), snippet: 'First fact from the story.' },
        { ...finding('https://reuters.com/a/', 'Story'), snippet: 'Second fact from the story.' }
      ],
      { ownHosts: [] }
    )
    assert.strictEqual(sources.length, 1)
    assert.strictEqual(sources[0]!.quote, 'First fact from the story.')
    assert.deepStrictEqual(sources[0]!.quotes, [
      'First fact from the story.',
      'Second fact from the story.'
    ])
  })

  it('keeps where a quote was verified, the page winning', () => {
    const [merged] = webSourcesFrom(
      [
        { ...finding('https://www.reuters.com/a', 'Story'), verifiedOn: 'snippet' },
        {
          ...finding('https://www.reuters.com/a', 'Story'),
          snippet: 'Another fact.',
          verifiedOn: 'page'
        }
      ],
      { ownHosts: [] }
    )
    assert.strictEqual(merged!.verifiedOn, 'page')
  })

  it('cleans search titles and prefers the title of a page that was read', () => {
    assert.strictEqual(
      cleanSourceTitle(
        'Gartner Sales Survey Finds 61% of B2B Buyers Prefer a Rep-Free ...'
      ),
      'Gartner Sales Survey Finds 61% of B2B Buyers Prefer a Rep-Free'
    )
    assert.strictEqual(cleanSourceTitle('  A   title…'), 'A title')
    const [read] = webSourcesFrom([finding('https://www.reuters.com/a', 'The full story ...')], {
      ownHosts: [],
      pageTitles: { 'https://www.reuters.com/a': 'The full story title' }
    })
    assert.strictEqual(read!.title, 'The full story title')
  })

  it('cleans menus, images and spaced letters from knowledge passages', () => {
    const cleaned = cleanKnowledgePassage(
      [
        '## O n e S e t o f R e c o r d s, U n d e r Y o u r C o n t r o l',
        'TDCCommerce keeps sales, inventory, purchasing and accounting on one system, so every team works from the same order, the same stock count and the same books.',
        '* [Solutions](https://www.tdccommerce.com/solutions)',
        '* [Integrations](https://www.tdccommerce.com/integrations)',
        '[](https://www.tdccommerce.com/)',
        '![Dashboard](https://cdn.test/x.png)',
        'Read the [pricing guide](https://www.tdccommerce.com/pricing) for plans.'
      ].join('\n')
    )
    assert.ok(cleaned.includes('TDCCommerce keeps sales, inventory'))
    assert.ok(cleaned.includes('Read the pricing guide for plans.'))
    for (const gone of ['O n e', '[Solutions]', '![', 'https://', 'Integrations']) {
      assert.ok(!cleaned.includes(gone), `still has ${gone}`)
    }
  })

  it('drops passages that are only navigation', () => {
    const menu =
      '### Company * [Solutions](https://www.tdccommerce.com/solutions) * [Integrations](https://www.tdccommerce.com/integrations) * [Services](https://www.tdccommerce.com/services) * [About](https://www.tdccommerce.com/about) * [Contact](https://www.tdccommerce.com/contact) © 2026 The Developer Company Inc.'
    assert.deepStrictEqual(
      knowledgeSourcesFrom(
        [{ documentId: 'd1', content: menu, similarity: 0.9 }],
        [{ id: 'd1', title: 'Home', sourceUrl: 'https://www.tdccommerce.com' }],
        ['tdccommerce.com']
      ),
      []
    )
  })

  it("labels the company's own pages and merges a document's passages", () => {
    const sources = knowledgeSourcesFrom(
      [
        { documentId: 'own', content: PASSAGE, similarity: 0.9 },
        { documentId: 'listing', content: PASSAGE, similarity: 0.8 },
        {
          documentId: 'own',
          content: `${PASSAGE} Every plan includes onboarding.`,
          similarity: 0.7
        }
      ],
      [
        { id: 'own', title: 'Home', sourceUrl: 'https://www.tdccommerce.com/' },
        { id: 'listing', title: 'Directory listing', sourceUrl: 'https://b2bea.org/x' }
      ],
      ['tdccommerce.com']
    )
    assert.deepStrictEqual(
      sources.map(s => [s.title, s.ownPage, s.quotes?.length]),
      [
        ['Home', true, 2],
        ['Directory listing', false, 1]
      ]
    )
  })

  it('confirms a figure from a search snippet on its page', async () => {
    const fetched: string[] = []
    const sources: BlogSource[] = [
      {
        ...source('S1', 'https://a.example/survey'),
        quote: '61% of B2B buyers prefer a rep-free buying experience.',
        verifiedOn: 'snippet'
      },
      {
        ...source('S2', 'https://b.example/post'),
        quote: '40% of orders arrive by email.',
        verifiedOn: 'snippet'
      },
      {
        ...source('S3', 'https://c.example/essay'),
        quote: 'Buyers want fewer phone calls.',
        verifiedOn: 'snippet'
      }
    ]
    const confirmed = await confirmSnippetFigures(sources, async url => {
      fetched.push(url)
      return url.includes('a.example')
        ? 'Intro. 61% of B2B buyers prefer a rep-free buying experience. More.'
        : 'A page that says something else.'
    })
    assert.deepStrictEqual(
      confirmed.map(s => s.verifiedOn),
      ['page', 'snippet', 'snippet']
    )
    // A quote without a figure is not fetched.
    assert.deepStrictEqual(fetched.sort(), [
      'https://a.example/survey',
      'https://b.example/post'
    ])
  })
})

describe('pages that are not the page', () => {
  it('ignores the title and text of a bot-check page', () => {
    assert.strictEqual(
      usablePage({ title: 'Just a moment...', content: 'Checking your browser before accessing the site.' }),
      null
    )
    assert.deepStrictEqual(
      usablePage({ title: 'B2B replatforming guide | On Tap Group', content: 'Run the new platform beside the old one.' }),
      { title: 'B2B replatforming guide | On Tap Group', text: 'Run the new platform beside the old one.' }
    )
  })
})

describe('source titles', () => {
  it("prefers a page's title only when it finishes a cut search title", () => {
    assert.strictEqual(
      pickSourceTitle('Gartner Sales Survey Finds 67% of B2B Buyers Prefer a ...', 'STAMFORD, Conn., March 9, 2026'),
      'Gartner Sales Survey Finds 67% of B2B Buyers Prefer a'
    )
    assert.strictEqual(
      pickSourceTitle('Gartner Sales Survey Finds 67% of B2B Buyers Prefer a ...', 'Gartner Sales Survey Finds 67% of B2B Buyers Prefer a Rep-Free Experience'),
      'Gartner Sales Survey Finds 67% of B2B Buyers Prefer a Rep-Free Experience'
    )
    assert.strictEqual(pickSourceTitle('A complete title', 'Something else entirely'), 'A complete title')
    assert.strictEqual(pickSourceTitle('', 'Only the page title'), 'Only the page title')
  })
})
