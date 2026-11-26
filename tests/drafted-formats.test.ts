import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  draftedPlatforms,
  formatsStillToDraft,
  hasPostFor
} from '../src/lib/formats/drafted'

/**
 * An idea selected again in Create posts: which platforms it is drafted for,
 * and which of the chosen ones it still gets a post on. Pure.
 */
describe('an idea drafted before, selected again', () => {
  it('is drafted for a platform once it has any post there that is not a video', () => {
    assert.equal(hasPostFor('linkedin.post', ['linkedin.post']), true)
    assert.equal(hasPostFor('x.post', ['linkedin.post']), false)
    // One post per platform: an X post means X is drafted, thread or not.
    assert.equal(hasPostFor('x.thread', ['x.post']), true)
  })

  it('treats a Reel or Short as its own kind of post', () => {
    assert.equal(hasPostFor('instagram.reel', ['instagram.reel']), true)
    assert.equal(hasPostFor('instagram.caption', ['instagram.reel']), false)
    assert.equal(hasPostFor('instagram.reel', ['instagram.caption']), false)
  })

  it('gets posts only on the chosen platforms it has none on', () => {
    assert.deepEqual(
      formatsStillToDraft(
        ['linkedin.post', 'x.post', 'threads.post'],
        ['linkedin.post']
      ),
      ['x.post', 'threads.post']
    )
    assert.deepEqual(
      formatsStillToDraft(['linkedin.post'], ['linkedin.post']),
      []
    )
    // Never drafted: everything chosen.
    assert.deepEqual(formatsStillToDraft(['linkedin.post', 'x.post'], []), [
      'linkedin.post',
      'x.post'
    ])
  })

  it('names the platforms it is drafted for, and ignores formats the app no longer has', () => {
    assert.deepEqual(
      draftedPlatforms([
        'x.thread',
        'linkedin.post',
        'instagram.reel',
        'tiktok.video'
      ]),
      ['linkedin', 'x']
    )
    assert.equal(hasPostFor('linkedin.post', ['tiktok.video']), false)
  })
})
