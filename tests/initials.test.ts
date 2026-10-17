import assert from 'node:assert'
import { describe, it } from 'node:test'
import { IdentityProfileSchema } from '../src/lib/identity-profile'
import { initialsOf } from '../src/lib/initials'

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    assert.strictEqual(initialsOf('Aditya Kumar'), 'AK')
    assert.strictEqual(initialsOf('acme'), 'A')
    assert.strictEqual(initialsOf('  extra   spaces here '), 'ES')
  })

  it('keeps an emoji whole instead of half of it', () => {
    assert.strictEqual(initialsOf('😀 QA Identity'), '😀Q')
    assert.ok(!initialsOf('😀 QA Identity').includes('\uFFFD'))
  })
})

describe('profile limit messages', () => {
  it('names the field', () => {
    const parsed = IdentityProfileSchema.safeParse({
      name: 'x'.repeat(201),
      description: 'd',
      targetAudience: 't',
      offerings: 'o',
      industry: 'i'
    })
    assert.strictEqual(parsed.success, false)
    assert.match(parsed.error!.issues[0]!.message, /Display name must be 200 characters or fewer/)
  })
})
