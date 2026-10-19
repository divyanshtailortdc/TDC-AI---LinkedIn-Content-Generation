import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  sanitizeIdentitySetup,
  type SanitizeContext
} from '../src/lib/ai/skills/profile-setup/guard'
import { INSTRUCTIONS } from '../src/lib/ai/skills/profile-setup/prompt'
import {
  IdentitySetupSuggestionsSchema,
  ProfileSuggestionsSchema
} from '../src/lib/ai/skills/profile-setup/schema'
import { extractUrls, findLinks, isSiteRoot, toWebUrl } from '../src/lib/urls'

const SHOPIFY =
  'Shopify is a commerce platform that lets anyone start, run and grow a business, online and in person. Merchants use it to sell on their own store, social media and marketplaces. We are hiring engineers, designers and support advisors; see open roles at www.shopify.com/careers.'

const entry = (
  field: string,
  value: string,
  kind: 'fact' | 'recommendation' = 'recommendation',
  source = ''
) => ({ field, value, kind, source, confidence: 'high' })

/** Runs the guard over a company profile and, optionally, a goal and knowledge. */
function analyze(
  fields: unknown[],
  context: Partial<SanitizeContext> = {},
  extra: { goals?: unknown[]; sources?: unknown[] } = {}
) {
  return sanitizeIdentitySetup(
    {
      profile: { identityType: 'company', fields, missing: [] },
      ...(extra.goals ? { goals: { fields: extra.goals, missing: [] } } : {}),
      ...(extra.sources ? { knowledge: { sources: extra.sources } } : {})
    },
    {
      description: SHOPIFY,
      providedUrls: [],
      fetchedSources: [],
      accountType: 'company',
      ...context
    }
  )
}

const named = [entry('name', 'Shopify', 'fact', 'description')]

describe('finding links in a description', () => {
  it('finds a link written without a scheme and adds https://', () => {
    assert.deepStrictEqual(findLinks(SHOPIFY), [
      {
        url: 'https://www.shopify.com/careers',
        homepage: 'https://www.shopify.com',
        explicit: true
      }
    ])
    // A scheme the writer chose is kept; only a missing one is added.
    assert.strictEqual(findLinks('see http://acme.com')[0]?.url, 'http://acme.com')
  })

  it('tells a site root from a page on it by the address alone', () => {
    assert.ok(isSiteRoot('https://www.shopify.com/'))
    assert.ok(isSiteRoot('https://shopify.com/?ref=bio'))
    assert.ok(!isSiteRoot('https://www.shopify.com/careers'))
    assert.ok(!isSiteRoot('not a url'))
  })

  it('finds several links in order, each once', () => {
    const links = findLinks(
      'Priya Rao (linkedin.com/in/priya-rao). Portfolio: https://priyarao.design/work, also at PriyaRao.design/work and priyarao.design.'
    )
    assert.deepStrictEqual(
      links.map(link => [link.url, link.explicit]),
      [
        ['https://linkedin.com/in/priya-rao', true],
        ['https://priyarao.design/work', true],
        // A bare name.word: maybe a site, maybe not; the AI decides.
        ['https://priyarao.design', false]
      ]
    )
  })

  it('leaves out the punctuation and brackets around a link', () => {
    assert.deepStrictEqual(
      extractUrls(
        'See [our jobs](https://shopify.com/careers), (shopify.com/contact) or **shopify.com/pricing**!'
      ),
      [
        'https://shopify.com/careers',
        'https://shopify.com/contact',
        'https://shopify.com/pricing'
      ]
    )
  })

  it('finds nothing in a description without links', () => {
    for (const text of [
      '',
      'Shopify is a commerce platform for merchants of every size.',
      'Email hello@acme.com, e.g. for quotes. We serve the U.S.A. and Ph.D. holders.',
      'Running on localhost:3000 and 192.168.0.1 during testing.'
    ]) {
      assert.deepStrictEqual(findLinks(text), [], text)
    }
  })

  it('only makes web addresses absolute', () => {
    assert.strictEqual(toWebUrl('shopify.com/careers'), 'https://shopify.com/careers')
    assert.strictEqual(toWebUrl('ftp://shopify.com'), null)
    assert.strictEqual(toWebUrl('javascript:alert(1)'), null)
    assert.strictEqual(toWebUrl('localhost'), null)
    assert.strictEqual(toWebUrl('https://user:pw@acme.com'), null)
  })
})

