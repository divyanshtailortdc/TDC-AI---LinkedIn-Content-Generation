import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  dedupeNewsletters,
  keepClassifiedNewsletters,
  keepValidQueries,
  type VerifiedCandidate
} from '../src/lib/ai/skills/newsletter-discovery/guard'
import {
  ClassificationModelSchema,
  MAX_QUERIES,
  MIN_RELEVANCE
} from '../src/lib/ai/skills/newsletter-discovery/schema'
import {
  analyzePage,
  isExcludedHost,
  isNewsletterPlatform,
  signupUrlKey
} from '../src/lib/newsletters/candidates'
import {
  NEWSLETTER_ACTIONS,
  NEWSLETTER_STATUSES,
  nextNewsletterStatus
} from '../src/lib/newsletters/status'

describe('newsletter status transitions', () => {
  it('saves a discovered newsletter and unsaves it back', () => {
    assert.equal(nextNewsletterStatus('discovered', 'save'), 'saved')
    assert.equal(nextNewsletterStatus('saved', 'unsave'), 'discovered')
    assert.equal(nextNewsletterStatus('subscribed', 'save'), null)
  })

  it('records what the user reports after signing up', () => {
    assert.equal(
      nextNewsletterStatus('saved', 'mark_pending'),
      'pending_confirmation'
    )
    assert.equal(
      nextNewsletterStatus('pending_confirmation', 'mark_subscribed'),
      'subscribed'
    )
    assert.equal(nextNewsletterStatus('saved', 'mark_failed'), 'failed')
    assert.equal(
      nextNewsletterStatus('subscribed', 'mark_unsubscribed'),
      'unsubscribed'
    )
    assert.equal(
      nextNewsletterStatus('unsubscribed', 'mark_subscribed'),
      'subscribed'
    )
  })

  it('no user action leads to active', () => {
    for (const status of NEWSLETTER_STATUSES) {
      for (const action of NEWSLETTER_ACTIONS) {
        assert.notEqual(nextNewsletterStatus(status, action), 'active')
      }
    }
  })

  it('cannot unsubscribe from something never subscribed to', () => {
    assert.equal(nextNewsletterStatus('discovered', 'mark_unsubscribed'), null)
    assert.equal(nextNewsletterStatus('saved', 'mark_unsubscribed'), null)
  })
})

describe('newsletter candidate pages', () => {
  it('excludes social and reference sites, recognises newsletter platforms', () => {
    assert.equal(
      isExcludedHost('https://www.linkedin.com/newsletters/x-123'),
      true
    )
    assert.equal(
      isExcludedHost('https://en.wikipedia.org/wiki/Newsletter'),
      true
    )
    assert.equal(isExcludedHost('https://retaildive.com/signup/'), false)
    assert.equal(isNewsletterPlatform('https://thehustle.substack.com/'), true)
    assert.equal(isNewsletterPlatform('https://notsubstack.com/'), false)
  })

  it('keys signup URLs without tracking, scheme or www', () => {
    assert.equal(
      signupUrlKey('https://www.example.com/newsletter/?utm_source=google'),
      signupUrlKey('http://example.com/newsletter')
    )
    // Where the link was clicked does not make it another list.
    assert.equal(
      signupUrlKey(
        'https://www.supplychaindive.com/signup/?signup_location=header'
      ),
      signupUrlKey(
        'https://www.supplychaindive.com/signup/?signup_location=footer-list'
      )
    )
    // On a platform, the query names the list.
    assert.notEqual(
      signupUrlKey('https://acme.us1.list-manage.com/subscribe?u=1&id=a'),
      signupUrlKey('https://acme.us1.list-manage.com/subscribe?u=1&id=b')
    )
  })

  it('finds the form, the subscribe link and the feed on a page', () => {
    const page = analyzePage(
      `<html><head>
        <title>Retail Weekly | Example News</title>
        <meta property="og:site_name" content="Example News">
        <meta name="description" content="Retail news every Tuesday.">
        <link rel="alternate" type="application/rss+xml" href="/feed.xml">
        <link rel="alternate" type="application/rss+xml" href="/comments/feed">
        <link rel="alternate" type="application/atom+xml" href="http://127.0.0.1/evil">
      </head><body>
        <a href="/newsletters/retail-weekly">Subscribe to our newsletter</a>
        <a href="/account/login">Sign in</a>
        <a href="https://other-site.com/subscribe">Subscribe elsewhere</a>
        <form><input type="email" name="email"></form>
        <p>A weekly newsletter on retail.</p>
      </body></html>`,
      'https://news.example.com/articles/one'
    )
    assert.equal(page.title, 'Retail Weekly | Example News')
    assert.equal(page.siteName, 'Example News')
    assert.equal(page.hasSignupForm, true)
    assert.equal(page.mentionsNewsletter, true)
    assert.deepEqual(page.subscribeLinks, [
      'https://news.example.com/newsletters/retail-weekly'
    ])
    // The comment feed and the private-network one are dropped.
    assert.deepEqual(page.feeds, [
      { url: 'https://news.example.com/feed.xml', type: 'rss' }
    ])
  })

  it('counts a newsletter platform embed as a signup form', () => {
    const page = analyzePage(
      '<body><iframe src="https://example.substack.com/embed"></iframe></body>',
      'https://example.com/'
    )
    assert.equal(page.hasSignupForm, true)
  })
})

