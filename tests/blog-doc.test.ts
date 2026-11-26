import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  blockText,
  blogWordCount,
  CALLOUT_LABELS,
  countWords,
  docFromDraft,
  docLinks,
  docOutline,
  docSections,
  docSignature,
  inlineFromMarkup,
  inlineText,
  plainDoc,
  replaceSection,
  sanitizeDoc,
  slugify,
  type BlogBlock,
  type BlogDoc
} from '../src/lib/blogs/doc'
import { cleanDiagram, diagramDescription } from '../src/lib/blogs/diagram'
import { isGenerationStale } from '../src/lib/blogs/types'

const text = (value: string) => ({ type: 'text' as const, text: value })
const p = (value: string): BlogBlock => ({
  type: 'paragraph',
  content: [text(value)]
})
const h = (level: 2 | 3, value: string): BlogBlock => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)]
})
const doc = (...content: BlogBlock[]): BlogDoc => ({ type: 'doc', content })

describe('model text to a document', () => {
  it('parses bold, italic and links in model text', () => {
    const { nodes, removedLinks } = inlineFromMarkup(
      'Read **this** and *that* at [the guide](https://example.com/g).',
      url => url === 'https://example.com/g'
    )
    assert.deepStrictEqual(nodes, [
      { type: 'text', text: 'Read ' },
      { type: 'text', text: 'this', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'that', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' at ' },
      {
        type: 'text',
        text: 'the guide',
        marks: [{ type: 'link', attrs: { href: 'https://example.com/g' } }]
      },
      { type: 'text', text: '.' }
    ])
    assert.deepStrictEqual(removedLinks, [])
  })

  it('turns a link that is not allowed into plain text', () => {
    const { nodes, removedLinks } = inlineFromMarkup(
      'See [this](https://evil.test/x).',
      () => false
    )
    assert.strictEqual(inlineText(nodes), 'See this.')
    assert.ok(nodes.every(n => n.type !== 'text' || !n.marks?.length))
    assert.deepStrictEqual(removedLinks, ['https://evil.test/x'])
  })

  it('never keeps an unsafe link, even when every link is allowed', () => {
    const { nodes, removedLinks } = inlineFromMarkup(
      'Click [me](javascript:alert(1)) now',
      null
    )
    assert.ok(nodes.every(n => n.type !== 'text' || !n.marks?.length))
    assert.strictEqual(removedLinks.length, 1)
  })

  it('does not read snake_case words as italic', () => {
    const { nodes } = inlineFromMarkup('Set max_retries_count to 3.', null)
    assert.deepStrictEqual(nodes, [
      { type: 'text', text: 'Set max_retries_count to 3.' }
    ])
  })

  it('builds the introduction, H2 sections with H3, lists and a quote, then the conclusion', () => {
    const { doc: built } = docFromDraft(
      {
        introduction: ['Intro one.'],
        sections: [
          {
            heading: 'First point',
            blocks: [
              { type: 'paragraph', text: 'Para.' },
              { type: 'subheading', text: 'Detail' },
              { type: 'bullets', items: ['a', 'b'] },
              { type: 'numbered', items: ['one'] },
              { type: 'quote', text: 'Quoted.' }
            ]
          }
        ],
        conclusion: { heading: 'What to do next', paragraphs: ['Close.'] }
      },
      null
    )
    assert.deepStrictEqual(
      built.content.map(b => b.type),
      [
        'paragraph',
        'heading',
        'paragraph',
        'heading',
        'bulletList',
        'orderedList',
        'blockquote',
        'heading',
        'paragraph'
      ]
    )
    assert.deepStrictEqual(
      built.content.flatMap(b => (b.type === 'heading' ? [b.attrs.level] : [])),
      [2, 3, 2]
    )
    assert.deepStrictEqual(built.content.map(blockText), [
      'Intro one.',
      'First point',
      'Para.',
      'Detail',
      'a\nb',
      'one',
      'Quoted.',
      'What to do next',
      'Close.'
    ])
  })

  it('drops empty blocks and sections without a heading', () => {
    const { doc: built } = docFromDraft(
      {
        introduction: ['Intro.', '  '],
        sections: [
          { heading: '', blocks: [{ type: 'paragraph', text: 'Orphan.' }] },
          {
            heading: 'Kept',
            blocks: [
              { type: 'paragraph', text: '' },
              { type: 'bullets', items: ['', 'x'] },
              { type: 'quote', text: ' ' }
            ]
          }
        ],
        conclusion: { heading: '', paragraphs: ['Last.'] }
      },
      null
    )
    assert.deepStrictEqual(built.content.map(blockText), [
      'Intro.',
      'Kept',
      'x',
      'Last.'
    ])
  })
})

