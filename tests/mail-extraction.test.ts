import assert from 'node:assert'
import { describe, it } from 'node:test'
import { digestHeuristically } from '../src/lib/ai/skills/newsletter-digest/fallback'
import { keepGroundedDigest } from '../src/lib/ai/skills/newsletter-digest/guard'
import {
  readEmailContent,
  textAroundLink
} from '../src/lib/intel/email-content'
import {
  canonicalArticleUrl,
  isActionLink,
  isArticleUrl
} from '../src/lib/intel/links'
import { readArticleHtml } from '../src/lib/scraper'

const filler = Array.from(
  { length: 12 },
  (_, i) => `<p>Paragraph ${i} about retail margins, logistics and pricing.</p>`
).join('')

const NEWSLETTER = `<html><head><style>.x{color:red}</style><title>Issue</title></head><body>
<div style="display:none;max-height:0;overflow:hidden">Preview text that should vanish</div>
<a href="https://substack.com/redirect/2/logo"><img src="https://cdn.example.com/logo.png" alt="The Retail Brief"></a>
<h1><a href="https://retailbrief.substack.com/p/d2c-ad-spend?utm_source=email&amp;token=SECRET">D2C brands cut ad spend by 18%</a></h1>
<p>Direct-to-consumer brands spent 18% less on paid social in Q3, according to new data. Most moved budget into retention.</p>
<p><a href="https://retailbrief.substack.com/p/d2c-ad-spend?utm_source=email&amp;token=SECRET">Read more</a></p>
<h2>Quick commerce</h2>
<p>Blinkit and Zepto now take 30% of urban grocery orders. <a href="https://news.example.com/quick-commerce-share">The full report</a> has city-level numbers. See note [1].</p>
<p><a href="https://twitter.com/retailbrief">Follow us on X</a> <a href="https://retailbrief.substack.com/p/d2c-ad-spend/comments">Comment</a> <a href="https://substack.com/app-link/post?publication_id=1&amp;token=xyz">Open in app</a> <a href="https://substack.com/redirect/3/share">Share</a></p>
<img src="https://eotrx.substackcdn.com/open?token=abc" width="1" height="1" alt="">
${filler}
<p>You received this email because you subscribed to The Retail Brief. <a href="https://retailbrief.substack.com/action/disable_email?token=abc">Unsubscribe</a></p>
<p><a href="https://news.example.com/after-footer">A link below the footer</a></p>
</body></html>`

describe('readEmailContent', () => {
  const content = readEmailContent({ html: NEWSLETTER, text: null })

  it('keeps the stories and drops hidden text, the footer and pixels', () => {
    assert.match(content.text, /D2C brands cut ad spend by 18%/)
    assert.match(content.text, /Blinkit and Zepto now take 30%/)
    assert.doesNotMatch(content.text, /Preview text/)
    assert.doesNotMatch(content.text, /You received this email/)
    assert.doesNotMatch(content.text, /below the footer/)
  })

  it('numbers the links worth following, each address once, from 1', () => {
    assert.deepStrictEqual(
      content.links.map(link => link.n),
      content.links.map((_, i) => i + 1)
    )
    const urls = content.links.map(link => link.url)
    assert.ok(urls.some(url => url.includes('/p/d2c-ad-spend?')))
    assert.ok(urls.includes('https://news.example.com/quick-commerce-share'))
    assert.strictEqual(
      urls.filter(url => url.includes('/p/d2c-ad-spend?')).length,
      1,
      'the headline and its Read more are one link'
    )
    for (const dropped of [
      'twitter.com',
      '/comments',
      'app-link',
      '/share',
      'disable_email',
      'after-footer'
    ])
      assert.ok(!urls.some(url => url.includes(dropped)), dropped)
  })

  it('names a link by its headline, not its "Read more"', () => {
    const story = content.links.find(link =>
      link.url.includes('/p/d2c-ad-spend?')
    )!
    assert.strictEqual(story.text, 'D2C brands cut ad spend by 18%')
    assert.match(
      content.text,
      new RegExp(`D2C brands cut ad spend by 18% \\[${story.n}\\]`)
    )
  })

  it('keeps footnote numbers from reading as link markers', () => {
    assert.match(content.text, /See note \(1\)/)
  })

  it('reads plain-text email, naming each address by the words before it', () => {
    const text = readEmailContent({
      html: null,
      text: `Big story: retailers raise prices https://news.example.com/prices?utm_source=x\n${'More text here.\n'.repeat(10)}Unsubscribe here: https://list.example.com/u?id=1`
    })
    assert.strictEqual(text.links.length, 1)
    assert.match(text.links[0]!.text, /retailers raise prices/)
    assert.match(text.text, /retailers raise prices \[1\]/)
    assert.doesNotMatch(text.text, /Unsubscribe/)
  })

  it('finds the text around a link', () => {
    const quick = content.links.find(link =>
      link.url.includes('quick-commerce')
    )!
    assert.match(
      textAroundLink(content.text, quick.n)!,
      /^Blinkit and Zepto now take 30%/
    )
  })
})

