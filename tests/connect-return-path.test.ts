import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  connectReturnPath,
  withConnectResult
} from '../src/lib/publishing/return-path'

describe('where connecting Buffer returns to', () => {
  it('accepts a page of the app, with its query and hash', () => {
    assert.equal(connectReturnPath('/'), '/')
    assert.equal(
      connectReturnPath('/settings/integrations'),
      '/settings/integrations'
    )
    assert.equal(
      connectReturnPath('/posts/abc?tab=1#publish'),
      '/posts/abc?tab=1#publish'
    )
  })

  it('refuses other sites, whatever the spelling', () => {
    for (const value of [
      'https://evil.example/',
      '//evil.example',
      '/\\evil.example',
      '/.//evil.example',
      'javascript:alert(1)'
    ]) {
      assert.equal(connectReturnPath(value), null, value)
    }
  })

  it('refuses API routes and the sign-in page, which are not somewhere to land', () => {
    assert.equal(connectReturnPath('/api/integrations/buffer/connect'), null)
    assert.equal(connectReturnPath('/api/onboarding'), null)
    assert.equal(connectReturnPath('/login?next=/'), null)
  })

  it('refuses anything that is not a non-empty string', () => {
    assert.equal(connectReturnPath(undefined), null)
    assert.equal(connectReturnPath(''), null)
    assert.equal(connectReturnPath(['/']), null)
  })

  it('drops an earlier outcome from the path it returns to', () => {
    assert.equal(
      connectReturnPath('/?connection=failed&platform=buffer&x=1'),
      '/?x=1'
    )
  })
})

describe('the outcome on the page connecting returns to', () => {
  it('adds the outcome before the hash', () => {
    assert.equal(
      withConnectResult('/?a=1#buffer', 'connected', 'buffer'),
      '/?a=1&connection=connected&platform=buffer#buffer'
    )
  })

  it('replaces an outcome already there', () => {
    assert.equal(
      withConnectResult(
        '/settings/integrations?connection=failed&platform=buffer',
        'connected',
        'buffer'
      ),
      '/settings/integrations?connection=connected&platform=buffer'
    )
  })
})
