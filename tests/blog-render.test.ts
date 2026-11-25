import assert from 'node:assert'
import { describe, it } from 'node:test'
import { docFromDraft, type BlogDoc } from '../src/lib/blogs/doc'
import {
  blogArticleHtml,
  blogFileName,
  blogJsonLd,
  blogToMarkdown,
  blogToStandaloneHtml,
  blogToText,
  docToHtml,
  figureFiles,
  formatReference,
  referenceList
} from '../src/lib/blogs/render'
import type { BlogContent, BlogVerification } from '../src/lib/blogs/types'

const DRAFT = {
  introduction: ['Intro one.'],
  sections: [
    {
      heading: 'First point',
      blocks: [
        {
          type: 'paragraph' as const,
          text: 'Read [the guide](https://example.com/g) with **b** now.'
        },
        { type: 'subheading' as const, text: 'Detail' },
        { type: 'bullets' as const, items: ['a', 'b'] },
        { type: 'numbered' as const, items: ['one'] },
        { type: 'quote' as const, text: 'Quoted.' }
      ]
    }
  ],
  conclusion: { heading: 'What to do next', paragraphs: ['Close.'] }
}

function sample(overrides: Partial<BlogContent> = {}): BlogContent {
  return {
    kind: 'blog',
    title: 'How to X',
    slug: 'how-to-x',
    metaTitle: 'How to X in five steps',
    metaDescription: 'A short guide to X.',
    primaryKeyword: 'x',
    keywords: ['y'],
    searchIntent: '',
    content: docFromDraft(DRAFT, null).doc,
    featuredImage: null,
    verification: null,
    faq: [{ question: 'Why?', answer: 'Because.' }],
    sources: [
      {
        id: 'S1',
        origin: 'web',
        title: 'Guide title',
        url: 'https://example.com/g',
        quote: 'q',
        cited: true
      },
      {
        id: 'S2',
        origin: 'web',
        title: 'Unused page',
        url: 'https://example.com/u',
        quote: 'q',
        cited: false
      },
      {
        id: 'K1',
        origin: 'knowledge',
        title: 'Internal doc',
        url: null,
        quote: 'q',
        cited: true
      }
    ],
    ...overrides
  }
}

const textDoc = (text: string, marks?: unknown[]): BlogDoc =>
  ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          marks ? { type: 'text', text, marks } : { type: 'text', text }
        ]
      }
    ]
  }) as BlogDoc