describe('links', () => {
  it('stores articles without tracking or reader tokens', () => {
    assert.strictEqual(
      canonicalArticleUrl(
        'https://Example.com/a?utm_source=x&id=5&token=abc&r=2x#frag'
      ),
      'https://example.com/a?id=5'
    )
    assert.strictEqual(canonicalArticleUrl('mailto:a@b.com'), null)
  })

  it('tells stories from homepages, profiles, stores and files', () => {
    assert.ok(isArticleUrl('https://news.example.com/2026/11/retail-margins'))
    assert.ok(
      isArticleUrl('https://www.linkedin.com/pulse/retail-2026-someone')
    )
    for (const url of [
      'https://news.example.com/',
      'https://news.example.com/blog',
      'https://twitter.com/someone/status/1',
      'https://www.linkedin.com/in/someone',
      'https://apps.apple.com/app/id1',
      'https://cdn.example.com/chart.png',
      'https://news.example.com/account/settings'
    ])
      assert.ok(!isArticleUrl(url), url)
  })

  it('never follows links that act on the subscription', () => {
    assert.ok(
      isActionLink(
        'https://x.example.com/a',
        'Unsubscribe from all marketing emails here'
      )
    )
    assert.ok(
      isActionLink('https://x.example.com/unsubscribe?u=1', 'Click here')
    )
    assert.ok(isActionLink('https://x.example.com/a', 'Share'))
    assert.ok(
      isActionLink('https://x.example.com/a', 'Manage your email preferences')
    )
    assert.ok(
      isActionLink('https://x.example.com/a', 'View this email in your browser')
    )
    assert.ok(
      !isActionLink(
        'https://x.example.com/a',
        'Share buybacks surge in Q3 as rates fall'
      )
    )
    assert.ok(
      !isActionLink(
        'https://x.example.com/a',
        'Why readers subscribe to local news again'
      )
    )
  })
})

describe('keepGroundedDigest', () => {
  const content = readEmailContent({ html: NEWSLETTER, text: null })
  const story = content.links.find(link =>
    link.url.includes('/p/d2c-ad-spend?')
  )!
  const quick = content.links.find(link => link.url.includes('quick-commerce'))!

  it('keeps verbatim blurbs and real link numbers', () => {
    const digest = keepGroundedDigest(
      {
        kind: 'newsletter',
        summary: 'Retail news.',
        topics: [' D2C ', 'Quick commerce'],
        items: [
          {
            headline: 'D2C brands cut ad spend by 18%',
            blurb:
              'Direct-to-consumer brands spent 18% less on paid social in Q3, according to new data.',
            link: story.n,
            sponsored: false
          }
        ]
      },
      content
    )
    assert.strictEqual(digest.items[0]!.link, story.n)
    assert.match(
      digest.items[0]!.blurb!,
      /^Direct-to-consumer brands spent 18%/
    )
    assert.deepStrictEqual(digest.topics, ['D2C', 'Quick commerce'])
  })

  it('replaces a paraphrase with the email’s own words, and drops made-up links', () => {
    const digest = keepGroundedDigest(
      {
        kind: 'newsletter',
        summary: '',
        topics: [],
        items: [
          {
            headline: 'Quick commerce share',
            blurb: 'Instant delivery apps are growing fast.',
            link: quick.n,
            sponsored: false
          },
          {
            headline: 'Invented story',
            blurb: 'Nothing like this is in the email.',
            link: 99,
            sponsored: false
          },
          {
            headline: 'Same link again',
            blurb: 'Also invented.',
            link: quick.n,
            sponsored: false
          }
        ]
      },
      content
    )
    assert.strictEqual(digest.items.length, 1)
    assert.match(digest.items[0]!.blurb!, /^Blinkit and Zepto now take 30%/)
  })

  it('swaps a near-quote for the email’s own sentences, even without a link', () => {
    const digest = keepGroundedDigest(
      {
        kind: 'newsletter',
        summary: '',
        topics: [],
        items: [
          {
            headline: 'D2C ad spend',
            // One word dropped ("paid") and one changed ("data" → "figures").
            blurb:
              'Direct-to-consumer brands spent 18% less on social in Q3, according to new figures.',
            link: null,
            sponsored: false
          },
          {
            headline: 'Unrelated',
            blurb:
              'Grocery delivery in rural areas fell sharply this quarter for most brands.',
            link: null,
            sponsored: false
          }
        ]
      },
      content
    )
    assert.strictEqual(digest.items.length, 1)
    assert.match(
      digest.items[0]!.blurb!,
      /^Direct-to-consumer brands spent 18% less on paid social in Q3, according to new data\./
    )
  })

  it('keeps no stories from an email that is not a newsletter', () => {
    const digest = keepGroundedDigest(
      {
        kind: 'transactional',
        summary: 'Please confirm.',
        topics: [],
        items: [
          {
            headline: 'D2C brands cut ad spend by 18%',
            blurb: '',
            link: story.n,
            sponsored: false
          }
        ]
      },
      content
    )
    assert.deepStrictEqual(digest.items, [])
  })
})

