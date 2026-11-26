import assert from 'node:assert'
import { describe, it } from 'node:test'
import { gatherLinkCandidatesWith } from '../src/lib/ai/pipeline/blog-links'
import {
  buildLinkCandidates,
  isLinkablePage,
  parseSitemap,
  titleFromUrl
} from '../src/lib/blogs/link-candidates'

const NO_SITE = {
  homeLinks: [],
  sitemapUrls: [],
  offerings: [],
  knowledgeDocs: [],
  blogs: [],
  currentBlogId: 'current'
}

describe('the pages a blog can link to', () => {
  it('reads urls and child sitemaps', () => {
    assert.deepStrictEqual(
      parseSitemap(`<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://www.tdccommerce.com/</loc></url>
          <url><loc> https://www.tdccommerce.com/solutions?a=1&amp;b=2 </loc><lastmod>2026-01-01</lastmod></url>
          <url><loc><![CDATA[https://www.tdccommerce.com/blog/erp-basics]]></loc></url>
          <url><loc>ftp://files.example/x</loc></url>
        </urlset>`),
      {
        urls: [
          'https://www.tdccommerce.com/',
          'https://www.tdccommerce.com/solutions?a=1&b=2',
          'https://www.tdccommerce.com/blog/erp-basics'
        ],
        sitemaps: []
      }
    )
    assert.deepStrictEqual(
      parseSitemap(`<sitemapindex>
        <sitemap><loc>https://x.example/post-sitemap.xml</loc></sitemap>
        <sitemap><loc>https://x.example/page-sitemap.xml</loc></sitemap>
      </sitemapindex>`),
      {
        urls: [],
        sitemaps: [
          'https://x.example/post-sitemap.xml',
          'https://x.example/page-sitemap.xml'
        ]
      }
    )
  })

  it("keeps the site's own content pages only", () => {
    const host = 'tdccommerce.com'
    for (const url of [
      'https://www.tdccommerce.com/',
      'https://tdccommerce.com/solutions/inventory',
      'https://www.tdccommerce.com/blog/erp-basics.html'
    ]) {
      assert.strictEqual(isLinkablePage(url, host), true, url)
    }
    for (const url of [
      'https://other.example/solutions',
      'https://www.tdccommerce.com/login',
      'https://www.tdccommerce.com/cart',
      'https://www.tdccommerce.com/privacy-policy',
      'https://www.tdccommerce.com/tag/erp',
      'https://www.tdccommerce.com/files/brochure.pdf',
      'https://www.tdccommerce.com/?s=erp',
      'mailto:hello@tdccommerce.com'
    ]) {
      assert.strictEqual(isLinkablePage(url, host), false, url)
    }
  })

  it('titles a page from its path', () => {
    assert.strictEqual(
      titleFromUrl('https://www.tdccommerce.com/solutions/inventory-management'),
      'Inventory management'
    )
    assert.strictEqual(
      titleFromUrl('https://www.tdccommerce.com/blog/what_is_erp.html'),
      'What is erp'
    )
    assert.strictEqual(titleFromUrl('https://www.tdccommerce.com/'), 'tdccommerce.com')
  })

  it('puts offerings and menu pages first and dedupes', () => {
    const { candidates } = buildLinkCandidates({
      ...NO_SITE,
      website: 'https://www.tdccommerce.com',
      offerings: [
        {
          name: 'Catalog AI',
          url: 'https://www.tdccommerce.com/catalog-ai',
          description: 'Product data enrichment'
        },
        { name: 'Elsewhere', url: 'https://other.example/x' }
      ],
      homeLinks: [
        { url: 'https://www.tdccommerce.com/integrations', label: 'Integrations' },
        { url: 'https://www.tdccommerce.com/pricing', label: 'Learn more' },
        { url: 'https://www.tdccommerce.com/login', label: 'Sign in' }
      ],
      sitemapUrls: [
        'https://tdccommerce.com/catalog-ai/',
        'https://www.tdccommerce.com/integrations',
        'https://www.tdccommerce.com/solutions/order-management'
      ]
    })
    assert.deepStrictEqual(
      candidates.map(c => [c.kind, c.title, c.url]),
      [
        ['offering', 'Catalog AI', 'https://www.tdccommerce.com/catalog-ai'],
        ['page', 'Integrations', 'https://www.tdccommerce.com/integrations'],
        ['page', 'Pricing', 'https://www.tdccommerce.com/pricing'],
        [
          'page',
          'Order management',
          'https://www.tdccommerce.com/solutions/order-management'
        ]
      ]
    )
    assert.strictEqual(candidates[0]!.description, 'Product data enrichment')
  })

  it('published blogs are candidates, drafts are related reading', () => {
    const result = buildLinkCandidates({
      ...NO_SITE,
      website: 'https://www.tdccommerce.com',
      blogs: [
        {
          id: 'b1',
          title: 'ERP basics',
          status: 'published',
          publishedUrl: 'https://www.tdccommerce.com/blog/erp-basics'
        },
        { id: 'b2', title: 'Inventory sync costs', status: 'draft', publishedUrl: null },
        { id: 'current', title: 'This one', status: 'draft', publishedUrl: null },
        {
          id: 'b3',
          title: 'Published without a link',
          status: 'published',
          publishedUrl: null
        }
      ]
    })
    assert.deepStrictEqual(
      result.candidates.map(c => [c.kind, c.title]),
      [['blog', 'ERP basics']]
    )
    assert.deepStrictEqual(result.related, [
      { blogId: 'b2', title: 'Inventory sync costs' },
      { blogId: 'b3', title: 'Published without a link' }
    ])
  })

  it('an identity without a website has no page candidates', () => {
    const { candidates } = buildLinkCandidates({
      ...NO_SITE,
      website: null,
      offerings: [{ name: 'Kit', url: 'https://shop.example/kit' }],
      homeLinks: [{ url: 'https://shop.example/a', label: 'A' }],
      sitemapUrls: ['https://shop.example/b']
    })
    assert.deepStrictEqual(candidates, [])
  })
})