describe('sanitizing a document from the editor', () => {
  it('keeps a TipTap document and drops editor-only attributes', () => {
    const raw = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, id: 'x' },
          content: [{ type: 'text', text: 'Title' }]
        },
        {
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [
            { type: 'text', text: 'Go ', marks: [] },
            {
              type: 'text',
              text: 'here',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com',
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: null
                  }
                },
                { type: 'bold' }
              ]
            }
          ]
        },
        {
          type: 'orderedList',
          attrs: { start: 1, type: null },
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'one' }] }
              ]
            }
          ]
        },
        {
          type: 'orderedList',
          attrs: { start: 3, type: null },
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'three' }]
                }
              ]
            }
          ]
        },
        { type: 'paragraph' }
      ]
    }
    assert.deepStrictEqual(sanitizeDoc(raw), {
      ok: true,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Title' }]
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Go ' },
              {
                type: 'text',
                text: 'here',
                marks: [
                  { type: 'link', attrs: { href: 'https://example.com' } },
                  { type: 'bold' }
                ]
              }
            ]
          },
          {
            type: 'orderedList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'one' }]
                  }
                ]
              }
            ]
          },
          {
            type: 'orderedList',
            attrs: { start: 3 },
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'three' }]
                  }
                ]
              }
            ]
          },
          { type: 'paragraph' }
        ]
      }
    })
  })

  it('removes javascript: and data: links and unknown marks but keeps their text', () => {
    const result = sanitizeDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'bad',
              marks: [
                { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                { type: 'underline' }
              ]
            },
            {
              type: 'text',
              text: ' worse',
              marks: [
                { type: 'link', attrs: { href: 'data:text/html,<b>x</b>' } },
                { type: 'italic' }
              ]
            }
          ]
        }
      ]
    })
    assert.deepStrictEqual(result, {
      ok: true,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'bad' },
              { type: 'text', text: ' worse', marks: [{ type: 'italic' }] }
            ]
          }
        ]
      }
    })
  })

  it('refuses unknown nodes', () => {
    assert.deepStrictEqual(
      sanitizeDoc({
        type: 'doc',
        content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }]
      }),
      {
        ok: false,
        error: 'This document has content the editor cannot save (codeBlock).'
      }
    )
  })

  it('keeps a section picture by id, with its alt text and caption trimmed', () => {
    const result = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before.' }] },
        {
          type: 'image',
          attrs: { imageId: 'pic-1', alt: '  A loading dock  at dawn ', caption: 'Where orders leave.', src: 'ignored' }
        }
      ]
    })
    assert.ok(result.ok)
    if (!result.ok) return
    assert.deepStrictEqual(result.doc.content[1], {
      type: 'image',
      attrs: { imageId: 'pic-1', alt: 'A loading dock at dawn', caption: 'Where orders leave.' }
    })
  })

  it('leaves out a picture with no id, or one the blog does not have', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { imageId: '', alt: 'x' } },
        { type: 'image', attrs: { imageId: '../etc', alt: 'x' } },
        { type: 'image', attrs: { imageId: 'other-blog', alt: 'x' } },
        { type: 'image', attrs: { imageId: 'mine', alt: 'x' } }
      ]
    }
    const result = sanitizeDoc(doc, { imageIds: ['mine'] })
    assert.ok(result.ok)
    if (!result.ok) return
    assert.deepStrictEqual(
      result.doc.content.map(block => (block.type === 'image' ? block.attrs.imageId : block.type)),
      ['mine']
    )
  })

  it('drops a picture inside a box or a table cell, keeping the box', () => {
    const result = sanitizeDoc({
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { variant: 'tip' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Tip.' }] },
            { type: 'image', attrs: { imageId: 'pic-1', alt: 'x' } }
          ]
        }
      ]
    })
    assert.ok(result.ok)
    if (!result.ok) return
    assert.deepStrictEqual(result.doc.content[0], {
      type: 'callout',
      attrs: { variant: 'tip' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tip.' }] }]
    })
  })

  it('refuses headings other than H2 and H3', () => {
    const result = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('Big')] }
      ]
    })
    assert.strictEqual(result.ok, false)
  })

  it('refuses a list that holds something other than list items', () => {
    const result = sanitizeDoc({
      type: 'doc',
      content: [{ type: 'bulletList', content: [p('loose')] }]
    })
    assert.strictEqual(result.ok, false)
  })

  it('refuses something that is not a document', () => {
    assert.deepStrictEqual(sanitizeDoc(null), {
      ok: false,
      error: 'The document could not be read.'
    })
    assert.deepStrictEqual(sanitizeDoc({ type: 'paragraph', content: [] }), {
      ok: false,
      error: 'The document could not be read.'
    })
  })

  it('refuses a document over the size cap', () => {
    assert.deepStrictEqual(sanitizeDoc(doc(p('x'.repeat(400_001)))), {
      ok: false,
      error: 'This blog is too long to save.'
    })
  })
})

