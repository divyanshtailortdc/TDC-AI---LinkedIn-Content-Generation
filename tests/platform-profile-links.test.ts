import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  canonicalProfileLink,
  cleanProfileLinks,
  linkPlatforms,
  mainProfileLink,
  mergeProfileLinks,
  otherProfileLink,
  platformOfLink,
  profileLinkError,
  profileLinkErrors,
  profileLinksOf,
  profilesAmong
} from '../src/lib/profile-links'
import { extractPlatformLinks, platformLinksInText } from '../src/lib/site-links'

const LINKEDIN = 'https://www.linkedin.com/company/zomato'
const INSTAGRAM = 'https://www.instagram.com/zomato/'

describe('profile links per platform', () => {
  it('knows a platform by its host', () => {
    assert.strictEqual(platformOfLink(LINKEDIN), 'linkedin')
    assert.strictEqual(platformOfLink('https://in.linkedin.com/in/priya'), 'linkedin')
    assert.strictEqual(platformOfLink('https://twitter.com/zomato'), 'x')
    assert.strictEqual(platformOfLink('https://x.com/zomato'), 'x')
    assert.strictEqual(platformOfLink('https://www.threads.net/@zomato'), 'threads')
    assert.strictEqual(platformOfLink('https://www.threads.com/@zomato'), 'threads')
    assert.strictEqual(platformOfLink('https://m.facebook.com/zomato'), 'facebook')
    assert.strictEqual(platformOfLink(INSTAGRAM), 'instagram')
    assert.strictEqual(platformOfLink('https://www.zomato.com'), null)
    // Only the host counts, not a platform named in the path.
    assert.strictEqual(platformOfLink('https://example.com/instagram.com'), null)
    assert.strictEqual(platformOfLink('https://notlinkedin.com/in/x'), null)
    assert.strictEqual(platformOfLink('not a url'), null)
  })

  it("rejects another platform's link in a platform's field", () => {
    assert.strictEqual(profileLinkError('instagram', INSTAGRAM), undefined)
    assert.strictEqual(profileLinkError('instagram', ''), undefined)
    assert.match(profileLinkError('instagram', LINKEDIN) ?? '', /LinkedIn link/)
    assert.match(profileLinkError('x', 'x.com/zomato') ?? '', /http/)
    // A site that is no platform's (a custom domain) is allowed.
    assert.strictEqual(profileLinkError('instagram', 'https://links.zomato.com'), undefined)
    assert.deepStrictEqual(Object.keys(profileLinkErrors({ x: LINKEDIN, instagram: INSTAGRAM })), ['x'])
  })

  it('keeps known platforms with valid links, trimmed', () => {
    assert.deepStrictEqual(
      cleanProfileLinks({ instagram: ` ${INSTAGRAM} `, linkedin: '', tiktok: 'https://tiktok.com/@z', x: LINKEDIN }),
      { instagram: INSTAGRAM }
    )
    assert.deepStrictEqual(cleanProfileLinks(null), {})
    assert.deepStrictEqual(cleanProfileLinks([INSTAGRAM]), {})
  })

  it("makes LinkedIn's link the main one, else the first platform's", () => {
    assert.strictEqual(mainProfileLink({ instagram: INSTAGRAM, linkedin: LINKEDIN }), LINKEDIN)
    assert.strictEqual(mainProfileLink({ instagram: INSTAGRAM, x: 'https://x.com/zomato' }), 'https://x.com/zomato')
    assert.strictEqual(mainProfileLink({}), null)
  })

  it('reads a link saved before links were per platform', () => {
    assert.deepStrictEqual(profileLinksOf({ profileLinks: {}, linkedinUrl: INSTAGRAM }), { instagram: INSTAGRAM })
    assert.deepStrictEqual(profileLinksOf({ linkedinUrl: null }), {})
    // A saved link for that platform wins over the old single link.
    assert.deepStrictEqual(
      profileLinksOf({ profileLinks: { instagram: 'https://www.instagram.com/new' }, linkedinUrl: INSTAGRAM }),
      { instagram: 'https://www.instagram.com/new' }
    )
    // One on no platform's site has no field, and is kept apart.
    assert.deepStrictEqual(profileLinksOf({ linkedinUrl: 'https://linktr.ee/zomato' }), {})
    assert.strictEqual(otherProfileLink({ linkedinUrl: 'https://linktr.ee/zomato' }), 'https://linktr.ee/zomato')
    assert.strictEqual(otherProfileLink({ linkedinUrl: INSTAGRAM }), null)
  })

  it('merges typed links over saved ones; an emptied one is removed', () => {
    const saved = { linkedin: LINKEDIN, youtube: 'https://www.youtube.com/@zomato' }
    assert.deepStrictEqual(mergeProfileLinks(saved, { linkedin: '', instagram: INSTAGRAM }), {
      instagram: INSTAGRAM,
      youtube: 'https://www.youtube.com/@zomato'
    })
  })

  it('shows a field for every platform posted on, and any with a saved link', () => {
    assert.deepStrictEqual(linkPlatforms(['instagram', 'linkedin'], {}), ['linkedin', 'instagram'])
    assert.deepStrictEqual(linkPlatforms(['linkedin'], { facebook: 'https://www.facebook.com/zomato' }), [
      'linkedin',
      'facebook'
    ])
  })
})

