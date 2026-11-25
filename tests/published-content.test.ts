import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  BLOG_DESTINATION_IDS,
  localDay,
  publicationTimestamp,
  publishedOnLabel
} from '../src/lib/blogs/destinations'
import { PLATFORM_IDS } from '../src/lib/platforms'
import {
  destinationLabel,
  destinationTypeOf,
  filteredEmptyState,
  mergePublished,
  parsePublishedFilters,
  publishedHref,
  type PublishedItem
} from '../src/lib/published-content'

const item = (
  type: PublishedItem['type'],
  id: string,
  publishedAt: string
): PublishedItem => ({
  key: `${type}:${id}`,
  type,
  id,
  destination: type === 'social' ? 'linkedin' : 'wordpress',
  title: id,
  detail: '',
  publishedAt,
  liveUrl: null,
  href: `/${type === 'social' ? 'posts' : 'blogs'}/${id}`
})

describe('publishing destinations', () => {
  it('no destination id is both a platform and a CMS destination', () => {
    const platforms = new Set<string>(PLATFORM_IDS)
    assert.deepStrictEqual(
      BLOG_DESTINATION_IDS.filter(id => platforms.has(id)),
      []
    )
    assert.ok(!platforms.has('unrecorded'))
    assert.ok(
      !(BLOG_DESTINATION_IDS as readonly string[]).includes('unrecorded')
    )
  })

  it('says which content type a destination belongs to', () => {
    assert.strictEqual(destinationTypeOf('instagram'), 'social')
    assert.strictEqual(destinationTypeOf('shopify'), 'blog')
    assert.strictEqual(destinationTypeOf('unrecorded'), 'blog')
  })

  it('names destinations for people', () => {
    assert.strictEqual(destinationLabel('linkedin'), 'LinkedIn')
    assert.strictEqual(destinationLabel('wordpress'), 'WordPress')
    assert.strictEqual(destinationLabel('website'), 'Your website')
    assert.strictEqual(destinationLabel('unrecorded'), 'Not recorded')
    assert.strictEqual(publishedOnLabel('website'), 'Published on your website')
    assert.strictEqual(publishedOnLabel('webflow'), 'Published on Webflow')
    assert.strictEqual(publishedOnLabel('other'), 'Published elsewhere')
    assert.strictEqual(publishedOnLabel(null), 'Published')
  })
})

describe('parsePublishedFilters', () => {
  it('keeps a type and a destination that belong together', () => {
    assert.deepStrictEqual(
      parsePublishedFilters({ type: 'blog', destination: 'wordpress' }),
      { type: 'blog', destination: 'wordpress' }
    )
    assert.deepStrictEqual(
      parsePublishedFilters({ type: 'blog', destination: 'unrecorded' }),
      { type: 'blog', destination: 'unrecorded' }
    )
  })

  it('drops a destination of the other content type', () => {
    assert.deepStrictEqual(
      parsePublishedFilters({ type: 'social', destination: 'wordpress' }),
      { type: 'social', destination: null }
    )
    assert.deepStrictEqual(
      parsePublishedFilters({ type: 'blog', destination: 'linkedin' }),
      { type: 'blog', destination: null }
    )
  })

  it('allows a destination on its own', () => {
    assert.deepStrictEqual(
      parsePublishedFilters({ destination: 'instagram' }),
      {
        type: null,
        destination: 'instagram'
      }
    )
  })

  it('ignores values it does not know, and takes the first of repeats', () => {
    assert.deepStrictEqual(
      parsePublishedFilters({ type: 'nope', destination: 'nope' }),
      { type: null, destination: null }
    )
    assert.deepStrictEqual(parsePublishedFilters({}), {
      type: null,
      destination: null
    })
    assert.deepStrictEqual(
      parsePublishedFilters({ type: ['blog', 'social'] }),
      { type: 'blog', destination: null }
    )
  })
})

