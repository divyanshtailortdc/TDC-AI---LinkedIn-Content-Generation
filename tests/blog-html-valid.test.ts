import assert from 'node:assert'
import { describe, it } from 'node:test'
import { HtmlValidate, type Message } from 'html-validate'
import type { BlogDoc } from '../src/lib/blogs/doc'
import { blogArticleHtml, blogJsonLd, blogToStandaloneHtml } from '../src/lib/blogs/render'
import type { BlogContent } from '../src/lib/blogs/types'

/**
 * Every export a blog leaves the app as must be valid HTML: the standalone
 * page as a whole document, and the article body (Copy HTML, Copy formatted,
 * the preview) inside one. The fixture holds every kind of block a blog can.
 */

const text = (value: string, marks?: Array<{ type: 'bold' } | { type: 'italic' } | { type: 'link'; attrs: { href: string } }>) =>
  marks ? { type: 'text' as const, text: value, marks } : { type: 'text' as const, text: value }

const para = (value: string) => ({ type: 'paragraph' as const, content: [text(value)] })

const CONTENT: BlogDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        text('ERP integration is the link between systems, as '),
        text('Sana Commerce', [{ type: 'link', attrs: { href: 'https://www.sana-commerce.com/report' } }]),
        text(' reports, with '),
        text('bold', [{ type: 'bold' }]),
        text(' and '),
        text('italic & <angle> "quotes"', [{ type: 'italic' }]),
        { type: 'hardBreak' },
        text('after a break.')
      ]
    },
    { type: 'callout', attrs: { variant: 'takeaways' }, content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [para('One')] }, { type: 'listItem', content: [para('Two')] }] }] },
    { type: 'heading', attrs: { level: 2 }, content: [text('How does ERP integration work?')] },
    para('It connects the ERP to the store so each order exists once.'),
    { type: 'image', attrs: { imageId: 'pic-1', alt: 'A picker scanning a shelf', caption: 'Counts start on the shelf.' } },
    { type: 'heading', attrs: { level: 3 }, content: [text('In detail')] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [para('Third'), { type: 'bulletList', content: [{ type: 'listItem', content: [para('Nested')] }] }] }] },
    { type: 'blockquote', content: [para('A quotation, word for word.')] },
    { type: 'horizontalRule' },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [para('Option')] }, { type: 'tableHeader', content: [para('Cost')] }] },
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [para('Unified')] }, { type: 'tableCell', content: [para('Lower')] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [para('Both need training.')] }] }
      ]
    },
    { type: 'callout', attrs: { variant: 'example' }, content: [para('Say, 200 orders a day.')] },
    { type: 'callout', attrs: { variant: 'tip' }, content: [para('Start small.')] },
    { type: 'callout', attrs: { variant: 'warning' }, content: [para('Watch the data.')] },
    { type: 'callout', attrs: { variant: 'note' }, content: [para('A note.')] },
    { type: 'diagram', attrs: { kind: 'flow', title: 'One order', items: ['Order placed', 'Stock checked', 'Shipped'], values: [], unit: '', caption: 'How one order moves.', alt: 'Three steps of an order', sourceId: '' } },
    { type: 'diagram', attrs: { kind: 'timeline', title: 'History', items: ['2019 — first store', '2024 — unified'], values: [], unit: '', caption: '', alt: 'Two dated steps', sourceId: '' } },
    { type: 'diagram', attrs: { kind: 'bar', title: 'Buyers', items: ['Live stock', 'Prices'], values: [46, 38], unit: '%', caption: 'What buyers want.', alt: 'Two bars', sourceId: 'S1' } },
    { type: 'heading', attrs: { level: 2 }, content: [text('What to do next')] },
    para('Book a walkthrough.')
  ]
}

const BLOG: BlogContent = {
  kind: 'article',
  title: 'ERP integration explained: what changes for distributors',
  slug: 'erp-integration-explained',
  metaTitle: 'ERP integration explained for distributors',
  metaDescription: 'What ERP integration is, how it works and what it changes for distributors that sell online, with sources.',
  primaryKeyword: 'ERP integration',
  keywords: ['B2B ordering'],
  searchIntent: 'informational',
  content: CONTENT,
  faq: [{ question: 'Is ERP integration expensive?', answer: 'It depends on how many systems are involved & who maintains them.' }],
  sources: [
    { id: 'S1', origin: 'web', title: 'B2B buyer report', url: 'https://www.sana-commerce.com/report', publisher: 'Sana Commerce', quote: '46% want live stock.', publishedAt: '2024-09-01', cited: true }
  ],
  featuredImage: { src: 'data:image/webp;base64,AAAA', alt: 'A loading dock at dawn', caption: 'Orders leave from here.', width: 1600, height: 900 },
  verification: null,
  images: { 'pic-1': { src: 'data:image/webp;base64,BBBB', width: 1200, height: 800 } },
  entities: [{ name: 'Sana Commerce', type: 'organization', note: 'B2B eCommerce vendor', sourceId: 'S1' }],
  mainEntity: 'Sana Commerce'
}

const META = {
  siteName: 'Northwind Studio',
  author: { name: 'Northwind Studio', url: 'https://northwind.example/', type: 'Organization' as const },
  publishedUrl: 'https://northwind.example/blog/erp-integration-explained',
  datePublished: '2026-11-20T10:00:00.000Z',
  dateModified: '2026-11-26T10:00:00.000Z',
  diagramColor: '#0f766e'
}

const validator = new HtmlValidate({
  extends: ['html-validate:recommended'],
  rules: {
    // Diagrams are drawn as inline SVG with presentation styles of their own.
    'no-inline-style': 'off',
    // Long words in data URLs and titles are fine in generated markup.
    'long-title': 'off'
  }
})

const problems = (messages: Message[]) =>
  messages.map(m => `${m.ruleId}: ${m.message} (line ${m.line}:${m.column}) ${m.selector ?? ''}`)

describe('the HTML a blog leaves as', () => {
  it('is a valid, complete page', async () => {
    const page = blogToStandaloneHtml(BLOG, META)
    const report = await validator.validateString(page)
    assert.deepStrictEqual(problems(report.results[0]?.messages ?? []), [])
  })

  it('is a valid article body for a CMS', async () => {
    const body = blogArticleHtml(BLOG, { newTab: true })
    const page = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Body</title></head><body><main><article>${body}</article></main></body></html>`
    const report = await validator.validateString(page)
    assert.deepStrictEqual(problems(report.results[0]?.messages ?? []), [])
  })

  it('carries structured data search engines accept', () => {
    const [main, faq] = blogJsonLd(BLOG, { ...META, featuredImageUrl: 'https://northwind.example/img/dock.webp' }) as Array<Record<string, unknown>>
    assert.strictEqual(main!['@type'], 'Article')
    assert.ok(String(main!.headline).length <= 110)
    assert.deepStrictEqual(main!.image, ['https://northwind.example/img/dock.webp'])
    assert.deepStrictEqual(main!.author, { '@type': 'Organization', name: 'Northwind Studio', url: 'https://northwind.example/' })
    assert.ok(!Number.isNaN(Date.parse(String(main!.datePublished))))
    assert.ok(!Number.isNaN(Date.parse(String(main!.dateModified))))
    assert.strictEqual((main!.about as { name: string }).name, 'Sana Commerce')
    assert.strictEqual(faq!['@type'], 'FAQPage')
    // No FAQ on the page: no FAQPage.
    assert.strictEqual(blogJsonLd({ ...BLOG, faq: [] }, META).length, 1)
  })
})