describe('gathering link candidates', () => {
  const ctx = {
    account: { id: 'acc', websiteUrl: 'tdccommerce.com' },
    offerings: [],
    knowledgeDocs: []
  } as never

  it('never throws when the site cannot be reached', async () => {
    const result = await gatherLinkCandidatesWith(
      {
        fetchText: async () => {
          throw new Error('offline')
        },
        loadBlogs: async () => [
          {
            id: 'b1',
            title: 'ERP basics',
            status: 'published',
            publishedUrl: 'https://www.tdccommerce.com/blog/erp-basics'
          }
        ]
      },
      ctx,
      { blogId: 'current' }
    )
    assert.deepStrictEqual(
      result.candidates.map(c => c.title),
      ['ERP basics']
    )
  })

  it('follows a sitemap index to its pages sitemap', async () => {
    const pages: Record<string, string> = {
      'https://tdccommerce.com/': '<a href="/integrations">Integrations</a>',
      'https://tdccommerce.com/sitemap.xml':
        '<sitemapindex><sitemap><loc>https://tdccommerce.com/post-sitemap.xml</loc></sitemap><sitemap><loc>https://tdccommerce.com/page-sitemap.xml</loc></sitemap></sitemapindex>',
      'https://tdccommerce.com/page-sitemap.xml':
        '<urlset><url><loc>https://tdccommerce.com/about-us</loc></url></urlset>'
    }
    const asked: string[] = []
    const result = await gatherLinkCandidatesWith(
      {
        fetchText: async url => {
          asked.push(url)
          return pages[url] !== undefined ? { url, text: pages[url]! } : null
        },
        loadBlogs: async () => []
      },
      ctx,
      { blogId: 'current' }
    )
    assert.deepStrictEqual(
      result.candidates.map(c => c.title),
      ['Integrations', 'About us']
    )
    assert.ok(asked.includes('https://tdccommerce.com/page-sitemap.xml'))
    assert.ok(!asked.includes('https://tdccommerce.com/post-sitemap.xml'))
  })
})