describe('document to HTML', () => {
  it('renders headings, lists, quotes, marks and links', () => {
    const doc: BlogDoc = {
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
            { type: 'text', text: 'x ' },
            { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'i', marks: [{ type: 'italic' }] }
          ]
        },
        {
          type: 'bulletList',
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
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'two' }] }
              ]
            }
          ]
        },
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'q' }] }
          ]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            {
              type: 'text',
              text: 'here',
              marks: [
                { type: 'link', attrs: { href: 'https://example.com/a' } }
              ]
            }
          ]
        }
      ]
    }
    assert.strictEqual(
      docToHtml(doc),
      '<h2>A</h2><p>x <strong>b</strong> <em>i</em></p><ul><li>one</li></ul><ol><li>two</li></ol><blockquote><p>q</p></blockquote><p>see <a href="https://example.com/a" rel="noopener noreferrer">here</a></p>'
    )
  })

  it('escapes text and attributes', () => {
    const html = docToHtml({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '<script>alert(1)</script> & "x" ' },
            {
              type: 'text',
              text: 'link',
              marks: [
                { type: 'link', attrs: { href: 'https://a.test/?q="><img>' } }
              ]
            }
          ]
        }
      ]
    })
    assert.ok(
      html.includes(
        '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;'
      ),
      html
    )
    assert.ok(!html.includes('<script>'))
    assert.ok(!html.includes('<img'))
    assert.ok(
      html.includes('href="https://a.test/?q=&quot;&gt;&lt;img&gt;"'),
      html
    )
  })

  it('never renders an unsafe link', () => {
    const html = docToHtml(
      textDoc('click', [
        { type: 'link', attrs: { href: 'javascript:alert(1)' } }
      ])
    )
    assert.ok(!html.includes('href="javascript:'), html)
    assert.ok(html.includes('click'))
  })

  it('keeps an ordered list that starts later, and nested lists', () => {
    const html = docToHtml({
      type: 'doc',
      content: [
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
                },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'sub' }]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
    assert.strictEqual(
      html,
      '<ol start="3"><li>three<ul><li>sub</li></ul></li></ol>'
    )
  })

  it('builds the article with its title, FAQ and cited sources', () => {
    const html = blogArticleHtml(sample())
    assert.ok(
      html.startsWith('<header><h1>How to X</h1></header><p>Intro one.</p>'),
      html
    )
    assert.ok(
      html.includes(
        '<section class="faq" id="faq"><h2>Frequently asked questions</h2><h3>Why?</h3><p>Because.</p></section>'
      )
    )
    assert.ok(
      html.includes(
        '<section class="references" id="references"><h2>References</h2><ol><li id="ref-1"><a href="https://example.com/g" rel="noopener noreferrer">Guide title</a>. example.com.</li></ol></section>'
      ),
      html
    )
    assert.ok(!html.includes('Unused page'))
    assert.ok(!html.includes('Internal doc'))
  })

  it('opens links in a new tab when asked', () => {
    assert.ok(
      blogArticleHtml(sample(), { newTab: true }).includes(
        'href="https://example.com/g" rel="noopener noreferrer" target="_blank"'
      )
    )
  })
})

describe('Markdown export', () => {
  it('exports front matter, the H1, sections, the FAQ and References', () => {
    const md = blogToMarkdown(sample())
    assert.ok(
      md.startsWith(
        '---\ntitle: "How to X"\nmeta_title: "How to X in five steps"\n'
      ),
      md
    )
    for (const part of [
      'meta_description: "A short guide to X."\n',
      'slug: "how-to-x"\n',
      'keywords: ["x", "y"]\n---\n',
      '\n# How to X\n',
      '\nIntro one.\n',
      '\n## First point\n',
      'Read [the guide](https://example.com/g) with **b** now.',
      '\n### Detail\n',
      '\n- a\n- b\n',
      '\n1. one\n',
      '\n> Quoted.\n',
      '\n## What to do next\n',
      '\n## Frequently asked questions\n',
      '\n### Why?\n\nBecause.\n',
      '\n## References\n',
      '\n1. [Guide title](https://example.com/g). example.com.'
    ]) {
      assert.ok(md.includes(part), `missing ${JSON.stringify(part)} in\n${md}`)
    }
    assert.ok(!md.includes('Unused page'))
  })

  it('lists a page once, however many cited passages came from it', () => {
    const passage = (id: string, url: string) => ({
      id,
      origin: 'knowledge' as const,
      title: 'Our homepage',
      url,
      quote: `passage ${id}`,
      cited: true
    })
    const md = blogToMarkdown(
      sample({
        sources: [
          ...sample().sources,
          passage('K2', 'https://www.northwind.test'),
          passage('K3', 'https://northwind.test/'),
          passage('K4', 'https://www.northwind.test')
        ]
      })
    )
    assert.ok(
      md.endsWith(
        '## References\n\n1. [Guide title](https://example.com/g). example.com.\n2. [Our homepage](https://www.northwind.test). northwind.test.\n'
      ),
      md
    )
  })

  it('leaves the front matter out when asked', () => {
    assert.ok(
      blogToMarkdown(sample(), { frontMatter: false }).startsWith(
        '# How to X\n'
      )
    )
  })

  it('escapes front matter values', () => {
    const md = blogToMarkdown(sample({ title: 'He said "hi"\nok' }))
    assert.ok(
      md.includes('\ntitle: "He said \\"hi\\" ok"\n') ||
        md.startsWith('---\ntitle: "He said \\"hi\\" ok"\n'),
      md
    )
  })

  it('escapes Markdown characters in text', () => {
    const md = blogToMarkdown(
      sample({
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '*not bold* and _x_ [y]' }]
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '# not a heading' }]
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '1. not a list' }]
            }
          ]
        }
      })
    )
    assert.ok(md.includes('\\*not bold\\* and \\_x\\_ \\[y\\]'), md)
    assert.ok(md.includes('\n\\# not a heading\n'), md)
    assert.ok(md.includes('\n1\\. not a list\n'), md)
  })
})

