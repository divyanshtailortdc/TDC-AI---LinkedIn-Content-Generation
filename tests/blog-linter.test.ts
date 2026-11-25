import assert from 'node:assert'
import { describe, it } from 'node:test'
import type { BlogDoc } from '../src/lib/blogs/doc'
import {
  blockingFindings,
  runBlogLinter,
  type BlogLintOptions
} from '../src/lib/lint/blog-linter'

const docOf = (...paragraphs: string[]): BlogDoc => ({
  type: 'doc',
  content: paragraphs.map(text => ({
    type: 'paragraph' as const,
    content: [{ type: 'text' as const, text }]
  }))
})
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `word${i % 40}`).join(' ')

const lint = (overrides: Partial<BlogLintOptions>) =>
  runBlogLinter({
    title: 'Title',
    content: docOf('Text.'),
    faq: [],
    ...overrides
  })
const ruleOf = (findings: ReturnType<typeof lint>, rule: string) =>
  findings.find(f => f.rule === rule)

describe('blog truth and writing checks', () => {
  it('flags a figure that is not in the sources', () => {
    const f = ruleOf(
      lint({
        content: docOf('83% of carts are abandoned.'),
        figureSources: 'Shopify says 70% of carts are abandoned.'
      }),
      'unsupported_figures'
    )!
    assert.strictEqual(f.passed, false)
    assert.strictEqual(f.severity, 'error')
    assert.ok(f.message.includes('"83%"'), f.message)
  })

  it('accepts a figure that is in the sources', () => {
    const f = ruleOf(
      lint({
        content: docOf('About 70% of carts are abandoned.'),
        figureSources: 'Shopify says 70% of carts are abandoned.'
      }),
      'unsupported_figures'
    )!
    assert.strictEqual(f.passed, true)
  })

  it('skips the figure check without sources to check against', () => {
    assert.strictEqual(
      ruleOf(lint({ content: docOf('83% of carts.') }), 'unsupported_figures'),
      undefined
    )
  })

  it('treats a banned topic as blocking', () => {
    const findings = lint({
      content: docOf('Politics shapes what shoppers pay.'),
      bannedTopics: ['politics']
    })
    assert.deepStrictEqual(
      blockingFindings(findings).map(f => f.rule),
      ['banned_topics']
    )
  })

  it('warns on banned words, in the FAQ too', () => {
    const f = ruleOf(
      lint({ faq: [{ question: 'Why?', answer: 'We delve into it.' }] }),
      'banned_words'
    )!
    assert.strictEqual(f.passed, false)
    assert.strictEqual(f.severity, 'warning')
    assert.deepStrictEqual(
      blockingFindings(
        lint({ faq: [{ question: 'Why?', answer: 'We delve into it.' }] })
      ),
      []
    )
  })

  it('scales writing-habit allowances with length', () => {
    const frames = Array.from(
      { length: 5 },
      () => `It's not a tool. It's a habit. ${filler(70)}`
    )
    const short = lint({ content: docOf(...frames, filler(15)) })
    assert.strictEqual(ruleOf(short, 'contrast_overuse')?.passed, false)
    const long = lint({ content: docOf(...frames, filler(1115)) })
    assert.strictEqual(ruleOf(long, 'contrast_overuse'), undefined)
  })

  it('flags vague attribution', () => {
    const f = ruleOf(
      lint({ content: docOf('Studies show that carts get abandoned.') }),
      'vague_attribution'
    )!
    assert.strictEqual(f.passed, false)
  })

  it('flags two paragraphs that say the same thing', () => {
    const point =
      'Shoppers abandon carts when shipping costs appear late in checkout, because surprise fees break trust and make the total feel unfair to them today'
    const f = ruleOf(
      lint({ content: docOf(point, `${point} again`) }),
      'repeated_paragraphs'
    )!
    assert.strictEqual(f.passed, false)
  })

  it('flags Markdown left in the text', () => {
    assert.strictEqual(
      ruleOf(
        lint({ content: docOf('## Heading in a paragraph') }),
        'no_markdown_leakage'
      )?.passed,
      false
    )
  })
})

describe('pitch and citation checks', () => {
  it('warns when the piece reads like a sales pitch', () => {
    const paragraphs = [
      'Northwind Kit makes checkout simple.',
      'With Northwind Kit, stock is always right.',
      'Northwind Kit connects to your bank.',
      'Buyers leave when fees surprise them.',
      'Short forms help on phones.',
      'Northwind Kit also sends reminders.'
    ]
    const findings = lint({ content: docOf(...paragraphs), brandNames: ['Northwind Kit'], searchIntent: 'informational' })
    const pitch = ruleOf(findings, 'product_share')!
    assert.strictEqual(pitch.passed, false)
    assert.match(pitch.message, /4 of 6 paragraphs/)
    const commercial = lint({
      content: docOf(...paragraphs.slice(1, 6), 'Shipping costs matter.', 'Returns too.'),
      brandNames: ['Northwind Kit'],
      searchIntent: 'commercial'
    })
    assert.strictEqual(ruleOf(commercial, 'product_share')?.passed, true)
  })

  it('makes a figure from the wrong source blocking', () => {
    const findings = lint({
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '40% of carts are abandoned, says ' },
              { type: 'text', text: 'the study', marks: [{ type: 'link', attrs: { href: 'https://a.example/s' } }] },
              { type: 'text', text: '.' }
            ]
          }
        ]
      },
      figureSources: '40% of carts are abandoned. 70% of carts are abandoned.',
      citations: {
        sources: [
          { id: 'S1', origin: 'web', title: 'Study', url: 'https://a.example/s', quote: '70% of carts are abandoned.', cited: true },
          { id: 'S2', origin: 'web', title: 'Other', url: 'https://b.example/o', quote: '40% of carts are abandoned.', cited: true }
        ],
        authorText: ''
      }
    })
    const finding = ruleOf(findings, 'citation_figure')!
    assert.strictEqual(finding.passed, false)
    assert.strictEqual(finding.severity, 'error')
    assert.ok(blockingFindings(findings).some(f => f.rule === 'citation_figure'))
  })
})

describe('hypothetical examples', () => {
  it('does not treat the numbers in a hypothetical example as invented facts', () => {
    const findings = lint({
      content: {
        type: 'doc',
        content: [
          {
            type: 'callout',
            attrs: { variant: 'example' },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Say a shop loses about 20% of its carts at shipping.' }]
              }
            ]
          }
        ]
      },
      figureSources: 'Fees drive abandonment.'
    })
    assert.strictEqual(ruleOf(findings, 'unsupported_figures')?.passed, true)
  })
})