describe('words, outline and sections', () => {
  it('counts words in the document and the FAQ', () => {
    assert.strictEqual(
      blogWordCount(doc(p('One two three.')), [
        { question: 'Why four?', answer: 'Because five six.' }
      ]),
      8
    )
  })

  it('counts words in any script', () => {
    assert.strictEqual(countWords('भारत में ई-कॉमर्स तेज़ी से बढ़ रहा है'), 8)
    assert.strictEqual(countWords('Hello, world — 2026!'), 3)
  })

  it('outlines H2 and H3 with their section numbers', () => {
    assert.deepStrictEqual(
      docOutline(doc(p('intro'), h(2, 'A'), p('a'), h(3, 'A1'), h(2, 'B'))),
      [
        { level: 2, text: 'A', section: 1 },
        { level: 3, text: 'A1', section: 1 },
        { level: 2, text: 'B', section: 2 }
      ]
    )
  })

  it('splits a document into its introduction and sections', () => {
    const sections = docSections(
      doc(p('intro'), h(2, 'A'), p('a'), h(2, 'B'), p('b'))
    )
    assert.deepStrictEqual(
      sections.map(s => [s.index, s.heading, s.blocks.map(blockText)]),
      [
        [0, null, ['intro']],
        [1, 'A', ['A', 'a']],
        [2, 'B', ['B', 'b']]
      ]
    )
  })

  it('replaces one section and keeps the rest', () => {
    const before = doc(p('intro'), h(2, 'A'), p('a'), h(2, 'B'), p('b'))
    const after = replaceSection(before, 1, [h(2, 'A2'), p('new')])
    assert.deepStrictEqual(after.content.map(blockText), [
      'intro',
      'A2',
      'new',
      'B',
      'b'
    ])
    assert.deepStrictEqual(before.content.map(blockText), [
      'intro',
      'A',
      'a',
      'B',
      'b'
    ])
  })

  it('refuses a section that does not exist', () => {
    assert.throws(
      () => replaceSection(doc(p('intro'), h(2, 'A')), 9, []),
      RangeError
    )
  })
})

describe('slugs', () => {
  it('makes lowercase hyphenated slugs and folds accents', () => {
    assert.strictEqual(
      slugify('How to Cut Cart Abandonment in 2026: A Guide!'),
      'how-to-cut-cart-abandonment-in-2026-a-guide'
    )
    assert.strictEqual(slugify('Café Déjà Vu'), 'cafe-deja-vu')
  })

  it('keeps letters of other scripts', () => {
    assert.strictEqual(slugify('भारत में ई-कॉमर्स'), 'भारत-में-ई-कॉमर्स')
  })

  it('cuts long slugs at a word boundary', () => {
    const long = slugify('word '.repeat(40))
    assert.ok(long.length <= 75, long)
    assert.ok(!long.endsWith('-'))
    assert.ok(long.startsWith('word-word'))
  })
})

