import assert from 'node:assert'
import { describe, it } from 'node:test'
import { NextRequest } from 'next/server'
import robots from '../src/app/robots'
import { SITE_PATH } from '../src/lib/site'
import { proxy } from '../src/proxy'

const SESSION_COOKIE = 'better-auth.session_token=token.signature'

function request(path: string, { signedIn = false } = {}) {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    headers: signedIn ? { cookie: SESSION_COOKIE } : {}
  })
}

/** Where a response sends the browser or what it renders instead, if anywhere. */
function outcome(response: Response) {
  const rewrite = response.headers.get('x-middleware-rewrite')
  if (rewrite) return { rewrite: new URL(rewrite).pathname }
  const location = response.headers.get('location')
  if (location) {
    const url = new URL(location)
    return { redirect: `${url.pathname}${url.search}` }
  }
  return 'next'
}

describe('the public website', () => {
  it('shows signed-out visitors the website at /', () => {
    assert.deepStrictEqual(outcome(proxy(request('/'))), { rewrite: SITE_PATH })
  })

  it('keeps / as the dashboard for anyone with a session cookie', () => {
    assert.strictEqual(outcome(proxy(request('/', { signedIn: true }))), 'next')
  })

  it('lets anyone open the website at its own path', () => {
    assert.strictEqual(outcome(proxy(request(SITE_PATH))), 'next')
  })

  it('still sends signed-out visitors of app pages to sign in', () => {
    assert.deepStrictEqual(outcome(proxy(request('/ideas'))), {
      redirect: '/login?next=%2Fideas'
    })
  })
})

describe('robots.txt', () => {
  it('lets search engines read the website and the help pages only', () => {
    const { rules } = robots()
    const rule = Array.isArray(rules) ? rules[0] : rules
    assert.ok(rule)
    assert.deepStrictEqual(rule.allow, ['/$', SITE_PATH, '/docs'])
    assert.strictEqual(rule.disallow, '/')
  })
})