describe('mergePublished', () => {
  const posts = [
    item('social', 'p1', '2026-11-20T10:00:00.000Z'),
    item('social', 'p2', '2026-11-20T08:00:00.000Z')
  ]
  const blogs = [
    item('blog', 'b1', '2026-11-20T09:00:00.000Z'),
    item('blog', 'b2', '2026-11-20T07:00:00.000Z')
  ]

  it('orders both sources by date and returns the asked-for slice', () => {
    assert.deepStrictEqual(
      mergePublished([posts, blogs], 1, 2).map(i => i.key),
      ['blog:b1', 'social:p2']
    )
    assert.deepStrictEqual(
      mergePublished([posts, blogs], 0, 10).map(i => i.key),
      ['social:p1', 'blog:b1', 'social:p2', 'blog:b2']
    )
    assert.deepStrictEqual(mergePublished([posts, blogs], 4, 10), [])
  })

  it('breaks a tie in date by id, highest first', () => {
    const at = '2026-11-20T09:00:00.000Z'
    assert.deepStrictEqual(
      mergePublished(
        [[item('social', 'a', at)], [item('blog', 'c', at)]],
        0,
        2
      ).map(i => i.id),
      ['c', 'a']
    )
  })
})

describe('publishedHref', () => {
  it('leaves out empty filters and the first page', () => {
    assert.strictEqual(
      publishedHref({ type: null, destination: null }),
      '/published'
    )
    assert.strictEqual(
      publishedHref({ type: null, destination: null }, 1),
      '/published'
    )
    assert.strictEqual(
      publishedHref({ type: 'blog', destination: 'shopify' }, 2),
      '/published?type=blog&destination=shopify&page=2'
    )
    assert.strictEqual(
      publishedHref({ type: null, destination: 'x' }),
      '/published?destination=x'
    )
  })
})

describe('the publication date a blog is marked with', () => {
  // Built from local times, so the test holds in every time zone.
  const now = new Date(2026, 10, 24, 15, 0, 0)

  it('reads a moment as its day on this computer', () => {
    assert.strictEqual(localDay(new Date(2026, 10, 20, 23, 30)), '2026-11-20')
    assert.strictEqual(localDay(new Date(2026, 10, 20, 0, 5)), '2026-11-20')
  })

  it('takes today as the present moment', () => {
    assert.strictEqual(
      publicationTimestamp('2026-11-24', now, null),
      now.toISOString()
    )
  })

  it('takes a cleared or unreadable day as the present moment', () => {
    assert.strictEqual(publicationTimestamp('', now, null), now.toISOString())
    assert.strictEqual(
      publicationTimestamp('2026-13-45', now, null),
      now.toISOString()
    )
  })

  it('takes an earlier day as noon that day', () => {
    const result = publicationTimestamp('2026-11-20', now, null)
    assert.strictEqual(result, new Date(2026, 10, 20, 12, 0, 0).toISOString())
  })

  it('keeps the recorded moment when its day is unchanged', () => {
    const original = new Date(2026, 10, 20, 9, 41, 7).toISOString()
    assert.strictEqual(
      publicationTimestamp('2026-11-20', now, original),
      original
    )
    assert.strictEqual(
      publicationTimestamp('2026-11-22', now, original),
      new Date(2026, 10, 22, 12, 0, 0).toISOString()
    )
  })
})

describe('what a filtered, empty list says', () => {
  it('names the content type picked, not a destination', () => {
    assert.deepStrictEqual(
      filteredEmptyState({ type: 'blog', destination: null }).title,
      'No blogs or articles published yet'
    )
    assert.deepStrictEqual(
      filteredEmptyState({ type: 'social', destination: null }).title,
      'No social media posts published yet'
    )
    assert.ok(
      !filteredEmptyState({
        type: 'blog',
        destination: null
      }).description.includes('destination')
    )
  })

  it('names the destination picked', () => {
    assert.strictEqual(
      filteredEmptyState({ type: null, destination: 'wordpress' }).title,
      'Nothing published to WordPress yet'
    )
    const x = filteredEmptyState({ type: 'social', destination: 'x' })
    assert.strictEqual(x.title, 'Nothing published to X yet')
    assert.ok(x.description.includes('marked as posted'))
  })

  it('explains the blogs with no recorded destination', () => {
    assert.strictEqual(
      filteredEmptyState({ type: 'blog', destination: 'unrecorded' }).title,
      'No blogs without a recorded destination'
    )
  })
})