describe('standalone page', () => {
  it('carries the meta tags and JSON-LD, with script tags escaped', () => {
    const html = blogToStandaloneHtml(
      sample({
        metaTitle: 'Meta title',
        metaDescription: 'Meta desc',
        title: 'T </script><script>alert(1)</script>'
      })
    )
    assert.ok(html.startsWith('<!doctype html>'))
    assert.ok(html.includes('<title>Meta title</title>'))
    assert.ok(html.includes('<meta name="description" content="Meta desc">'))
    assert.ok(html.includes('<meta name="keywords" content="x, y">'))
    assert.ok(html.includes('"@type":"BlogPosting"'))
    assert.ok(html.includes('"@type":"FAQPage"'))
    assert.strictEqual(html.split('</script>').length - 1, 1)
    assert.ok(html.includes('\\u003c/script\\u003e'))
  })

  it('uses the Article type for articles and leaves out an empty FAQ', () => {
    const html = blogToStandaloneHtml(sample({ kind: 'article', faq: [] }))
    assert.ok(html.includes('"@type":"Article"'))
    assert.ok(!html.includes('BlogPosting'))
    assert.ok(!html.includes('FAQPage'))
  })
})

describe('plain text and file names', () => {
  it('exports plain text', () => {
    const text = blogToText(sample())
    assert.ok(text.startsWith('How to X\n\nIntro one.'), text)
    assert.ok(text.includes('\n- a\n- b\n'), text)
    assert.ok(text.includes('the guide (https://example.com/g)'), text)
    assert.ok(!text.includes('**'))
    assert.ok(text.includes('Frequently asked questions'))
    assert.ok(
      text.includes('1. Guide title. example.com. https://example.com/g'),
      text
    )
  })

  it('names files by slug, then title', () => {
    assert.strictEqual(blogFileName(sample(), 'md'), 'how-to-x.md')
    assert.strictEqual(
      blogFileName(sample({ slug: '' }), 'html'),
      'how-to-x.html'
    )
    assert.strictEqual(
      blogFileName(sample({ slug: '', title: '' }), 'txt'),
      'blog.txt'
    )
  })
})

describe('Markdown that is safe to paste', () => {
  it('keeps HTML in the text as text', () => {
    const md = blogToMarkdown(
      sample({
        title: 'The <title> tag',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Put the keyword in the <title> tag, not <img src=x onerror=alert(1)>. AT&T and &amp; stay.'
                }
              ]
            }
          ]
        },
        faq: [{ question: 'Is <b> bold?', answer: 'Use <strong>.' }]
      }),
      { frontMatter: false }
    )
    assert.ok(!md.includes('<title>'), md)
    assert.ok(!md.includes('<img'), md)
    assert.ok(!md.includes('<b>') && !md.includes('<strong>'), md)
    assert.ok(md.startsWith('# The &lt;title> tag\n'), md)
    assert.ok(
      md.includes('&lt;title> tag, not &lt;img src=x onerror=alert(1)>.'),
      md
    )
    assert.ok(md.includes('AT&T and &amp;amp; stay.'), md)
  })
})

const cell = (type: 'tableHeader' | 'tableCell', text: string) => ({
  type,
  content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }]
})

