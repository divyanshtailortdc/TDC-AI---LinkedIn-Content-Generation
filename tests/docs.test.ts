import assert from 'node:assert'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, it } from 'node:test'
import { buildDocsSearchIndex, docContentFile } from '../src/docs/build-index'
import {
  decodeVector,
  encodeVector,
  sectionEmbeddingHash,
  sectionEmbeddingInput,
  type StoredDocEmbeddings
} from '../src/docs/embedding-input'
import {
  adjacentDocPages,
  DOC_PAGES,
  docSlugFromPathname,
  findDocPage,
  siblingDocPages
} from '../src/docs/nav'
import { docForAppPath, ROUTE_DOC_SLUGS } from '../src/docs/route-docs'
import {
  bestSnippet,
  isQuestion,
  queryTerms,
  searchDocsIndex,
  snippetHash,
  type DocsSearchIndexPage
} from '../src/docs/search'
import { headingId, parseDoc, tableOfContents } from '../src/docs/sections'

const ROOT = process.cwd()
const CONTENT = join(ROOT, 'src/docs/content')
const EMBEDDINGS = join(ROOT, 'src/docs/search-embeddings.json')
/** What src/docs/components/mdx-components.tsx provides besides markdown. */
const COMPONENTS = new Set([
  'Tags',
  'NextSteps',
  'Grid',
  'Card',
  'Details',
  'Tabs',
  'TabItem',
  'Kbd'
])

function filesUnder(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return filesUnder(path, suffix)
    return path.endsWith(suffix) ? [path] : []
  })
}

const contentFiles = filesUnder(CONTENT, '.mdx').map(path =>
  relative(CONTENT, path).split(sep).join('/')
)
const readContent = (file: string) => {
  const path = join(CONTENT, file)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}
const pages = DOC_PAGES.map(page => ({
  page,
  file: docContentFile(page.slug),
  source: readContent(docContentFile(page.slug)) ?? ''
}))

