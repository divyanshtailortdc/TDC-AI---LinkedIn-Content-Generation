import { getSchema } from '@tiptap/react'
import assert from 'node:assert'
import { describe, it } from 'node:test'
import { docFromDraft, MARK_ORDER, sanitizeDoc } from '../src/lib/blogs/doc'
import {
  blogEditorExtensions,
  tidyPastedHtml
} from '../src/lib/blogs/editor-extensions'

const DRAFT = {
  introduction: [
    'Intro with **bold**, *italic* and [a link](https://example.com/a).'
  ],
  sections: [
    {
      heading: 'A section',
      blocks: [
        { type: 'paragraph' as const, text: 'Body.' },
        { type: 'subheading' as const, text: 'A detail' },
        { type: 'bullets' as const, items: ['one', 'two'] },
        { type: 'numbered' as const, items: ['first'] },
        { type: 'quote' as const, text: 'Quoted.' },
        {
          type: 'table' as const,
          columns: ['Option', 'Sync'],
          rows: [['Store', '[Hourly](https://example.com/h)']]
        },
        {
          type: 'example' as const,
          title: 'A Monday order',
          paragraphs: ['A buyer orders at 10:24.']
        },
        { type: 'callout' as const, variant: 'tip', text: 'Check stock first.' },
        {
          type: 'diagram' as const,
          diagram: 'bar',
          title: 'Buyers',
          items: ['2023', '2025'],
          values: [43, 61],
          unit: '%',
          sourceId: 'S1'
        }
      ]
    }
  ],
  keyTakeaways: ['One.', 'Two.', 'Three.'],
  conclusion: { heading: 'Next', paragraphs: ['Close.'] }
}

describe('the blog editor', () => {
  it('can hold nothing the sanitizer refuses', () => {
    const schema = getSchema(blogEditorExtensions())
    assert.deepStrictEqual(Object.keys(schema.nodes).sort(), [
      'blockquote',
      'bulletList',
      'callout',
      'diagram',
      'doc',
      'hardBreak',
      'heading',
      'horizontalRule',
      'image',
      'listItem',
      'orderedList',
      'paragraph',
      'table',
      'tableCell',
      'tableHeader',
      'tableRow',
      'text'
    ])
    assert.deepStrictEqual(Object.keys(schema.marks).sort(), [
      'bold',
      'italic',
      'link'
    ])
  })

  it('opens every generated document, tables, boxes and diagrams included', () => {
    const { doc } = docFromDraft(DRAFT, null)
    const schema = getSchema(blogEditorExtensions())
    const node = schema.nodeFromJSON(doc)
    assert.doesNotThrow(() => node.check())
    // What the editor gives back is what was stored.
    assert.deepStrictEqual(sanitizeDoc(node.toJSON()), { ok: true, doc })
  })

  it('keeps a table with merged cells and lists, and the sanitizer accepts it', () => {
    const schema = getSchema(blogEditorExtensions())
    const paragraph = (text: string) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }]
    })
    const table = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', attrs: { colspan: 2 }, content: [paragraph('Plan')] }
              ]
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Pasted heading' }] }
                  ]
                },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'bulletList',
                      content: [{ type: 'listItem', content: [paragraph('Item')] }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
    const node = schema.nodeFromJSON(table)
    assert.doesNotThrow(() => node.check())
    const saved = sanitizeDoc(node.toJSON())
    assert.strictEqual(saved.ok, true, JSON.stringify(saved))
  })

  it('round-trips a box and a diagram with its data', () => {
    const schema = getSchema(blogEditorExtensions())
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { variant: 'example' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A buyer.' }] }]
        },
        {
          type: 'diagram',
          attrs: {
            kind: 'flow',
            title: 'Order to cash',
            items: ['Order', 'Ship'],
            values: [],
            unit: '',
            caption: 'One record.',
            alt: 'Two steps',
            sourceId: ''
          }
        }
      ]
    }
    const back = schema.nodeFromJSON(doc).toJSON()
    assert.deepStrictEqual(sanitizeDoc(back), { ok: true, doc })
  })
})

describe('pasting into the blog editor', () => {
  it('keeps pasted tables as tables', () => {
    const html = '<table><tr><td>cell one</td><th>cell two</th></tr></table>'
    assert.strictEqual(tidyPastedHtml(html), html)
  })
})

describe('mark order', () => {
  it("is the editor schema's own rank order", () => {
    assert.deepStrictEqual(
      Object.keys(getSchema(blogEditorExtensions()).marks),
      [...MARK_ORDER]
    )
  })
})