function candidate(
  overrides: Partial<VerifiedCandidate> = {}
): VerifiedCandidate {
  return {
    signupUrl: 'https://example.com/newsletter',
    websiteUrl: 'https://example.com/',
    title: 'Example Weekly',
    siteName: 'Example',
    description: 'Weekly news.',
    excerpt: '',
    signupEvidence: 'form',
    feed: null,
    ...overrides
  }
}

function verdict(overrides: Record<string, unknown> = {}) {
  return {
    candidate: 1,
    isNewsletter: true,
    name: 'Example Weekly',
    publisher: 'Example Media',
    description: 'Weekly retail news.',
    category: 'industry' as const,
    topics: ['retail', 'retail', 'ecommerce'],
    relevanceScore: 82,
    reason: 'Covers retail.',
    ...overrides
  }
}

describe('newsletter AI output guard', () => {
  it('rejects output outside the schema', () => {
    const parsed = ClassificationModelSchema.safeParse({
      newsletters: [{ ...verdict(), category: 'gossip' }]
    })
    assert.equal(parsed.success, false)
  })

  it('takes URLs from the verified candidate, never the model', () => {
    const [kept] = keepClassifiedNewsletters(
      { newsletters: [verdict({ signupUrl: 'https://evil.test/' })] },
      [candidate()]
    )
    assert.equal(kept?.signupUrl, 'https://example.com/newsletter')
    assert.deepEqual(kept?.topics, ['retail', 'ecommerce'])
  })

  it('drops unknown, repeated, non-newsletter and low-scoring verdicts', () => {
    const kept = keepClassifiedNewsletters(
      {
        newsletters: [
          verdict({ candidate: 0 }),
          verdict({ candidate: 9 }),
          verdict({ candidate: 1.5 }),
          verdict({ candidate: 1 }),
          verdict({ candidate: 1, name: 'Second verdict' }),
          verdict({ candidate: 2, isNewsletter: false }),
          verdict({ candidate: 3, relevanceScore: MIN_RELEVANCE - 1 })
        ]
      },
      [
        candidate(),
        candidate({
          signupUrl: 'https://b.com/subscribe',
          websiteUrl: 'https://b.com/'
        }),
        candidate({
          signupUrl: 'https://c.com/subscribe',
          websiteUrl: 'https://c.com/'
        })
      ]
    )
    assert.deepEqual(
      kept.map(k => k.name),
      ['Example Weekly']
    )
  })

  it('clamps scores into 0-100', () => {
    const [kept] = keepClassifiedNewsletters(
      { newsletters: [verdict({ relevanceScore: 140.6 })] },
      [candidate()]
    )
    assert.equal(kept?.relevanceScore, 100)
  })

  it('keeps one per signup page and per name on a site, best score first', () => {
    const base = keepClassifiedNewsletters(
      {
        newsletters: [
          verdict({ candidate: 1, relevanceScore: 60 }),
          verdict({ candidate: 2, relevanceScore: 90 }),
          verdict({ candidate: 3, name: 'Other', relevanceScore: 70 })
        ]
      },
      [
        candidate(),
        // Same newsletter name on the same site, another signup page.
        candidate({ signupUrl: 'https://www.example.com/subscribe' }),
        candidate({
          signupUrl: 'https://other.com/subscribe',
          websiteUrl: 'https://other.com/'
        })
      ]
    )
    assert.deepEqual(
      base.map(n => [n.name, n.relevanceScore]),
      [
        ['Example Weekly', 90],
        ['Other', 70]
      ]
    )
    assert.equal(dedupeNewsletters([...base, ...base]).length, 2)
  })

  it('makes every query ask for a newsletter, without repeats', () => {
    const queries = keepValidQueries({
      queries: [
        { query: 'retail technology', category: 'technology' },
        { query: '  Retail   technology ', category: 'technology' },
        { query: '', category: 'niche' },
        { query: 'grocery industry newsletter', category: 'industry' },
        ...Array.from({ length: 12 }, (_, i) => ({
          query: `topic ${i} weekly briefing`,
          category: 'business' as const
        }))
      ]
    })
    assert.equal(queries[0], 'retail technology newsletter')
    assert.equal(queries[1], 'grocery industry newsletter')
    assert.equal(queries.length, MAX_QUERIES)
  })
})
