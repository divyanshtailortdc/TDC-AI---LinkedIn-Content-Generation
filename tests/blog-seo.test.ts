import assert from 'node:assert'
import { describe, it } from 'node:test'
import type { BlogBlock, BlogDoc } from '../src/lib/blogs/doc'
import {
  containsKeyword,
  runSeoChecks,
  searchResultHost,
  seoSummary,
  type SeoInput
} from '../src/lib/blogs/seo'

const para = (text: string): BlogBlock => ({
  type: 'paragraph',
  content: [{ type: 'text', text }]
})
const linked = (text: string, href: string): BlogBlock => ({
  type: 'paragraph',
  content: [
    { type: 'text', text: `${text} ` },
    { type: 'text', text: 'source', marks: [{ type: 'link', attrs: { href } }] }
  ]
})
const heading = (level: 2 | 3, text: string): BlogBlock => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }]
})
/** `n` filler words that are none of the keywords. */
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `word${i % 40}`).join(' ')
const doc = (...content: BlogBlock[]): BlogDoc => ({ type: 'doc', content })

const DESCRIPTION =
  'Cart abandonment costs small shops sales every day. These seven fixes, from checkout design to reminder emails, help you win those buyers back.'

/** A medium blog that passes every check: ~1,330 words, three sections. */
function good(overrides: Partial<SeoInput> = {}): SeoInput {
  const section = (title: string, first: BlogBlock) => [
    heading(2, title),
    first,
    para(filler(100)),
    para(filler(100)),
    para(filler(100))
  ]
  return {
    title: 'Cart abandonment: 7 fixes that work for small shops',
    metaTitle: 'Cart abandonment: 7 fixes for small online shops',
    metaDescription: DESCRIPTION,
    slug: 'cart-abandonment-fixes',
    primaryKeyword: 'cart abandonment',
    keywords: ['checkout design'],
    content: doc(
      para(
        `Cart abandonment is the gap between interest and a sale. ${filler(90)}`
      ),
      ...section('Why cart abandonment happens', para(filler(100))),
      ...section(
        'Fix your checkout design',
        linked(
          `Most cart abandonment starts at checkout. ${filler(93)}`,
          'https://example.com/a'
        )
      ),
      ...section('Send reminders that work', para(filler(100)))
    ),
    faq: [
      {
        question: 'What is cart abandonment?',
        answer: 'Leaving a cart before paying.'
      },
      { question: 'Is it normal?', answer: 'Yes, in every shop.' },
      { question: 'What helps first?', answer: 'A shorter checkout.' }
    ],
    length: 'medium',
    faqWanted: true,
    researchUsed: true,
    ...overrides
  }
}

const finding = (input: SeoInput, rule: string) =>
  runSeoChecks(input).find(f => f.rule === rule)