/** Text outside fenced code blocks, where markup means something. */
function outsideCode(source: string) {
  return source.replace(/^(```|~~~)[\s\S]*?^\1/gm, '')
}

/** Every app page's path as a pattern, from src/app's page files. */
const appRoutes = filesUnder(join(ROOT, 'src/app'), `${sep}page.tsx`).map(
  path => {
    const route = relative(join(ROOT, 'src/app'), path)
      .split(sep)
      .slice(0, -1)
      .filter(part => !/^\(.*\)$/.test(part))
      .map(part =>
        /^\[\[?\.\.\./.test(part)
          ? '.*'
          : /^\[.*\]$/.test(part)
            ? '[^/]+'
            : part
      )
      .join('/')
    return new RegExp(`^/${route}/?$`.replace('/.*/?$', '(?:/.*)?$'))
  }
)

function linksIn(source: string): string[] {
  const text = outsideCode(source)
  return [
    ...[...text.matchAll(/\]\((\/[^)\s]*)\)/g)].map(m => m[1]!),
    ...[...text.matchAll(/href[:=]\s*\{?\s*['"](\/[^'"]*)['"]/g)].map(
      m => m[1]!
    )
  ]
}

describe('docs content', () => {
  it('has a file for every page in the nav, and no file outside it', () => {
    const expected = DOC_PAGES.map(page => docContentFile(page.slug)).sort()
    assert.deepStrictEqual(
      expected.filter(file => !contentFiles.includes(file)),
      [],
      'pages in src/docs/nav.ts without a content file'
    )
    assert.deepStrictEqual(
      contentFiles.filter(file => !expected.includes(file)),
      [],
      'content files no page in src/docs/nav.ts shows'
    )
    assert.strictEqual(
      new Set(DOC_PAGES.map(page => page.slug)).size,
      DOC_PAGES.length,
      'slugs are unique'
    )
  })

  it('compiles every page as the app does', async () => {
    // ESM only, and the tests run as CommonJS.
    const { compile } = await import('@mdx-js/mdx')
    const { default: remarkGfm } = await import('remark-gfm')
    for (const { file, source } of pages) {
      await assert.doesNotReject(
        compile(source, { remarkPlugins: [remarkGfm] }),
        `${file} does not compile`
      )
    }
  })

  it('uses only the components the docs provide', () => {
    for (const { file, source } of pages) {
      const used = [...outsideCode(source).matchAll(/<([A-Z]\w*)/g)].map(
        m => m[1]!
      )
      const unknown = used.filter(name => !COMPONENTS.has(name))
      assert.deepStrictEqual(unknown, [], `${file} uses unknown components`)
    }
  })

  it('gives every page one title, the nav title, and unique headings', () => {
    for (const { page, file, source } of pages) {
      const titles = outsideCode(source).match(/^# .+$/gm) ?? []
      assert.strictEqual(titles.length, 1, `${file} has one # title`)
      // The home page has a heading of its own.
      if (page.slug)
        assert.strictEqual(parseDoc(source).title, page.title, `${file} title`)
      const ids = tableOfContents(parseDoc(source)).map(h => h.id)
      assert.ok(ids.every(Boolean), `${file} has a heading with no text`)
      assert.deepStrictEqual(
        ids.filter((id, i) => ids.indexOf(id) !== i),
        [],
        `${file} repeats a heading`
      )
    }
  })

  it('links only to help pages and headings that exist', () => {
    for (const { file, source } of pages) {
      for (const link of linksIn(source).filter(l =>
        /^\/docs(\/|$|#)/.test(l)
      )) {
        const [path = '', anchor] = link.split('#')
        const slug = docSlugFromPathname(path.replace(/\/$/, '') || '/docs')
        const target = slug === null ? undefined : findDocPage(slug)
        assert.ok(target, `${file} links to ${link}, which is not a page`)
        if (anchor) {
          const ids = tableOfContents(
            parseDoc(readContent(docContentFile(target.slug)) ?? '')
          ).map(h => h.id)
          assert.ok(
            ids.includes(anchor),
            `${file} links to ${link}, a heading that does not exist`
          )
        }
      }
    }
  })

  it('links only to app pages that exist', () => {
    for (const { file, source } of pages) {
      for (const link of linksIn(source).filter(l => !l.startsWith('/docs'))) {
        const path = link.split(/[?#]/)[0]!
        assert.ok(
          appRoutes.some(route => route.test(path)),
          `${file} links to ${link}, which is not a page of the app`
        )
      }
    }
  })
})

describe('parseDoc', () => {
  const source = [
    "import { Thing } from './thing'",
    '',
    '# Voice',
    '',
    'Intro with **bold**, `code` and a [link](/identity).',
    'Same paragraph.',
    '',
    '## How it `works`',
    '',
    '- First item',
    '- Second item',
    '  continued',
    '',
    '| Setting | Meaning |',
    '| ------- | ------- |',
    '| Tone | How it sounds |',
    '',
    '<Tags type="tip">',
    '',
    'Inside a tip.',
    '',
    '</Tags>',
    '',
    '### Questions',
    '',
    '<Details summary="Can I change it?">',
    'Yes, any time.',
    '</Details>',
    '',
    '<NextSteps links={[{ title: "Other", href: "/docs" }]} />',
    '',
    '```',
    '<NotAComponent> {kept as text}',
    '```'
  ].join('\n')
  const doc = parseDoc(source)

  it('reads the title and splits at ## and ### headings', () => {
    assert.strictEqual(doc.title, 'Voice')
    assert.deepStrictEqual(
      doc.sections.map(s => [s.id, s.heading, s.level]),
      [
        ['', 'Voice', 1],
        ['how-it-works', 'How it works', 2],
        ['questions', 'Questions', 3]
      ]
    )
  })

  it('keeps text, without markup, one block per line', () => {
    assert.strictEqual(
      doc.sections[0]!.text,
      'Intro with bold, code and a link. Same paragraph.'
    )
    assert.deepStrictEqual(doc.sections[1]!.text.split('\n'), [
      'First item',
      'Second item continued',
      'Setting — Meaning',
      'Tone — How it sounds',
      'Inside a tip.'
    ])
  })

  it('keeps a Details summary, drops Next steps, keeps code as it is', () => {
    assert.deepStrictEqual(doc.sections[2]!.text.split('\n'), [
      'Can I change it?',
      'Yes, any time.',
      '<NotAComponent> {kept as text}'
    ])
  })

  it('makes the anchors the heading components make', () => {
    assert.strictEqual(headingId('Connect LinkedIn & X'), 'connect-linkedin-x')
    assert.strictEqual(headingId('What’s a run?'), 'whats-a-run')
    assert.strictEqual(headingId('Café — résumé'), 'cafe-resume')
  })
})

describe('docs navigation', () => {
  it('reads slugs from /docs paths', () => {
    assert.strictEqual(docSlugFromPathname('/docs'), '')
    assert.strictEqual(
      docSlugFromPathname('/docs/account-setup/voice/'),
      'account-setup/voice'
    )
    assert.strictEqual(docSlugFromPathname('/identity'), null)
  })

  it('links each page to the ones before and after it', () => {
    const { previous, next } = adjacentDocPages('getting-started')
    assert.strictEqual(previous?.slug, '')
    assert.strictEqual(next?.slug, 'getting-started/dashboard')
    assert.strictEqual(adjacentDocPages('').previous, null)
  })

  it('finds a page’s neighbours in its group', () => {
    const siblings = siblingDocPages('publishing/posts/editing').map(
      p => p.slug
    )
    assert.deepStrictEqual(siblings, [
      'publishing/posts/overview',
      'publishing/posts/post-types'
    ])
  })
})

describe('help button', () => {
  it('points only at pages that exist', () => {
    for (const slug of ROUTE_DOC_SLUGS)
      assert.ok(findDocPage(slug), `${slug} is not a page`)
  })

  it('picks the page for where you are', () => {
    const slugOf = (path: string) => docForAppPath(path)?.slug ?? null
    assert.strictEqual(slugOf('/'), 'getting-started/dashboard')
    assert.strictEqual(slugOf('/identity'), 'account-setup/profile')
    assert.strictEqual(slugOf('/identity/voice'), 'account-setup/voice')
    assert.strictEqual(
      slugOf('/newsletters'),
      'publishing/newsletters/discover'
    )
    assert.strictEqual(
      slugOf('/newsletters/inbox'),
      'publishing/newsletters/inbox'
    )
    assert.strictEqual(slugOf('/posts'), 'publishing/posts/overview')
    assert.strictEqual(slugOf('/posts/123'), 'publishing/posts/editing')
    assert.strictEqual(
      slugOf('/settings/integrations'),
      'settings/integrations'
    )
    assert.strictEqual(slugOf('/goalsx'), null)
    assert.strictEqual(slugOf('/nowhere'), null)
  })
})

describe('docs search', () => {
  const index: DocsSearchIndexPage[] = [
    {
      slug: 'publishing/schedule',
      title: 'Schedule',
      trail: ['Publishing'],
      sections: [
        { id: '', heading: 'Schedule', text: 'When each post goes out.' },
        {
          id: 'publish-now',
          heading: 'Publish now',
          text: 'Scheduled posts are published at their time.\nA post that fails to publish is retried.'
        }
      ]
    },
    {
      slug: 'settings/integrations',
      title: 'Integrations',
      trail: ['Settings'],
      sections: [
        {
          id: 'connect-linkedin',
          heading: 'Connect LinkedIn',
          text: 'Connect the account your posts are published to.'
        }
      ]
    }
  ]

  it('drops filler words and word endings', () => {
    assert.deepStrictEqual(queryTerms('How do I schedule my posts?'), [
      'schedul',
      'post'
    ])
    assert.deepStrictEqual(queryTerms('how do I'), ['how', 'do', 'i'])
  })

  it('tells questions from keywords', () => {
    assert.ok(isQuestion('how do I connect LinkedIn'))
    assert.ok(isQuestion('posts not publishing?'))
    assert.ok(!isQuestion('schedule'))
  })

  it('ranks a title match first and needs every word', () => {
    const results = searchDocsIndex(index, 'scheduled posts')
    assert.deepStrictEqual(
      results.map(r => r.slug),
      ['publishing/schedule']
    )
    assert.strictEqual(results[0]!.category, 'Publishing')
    assert.strictEqual(results[0]!.snippets[0]!.sectionId, 'publish-now')
    assert.deepStrictEqual(
      searchDocsIndex(index, 'connect').map(r => r.slug),
      ['settings/integrations']
    )
    assert.deepStrictEqual(searchDocsIndex(index, 'connect schedule'), [])
  })

  it('cuts a snippet around the match', () => {
    const long = `${'Filler words here. '.repeat(20)}The retry happens later.`
    const snippet = bestSnippet(long, ['retr'], 80)
    assert.ok(snippet.includes('retry'), snippet)
    assert.ok(snippet.startsWith('…') && snippet.length <= 82, snippet)
  })

  it('opens a snippet at its text and heading', () => {
    const hash = snippetHash({
      sectionId: 'publish-now',
      heading: 'Publish now',
      text: '…published at their time…'
    })
    const params = new URLSearchParams(hash.slice(1))
    assert.ok(params.has('search'))
    assert.strictEqual(params.get('text'), 'published at their time')
    assert.strictEqual(params.get('section'), 'publish-now')
  })
})

describe('docs search embeddings', () => {
  it('round-trips a vector through its stored form', () => {
    const vector = [0.25, -1.5, 3.125]
    assert.deepStrictEqual(decodeVector(encodeVector(vector)), vector)
  })

  it('has a vector for every section (run pnpm docs:index)', () => {
    assert.ok(
      existsSync(EMBEDDINGS),
      'src/docs/search-embeddings.json is missing'
    )
    const stored = JSON.parse(
      readFileSync(EMBEDDINGS, 'utf8')
    ) as StoredDocEmbeddings
    const hashes = new Set(stored.sections.map(s => s.hash))
    const missing = buildDocsSearchIndex(readContent).flatMap(page =>
      page.sections
        .filter(section => section.text)
        .filter(
          section =>
            !hashes.has(
              sectionEmbeddingHash(
                stored.model,
                sectionEmbeddingInput(page, section)
              )
            )
        )
        .map(section => `${page.slug}#${section.id}`)
    )
    assert.deepStrictEqual(
      missing,
      [],
      'sections changed since pnpm docs:index'
    )
  })
})
