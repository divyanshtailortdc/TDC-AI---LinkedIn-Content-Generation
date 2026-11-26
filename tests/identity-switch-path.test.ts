import assert from 'node:assert'
import { describe, it } from 'node:test'
import { pathAfterSwitch } from '../src/lib/identity-switch-path'

describe('where switching identity leaves you', () => {
  it('takes a page of one item to the list it belongs to', () => {
    assert.strictEqual(pathAfterSwitch('/posts/abc', ''), '/posts')
    assert.strictEqual(pathAfterSwitch('/runs/abc', ''), '/runs')
    assert.strictEqual(pathAfterSwitch('/ideas/abc', ''), '/ideas')
    assert.strictEqual(pathAfterSwitch('/blogs/abc', '?tab=seo'), '/blogs')
  })

  it("starts a new blog afresh, without the other identity's idea or blog", () => {
    assert.strictEqual(pathAfterSwitch('/blogs/new', '?idea=1'), '/blogs/new')
    assert.strictEqual(
      pathAfterSwitch('/blogs/new', '?idea=1&x=2'),
      '/blogs/new?x=2'
    )
    assert.strictEqual(pathAfterSwitch('/blogs/new', '?from=1'), '/blogs/new')
    assert.strictEqual(pathAfterSwitch('/blogs/new', ''), null)
  })

  it("drops the other identity's run from the posts list, keeping its filters", () => {
    assert.strictEqual(
      pathAfterSwitch('/posts', '?runId=r&platform=x'),
      '/posts?platform=x'
    )
    assert.strictEqual(pathAfterSwitch('/posts', '?runId=r'), '/posts')
    assert.strictEqual(pathAfterSwitch('/posts', '?platform=x'), null)
  })

  it('reloads every other page where it is', () => {
    assert.strictEqual(pathAfterSwitch('/published', '?type=blog'), null)
    assert.strictEqual(pathAfterSwitch('/ideas', '?platform=x'), null)
    assert.strictEqual(pathAfterSwitch('/schedule', ''), null)
    assert.strictEqual(pathAfterSwitch('/blogs', ''), null)
    assert.strictEqual(pathAfterSwitch('/', ''), null)
  })
})
