import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  applySentenceFixes,
  checkCitations,
  citedClaims,
  docSentences,
  unlinkSentences,
  wholeSentence
} from '../src/lib/blogs/citations'
import { docLinks, docText, type BlogBlock, type BlogDoc, type BlogInline } from '../src/lib/blogs/doc'
import type { BlogSource } from '../src/lib/blogs/types'

const GARTNER = 'https://www.gartner.com/en/newsroom/rep-free'
const MCKINSEY = 'https://www.mckinsey.com/b2b-growth'

const SOURCES: BlogSource[] = [
  {
    id: 'S1',
    origin: 'web',
    title: 'Gartner sales survey',
    url: GARTNER,
    quote: '61% of B2B buyers prefer an overall rep-free buying experience.',
    cited: true
  },
  {
    id: 'S2',
    origin: 'web',
    title: 'The economics of B2B growth',
    url: MCKINSEY,
    quote: 'Seventy-one percent of B2B companies now offer e-commerce.',
    quotes: [
      'Seventy-one percent of B2B companies now offer e-commerce.',
      'Roughly one-third of revenue now flows through digital channels.'
    ],
    cited: true
  }
]

const text = (value: string): BlogInline => ({ type: 'text', text: value })
const link = (value: string, href: string): BlogInline => ({
  type: 'text',
  text: value,
  marks: [{ type: 'link', attrs: { href } }]
})
const p = (...content: BlogInline[]): BlogBlock => ({ type: 'paragraph', content })
const doc = (...content: BlogBlock[]): BlogDoc => ({ type: 'doc', content })
const example = (...content: BlogBlock[]): BlogBlock => ({
  type: 'callout',
  attrs: { variant: 'example' },
  content
})

describe('sentences and their citations', () => {
  it('splits paragraphs into sentences, each with the links inside it', () => {
    const sentences = docSentences(
      doc(
        p(
          text('McKinsey reports in '),
          link('its analysis', MCKINSEY),
          text(' that 71% of B2B companies offer e-commerce. Gartner found that '),
          link('61% of buyers', GARTNER),
          text(' prefer rep-free buying.')
        )
      )
    )
    assert.deepStrictEqual(
      sentences.map(s => [s.text, s.links]),
      [
        ['McKinsey reports in its analysis that 71% of B2B companies offer e-commerce.', [MCKINSEY]],
        ['Gartner found that 61% of buyers prefer rep-free buying.', [GARTNER]]
      ]
    )
  })

  it('lists each linked sentence as a claim on its source', () => {
    const claims = citedClaims(
      doc(
        p(text('Buyers moved online, says '), link('Gartner', GARTNER), text('.')),
        p(text('Read '), link('our guide', 'https://own.example/guide'), text('.'))
      ),
      SOURCES
    )
    assert.deepStrictEqual(claims, [
      { id: 'C1', sentence: 'Buyers moved online, says Gartner.', sourceId: 'S1' }
    ])
  })
})

describe('checking citations without a model', () => {
  it('a figure must come from the source its sentence links', () => {
    const wrong = checkCitations({
      doc: doc(p(text('71% of B2B companies offer e-commerce, says '), link('Gartner', GARTNER), text('.'))),
      sources: SOURCES,
      authorText: ''
    })
    assert.deepStrictEqual(wrong, [
      {
        rule: 'figure_not_in_source',
        sentence: '71% of B2B companies offer e-commerce, says Gartner.',
        sourceId: 'S1',
        figures: ['71%']
      }
    ])
    const right = checkCitations({
      doc: doc(p(text('71% of B2B companies offer e-commerce, says '), link('McKinsey', MCKINSEY), text('.'))),
      sources: SOURCES,
      authorText: ''
    })
    assert.deepStrictEqual(right, [])
  })

  it('asks for the citation of a figure a source gives', () => {
    const problems = checkCitations({
      doc: doc(p(text('61% of B2B buyers prefer rep-free buying. We serve over 1,200 shops.'))),
      sources: SOURCES,
      authorText: 'Northwind serves over 1,200 shops.'
    })
    assert.deepStrictEqual(problems, [
      {
        rule: 'uncited_figure',
        sentence: '61% of B2B buyers prefer rep-free buying.',
        figures: ['61%']
      }
    ])
  })

  it('flags order numbers and clock times outside an example box, not inside one', () => {
    const outside = checkCitations({
      doc: doc(p(text('Our demo order #1048 was confirmed at 10:24 AM.'))),
      sources: SOURCES,
      authorText: ''
    })
    assert.deepStrictEqual(
      outside.map(p => [p.rule, p.figures]),
      [['unlabelled_specific', ['#1048', '10:24']]]
    )
    const inside = checkCitations({
      doc: doc(example(p(text('Say order #1048 is confirmed at 10:24 AM.')))),
      sources: SOURCES,
      authorText: ''
    })
    assert.deepStrictEqual(inside, [])
  })

  it("checks a chart's values against its source", () => {
    const problems = checkCitations({
      doc: doc({
        type: 'diagram',
        attrs: {
          kind: 'bar',
          title: 'Rep-free preference',
          items: ['2025', '2023'],
          values: [61, 43],
          unit: '%',
          caption: '',
          alt: '',
          sourceId: 'S1'
        }
      }),
      sources: SOURCES,
      authorText: ''
    })
    assert.deepStrictEqual(problems, [
      {
        rule: 'chart_value_not_in_source',
        sentence: 'Rep-free preference',
        sourceId: 'S1',
        figures: ['43%']
      }
    ])
  })
})