describe('stale generations', () => {
  it('knows when a generation went stale', () => {
    const started = new Date('2026-11-24T10:00:00Z')
    assert.strictEqual(
      isGenerationStale(
        { generationStatus: 'generating', generationStartedAt: started },
        started.getTime() + 479_000
      ),
      false
    )
    assert.strictEqual(
      isGenerationStale(
        { generationStatus: 'generating', generationStartedAt: started },
        started.getTime() + 481_000
      ),
      true
    )
    assert.strictEqual(
      isGenerationStale(
        { generationStatus: 'ready', generationStartedAt: started },
        started.getTime() + 999_999
      ),
      false
    )
  })
})

describe('telling documents apart', () => {
  it('gives the same signature whatever the key order and editor-only attributes', () => {
    const fromEditor = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [
            {
              type: 'text',
              text: 'Go',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com',
                    target: '_blank',
                    rel: null,
                    class: null
                  }
                }
              ]
            }
          ]
        }
      ]
    }
    // As jsonb gives it back: keys reordered, editor-only attributes gone.
    const fromDatabase = {
      content: [
        {
          content: [
            {
              marks: [{ attrs: { href: 'https://example.com' }, type: 'link' }],
              text: 'Go',
              type: 'text'
            }
          ],
          type: 'paragraph'
        }
      ],
      type: 'doc'
    }
    assert.strictEqual(docSignature(fromEditor), docSignature(fromDatabase))
    assert.notStrictEqual(docSignature(fromEditor), docSignature(doc(p('Go'))))
  })
})

describe('the editor document as plain data', () => {
  it('turns attribute objects without a prototype into plain objects', () => {
    // ProseMirror builds attrs with Object.create(null); a server action
    // cannot send those as data.
    const attrs = Object.assign(Object.create(null), { level: 2 })
    const linkAttrs = Object.assign(Object.create(null), {
      href: 'https://example.com'
    })
    const plain = plainDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs, content: [{ type: 'text', text: 'A' }] },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'link', attrs: linkAttrs }]
            }
          ]
        }
      ]
    })
    const heading = plain.content[0] as { attrs: object }
    assert.strictEqual(Object.getPrototypeOf(heading.attrs), Object.prototype)
    assert.deepStrictEqual(plain, {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'A' }]
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }]
            }
          ]
        }
      ]
    })
  })
})

describe('mark order and nesting', () => {
  const link = { type: 'link', attrs: { href: 'https://a.example' } }
  it("puts marks in the editor's order: link, bold, italic", () => {
    assert.deepStrictEqual(
      sanitizeDoc({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'italic' }, { type: 'bold' }, link]
              }
            ]
          }
        ]
      }),
      {
        ok: true,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'x',
                  marks: [link, { type: 'bold' }, { type: 'italic' }]
                }
              ]
            }
          ]
        }
      }
    )
    assert.deepStrictEqual(
      inlineFromMarkup('**[x](https://a.example)**', null).nodes,
      [{ type: 'text', text: 'x', marks: [link, { type: 'bold' }] }]
    )
  })

  it('gives the same signature whatever order the marks come in', () => {
    const withMarks = (marks: unknown[]) => ({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x', marks }] }
      ]
    })
    assert.strictEqual(
      docSignature(withMarks([{ type: 'bold' }, link])),
      docSignature(withMarks([link, { type: 'bold' }]))
    )
  })

  it('takes lists nested ten deep and names the problem past the limit', () => {
    const nested = (depth: number): BlogBlock =>
      depth === 0
        ? p('deep')
        : {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [p('item'), nested(depth - 1)] }
            ]
          }
    assert.strictEqual(sanitizeDoc(doc(nested(10))).ok, true)
    assert.deepStrictEqual(sanitizeDoc(doc(nested(17))), {
      ok: false,
      error:
        'Lists or quotes are nested too deeply to save. Move some items out a level.'
    })
  })
})

