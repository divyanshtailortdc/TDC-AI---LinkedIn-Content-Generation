import assert from 'node:assert'
import { describe, it } from 'node:test'
import { looksLikePlaceholderPage } from '../src/lib/scraper'

const article = 'An ordinary paragraph of article text. '.repeat(40)

describe('looksLikePlaceholderPage', () => {
  it('rejects error, bot-check and sign-in titles', () => {
    for (const title of [
      '404',
      'Not Found',
      '404 Not Found',
      '404: Page not found',
      '404 - Page Not Found',
      'Page Not Found | Acme',
      'Acme Blog | Page not found',
      'Page not found – Acme Blog',
      'Error',
      'Error 404',
      '403 Forbidden',
      'Access Denied',
      'Just a moment...',
      'Attention Required! | Cloudflare',
      'Are you a robot?',
      'Sign in - Google Accounts',
      'Log in | Medium'
    ]) {
      assert.ok(looksLikePlaceholderPage(title, article), title)
    }
  })

  it('keeps articles whose titles start with one of those words', () => {
    for (const title of [
      'Error budgets: how SRE teams ship faster',
      '404 Media',
      'Forbidden patterns in API design',
      'Sign in with Apple: integration guide',
      'Log in with SSO — a setup guide',
      'Error handling in Go | Acme Blog',
      'Not found in translation',
      'Error: what our outage taught us about retries',
      'Forbidden – a novel by Jane Doe',
      ''
    ]) {
      assert.equal(looksLikePlaceholderPage(title, article), false, title)
    }
  })

  it('still catches a short 404 page by its body', () => {
    assert.ok(
      looksLikePlaceholderPage(
        'Acme',
        'Oops! 404. The page could not be found. Go home.'
      )
    )
    assert.equal(looksLikePlaceholderPage('Acme', article), false)
  })
})