describe('SEO checks', () => {
  it('passes a well-formed blog on every check', () => {
    const findings = runSeoChecks(good())
    assert.deepStrictEqual(
      findings.filter(f => !f.passed),
      []
    )
    const { passed, total } = seoSummary(findings)
    assert.strictEqual(passed, total)
    assert.ok(total >= 15, `only ${total} checks ran`)
  })

  it('flags an empty meta description as an error', () => {
    const f = finding(good({ metaDescription: '' }), 'seo_meta_description')!
    assert.strictEqual(f.severity, 'error')
    assert.strictEqual(f.passed, false)
  })

  it('flags a meta description outside 120-160 characters', () => {
    const f = finding(
      good({ metaDescription: `Cart abandonment ${'a'.repeat(83)}` }),
      'seo_meta_description'
    )!
    assert.strictEqual(f.passed, false)
    assert.strictEqual(f.severity, 'warning')
    assert.ok(f.message.includes('100 characters'), f.message)
  })

  it('flags an empty meta title as an error and a long one as a warning', () => {
    assert.strictEqual(
      finding(good({ metaTitle: '' }), 'seo_meta_title')!.severity,
      'error'
    )
    const long = finding(
      good({ metaTitle: `Cart abandonment ${'b'.repeat(60)}` }),
      'seo_meta_title'
    )!
    assert.strictEqual(long.passed, false)
    assert.strictEqual(long.severity, 'warning')
  })

  it('flags a title without the keyword', () => {
    assert.strictEqual(
      finding(
        good({ title: 'Seven fixes that work for small online shops' }),
        'seo_title_keyword'
      )!.passed,
      false
    )
  })

  it('flags keyword stuffing over 2.5%', () => {
    const f = finding(
      good({
        content: doc(
          heading(2, 'Cart abandonment'),
          para(`${'cart abandonment '.repeat(4)}${filler(90)}`)
        )
      }),
      'seo_keyword_density'
    )!
    assert.strictEqual(f.passed, false)
  })

  it('flags an H3 before the first H2', () => {
    assert.strictEqual(
      finding(
        good({
          content: doc(heading(3, 'Too early'), ...good().content.content)
        }),
        'seo_heading_order'
      )!.passed,
      false
    )
  })

  it('flags too few sections for the length', () => {
    const f = finding(
      good({
        content: doc(
          para(`Cart abandonment matters. ${filler(97)}`),
          heading(2, 'Cart abandonment basics'),
          para(filler(100)),
          heading(2, 'Next'),
          para(filler(100))
        )
      }),
      'seo_sections'
    )!
    assert.strictEqual(f.passed, false)
    assert.strictEqual(
      f.message,
      'Only 2 section headings; use at least 3 so readers can scan.'
    )
  })

  it('flags a length far outside the target, and lets a shorter, complete piece be', () => {
    const short = (paragraphs: number) =>
      finding(
        good({
          length: 'short',
          faq: [],
          faqWanted: false,
          content: doc(...Array.from({ length: paragraphs }, () => para(filler(100))))
        }),
        'seo_length'
      )!
    // 400 of 800 words: half the length.
    assert.strictEqual(short(4).passed, false)
    assert.ok(short(4).message.startsWith('400 words'), short(4).message)
    // 520 words is shorter than the 800 aimed for, and fine when it covers the topic.
    assert.strictEqual(short(5).passed, true, short(5).message)
    // 1,100 words is more than 130% of 800.
    assert.strictEqual(short(11).passed, false)
  })

  it('asks for the search intent, the image alt text and an internal link', () => {
    const findings = runSeoChecks(
      good({
        searchIntent: '',
        featuredImage: { alt: '' },
        internalLinkHosts: ['northwind.test']
      })
    )
    const failed = Object.fromEntries(
      findings.filter(f => !f.passed).map(f => [f.rule, f.message])
    )
    assert.ok(failed.seo_intent, 'intent')
    assert.ok(failed.seo_featured_image, 'image alt')
    assert.ok(failed.seo_internal_links, 'internal link')
    const fine = runSeoChecks(
      good({
        searchIntent: 'informational',
        featuredImage: { alt: 'A cart left in a shop aisle' },
        internalLinkHosts: ['example.com']
      })
    )
    assert.deepStrictEqual(fine.filter(f => !f.passed), [])
  })

  it('wants alt text on every diagram', () => {
    const withDiagram = good({
      content: {
        ...good().content,
        content: [
          ...good().content.content,
          {
            type: 'diagram',
            attrs: {
              kind: 'flow',
              title: 'Steps',
              items: ['a', 'b'],
              values: [],
              unit: '',
              caption: '',
              alt: '',
              sourceId: ''
            }
          }
        ]
      }
    })
    assert.strictEqual(finding(withDiagram, 'seo_figure_alt')?.passed, false)
  })

  it('checks the FAQ only when it was asked for', () => {
    assert.strictEqual(
      finding(good({ faqWanted: false, faq: [] }), 'seo_faq'),
      undefined
    )
    const f = finding(good({ faq: good().faq.slice(0, 2) }), 'seo_faq')!
    assert.strictEqual(f.passed, false)
  })

  it('names secondary keywords not used yet', () => {
    const f = finding(
      good({ keywords: ['checkout design', 'abandoned cart email'] }),
      'seo_secondary_keywords'
    )!
    assert.strictEqual(f.passed, false)
    assert.ok(f.message.includes('"abandoned cart email"'), f.message)
    assert.ok(!f.message.includes('"checkout design"'), f.message)
  })

  it('skips keyword checks without a keyword', () => {
    const rules = runSeoChecks(good({ primaryKeyword: '' })).map(f => f.rule)
    for (const rule of [
      'seo_title_keyword',
      'seo_meta_title_keyword',
      'seo_meta_description_keyword',
      'seo_keyword_intro',
      'seo_keyword_heading',
      'seo_keyword_density'
    ]) {
      assert.ok(!rules.includes(rule), rule)
    }
  })

  it('checks the slug format', () => {
    assert.strictEqual(
      finding(good({ slug: 'Cart_Abandonment' }), 'seo_slug')!.passed,
      false
    )
    assert.strictEqual(
      finding(good({ slug: 'seven-fixes' }), 'seo_slug')!.passed,
      false
    )
  })

  it('accepts slugs and keywords in other scripts', () => {
    const f = finding(
      good({ primaryKeyword: 'ई-कॉमर्स', slug: 'भारत-में-ई-कॉमर्स' }),
      'seo_slug'
    )!
    assert.strictEqual(f.passed, true, f.message)
  })

  it('wants a linked source when research was used', () => {
    const unlinked = good({
      content: doc(
        para(
          `Cart abandonment is the gap between interest and a sale. ${filler(90)}`
        )
      )
    })
    assert.strictEqual(finding(unlinked, 'seo_citations')!.passed, false)
    assert.strictEqual(
      finding({ ...unlinked, researchUsed: false }, 'seo_citations'),
      undefined
    )
  })
})