describe('tables, boxes and diagrams', () => {
  const allowOk = (url: string) => url.startsWith('https://ok.test/')
  const cellP = (value: string) => ({
    type: 'paragraph' as const,
    content: [text(value)]
  })

  it("builds a table from the model's columns and rows", () => {
    const { doc: built } = docFromDraft(
      {
        introduction: ['Intro.'],
        sections: [
          {
            heading: 'Compare',
            blocks: [
              {
                type: 'table',
                columns: ['Option', 'Sync'],
                rows: [
                  ['Separate store', 'Hourly [batch](https://ok.test/a)'],
                  ['One record']
                ]
              }
            ]
          }
        ]
      },
      allowOk
    )
    const table = built.content[2]
    assert.strictEqual(table?.type, 'table')
    if (table?.type !== 'table') return
    assert.strictEqual(table.content.length, 3)
    assert.deepStrictEqual(
      table.content[0]!.content.map(cell => cell.type),
      ['tableHeader', 'tableHeader']
    )
    assert.deepStrictEqual(table.content[0]!.content[0]!.content, [
      cellP('Option')
    ])
    // A short row is padded, so every row has every column.
    assert.strictEqual(table.content[2]!.content.length, 2)
    assert.deepStrictEqual(table.content[2]!.content[1]!.content, [
      { type: 'paragraph' }
    ])
    assert.deepStrictEqual(table.content[1]!.content[1]!.content, [
      {
        type: 'paragraph',
        content: [
          text('Hourly '),
          {
            type: 'text',
            text: 'batch',
            marks: [{ type: 'link', attrs: { href: 'https://ok.test/a' } }]
          }
        ]
      }
    ])
  })

  it('an example becomes a Hypothetical example box with its title in bold', () => {
    const { doc: built } = docFromDraft(
      {
        introduction: ['Intro.'],
        sections: [
          {
            heading: 'In practice',
            blocks: [
              {
                type: 'example',
                title: 'A Monday order',
                paragraphs: [
                  'A buyer orders at 10:24.',
                  'A rep sells the last unit at 10:40.'
                ]
              }
            ]
          }
        ]
      },
      null
    )
    assert.deepStrictEqual(built.content[2], {
      type: 'callout',
      attrs: { variant: 'example' },
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'A Monday order', marks: [{ type: 'bold' }] }]
        },
        cellP('A buyer orders at 10:24.'),
        cellP('A rep sells the last unit at 10:40.')
      ]
    })
    assert.strictEqual(CALLOUT_LABELS.example, 'Hypothetical example')
  })

  it('key takeaways sit after the introduction as a takeaways box', () => {
    const { doc: built } = docFromDraft(
      {
        introduction: ['Intro one.', 'Intro two.'],
        keyTakeaways: ['First point.', 'Second point.', 'Third point.'],
        sections: [{ heading: 'Body', blocks: [{ type: 'paragraph', text: 'Text.' }] }]
      },
      null
    )
    assert.deepStrictEqual(
      built.content.map(block => block.type),
      ['paragraph', 'paragraph', 'callout', 'heading', 'paragraph']
    )
    const box = built.content[2]
    assert.ok(box?.type === 'callout' && box.attrs.variant === 'takeaways')
    if (box?.type !== 'callout') return
    assert.strictEqual(box.content[0]?.type, 'bulletList')
  })

  it('keeps a valid diagram and drops one whose values do not match', () => {
    const { doc: built, dropped } = docFromDraft(
      {
        introduction: ['Intro.'],
        sections: [
          {
            heading: 'Flow',
            blocks: [
              {
                type: 'diagram',
                diagram: 'flow',
                title: ' Order to cash ',
                items: ['Order', 'Reserve stock', 'Ship', 'Invoice'],
                caption: 'One order, one record.',
                alt: 'Four steps from order to invoice'
              },
              {
                type: 'diagram',
                diagram: 'bar',
                title: 'Share',
                items: ['A', 'B'],
                values: [1]
              }
            ]
          }
        ]
      },
      null
    )
    const diagrams = built.content.filter(block => block.type === 'diagram')
    assert.strictEqual(diagrams.length, 1)
    assert.deepStrictEqual(diagrams[0], {
      type: 'diagram',
      attrs: {
        kind: 'flow',
        title: 'Order to cash',
        items: ['Order', 'Reserve stock', 'Ship', 'Invoice'],
        values: [],
        unit: '',
        caption: 'One order, one record.',
        alt: 'Four steps from order to invoice',
        sourceId: ''
      }
    })
    assert.strictEqual(dropped.length, 1)
    assert.match(dropped[0]!, /chart/i)
  })

  it('cleans diagram data and describes it', () => {
    assert.strictEqual(cleanDiagram({ kind: 'pie', items: ['a', 'b'] }), null)
    assert.strictEqual(cleanDiagram({ kind: 'flow', items: ['only one'] }), null)
    const bar = cleanDiagram({
      kind: 'bar',
      title: 'Buyers who prefer no rep',
      items: ['2023', '2025'],
      values: [43, 61],
      unit: '%',
      sourceId: 'S1'
    })
    assert.ok(bar)
    assert.strictEqual(
      diagramDescription(bar!),
      'Buyers who prefer no rep. 2023: 43%; 2025: 61%.'
    )
    const flow = cleanDiagram({ kind: 'flow', items: ['Order', 'Ship'] })
    assert.strictEqual(diagramDescription(flow!), 'Steps: 1. Order; 2. Ship.')
  })

  it('sanitizes pasted tables', () => {
    const result = sanitizeDoc({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  attrs: { colspan: 2, rowspan: 1, colwidth: [120, 80] },
                  content: [
                    { type: 'heading', attrs: { level: 2 }, content: [text('Plan')] }
                  ]
                }
              ]
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 1, rowspan: 99, colwidth: null },
                  content: [
                    {
                      type: 'table',
                      content: [
                        {
                          type: 'tableRow',
                          content: [
                            { type: 'tableCell', content: [cellP('Nested')] }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'bulletList',
                      content: [{ type: 'listItem', content: [cellP('Item')] }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
    assert.strictEqual(result.ok, true)
    if (!result.ok) return
    assert.deepStrictEqual(result.doc, {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  attrs: { colspan: 2 },
                  content: [cellP('Plan')]
                }
              ]
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [cellP('Nested')] },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'bulletList',
                      content: [{ type: 'listItem', content: [cellP('Item')] }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
  })

  it('sanitizes boxes: unknown variants become notes, headings become paragraphs', () => {
    const result = sanitizeDoc({
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { variant: 'shout', label: 'x' },
          content: [
            { type: 'heading', attrs: { level: 3 }, content: [text('Title')] },
            cellP('Body')
          ]
        }
      ]
    })
    assert.deepStrictEqual(result, {
      ok: true,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'callout',
            attrs: { variant: 'note' },
            content: [cellP('Title'), cellP('Body')]
          }
        ]
      }
    })
  })

  it('refuses an invalid diagram', () => {
    assert.deepStrictEqual(
      sanitizeDoc({
        type: 'doc',
        content: [{ type: 'diagram', attrs: { kind: 'pie', items: ['a', 'b'] } }]
      }),
      {
        ok: false,
        error: 'This document has content the editor cannot save (diagram).'
      }
    )
  })

  it('counts words in tables, boxes and diagrams', () => {
    const withAll = doc(
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [cellP('Two words')] },
              { type: 'tableHeader', content: [cellP('More words')] }
            ]
          }
        ]
      },
      {
        type: 'callout',
        attrs: { variant: 'tip' },
        content: [cellP('Three words here')]
      },
      {
        type: 'diagram',
        attrs: {
          kind: 'flow',
          title: 'Order flow',
          items: ['Order', 'Ship'],
          values: [],
          unit: '',
          caption: 'Caption',
          alt: '',
          sourceId: ''
        }
      }
    )
    assert.strictEqual(blogWordCount(withAll, []), 4 + 3 + 2 + 2 + 1)
    assert.strictEqual(blockText(withAll.content[0]!), 'Two words | More words')
  })

  it('finds links inside tables and boxes', () => {
    const linked = (href: string) => ({
      type: 'paragraph' as const,
      content: [
        {
          type: 'text' as const,
          text: 'x',
          marks: [{ type: 'link' as const, attrs: { href } }]
        }
      ]
    })
    const withLinks = doc(
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableCell', content: [linked('https://a.test/')] }]
          }
        ]
      },
      { type: 'callout', attrs: { variant: 'note' }, content: [linked('https://b.test/')] }
    )
    assert.deepStrictEqual(docLinks(withLinks), [
      'https://a.test/',
      'https://b.test/'
    ])
  })
})
