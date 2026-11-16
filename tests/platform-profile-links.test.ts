import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  cleanProfileLinks,
  linkPlatforms,
  mainProfileLink,
  mergeProfileLinks,
  otherProfileLink,
  platformOfLink,
  profileLinkError,
  profileLinkErrors,
  profileLinksOf
} from '../src/lib/profile-links'

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