describe('tables, boxes and figures', () => {
  it('renders a table with header cells and scope', () => {
    const html = docToHtml({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('tableHeader', 'Option'), cell('tableHeader', 'Sync')] },
            { type: 'tableRow', content: [cell('tableHeader', 'Store'), cell('tableCell', 'Hourly <batch>')] }
          ]
        }
      ]
    })
    assert.strictEqual(
      html,
      '<div class="table-wrap"><table><thead><tr><th scope="col">Option</th><th scope="col">Sync</th></tr></thead><tbody><tr><th scope="row">Store</th><td>Hourly &lt;batch&gt;</td></tr></tbody></table></div>'
    )
  })

  it('labels a hypothetical example box', () => {
    const html = docToHtml({
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { variant: 'example' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A buyer orders.' }] }]
        }
      ]
    })
    assert.strictEqual(
      html,
      '<aside class="callout callout-example"><p class="callout-label"><strong>Hypothetical example</strong></p><p>A buyer orders.</p></aside>'
    )
  })

  it('renders a diagram figure with its caption and source link', () => {
    const blog = sample({
      content: {
        type: 'doc',
        content: [
          {
            type: 'diagram',
            attrs: {
              kind: 'bar',
              title: 'Buyers',
              items: ['2023', '2025'],
              values: [43, 61],
              unit: '%',
              caption: 'Rep-free preference.',
              alt: '',
              sourceId: 'S1'
            }
          }
        ]
      }
    })
    const html = blogArticleHtml(blog)
    assert.match(html, /<figure class="diagram"><svg [^>]*role="img"/)
    assert.ok(html.includes('aria-labelledby="figure-1-title figure-1-desc"'))
    assert.ok(
      html.includes(
        '<figcaption>Rep-free preference. Source: <a href="https://example.com/g" rel="noopener noreferrer">Guide title</a>.</figcaption></figure>'
      ),
      html
    )
    const md = blogToMarkdown(blog)
    assert.ok(md.includes('![Buyers. 2023: 43%; 2025: 61%.](how-to-x-figure-1.png)'), md)
    assert.ok(md.includes('_Rep-free preference. Source: [Guide title](https://example.com/g)._'), md)
    assert.ok(blogToText(blog).includes('[Figure 1: Buyers]'))
  })

  it('renders the featured image with its alt text after the title', () => {
    const blog = sample({
      featuredImage: {
        src: 'data:image/webp;base64,AAAA',
        alt: 'A warehouse team "packing" orders',
        caption: 'Packing at a distributor',
        width: 1600,
        height: 900
      }
    })
    const html = blogArticleHtml(blog)
    assert.ok(
      html.startsWith(
        '<header><h1>How to X</h1></header><figure class="featured"><img src="data:image/webp;base64,AAAA" alt="A warehouse team &quot;packing&quot; orders" width="1600" height="900"><figcaption>Packing at a distributor</figcaption></figure>'
      ),
      html
    )
    const md = blogToMarkdown(blog, { frontMatter: false })
    assert.ok(
      md.startsWith('# How to X\n\n![A warehouse team "packing" orders](how-to-x-featured.webp)\n\n_Packing at a distributor_\n'),
      md
    )
  })

  it('names figure files the way the Markdown refers to them', () => {
    const blog = sample({
      featuredImage: { src: 'data:image/png;base64,AA', alt: 'a', caption: '', width: 1, height: 1 },
      content: {
        type: 'doc',
        content: [1, 2].map(n => ({
          type: 'diagram' as const,
          attrs: {
            kind: 'flow' as const,
            title: `Flow ${n}`,
            items: ['a', 'b'],
            values: [],
            unit: '',
            caption: '',
            alt: '',
            sourceId: ''
          }
        }))
      }
    })
    const names = figureFiles(blog).map(f => f.name)
    assert.deepStrictEqual(names, ['how-to-x-featured.png', 'how-to-x-figure-1.png', 'how-to-x-figure-2.png'])
    const md = blogToMarkdown(blog)
    for (const name of names) assert.ok(md.includes(`](${name})`), name)
  })

  it('escapes pipes and line breaks in Markdown table cells', () => {
    const md = blogToMarkdown(
      sample({
        content: {
          type: 'doc',
          content: [
            {
              type: 'table',
              content: [
                { type: 'tableRow', content: [cell('tableHeader', 'A|B'), cell('tableHeader', 'C')] },
                { type: 'tableRow', content: [cell('tableCell', 'x'), cell('tableCell', 'y')] }
              ]
            }
          ]
        }
      })
    )
    assert.ok(md.includes('| A\\|B | C |\n| --- | --- |\n| x | y |'), md)
  })
})

