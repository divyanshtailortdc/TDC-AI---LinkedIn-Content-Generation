import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  comparableName,
  contextIdentityAfterSave,
  headlineAfterSave,
  isDifferentIdentity,
  linkFitsIdentity,
  profileHandle,
  removedProfileLinks,
  sameSite,
  siteOf,
  switchProfileLinks,
  unrelatedLinks
} from '../src/lib/identity-change'

const zomato = {
  name: 'Zomato',
  company: 'Eternal Limited',
  websiteUrl: 'https://www.zomato.com'
}
const tdc = {
  name: 'TDCCommerce',
  company: '',
  websiteUrl: 'https://tdccommerce.com/'
}

describe('comparableName and siteOf', () => {
  it('ignores case, punctuation and company suffixes', () => {
    assert.equal(comparableName('Zomato Pvt. Ltd.'), 'zomato')
    assert.equal(comparableName('The TDC-Commerce Company'), 'tdccommerce')
    assert.equal(comparableName('  '), '')
  })

  it('reads the site without www, and nothing for a bad URL', () => {
    assert.equal(siteOf('https://www.zomato.com/delivery'), 'zomato.com')
    assert.equal(siteOf('http://blog.zomato.com'), 'blog.zomato.com')
    assert.equal(siteOf('not a url'), '')
    assert.equal(siteOf(null), '')
  })
})

describe('isDifferentIdentity', () => {
  it('sees a different company in either direction', () => {
    assert.equal(isDifferentIdentity(zomato, tdc), true)
    assert.equal(isDifferentIdentity(tdc, zomato), true)
  })

  it('keeps the same company with small changes to its name or site', () => {
    assert.equal(
      isDifferentIdentity(zomato, { ...zomato, name: 'Zomato India' }),
      false
    )
    assert.equal(
      isDifferentIdentity(zomato, {
        ...zomato,
        websiteUrl: 'https://zomato.com/about'
      }),
      false
    )
    assert.equal(
      isDifferentIdentity(zomato, { ...zomato, websiteUrl: 'https://blog.zomato.com' }),
      false
    )
  })

  it('takes a new name on the same website as a rename, not a switch', () => {
    assert.equal(
      isDifferentIdentity(zomato, { ...zomato, name: 'Eternal' }),
      false
    )
  })

  it('sees a different name with no website to compare', () => {
    assert.equal(
      isDifferentIdentity(
        { name: 'Zomato' },
        { name: 'TDCCommerce', websiteUrl: '' }
      ),
      true
    )
  })

  it('sees a person who moved to another company', () => {
    const before = {
      name: 'Priya Rao',
      company: 'Ledgerly',
      websiteUrl: 'https://ledgerly.in'
    }
    assert.equal(
      isDifferentIdentity(before, {
        name: 'Priya Rao',
        company: 'Acme Analytics',
        websiteUrl: 'https://acme.io'
      }),
      true
    )
    // The same person and company, described again.
    assert.equal(
      isDifferentIdentity(before, { ...before, company: 'Ledgerly Pvt Ltd' }),
      false
    )
  })

  it('sees another website when the new name is unknown', () => {
    assert.equal(
      isDifferentIdentity(zomato, { name: '', websiteUrl: 'https://tdccommerce.com' }),
      true
    )
    assert.equal(isDifferentIdentity(zomato, { name: '' }), false)
  })
})

describe('contextIdentityAfterSave', () => {
  it('remembers the old company when the profile is changed to another one', () => {
    assert.deepEqual(contextIdentityAfterSave(null, zomato, tdc), zomato)
  })

  it('keeps remembering it while the profile still names another company', () => {
    const edited = { ...tdc, websiteUrl: 'https://www.tdccommerce.com' }
    assert.deepEqual(contextIdentityAfterSave(zomato, tdc, edited), zomato)
  })

  it('forgets it when the profile names that company again', () => {
    assert.equal(contextIdentityAfterSave(zomato, tdc, zomato), null)
  })

  it('stays empty for an ordinary edit', () => {
    assert.equal(
      contextIdentityAfterSave(null, zomato, { ...zomato, name: 'Zomato India' }),
      null
    )
  })
})

describe('headlineAfterSave', () => {
  const saved = { name: 'Zomato', company: '', industry: 'Food delivery' }

  it('follows the company and industry it is made from', () => {
    assert.equal(
      headlineAfterSave('Food delivery', saved, {
        name: 'TDCCommerce',
        company: 'TDC',
        industry: 'E-commerce services'
      }),
      'TDC · E-commerce services'
    )
  })

  it('keeps a headline when nothing it describes changed', () => {
    assert.equal(
      headlineAfterSave('Hand-written headline', saved, { ...saved }),
      'Hand-written headline'
    )
  })

  it('fills an empty headline', () => {
    assert.equal(headlineAfterSave('  ', saved, saved), 'Food delivery')
  })
})