describe('the Website URL is whatever the AI judged, checked and labelled', () => {
  it('accepts the homepage the AI works out from a careers page, for review', () => {
    const { suggestions, warnings } = analyze([
      ...named,
      entry('websiteUrl', 'https://www.shopify.com/')
    ])
    const website = suggestions.profile.websiteUrl
    // The root of the host the user wrote, exactly: same "www.", no slash added.
    assert.strictEqual(website?.value, 'https://www.shopify.com')
    // Not written by the user, so it is the AI's suggestion, not a fact.
    assert.strictEqual(website?.kind, 'recommendation')
    assert.strictEqual(website?.source, undefined)
    assert.match(website?.note ?? '', /https:\/\/www\.shopify\.com\/careers/)
    assert.deepStrictEqual(warnings, [])
    assert.ok(IdentitySetupSuggestionsSchema.safeParse(suggestions).success)
  })

  it('never works out a different host from a subdomain link', () => {
    const { suggestions, warnings } = analyze(
      [...named, entry('websiteUrl', 'https://shopify.com/')],
      { description: 'Shopify is a commerce platform. Jobs at careers.shopify.com.' }
    )
    assert.strictEqual(suggestions.profile.websiteUrl, undefined)
    assert.ok(warnings.some(w => w.includes('neither provided by you nor verified')))
  })

  it('never passes off a page as the homepage without saying so', () => {
    for (const proposed of [
      'www.shopify.com/careers',
      'https://www.shopify.com/careers',
      'https://shopify.com/careers/'
    ]) {
      const { suggestions } = analyze([
        ...named,
        entry('websiteUrl', proposed, 'fact', 'description')
      ])
      const website = suggestions.profile.websiteUrl
      assert.strictEqual(website?.value, 'https://www.shopify.com/careers', proposed)
      assert.strictEqual(website?.kind, 'recommendation', proposed)
      assert.match(website?.note ?? '', /not a homepage/, proposed)
      assert.match(website?.note ?? '', /homepage is https:\/\/www\.shopify\.com\./, proposed)
    }
  })

  it('uses a homepage the user wrote as a fact from their details', () => {
    const { suggestions } = analyze(
      [...named, entry('websiteUrl', 'shopify.com')],
      { description: `${SHOPIFY} More at shopify.com.` }
    )
    const website = suggestions.profile.websiteUrl
    assert.strictEqual(website?.value, 'https://shopify.com')
    assert.strictEqual(website?.kind, 'fact')
    assert.strictEqual(website?.source, 'provided')
    assert.strictEqual(website?.note, undefined)
  })

  it('uses the site research verified when the AI chose it or chose none', () => {
    const verifiedLinks = {
      websiteUrl: {
        url: 'https://www.shopify.com/',
        evidence: 'The page names Shopify.',
        confidence: 'high' as const
      }
    }
    for (const fields of [named, [...named, entry('websiteUrl', 'https://www.shopify.com/')]]) {
      const website = analyze(fields, { verifiedLinks }).suggestions.profile.websiteUrl
      assert.strictEqual(website?.value, 'https://www.shopify.com/')
      assert.strictEqual(website?.kind, 'fact')
      assert.strictEqual(website?.source, 'https://www.shopify.com/')
    }
  })

  it('keeps what the user typed into the Website URL field, whatever page it is', () => {
    for (const typed of ['https://www.shopify.com', 'https://www.shopify.com/careers']) {
      const { suggestions } = analyze(
        [...named, entry('websiteUrl', 'https://shopify.com/')],
        { providedUrls: [typed] }
      )
      assert.strictEqual(suggestions.profile.websiteUrl?.value, typed)
      assert.strictEqual(suggestions.profile.websiteUrl?.kind, 'fact')
      assert.strictEqual(suggestions.profile.websiteUrl?.source, 'provided')
    }
  })

  it('drops a website the AI invented, and leaves the field to the AI otherwise', () => {
    const invented = analyze([
      ...named,
      entry('websiteUrl', 'https://shopify-official.example/')
    ])
    assert.strictEqual(invented.suggestions.profile.websiteUrl, undefined)
    assert.ok(
      invented.warnings.some(w => w.includes('neither provided by you nor verified'))
    )
    // The AI judged no link to be their site: nothing is filled in for it.
    const none = analyze(named)
    assert.strictEqual(none.suggestions.profile.websiteUrl, undefined)
    assert.deepStrictEqual(none.warnings, [])
  })
})