describe('keyword matching', () => {
  it('matches keywords case-insensitively, hyphenated, plural and in any script', () => {
    assert.strictEqual(
      containsKeyword('Fixing Cart Abandonments fast', 'cart abandonment'),
      true
    )
    assert.strictEqual(
      containsKeyword('cart-abandonment', 'cart abandonment'),
      true
    )
    assert.strictEqual(
      containsKeyword('abandonment of carts', 'cart abandonment'),
      false
    )
    assert.strictEqual(
      containsKeyword('carts abandonment', 'cart abandonment'),
      false
    )
    assert.strictEqual(
      containsKeyword('भारत में ई-कॉमर्स बढ़ रहा है', 'ई-कॉमर्स'),
      true
    )
  })

  it('reads a keyword with small joining words in it as the keyword, as search does', () => {
    // A live ERP piece wrote "B2B eCommerce and ERP" throughout and was told
    // the keyword "B2B eCommerce ERP" was nowhere in the text.
    assert.strictEqual(
      containsKeyword('Running B2B eCommerce and ERP apart', 'B2B eCommerce ERP'),
      true
    )
    assert.strictEqual(
      containsKeyword('a threshold for free shipping', 'free shipping threshold'),
      false
    )
    assert.strictEqual(
      containsKeyword('B2B eCommerce platforms and an ERP', 'B2B eCommerce ERP'),
      false
    )
  })
})

describe('the site in the search preview', () => {
  it("shows the identity's own host", () => {
    assert.strictEqual(
      searchResultHost('https://www.tdccommerce.com'),
      'tdccommerce.com'
    )
    assert.strictEqual(
      searchResultHost('shop.example.com/en/'),
      'shop.example.com'
    )
  })

  it('has none without a usable address', () => {
    assert.strictEqual(searchResultHost(null), null)
    assert.strictEqual(searchResultHost('  '), null)
    assert.strictEqual(searchResultHost('not a site'), null)
  })
})
