import assert from 'node:assert'
import { describe, it } from 'node:test'
import type { StoryUse } from '../src/lib/intel/status'
import {
  compareStories,
  pairStories,
  type ComparedStory
} from '../src/lib/intel/story-versions'

const story = (
  headline: string,
  articleId: string | null = null,
  extra: Partial<ComparedStory> = {}
): ComparedStory => ({
  articleId,
  url: null,
  headline,
  isSponsored: false,
  ...extra
})

const stored = (s: ComparedStory, useInIdeas: StoryUse = 'auto') => ({
  ...s,
  useInIdeas
})

describe('versions of a newsletter issue', () => {
  const issue = [
    story('D2C brands cut ad spend by 18%', 'a1'),
    story('Quick commerce takes 30% of grocery', 'a2'),
    story('Retail media budgets double this year', 'a3')
  ]

  it('sees a resend as the same issue', () => {
    const { overlap } = compareStories(issue, issue)
    assert.equal(overlap, 1)
  })

  it('pairs each repeated story with its stored row, a fixed link included', () => {
    const resend = [
      issue[0]!,
      // The correction fixed this story's link: matched by its headline.
      story('Quick commerce takes 30% of grocery', 'a2-fixed'),
      issue[2]!
    ]
    const pairs = pairStories(
      resend,
      issue.map(s => stored(s))
    )
    assert.deepEqual(
      pairs.sort((x, y) => x[0] - y[0]),
      [
        [0, 0],
        [1, 1],
        [2, 2]
      ]
    )
  })

  it('pairs by the closest match when two stories share an article', () => {
    const older = [
      story('Ad spend falls at D2C brands', 'a1'),
      story('Why retention budgets are rising', 'a1')
    ]
    // Same stories, in the other order.
    const newer = [older[1]!, older[0]!]
    const pairs = pairStories(
      newer,
      older.map(s => stored(s))
    )
    assert.deepEqual(
      pairs.sort((x, y) => x[0] - y[0]),
      [
        [0, 1],
        [1, 0]
      ]
    )
  })

  it('keeps the row the user chose for when two match one story', () => {
    const newer = [story('D2C brands cut ad spend by 18%', 'a1')]
    const older = [
      stored(story('D2C brands cut ad spend by 18%', 'a1')),
      stored(story('D2C brands cut ad spend by 18%', 'a1'), 'never')
    ]
    assert.deepEqual(pairStories(newer, older), [[0, 1]])
  })

  it('pairs no row with a story a newer version carries', () => {
    const pairs = pairStories(
      issue,
      issue.map(s => stored(s, 'keep')),
      new Set([1])
    )
    assert.deepEqual(
      pairs.sort((x, y) => x[0] - y[0]),
      [
        [0, 0],
        [2, 2]
      ]
    )
  })

  it('never pairs sponsored stories or short headlines without a link', () => {
    const sponsored = story('Try our new analytics suite today', 'ad', {
      isSponsored: true
    })
    const short = story('Read more')
    assert.deepEqual(
      pairStories([sponsored, short], [stored(sponsored), stored(short)]),
      []
    )
  })
})
