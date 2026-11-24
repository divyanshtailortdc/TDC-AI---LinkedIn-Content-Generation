import assert from 'node:assert'
import { describe, it } from 'node:test'
import { pickLookExamples, type StoredExample } from '../src/lib/visual-examples/pick'

const at = (day: number) => new Date(`2026-11-${String(day).padStart(2, '0')}T00:00:00Z`)
const row = (
  platform: StoredExample['platform'],
  source: StoredExample['source'],
  day: number,
  name: string
): StoredExample => ({
  platform,
  source,
  imageUrl: name,
  width: 400,
  height: 500,
  createdAt: at(day)
})

describe('which example posts a new image follows', () => {
  it("uses the post's own platform first, uploads before found ones, newest first", () => {
    const picked = pickLookExamples(
      [
        row('instagram', 'search', 3, 'ig-old'),
        row('linkedin', 'upload', 9, 'li-upload'),
        row('instagram', 'search', 8, 'ig-new'),
        row('instagram', 'upload', 1, 'ig-upload')
      ],
      'instagram'
    )
    assert.deepStrictEqual(
      picked.map(p => p.imageUrl),
      ['ig-upload', 'ig-new', 'ig-old']
    )
  })

  it("borrows another platform's look when this one has no examples", () => {
    const picked = pickLookExamples(
      [
        row('x', 'search', 2, 'x-1'),
        row('linkedin', 'search', 3, 'li-1'),
        row('linkedin', 'search', 4, 'li-2')
      ],
      'facebook'
    )
    // The platform with the most examples comes first.
    assert.deepStrictEqual(
      picked.map(p => p.imageUrl),
      ['li-2', 'li-1', 'x-1']
    )
  })

  it('shows the art director at most eight', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row('linkedin', 'search', i + 1, `li-${i}`)
    )
    assert.strictEqual(pickLookExamples(rows, 'linkedin').length, 8)
  })

  it('finds nothing when the identity has no examples', () => {
    assert.deepStrictEqual(pickLookExamples([], 'linkedin'), [])
  })
})
