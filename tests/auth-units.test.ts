import assert from 'node:assert'
import { describe, it } from 'node:test'
import { authErrorMessage, RATE_LIMITED_MESSAGE } from '../src/lib/auth-errors'
import {
  ADMIN_ROLE,
  isAdminUser,
  parseAdminUserIds,
  USER_ROLE
} from '../src/lib/roles'
import { loginPathFor, safeRedirectPath } from '../src/lib/safe-redirect'

describe('safeRedirectPath', () => {
  it('keeps paths inside the app, with their query and hash', () => {
    assert.strictEqual(safeRedirectPath('/ideas'), '/ideas')
    assert.strictEqual(safeRedirectPath('/runs?page=2#top'), '/runs?page=2#top')
    assert.strictEqual(safeRedirectPath('/identity/voice'), '/identity/voice')
  })

  it('rejects anything that could leave the app', () => {
    const attacks = [
      'https://evil.com',
      'http://evil.com/ideas',
      '//evil.com',
      '//evil.com/ideas',
      '/\\evil.com',
      '\\\\evil.com',
      '/\\/evil.com',
      '/\t/evil.com',
      '/\n/evil.com',
      'javascript:alert(1)',
      'ideas',
      '',
      '  /ideas'
    ]
    for (const attack of attacks) {
      assert.strictEqual(safeRedirectPath(attack), '/', JSON.stringify(attack))
    }
  })

  it('falls back for non-strings and very long values', () => {
    assert.strictEqual(safeRedirectPath(undefined), '/')
    assert.strictEqual(safeRedirectPath(['/ideas']), '/')
    assert.strictEqual(safeRedirectPath(`/${'a'.repeat(3000)}`), '/')
    assert.strictEqual(safeRedirectPath('//evil.com', '/posts'), '/posts')
  })

  it('builds login links that return to a safe path only', () => {
    assert.strictEqual(loginPathFor('/'), '/login')
    assert.strictEqual(
      loginPathFor('/runs?page=2'),
      '/login?next=%2Fruns%3Fpage%3D2'
    )
    assert.strictEqual(loginPathFor('//evil.com'), '/login')
  })
})

describe('admin roles', () => {
  it('treats only the admin role or a listed id as admin', () => {
    assert.strictEqual(isAdminUser({ id: 'u1', role: ADMIN_ROLE }), true)
    assert.strictEqual(
      isAdminUser({ id: 'u1', role: `${USER_ROLE},${ADMIN_ROLE}` }),
      true
    )
    assert.strictEqual(isAdminUser({ id: 'u1', role: USER_ROLE }), false)
    assert.strictEqual(isAdminUser({ id: 'u1', role: null }), false)
    assert.strictEqual(isAdminUser({ id: 'u1', role: 'administrator' }), false)
    assert.strictEqual(isAdminUser({ id: 'u1', role: USER_ROLE }, ['u1']), true)
    assert.strictEqual(
      isAdminUser({ id: 'u2', role: USER_ROLE }, ['u1']),
      false
    )
  })

  it('parses ADMIN_USER_IDS', () => {
    assert.deepStrictEqual(parseAdminUserIds(undefined), [])
    assert.deepStrictEqual(parseAdminUserIds(' a , b,,c '), ['a', 'b', 'c'])
  })
})

describe('auth error messages', () => {
  it('maps known codes and hides unknown server text', () => {
    assert.match(authErrorMessage({ code: 'AUTH_CANCELLED' }, 'x'), /cancelled/)
    assert.strictEqual(
      authErrorMessage({ code: 'SOMETHING_NEW' }, 'fallback'),
      'fallback'
    )
    assert.strictEqual(authErrorMessage('<script>', 'fallback'), 'fallback')
    assert.strictEqual(
      authErrorMessage({ status: 429 }, 'x'),
      RATE_LIMITED_MESSAGE
    )
    assert.match(authErrorMessage('access_denied', 'x'), /cancelled/)
  })
})