describe('finding an account from a link', () => {
  it("gives the account's own address for a link to it or one of its posts", () => {
    const cases: Array<[Parameters<typeof canonicalProfileLink>[0], string, string | null]> = [
      ['instagram', 'https://www.instagram.com/zomato/', 'https://www.instagram.com/zomato/'],
      ['instagram', 'https://instagram.com/zomato/p/C1x2y3/?hl=en', 'https://www.instagram.com/zomato/'],
      ['instagram', 'https://www.instagram.com/p/C1x2y3/', null],
      ['instagram', 'https://www.instagram.com/explore/tags/food/', null],
      ['x', 'https://twitter.com/zomato/status/123', 'https://x.com/zomato'],
      ['x', 'https://x.com/intent/tweet?text=hi', null],
      ['x', 'https://twitter.com/share?url=x', null],
      ['threads', 'https://www.threads.net/@zomato/post/abc', 'https://www.threads.com/@zomato'],
      ['threads', 'https://www.threads.com/search?q=zomato', null],
      ['facebook', 'https://www.facebook.com/zomato/posts/1', 'https://www.facebook.com/zomato'],
      ['facebook', 'https://m.facebook.com/profile.php?id=1000123', 'https://www.facebook.com/profile.php?id=1000123'],
      ['facebook', 'https://www.facebook.com/sharer/sharer.php?u=x', null],
      ['youtube', 'https://www.youtube.com/@zomato/videos', 'https://www.youtube.com/@zomato'],
      ['youtube', 'https://www.youtube.com/watch?v=abc', null],
      ['linkedin', 'https://in.linkedin.com/company/Zomato/posts', 'https://www.linkedin.com/company/zomato'],
      // A link on another platform is not this one's account.
      ['instagram', 'https://twitter.com/zomato', null]
    ]
    for (const [platform, url, expected] of cases) {
      assert.strictEqual(canonicalProfileLink(platform, url), expected, `${platform} ${url}`)
    }
  })

  it("takes the first account on each platform a site links to", () => {
    assert.deepStrictEqual(
      profilesAmong(
        [
          'https://www.facebook.com/sharer/sharer.php?u=x',
          'https://www.facebook.com/zomato',
          'https://www.instagram.com/zomato/',
          'https://www.instagram.com/zomatocare/',
          'https://twitter.com/zomato'
        ],
        ['facebook', 'instagram', 'threads']
      ),
      { facebook: 'https://www.facebook.com/zomato', instagram: 'https://www.instagram.com/zomato/' }
    )
  })

  it("reads a site's links to platforms, icons with no words included", () => {
    // As zomato.com's footer has them: icon fonts, no text, no label.
    const html = `<html><body>
      <a href="/about">About</a>
      <footer>
        <a href="https://www.instagram.com/zomato/" target="_blank"><span class="z-icon"></span></a>
        <a href="https://twitter.com/zomato"><span class="z-icon"></span></a>
        <a href="https://twitter.com/zomato">again</a>
        <a href="https://example.com/x">Partner</a>
      </footer></body></html>`
    assert.deepStrictEqual(extractPlatformLinks(html, 'https://www.zomato.com/'), [
      'https://www.instagram.com/zomato/',
      'https://twitter.com/zomato'
    ])
    assert.deepStrictEqual(
      platformLinksInText('Follow us: [Instagram](https://www.instagram.com/zomato/), https://x.com/zomato. Site: https://www.zomato.com'),
      ['https://www.instagram.com/zomato/', 'https://x.com/zomato']
    )
  })
})
