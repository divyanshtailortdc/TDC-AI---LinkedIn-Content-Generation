import assert from 'node:assert'
import { describe, it } from 'node:test'
import { formatsForPlatforms, resolveChannels } from '../src/lib/formats'

describe('formatsForPlatforms (Profile step Platforms)', () => {
  it('keeps the formats of a platform kept, in registry order', () => {
    assert.deepStrictEqual(
      formatsForPlatforms(['x.thread', 'linkedin.post', 'x.post'], ['x', 'linkedin']),
      ['linkedin.post', 'x.post', 'x.thread']
    )
  })

  it('drops every format of a platform removed', () => {
    assert.deepStrictEqual(
      formatsForPlatforms(['linkedin.post', 'x.post', 'x.thread'], ['linkedin']),
      ['linkedin.post']
    )
  })

  it("starts a platform added with its main post", () => {
    assert.deepStrictEqual(
      formatsForPlatforms(['linkedin.post'], ['linkedin', 'instagram', 'threads']),
      ['linkedin.post', 'threads.post', 'instagram.caption']
    )
  })

  it('keeps a video format turned on for a platform kept', () => {
    assert.deepStrictEqual(
      formatsForPlatforms(['facebook.post', 'facebook.reel'], ['facebook', 'x']),
      ['x.post', 'facebook.post', 'facebook.reel']
    )
  })

  it('treats nothing saved as LinkedIn, as resolveChannels shows it', () => {
    assert.deepStrictEqual(formatsForPlatforms(null, ['linkedin', 'x']), [
      'linkedin.post',
      'x.post'
    ])
    assert.deepStrictEqual(formatsForPlatforms([], ['x']), ['x.post'])
  })

  it('gives a platform with only a video format its main post', () => {
    const next = formatsForPlatforms(['linkedin.post', 'instagram.reel'], ['linkedin', 'instagram'])
    assert.deepStrictEqual(next, ['linkedin.post', 'instagram.caption', 'instagram.reel'])
  })

  it('resolves back to exactly the platforms picked', () => {
    for (const picked of [['linkedin'], ['x', 'threads'], ['facebook', 'instagram', 'linkedin']] as const) {
      const next = formatsForPlatforms(['linkedin.post'], [...picked])
      assert.deepStrictEqual(
        [...resolveChannels({ enabledFormats: next }).platforms].sort(),
        [...picked].sort()
      )
    }
  })
})