describe('digestHeuristically', () => {
  it('turns each link into a story', () => {
    const content = readEmailContent({ html: NEWSLETTER, text: null })
    const digest = digestHeuristically(content)
    assert.strictEqual(digest.kind, 'newsletter')
    assert.strictEqual(digest.items.length, content.links.length)
    assert.ok(
      digest.items.some(
        item => item.headline === 'D2C brands cut ad spend by 18%'
      )
    )
  })

  it('finds none in an email without links', () => {
    const digest = digestHeuristically(
      readEmailContent({
        html: '<p>Please confirm your subscription.</p>',
        text: null
      })
    )
    assert.strictEqual(digest.kind, 'other')
    assert.deepStrictEqual(digest.items, [])
  })
})

describe('readArticleHtml', () => {
  const body = Array.from(
    { length: 30 },
    (_, i) => `Sentence ${i} explains how retail margins moved this quarter.`
  ).join(' ')
  const page = `<html><head>
<title>Retail margins | Example News</title>
<meta property="og:title" content="Retail margins in Q3">
<meta property="og:site_name" content="Example News">
<meta property="article:author" content="https://example.com/staff/a">
<link rel="canonical" href="/2026/11/retail-margins">
<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2026-10-30T08:00:00Z","author":[{"name":"A. Writer"},{"name":"B. Editor"}]}]}</script>
</head><body>
<nav>Home Markets Tech Subscribe</nav>
<article><h1>Retail margins in Q3</h1><p>${body}</p></article>
<footer>Copyright Example News</footer>
</body></html>`

  it('reads the article and what the page says about itself', () => {
    const article = readArticleHtml(
      page,
      'https://news.example.com/x?utm_source=y'
    )!
    assert.strictEqual(article.title, 'Retail margins in Q3')
    assert.strictEqual(article.siteName, 'Example News')
    assert.strictEqual(article.author, 'A. Writer, B. Editor')
    assert.strictEqual(
      article.publishedAt?.toISOString(),
      '2026-10-30T08:00:00.000Z'
    )
    assert.strictEqual(
      article.canonicalUrl,
      'https://news.example.com/2026/11/retail-margins'
    )
    assert.doesNotMatch(article.content, /Home Markets Tech|Copyright/)
    assert.ok(article.wordCount >= 80)
  })

  it('ignores a date in the future and returns null for an empty page', () => {
    const future = page.replace('2026-10-30T08:00:00Z', '2999-01-01T00:00:00Z')
    assert.strictEqual(
      readArticleHtml(future, 'https://news.example.com/x')!.publishedAt,
      null
    )
    assert.strictEqual(
      readArticleHtml(
        '<html><body><p>Hi</p></body></html>',
        'https://news.example.com/x'
      ),
      null
    )
  })
})