describe('switchProfileLinks', () => {
  it('keeps only the links given for the new identity, each on its platform', () => {
    const { links, otherLink } = switchProfileLinks({
      typed: 'https://www.instagram.com/tdccommerce/',
      found: {
        linkedin: 'https://www.linkedin.com/company/tdccommerce',
        x: 'https://x.com/tdccommerce'
      },
      suggested: undefined,
      platforms: ['instagram', 'linkedin']
    })
    assert.deepEqual(links, {
      linkedin: 'https://www.linkedin.com/company/tdccommerce',
      instagram: 'https://www.instagram.com/tdccommerce/'
    })
    assert.equal(otherLink, null)
  })

  it('prefers the link the user typed over one found for the same platform', () => {
    const { links } = switchProfileLinks({
      typed: 'https://www.instagram.com/tdc.commerce/',
      found: { instagram: 'https://www.instagram.com/tdccommerce/' },
      suggested: 'https://www.instagram.com/someone-else/'
    })
    assert.deepEqual(links, { instagram: 'https://www.instagram.com/tdc.commerce/' })
  })

  it('places the suggested main link when nothing else is on its platform', () => {
    const { links } = switchProfileLinks({
      suggested: 'https://www.linkedin.com/company/tdccommerce'
    })
    assert.deepEqual(links, {
      linkedin: 'https://www.linkedin.com/company/tdccommerce'
    })
  })

  it('returns nothing when no link was given, rather than an old one', () => {
    const { links, otherLink } = switchProfileLinks({})
    assert.deepEqual(links, {})
    assert.equal(otherLink, null)
  })

  it('keeps a typed link-in-bio page aside, since no platform field holds it', () => {
    const { links, otherLink } = switchProfileLinks({
      typed: 'https://linktr.ee/tdccommerce'
    })
    assert.deepEqual(links, {})
    assert.equal(otherLink, 'https://linktr.ee/tdccommerce')
  })

  it('keeps a saved link that fits the new company, after the ones given', () => {
    const { links, sources } = switchProfileLinks({
      typed: 'https://x.com/tdccommerce',
      saved: {
        x: 'https://x.com/old-handle',
        instagram: 'https://www.instagram.com/tdccommerce/'
      }
    })
    assert.deepEqual(links, {
      x: 'https://x.com/tdccommerce',
      instagram: 'https://www.instagram.com/tdccommerce/'
    })
    assert.deepEqual(sources, { x: 'typed', instagram: 'saved' })
  })

  it('drops a found link that is not a profile on its platform', () => {
    const { links } = switchProfileLinks({
      found: { instagram: 'https://x.com/tdccommerce' }
    })
    assert.deepEqual(links, {})
  })
})

describe('profile links of another account', () => {
  const tdcIdentity = {
    name: 'TDCCommerce',
    company: 'The Developer Company Inc.',
    websiteUrl: 'https://www.tdccommerce.com'
  }

  it('reads the account name from a profile link', () => {
    assert.equal(profileHandle('https://www.instagram.com/zomato/'), 'zomato')
    assert.equal(profileHandle('https://www.instagram.com/zomato/reel/abc'), 'zomato')
    assert.equal(profileHandle('https://www.linkedin.com/company/tdccommerce'), 'tdccommerce')
    assert.equal(profileHandle('https://www.threads.com/@zomato'), 'zomato')
    assert.equal(profileHandle('https://example.com/zomato'), '')
  })

  it('sees a link whose account shares nothing with the identity', () => {
    assert.equal(linkFitsIdentity('https://www.instagram.com/zomato/', tdcIdentity), false)
    assert.deepEqual(
      unrelatedLinks(
        {
          instagram: 'https://www.instagram.com/zomato/',
          linkedin: 'https://www.linkedin.com/company/tdccommerce'
        },
        tdcIdentity
      ),
      ['https://www.instagram.com/zomato/']
    )
  })

  it('fits a link named after the identity, its company or its website', () => {
    assert.equal(linkFitsIdentity('https://x.com/tdccommerce', tdcIdentity), true)
    assert.equal(linkFitsIdentity('https://www.instagram.com/zomato/', zomato), true)
    assert.equal(
      linkFitsIdentity('https://www.instagram.com/priya.dances/', { name: 'Priya Rao' }),
      true
    )
    assert.equal(
      linkFitsIdentity('https://x.com/ledgerly_hq', { name: 'Priya Rao', company: 'Ledgerly' }),
      true
    )
  })

  it('gives the benefit of the doubt when there is nothing to compare', () => {
    assert.equal(linkFitsIdentity('https://www.instagram.com/zomato/', { name: '' }), true)
    assert.equal(
      linkFitsIdentity('https://www.facebook.com/profile.php?id=123', tdcIdentity),
      true
    )
  })
})

describe('sameSite', () => {
  it('counts subdomains as the same site', () => {
    assert.equal(sameSite('signal.tdccommerce.com', 'tdccommerce.com'), true)
    assert.equal(sameSite('tdccommerce.com', 'zomato.com'), false)
    assert.equal(sameSite('', 'zomato.com'), false)
  })
})

describe('removedProfileLinks', () => {
  it('lists the saved links the switch leaves out', () => {
    assert.deepEqual(
      removedProfileLinks(
        {
          instagram: 'https://www.instagram.com/zomato/',
          x: 'https://x.com/zomato'
        },
        { instagram: 'https://instagram.com/zomato' }
      ),
      ['https://x.com/zomato']
    )
  })
})
