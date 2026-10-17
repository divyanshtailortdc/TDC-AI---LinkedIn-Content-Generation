import assert from 'node:assert'
import { describe, it } from 'node:test'
import { isUuid } from '../src/lib/ids'
import { AccountIdSchema, parseSetupPayload } from '../src/lib/setup-payloads'

describe('isUuid', () => {
  it('accepts every id Postgres stores, not only RFC 9562 ones', () => {
    assert.ok(isUuid('8f14e45f-ceea-4e7a-9a3b-0c9a5b6d7e8f'))
    // Seeded or imported rows: no valid version or variant digit.
    assert.ok(isUuid('11111111-1111-1111-1111-111111111111'))
    assert.ok(isUuid('12345678-1234-1234-1234-123456789abc'))
    assert.ok(isUuid('00000000-0000-0000-0000-000000000000'))
  })

  it('accepts capitals, which pages redirect to the lowercase form', () => {
    assert.ok(isUuid('8F14E45F-CEEA-4E7A-9A3B-0C9A5B6D7E8F'))
  })

  it('rejects anything Postgres would throw on or no link produces', () => {
    for (const id of [
      '',
      'new',
      'nope',
      "1' or '1'='1",
      '8f14e45f-ceea-4e7a-9a3b-0c9a5b6d7e8',
      '8f14e45f-ceea-4e7a-9a3b-0c9a5b6d7e8f0',
      '8f14e45f-ceea-4e7a-9a3b-0c9a5b6d7e8g',
      ' 8f14e45f-ceea-4e7a-9a3b-0c9a5b6d7e8f'
    ]) {
      assert.equal(isUuid(id), false, id)
    }
  })

  it('agrees with the schema the setup actions use', () => {
    parseSetupPayload(AccountIdSchema, '11111111-1111-1111-1111-111111111111')
    assert.throws(
      () => parseSetupPayload(AccountIdSchema, 'nope'),
      /Invalid account identifier/
    )
  })
})
