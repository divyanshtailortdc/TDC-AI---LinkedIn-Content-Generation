import assert from 'node:assert'
import { describe, it } from 'node:test'
import { isTestDomain } from '../src/lib/mail/test-domain'

describe('isTestDomain', () => {
  it('knows the reserved test and example domains', () => {
    for (const domain of [
      'in.tdc.test',
      'TDC.TEST',
      'in.example.com',
      'example.org',
      'x.invalid',
      'mail.localhost',
      'box.local'
    ])
      assert.ok(isTestDomain(domain), domain)
  })

  it('takes real domains, including ones that merely contain the words', () => {
    for (const domain of [
      'inbox.tdcai.com',
      'test.com',
      'example.co',
      'mytest.io',
      'local.news'
    ])
      assert.ok(!isTestDomain(domain), domain)
  })
})