describe('changing sentences', () => {
  it("takes a link off a sentence and keeps its words", () => {
    const before = doc(
      p(text('Buyers prefer it, says '), link('Gartner', GARTNER), text('. Next sentence '), link('stays', GARTNER), text('.'))
    )
    const { doc: after, removed } = unlinkSentences(before, [
      { sentence: 'Buyers prefer it, says Gartner.', url: GARTNER }
    ])
    assert.strictEqual(removed, 1)
    assert.strictEqual(docText(after), docText(before))
    const [paragraph] = after.content
    assert.ok(paragraph?.type === 'paragraph')
    // The unlinked words merge into plain text; the other sentence keeps its link.
    assert.deepStrictEqual(paragraph.content, [
      text('Buyers prefer it, says Gartner. Next sentence '),
      link('stays', GARTNER),
      text('.')
    ])
  })

  it('replaces a failing sentence, drops another and keeps the rest with its links', () => {
    const before = doc(
      p(
        text('Opening line. 71% of companies use it, says '),
        link('Gartner', GARTNER),
        text('. Closing line with '),
        link('a link', MCKINSEY),
        text('.')
      ),
      p(text('Delete me entirely.')),
      p(text('Last paragraph.'))
    )
    const result = applySentenceFixes(
      { doc: before, faq: [{ question: 'Q?', answer: 'An answer. A wrong claim.' }] },
      [
        {
          sentence: '71% of companies use it, says Gartner.',
          replacement: 'Most B2B companies [sell online](https://www.mckinsey.com/b2b-growth).'
        },
        { sentence: 'Delete me entirely.', replacement: '' },
        { sentence: 'A wrong claim.', replacement: '' },
        { sentence: 'Not in the piece.', replacement: 'x' }
      ],
      url => url.startsWith('https://www.mckinsey.com/')
    )
    assert.strictEqual(
      docText(result.doc),
      'Opening line. Most B2B companies sell online. Closing line with a link.\n\nLast paragraph.'
    )
    assert.deepStrictEqual(docLinks(result.doc), [MCKINSEY])
    assert.deepStrictEqual(result.faq, [{ question: 'Q?', answer: 'An answer.' }])
    assert.deepStrictEqual(result.missed, ['Not in the piece.'])
  })

  it('refuses a link the replacement may not carry', () => {
    const result = applySentenceFixes(
      { doc: doc(p(text('Old claim.'))), faq: [] },
      [{ sentence: 'Old claim.', replacement: 'New [claim](https://evil.example/).' }],
      () => false
    )
    assert.strictEqual(docText(result.doc), 'New claim.')
    assert.deepStrictEqual(result.removedLinks, ['https://evil.example/'])
  })
})

describe('whole sentences only', () => {
  it('leaves a sentence alone when a fix names only part of it', () => {
    const before = doc(p(text('Separately, a survey found 39% of buyers spend more online. Next sentence.')))
    const result = applySentenceFixes(
      { doc: before, faq: [] },
      [{ sentence: '39% of buyers spend more online.', replacement: '' }],
      () => true
    )
    assert.strictEqual(docText(result.doc), docText(before))
    assert.deepStrictEqual(result.missed, ['39% of buyers spend more online.'])
  })

  it('finds the whole sentence a quoted fragment belongs to', () => {
    const d = doc(p(text('Separately, a survey found 39% of buyers spend more online. Next sentence.')))
    assert.strictEqual(
      wholeSentence(d, '39% of buyers spend  more online.'),
      'Separately, a survey found 39% of buyers spend more online.'
    )
    assert.strictEqual(wholeSentence(d, 'Next sentence.'), 'Next sentence.')
    assert.strictEqual(wholeSentence(d, 'Not in the piece.'), null)
  })
})