describe('references', () => {
  const verification = (citations: BlogVerification['citations']): BlogVerification => ({
    checkedAt: '2026-11-25T10:00:00.000Z',
    citations,
    issues: [],
    removedLinks: []
  })

  it('lists only sources still linked that support something, titles without trailing dots', () => {
    const linkedTo = (href: string, text: string) => ({
      type: 'paragraph' as const,
      content: [{ type: 'text' as const, text, marks: [{ type: 'link' as const, attrs: { href } }] }]
    })
    const blog = sample({
      content: {
        type: 'doc',
        content: [
          linkedTo('https://www.gartner.com/a', 'Gartner'),
          linkedTo('https://weak.example/b', 'Weak'),
          linkedTo('https://part.example/c', 'Partly')
        ]
      },
      sources: [
        { id: 'S1', origin: 'web', title: 'Gartner Survey Finds 61% ...', url: 'https://www.gartner.com/a', publisher: 'Gartner', publishedAt: '2025-06-25', quote: 'q', cited: true },
        { id: 'S2', origin: 'web', title: 'Weak page', url: 'https://weak.example/b', quote: 'q', cited: true },
        { id: 'S3', origin: 'web', title: 'Partly', url: 'https://part.example/c', quote: 'q', cited: true },
        { id: 'S4', origin: 'web', title: 'Unlinked now', url: 'https://gone.example/d', quote: 'q', cited: true }
      ],
      verification: verification([
        { sourceId: 'S1', sentence: 'a', verdict: 'supported', reason: '' },
        { sourceId: 'S2', sentence: 'b', verdict: 'unsupported', reason: '' },
        { sourceId: 'S3', sentence: 'c', verdict: 'partial', reason: '' }
      ])
    })
    assert.deepStrictEqual(referenceList(blog).map(s => s.id), ['S1', 'S3'])
    assert.deepStrictEqual(formatReference(blog.sources[0]!), {
      title: 'Gartner Survey Finds 61%',
      publisher: 'Gartner',
      date: '25 Jun 2025'
    })
  })

  it('keeps a linked source the check did not rule on', () => {
    const blog = sample({
      verification: verification([])
    })
    // S1 is linked in the text and was never judged (the check failed or skipped it).
    assert.deepStrictEqual(referenceList(blog).map(s => s.id), ['S1'])
  })

  it('lists every cited source for a blog checked before verification existed', () => {
    assert.deepStrictEqual(referenceList(sample()).map(s => s.id), ['S1'])
  })
})