describe('Samsung: the main website, never the newsroom or an altered domain', () => {
  const BOTH =
    'Samsung Electronics is a global leader in technology. Website: https://www.samsung.com. For the latest news, visit the Samsung Newsroom at https://news.samsung.com. Careers: samsung.com/us/careers and careers.samsung.com.'
  const NEWSROOM_ONLY =
    'Samsung inspires the world and shapes the future with transformative ideas and technologies. For the latest news, please visit the Samsung Newsroom at http://news.samsung.com.'
  const verifiedLinks = {
    websiteUrl: {
      url: 'https://www.samsung.com',
      evidence: 'The page names Samsung.',
      confidence: 'high' as const
    }
  }
  const run = (
    description: string,
    proposed?: string,
    context: Partial<SanitizeContext> = {}
  ) =>
    sanitizeIdentitySetup(
      {
        profile: {
          identityType: 'company',
          fields: [
            entry('name', 'Samsung Electronics', 'fact', 'description'),
            ...(proposed ? [entry('websiteUrl', proposed)] : [])
          ]
        }
      },
      {
        description,
        providedUrls: [],
        fetchedSources: [],
        accountType: 'company',
        ...context
      }
    )

  it('extracts every link and subdomain exactly as written', () => {
    assert.deepStrictEqual(
      findLinks(BOTH).map(link => [link.url, link.homepage]),
      [
        ['https://www.samsung.com', 'https://www.samsung.com'],
        ['https://news.samsung.com', 'https://news.samsung.com'],
        ['https://samsung.com/us/careers', 'https://samsung.com'],
        ['https://careers.samsung.com', 'https://careers.samsung.com']
      ]
    )
    // The scheme the writer used is kept, and no slash is added.
    assert.deepStrictEqual(extractUrls(NEWSROOM_ONLY), ['http://news.samsung.com'])
  })

  it('takes the main site the user wrote, exactly as they wrote it', () => {
    for (const proposed of [
      'https://www.samsung.com',
      'https://www.samsung.com/',
      'www.samsung.com',
      'https://samsung.com'
    ]) {
      const { suggestions, warnings } = run(BOTH, proposed)
      const website = suggestions.profile.websiteUrl
      assert.strictEqual(website?.value, 'https://www.samsung.com', proposed)
      assert.strictEqual(website?.kind, 'fact', proposed)
      assert.strictEqual(website?.source, 'provided', proposed)
      assert.strictEqual(website?.note, undefined, proposed)
      assert.deepStrictEqual(warnings, [], proposed)
    }
  })

  it('never works out www.samsung.com from the newsroom link, but uses a verified one', () => {
    const guessed = run(NEWSROOM_ONLY, 'https://www.samsung.com')
    assert.strictEqual(guessed.suggestions.profile.websiteUrl, undefined)
    assert.ok(
      guessed.warnings.some(w => w.includes('neither provided by you nor verified'))
    )

    for (const proposed of ['https://www.samsung.com', undefined]) {
      const website = run(NEWSROOM_ONLY, proposed, { verifiedLinks }).suggestions
        .profile.websiteUrl
      assert.strictEqual(website?.value, 'https://www.samsung.com')
      assert.strictEqual(website?.kind, 'fact')
      assert.strictEqual(website?.source, 'https://www.samsung.com')
    }
  })

  it('drops an altered domain such as new.samsung.com', () => {
    const altered = run(BOTH, 'https://new.samsung.com')
    assert.strictEqual(altered.suggestions.profile.websiteUrl, undefined)
    assert.ok(
      altered.warnings.some(w => w.includes('neither provided by you nor verified'))
    )
    const withResearch = run(NEWSROOM_ONLY, 'https://new.samsung.com', {
      verifiedLinks
    })
    assert.strictEqual(
      withResearch.suggestions.profile.websiteUrl?.value,
      'https://www.samsung.com'
    )
  })

  it('keeps the newsroom and careers links, as knowledge rather than the website', () => {
    const { suggestions } = run(BOTH, 'https://www.samsung.com')
    const offered = suggestions.knowledge.sources.map(s => s.url)
    assert.ok(offered.includes('https://news.samsung.com'))
    assert.ok(offered.includes('https://samsung.com/us/careers'))
  })

})

describe('every link in the description lands somewhere', () => {
  it("keeps the AI's name for a page and offers any page it left out", () => {
    const { suggestions } = analyze(
      named,
      {
        description:
          'Shopify is a commerce platform. Careers: shopify.com/careers. Press: https://shopify.com/news. Built with Node.js.'
      },
      {
        sources: [
          {
            url: 'shopify.com/careers',
            title: 'Shopify careers page',
            reason: 'Open roles and hiring'
          }
        ]
      }
    )
    assert.deepStrictEqual(
      suggestions.knowledge.sources.map(s => [s.title, s.url, s.accessible]),
      [
        ['Shopify careers page', 'https://shopify.com/careers', false],
        ['Page from your details', 'https://shopify.com/news', false]
      ]
    )
  })

  it('keeps links written without a scheme in the CTA and LinkedIn fields', () => {
    const { suggestions, warnings } = analyze(
      [...named, entry('linkedinUrl', 'linkedin.com/company/shopify')],
      {
        description:
          'Shopify is a commerce platform. Careers: shopify.com/careers. LinkedIn: linkedin.com/company/shopify'
      },
      {
        goals: [
          entry('title', 'Hire engineers'),
          entry('keyMessage', 'Shopify is a place to do your best work.'),
          entry('targetUrl', 'shopify.com/careers')
        ]
      }
    )
    // Both used to fail the link check because the scheme was missing.
    assert.strictEqual(
      suggestions.goals.targetUrl?.value,
      'https://shopify.com/careers'
    )
    assert.strictEqual(
      suggestions.profile.linkedinUrl?.value,
      'https://linkedin.com/company/shopify'
    )
    // LinkedIn cannot be read signed out, so it is not offered as knowledge.
    assert.deepStrictEqual(
      suggestions.knowledge.sources.map(s => s.url),
      ['https://shopify.com/careers']
    )
    assert.deepStrictEqual(warnings, [])
  })

  it('offers nothing when the description has no links', () => {
    const { suggestions } = analyze(named, {
      description: 'Shopify is a commerce platform for merchants of every size.'
    })
    assert.deepStrictEqual(suggestions.knowledge.sources, [])
  })
})

describe('the AI is asked to judge links itself', () => {
  it('tells it to copy links exactly and judge the main site from context', () => {
    assert.match(INSTRUCTIONS, /websiteUrl: their main website/)
    assert.match(INSTRUCTIONS, /never alter a domain/)
    assert.match(INSTRUCTIONS, /Never work out a main site from a subdomain/)
    assert.match(INSTRUCTIONS, /List every web page the description links to/)
  })
})

describe('a suggestion keeps its note through review', () => {
  it('validates with or without a note, as it comes back from the browser', () => {
    const website: { value: string; kind: string; confidence: string; note?: string } = {
      value: 'https://www.shopify.com/',
      kind: 'recommendation',
      confidence: 'medium'
    }
    for (const item of [website, { ...website, note: 'Why it was suggested.' }]) {
      const parsed = ProfileSuggestionsSchema.safeParse({ websiteUrl: item })
      assert.ok(parsed.success)
      assert.strictEqual(parsed.data.websiteUrl?.note, item.note)
    }
  })
})