describe('structured data and page tags', () => {
  const meta = {
    siteName: 'Northwind Studio',
    author: { name: 'Northwind Studio', url: 'https://northwind.test', type: 'Organization' as const },
    datePublished: '2026-11-20T09:00:00.000Z',
    dateModified: '2026-11-25T09:00:00.000Z'
  }

  it('includes author, publisher, dates, word count and citations, and no image for a data URL', () => {
    const [main] = blogJsonLd(
      sample({ featuredImage: { src: 'data:image/webp;base64,AA', alt: 'a', caption: '', width: 1, height: 1 } }),
      meta,
      { faqVisible: true }
    ) as Array<Record<string, unknown>>
    assert.strictEqual(main!['@type'], 'BlogPosting')
    assert.deepStrictEqual(main!.author, { '@type': 'Organization', name: 'Northwind Studio', url: 'https://northwind.test' })
    assert.deepStrictEqual(main!.publisher, { '@type': 'Organization', name: 'Northwind Studio', url: 'https://northwind.test' })
    assert.strictEqual(main!.datePublished, '2026-11-20T09:00:00.000Z')
    assert.strictEqual(main!.dateModified, '2026-11-25T09:00:00.000Z')
    assert.strictEqual(main!.inLanguage, 'en')
    assert.strictEqual(typeof main!.wordCount, 'number')
    assert.deepStrictEqual(main!.citation, [
      { '@type': 'CreativeWork', name: 'Guide title', url: 'https://example.com/g' }
    ])
    assert.ok(!('image' in main!))
    assert.ok(!('mainEntityOfPage' in main!))
  })

  it('uses an absolute image and the published page when known', () => {
    const [main] = blogJsonLd(
      sample({ featuredImage: { src: 'data:image/webp;base64,AA', alt: 'a', caption: '', width: 1, height: 1 } }),
      { ...meta, publishedUrl: 'https://northwind.test/blog/how-to-x', featuredImageUrl: 'https://cdn.northwind.test/x.webp' },
      { faqVisible: true }
    ) as Array<Record<string, unknown>>
    assert.deepStrictEqual(main!.image, ['https://cdn.northwind.test/x.webp'])
    assert.deepStrictEqual(main!.mainEntityOfPage, { '@type': 'WebPage', '@id': 'https://northwind.test/blog/how-to-x' })
    assert.strictEqual(main!.url, 'https://northwind.test/blog/how-to-x')
  })

  it('adds FAQPage only when the FAQ is on the page', () => {
    assert.strictEqual(blogJsonLd(sample(), meta, { faqVisible: false }).length, 1)
    const both = blogJsonLd(sample(), meta, { faqVisible: true }) as Array<Record<string, unknown>>
    assert.strictEqual(both[1]!['@type'], 'FAQPage')
    assert.strictEqual(blogJsonLd(sample({ faq: [] }), meta, { faqVisible: true }).length, 1)
  })

  it('carries canonical and og:url only when published, og:image only when absolute', () => {
    const draft = blogToStandaloneHtml(sample(), meta)
    assert.ok(!draft.includes('rel="canonical"'))
    assert.ok(!draft.includes('og:url'))
    assert.ok(draft.includes('<meta property="og:type" content="article">'))
    assert.ok(draft.includes('<meta property="og:title" content="How to X in five steps">'))
    assert.ok(draft.includes('<meta name="twitter:card" content="summary">'))
    assert.ok(draft.includes('<meta property="article:modified_time" content="2026-11-25T09:00:00.000Z">'))
    const live = blogToStandaloneHtml(sample(), {
      ...meta,
      publishedUrl: 'https://northwind.test/blog/how-to-x',
      featuredImageUrl: 'https://cdn.northwind.test/x.webp'
    })
    assert.ok(live.includes('<link rel="canonical" href="https://northwind.test/blog/how-to-x">'))
    assert.ok(live.includes('<meta property="og:url" content="https://northwind.test/blog/how-to-x">'))
    assert.ok(live.includes('<meta property="og:image" content="https://cdn.northwind.test/x.webp">'))
    assert.ok(live.includes('<meta name="twitter:card" content="summary_large_image">'))
  })

  it('makes a responsive page', () => {
    const html = blogToStandaloneHtml(sample(), meta)
    assert.ok(html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'))
    assert.ok(html.includes('img,svg{max-width:100%;height:auto}'))
    assert.ok(html.includes('.table-wrap{overflow-x:auto'))
    assert.ok(html.includes('<main><article>'))
  })
})
