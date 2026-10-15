import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  researchIdentity,
  type ResearchDeps
} from '../src/lib/ai/pipeline/identity-research'
import { sanitizeIdentitySetup } from '../src/lib/ai/skills/profile-setup/guard'
import {
  canonicalLinkedinUrl,
  guessEntity,
  marketTerms,
  mentionsEntity,
  pageMatchStrength,
  pickBackgroundPages,
  pickLinkedin,
  pickWebsiteCandidates,
  ungroundedNumbers,
  type Entity,
  type SearchHit
} from '../src/lib/ai/skills/profile-setup/research'

const DESCRIPTION =
  'I am Priya Rao, founder of Ledgerly, a bookkeeping and month-end close service for direct-to-consumer brands in India. We help founders close their books in 5 days instead of 20.'

const company: Entity = { name: 'Ledgerly', kind: 'company', location: 'India' }
const person: Entity = { name: 'Priya Rao', kind: 'person' }

const hit = (url: string, title: string, snippet = ''): SearchHit => ({
  url,
  title,
  snippet
})

const entry = (
  field: string,
  value: string,
  kind = 'recommendation',
  source = ''
) => ({
  field,
  value,
  kind,
  source,
  confidence: 'high'
})

describe('recognizing the entity', () => {
  it('matches a name however it is written, and not a different one', () => {
    assert.ok(
      mentionsEntity('Welcome to Ledgerly — books closed fast', 'Ledgerly')
    )
    assert.ok(mentionsEntity('Rao, Priya | Founder', 'Priya Rao'))
    assert.ok(mentionsEntity('Ledger-ly is hiring', 'Ledgerly'))
    assert.ok(!mentionsEntity('Ledger Systems Inc', 'Ledgerly'))
    assert.ok(!mentionsEntity('anything', 'A'))
  })

  it('needs the name together, not its words scattered over a page', () => {
    // Regression: a different firm's page with "Reyes" and "legal" somewhere
    // on it was read as being about Reyes Legal.
    const otherFirm =
      'The Reyes Law Firm handles family visas. Our legal team is here to help.'
    assert.ok(!mentionsEntity(otherFirm, 'Reyes Legal', 'company'))
    assert.ok(
      mentionsEntity('Call Reyes Legal today', 'Reyes Legal', 'company')
    )
    assert.ok(
      !mentionsEntity(
        'Maya Angelou wrote it. Years later, Chidi Okafor read it.',
        'Maya Okafor'
      )
    )
    assert.ok(mentionsEntity('Priya K. Rao, founder', 'Priya Rao'))
    // A title the page leaves off is not needed.
    assert.ok(mentionsEntity('Maya Okafor, physiotherapist', 'Dr. Maya Okafor'))
  })

  it('guesses the entity from common phrasings when no model is available', () => {
    assert.deepStrictEqual(guessEntity(DESCRIPTION), {
      name: 'Ledgerly',
      kind: 'company',
      confident: true
    })
    assert.deepStrictEqual(guessEntity(DESCRIPTION, 'personal'), {
      name: 'Priya Rao',
      kind: 'person',
      confident: true
    })
    assert.strictEqual(guessEntity('we make things'), null)
  })

  it('is not confident about a lone capitalized word after "I\'m"', () => {
    assert.strictEqual(
      guessEntity("I'm Passionate about design")?.confident,
      false
    )
  })

  it('keeps names joined by "&" and ends a name where the sentence ends', () => {
    // Regression: "Crumb & Co." was looked up as "Co", "I am Sam. I want" as "Sam. I".
    assert.deepStrictEqual(
      guessEntity('Crumb & Co. is a family-run sourdough bakery in Leeds.'),
      { name: 'Crumb & Co', kind: 'company', confident: true }
    )
    assert.deepStrictEqual(
      guessEntity('Hi, I am Sam. I want to post more on LinkedIn.'),
      { name: 'Sam', kind: 'person', confident: false }
    )
    assert.strictEqual(
      guessEntity("I'm Dr. Maya Okafor, a sports physiotherapist.")?.name,
      'Dr. Maya Okafor'
    )
  })
})

describe('LinkedIn pages come only from matching search results', () => {
  it('canonicalizes regional and tracking variants', () => {
    assert.strictEqual(
      canonicalLinkedinUrl('https://in.linkedin.com/company/Ledgerly/?trk=x')
        ?.url,
      'https://www.linkedin.com/company/ledgerly'
    )
    assert.strictEqual(
      canonicalLinkedinUrl('https://linkedin.com/jobs/view/1'),
      null
    )
    assert.strictEqual(
      canonicalLinkedinUrl('https://example.com/company/x'),
      null
    )
  })

  it('picks a company page for a company and a profile for a person', () => {
    const hits = [
      hit(
        'https://www.linkedin.com/in/priya-rao-123',
        'Priya Rao - Founder - Ledgerly | LinkedIn'
      ),
      hit(
        'https://www.linkedin.com/company/ledgerly',
        'Ledgerly | LinkedIn',
        'Bookkeeping for D2C'
      )
    ]
    assert.strictEqual(
      pickLinkedin(hits, company).link?.url,
      'https://www.linkedin.com/company/ledgerly'
    )
    assert.strictEqual(
      pickLinkedin(hits, person).link?.url,
      'https://www.linkedin.com/in/priya-rao-123'
    )
  })

  it('refuses a page that does not name the entity', () => {
    const pick = pickLinkedin(
      [
        hit(
          'https://www.linkedin.com/company/ledger-systems',
          'Ledger Systems | LinkedIn'
        )
      ],
      company
    )
    assert.strictEqual(pick.link, undefined)
  })

  it('does not guess between several equally good pages', () => {
    const pick = pickLinkedin(
      [
        hit(
          'https://www.linkedin.com/in/priya-rao-1',
          'Priya Rao - Designer | LinkedIn'
        ),
        hit(
          'https://www.linkedin.com/in/priya-rao-2',
          'Priya Rao - Engineer | LinkedIn'
        )
      ],
      person
    )
    assert.strictEqual(pick.link, undefined)
    assert.strictEqual(pick.ambiguous, true)
  })
})

describe('official websites', () => {
  it('never treats social networks or directories as the official site', () => {
    const { candidates } = pickWebsiteCandidates(
      [
        hit('https://www.linkedin.com/company/ledgerly', 'Ledgerly | LinkedIn'),
        hit(
          'https://www.crunchbase.com/organization/ledgerly',
          'Ledgerly - Crunchbase'
        ),
        hit('https://en.wikipedia.org/wiki/Ledgerly', 'Ledgerly - Wikipedia')
      ],
      company
    )
    assert.strictEqual(candidates.length, 0)
  })

  it('prefers a host whose name matches, and returns its homepage', () => {
    const { candidates } = pickWebsiteCandidates(
      [
        hit('https://blog.example.com/ledgerly-review', 'Ledgerly review'),
        hit('https://www.ledgerly.in/pricing', 'Pricing | Ledgerly')
      ],
      company
    )
    assert.strictEqual(candidates[0]?.url, 'https://ledgerly.in/')
  })

  it('flags two equally likely sites as ambiguous', () => {
    const { ambiguous } = pickWebsiteCandidates(
      [
        hit('https://ledgerly.com/', 'Ledgerly'),
        hit('https://ledgerly.io/', 'Ledgerly')
      ],
      company
    )
    assert.strictEqual(ambiguous, true)
  })

  it('background pages exclude the site itself and unrelated results', () => {
    const picked = pickBackgroundPages(
      [
        hit('https://ledgerly.in/about', 'About Ledgerly'),
        hit(
          'https://yourstory.com/ledgerly',
          'Ledgerly raises seed',
          'Ledgerly, a bookkeeping firm'
        ),
        hit('https://random.com/other', 'Unrelated page')
      ],
      company,
      ['ledgerly.in']
    )
    assert.deepStrictEqual(
      picked.map(p => p.url),
      ['https://yourstory.com/ledgerly']
    )
  })

  it('background pages skip lookalike sites named after the entity', () => {
    const picked = pickBackgroundPages(
      [
        hit('https://ledgerly-en.com/', 'Ledgerly Official Website'),
        hit(
          'https://yourstory.com/ledgerly',
          'Ledgerly raises seed',
          'Ledgerly, a bookkeeping firm'
        )
      ],
      company,
      ['ledgerly.in']
    )
    assert.deepStrictEqual(
      picked.map(p => p.url),
      ['https://yourstory.com/ledgerly']
    )
  })
})

describe('telling the right business from a namesake', () => {
  it('accepts a page that names the entity and shares terms with the description', () => {
    const page =
      'Ledgerly runs bookkeeping and month-end close for direct-to-consumer brands across India.'
    assert.ok((pageMatchStrength(page, company, DESCRIPTION) ?? 0) >= 2)
  })

  it('rejects a different business with the same name', () => {
    const namesake =
      'Ledgerly is a luxury leather goods boutique in Milan selling handbags and wallets.'
    assert.strictEqual(pageMatchStrength(namesake, company, DESCRIPTION), null)
  })

  it('rejects a same-trade namesake in another market', () => {
    const hoa =
      'Ledgerly provides bookkeeping and month-end close for homeowners associations across the United States.'
    assert.strictEqual(pageMatchStrength(hoa, company, DESCRIPTION), null)
  })

  it('takes the places and markets from the description, not names or noise', () => {
    const terms = marketTerms(DESCRIPTION, company)
    assert.ok(terms.includes('India'))
    // The entity, the writer and LinkedIn say who, not where or what.
    for (const left of ['Ledgerly', 'Priya', 'Rao', 'LinkedIn', 'I']) {
      assert.ok(!terms.includes(left), left)
    }
    assert.deepStrictEqual(
      marketTerms('Vercel is a platform for Next.js teams.', {
        name: 'Vercel',
        kind: 'company'
      }),
      ['Next.js']
    )
    assert.deepStrictEqual(marketTerms('we make things', company), [])
  })

  it("does not let the entity's own name pass for its market", () => {
    // Regression: "North" (from North Philadelphia) matched inside
    // "Northside", so a namesake food bank in another state was accepted.
    const pantry: Entity = { name: 'Northside Pantry', kind: 'company' }
    const description =
      'Northside Pantry is a volunteer-led food bank serving families in North Philadelphia since 2014.'
    assert.strictEqual(
      pageMatchStrength(
        'Clothing donations went to the Salvation Army and Northside Pantry, a food bank serving families, police said.',
        pantry,
        description
      ),
      null
    )
    assert.ok(
      pageMatchStrength(
        'Northside Pantry is a food bank serving families in North Philadelphia.',
        pantry,
        description
      ) !== null
    )
  })

  it('rejects a page that never names the entity', () => {
    assert.strictEqual(
      pageMatchStrength(
        'Bookkeeping for direct-to-consumer brands in India.',
        company,
        DESCRIPTION
      ),
      null
    )
  })
})

describe('figures must come from the input', () => {
  const corpus = `${DESCRIPTION} Ledgerly runs month-end close for 40 D2C brands. Founded in 2021 in Bengaluru.`

  it('allows figures that appear in the description or a source', () => {
    assert.deepStrictEqual(
      ungroundedNumbers('Closes books in 5 days, not 20.', corpus),
      []
    )
    assert.deepStrictEqual(
      ungroundedNumbers('Serves 40 brands since 2021.', corpus),
      []
    )
    assert.deepStrictEqual(
      ungroundedNumbers('A B2B and Web3 service', corpus),
      []
    )
  })

  it('flags invented years, counts and percentages', () => {
    assert.deepStrictEqual(ungroundedNumbers('Founded in 2015', corpus), [
      '2015'
    ])
    assert.deepStrictEqual(ungroundedNumbers('Over 500 clients', corpus), [
      '500'
    ])
    assert.deepStrictEqual(ungroundedNumbers('Cuts costs by 30%', corpus), [
      '30%'
    ])
    // A percentage is never "small enough" to ignore.
    assert.deepStrictEqual(ungroundedNumbers('Saves 5% on fees', corpus), [
      '5%'
    ])
  })

  it('ignores single digits that count things', () => {
    assert.deepStrictEqual(ungroundedNumbers('A 3 step process', corpus), [])
  })
})

describe('researchIdentity', () => {
  const page = (url: string, content: string): ResearchDeps['fetchPage'] => {
    return async requested => {
      if (requested.startsWith(url)) {
        return {
          status: {
            url: requested,
            kind: 'web',
            status: 'fetched',
            title: 'page'
          },
          content
        }
      }
      return {
        status: {
          url: requested,
          kind: 'web',
          status: 'unavailable',
          reason: 'nope'
        }
      }
    }
  }

  const goodSite =
    'Ledgerly runs bookkeeping and month-end close for direct-to-consumer brands across India.'

  const deps = (overrides: Partial<ResearchDeps> = {}): ResearchDeps => ({
    searchConfigured: true,
    search: async query =>
      query.includes('linkedin.com')
        ? [
            hit(
              'https://www.linkedin.com/company/ledgerly',
              'Ledgerly | LinkedIn'
            )
          ]
        : [
            hit(
              'https://ledgerly.in/',
              'Ledgerly - Month-end close for D2C brands'
            )
          ],
    fetchPage: page('https://ledgerly.in', goodSite),
    ...overrides
  })

  it('verifies the website by reading it, and finds the LinkedIn page', async () => {
    const result = await researchIdentity(
      { description: DESCRIPTION, entity: company, provided: {} },
      deps()
    )
    assert.strictEqual(result.verified.websiteUrl?.url, 'https://ledgerly.in/')
    assert.strictEqual(
      result.verified.linkedinUrl?.url,
      'https://www.linkedin.com/company/ledgerly'
    )
    assert.strictEqual(result.sources[0]?.status.kind, 'web')
    assert.deepStrictEqual(result.notes, [])
  })

  it('picks the top-ranked site when several verify, and says to check it', async () => {
    const result = await researchIdentity(
      { description: DESCRIPTION, entity: company, provided: {} },
      deps({
        search: async query =>
          query.includes('linkedin.com')
            ? []
            : [
                hit('https://ledgerly.in/', 'Ledgerly - Month-end close'),
                hit('https://ledgerly.com/', 'Ledgerly - Month-end close')
              ],
        fetchPage: async url => ({
          status: { url, kind: 'web', status: 'fetched', title: 'page' },
          content: goodSite
        })
      })
    )
    assert.strictEqual(result.verified.websiteUrl?.url, 'https://ledgerly.in/')
    assert.strictEqual(result.verified.websiteUrl?.confidence, 'medium')
    assert.ok(result.notes.some(n => n.includes('chosen from several')))
  })

  it('does not accept a site whose page is about a namesake', async () => {
    const result = await researchIdentity(
      { description: DESCRIPTION, entity: company, provided: {} },
      deps({
        fetchPage: page(
          'https://ledgerly.in',
          'Ledgerly is a luxury leather goods boutique in Milan.'
        )
      })
    )
    assert.strictEqual(result.verified.websiteUrl, undefined)
    assert.ok(result.notes.some(n => n.startsWith('Website:')))
    assert.strictEqual(result.sources.length, 0)
  })

  it('does not accept a site that could not be read', async () => {
    const result = await researchIdentity(
      { description: DESCRIPTION, entity: company, provided: {} },
      deps({ fetchPage: page('https://other.com', 'x') })
    )
    assert.strictEqual(result.verified.websiteUrl, undefined)
  })

  it('does not search for links the user already gave', async () => {
    const queries: string[] = []
    const result = await researchIdentity(
      {
        description: DESCRIPTION,
        entity: company,
        provided: {
          websiteUrl: 'https://ledgerly.in',
          linkedinUrl: 'https://linkedin.com/company/ledgerly'
        }
      },
      deps({
        search: async q => {
          queries.push(q)
          return []
        }
      })
    )
    assert.strictEqual(queries.length, 1, 'only the background search runs')
    assert.strictEqual(result.verified.websiteUrl, undefined)
    assert.deepStrictEqual(result.notes, [])
  })

  it('says so when nothing can be verified, instead of guessing', async () => {
    const result = await researchIdentity(
      { description: DESCRIPTION, entity: company, provided: {} },
      deps({ search: async () => [] })
    )
    assert.deepStrictEqual(result.verified, {})
    assert.strictEqual(result.notes.length, 2)
    assert.ok(result.notes.some(n => n.startsWith('Website:')))
    assert.ok(result.notes.some(n => n.startsWith('LinkedIn:')))
  })

  it('reports plainly when search is not configured or nobody is named', async () => {
    const off = await researchIdentity(
      { description: DESCRIPTION, entity: company, provided: {} },
      deps({ searchConfigured: false })
    )
    assert.ok(off.notes[0]?.includes('not set up'))

    const unnamed = await researchIdentity(
      { description: 'we make things', entity: null, provided: {} },
      deps()
    )
    assert.ok(unnamed.notes[0]?.includes('nothing was searched'))
  })

  it('does not search for a person known only by a first name', async () => {
    // Regression: "Sam" verified sam.gov as the website.
    let searched = false
    const result = await researchIdentity(
      {
        description: 'Hi, I am Sam.',
        entity: { name: 'Sam', kind: 'person' },
        provided: {}
      },
      deps({
        search: async () => {
          searched = true
          return []
        }
      })
    )
    assert.strictEqual(searched, false)
    assert.deepStrictEqual(result.verified, {})
    assert.ok(result.notes[0]?.includes('Only a first name'))
  })
})

describe('the guard enforces what research found', () => {
  const base = {
    description: DESCRIPTION,
    providedUrls: [] as string[],
    fetchedSources: [] as Array<{ url: string; content: string }>
  }
  const verifiedLinks = {
    websiteUrl: {
      url: 'https://ledgerly.in/',
      evidence: 'The page names Ledgerly.',
      confidence: 'high' as const
    },
    linkedinUrl: {
      url: 'https://www.linkedin.com/company/ledgerly',
      evidence: 'Search result names Ledgerly.',
      confidence: 'medium' as const
    }
  }

  it('fills empty link fields with verified links, sourced to themselves', () => {
    const { suggestions } = sanitizeIdentitySetup(
      { profile: { fields: [entry('name', 'Ledgerly')] } },
      { ...base, verifiedLinks }
    )
    assert.strictEqual(
      suggestions.profile.websiteUrl?.value,
      'https://ledgerly.in/'
    )
    assert.strictEqual(
      suggestions.profile.websiteUrl?.source,
      'https://ledgerly.in/'
    )
    assert.strictEqual(suggestions.profile.websiteUrl?.kind, 'fact')
    assert.strictEqual(suggestions.profile.linkedinUrl?.confidence, 'medium')
  })

  it('drops a link the model invented, even one that looks right', () => {
    const { suggestions, warnings } = sanitizeIdentitySetup(
      {
        profile: {
          fields: [
            entry(
              'websiteUrl',
              'https://ledgerly-books.com',
              'fact',
              'description'
            )
          ]
        }
      },
      { ...base, verifiedLinks }
    )
    assert.strictEqual(
      suggestions.profile.websiteUrl?.value,
      'https://ledgerly.in/'
    )
    assert.ok(
      warnings.some(w => w.includes('neither provided by you nor verified'))
    )
  })

  it('checks that a link fits its field', () => {
    const user = [
      'https://ledgerly.in/',
      'https://www.linkedin.com/company/ledgerly'
    ]
    const { suggestions, warnings } = sanitizeIdentitySetup(
      {
        profile: {
          fields: [
            entry('linkedinUrl', 'https://ledgerly.in/', 'fact'),
            entry(
              'websiteUrl',
              'https://www.linkedin.com/company/ledgerly',
              'fact'
            )
          ]
        }
      },
      { ...base, providedUrls: user }
    )
    // The model put each link in the wrong field; neither slot keeps it.
    assert.ok(warnings.some(w => w.includes('not a LinkedIn profile')))
    assert.ok(warnings.some(w => w.includes('LinkedIn page, not a website')))
    // The links the user typed are sorted into the right fields instead.
    assert.strictEqual(suggestions.profile.linkedinUrl?.value, user[1])
    assert.strictEqual(suggestions.profile.websiteUrl?.value, user[0])
  })

  it('keeps the goal link to ones the user wrote, never a discovered page', () => {
    const { suggestions } = sanitizeIdentitySetup(
      { goals: { fields: [entry('targetUrl', 'https://ledgerly.in/')] } },
      { ...base, verifiedLinks }
    )
    assert.strictEqual(suggestions.goals.targetUrl, undefined)
  })

  it('lets a knowledge source be a page research read', () => {
    const url = 'https://yourstory.com/ledgerly'
    const { suggestions } = sanitizeIdentitySetup(
      {
        knowledge: {
          sources: [
            { url, title: 'Ledgerly raises seed', reason: 'Funding background' }
          ]
        }
      },
      {
        ...base,
        fetchedSources: [{ url, content: 'Ledgerly raised funding.' }],
        webSourceUrls: [url]
      }
    )
    assert.strictEqual(suggestions.knowledge.sources[0]?.url, url)
    assert.strictEqual(suggestions.knowledge.sources[0]?.accessible, true)
  })

  it('labels a page found by search differently from one the user gave', () => {
    const provided = 'https://ledgerly.in/'
    const found = 'https://yourstory.com/ledgerly'
    const { suggestions } = sanitizeIdentitySetup(
      { profile: { fields: [entry('name', 'Ledgerly')] } },
      {
        ...base,
        providedUrls: [provided],
        fetchedSources: [
          { url: provided, content: 'Ledgerly home page.' },
          { url: found, content: 'Ledgerly raised funding.' }
        ],
        webSourceUrls: [found]
      }
    )
    const reasonFor = (url: string) =>
      suggestions.knowledge.sources.find(s => s.url === url)?.reason
    assert.ok(reasonFor(provided)?.startsWith('A page you provided'))
    assert.ok(reasonFor(found)?.startsWith('Found by web search'))
  })

  it('removes only the sentences that state unbacked figures', () => {
    const { suggestions, warnings } = sanitizeIdentitySetup(
      {
        profile: {
          fields: [
            entry(
              'description',
              'Ledgerly closes books in 5 days instead of 20. The firm has served over 500 clients since 2012.'
            )
          ]
        }
      },
      base
    )
    assert.strictEqual(
      suggestions.profile.description?.value,
      'Ledgerly closes books in 5 days instead of 20.'
    )
    assert.ok(
      warnings.some(w => w.includes('figures that are not in your details'))
    )
  })

  it('leaves a field blank when all of it rests on invented figures', () => {
    const { suggestions } = sanitizeIdentitySetup(
      {
        goals: {
          fields: [entry('keyMessage', 'We cut month-end close time by 73%.')]
        }
      },
      base
    )
    assert.strictEqual(suggestions.goals.keyMessage, undefined)
  })

  it('accepts figures that a read page states', () => {
    const { suggestions } = sanitizeIdentitySetup(
      {
        profile: {
          fields: [
            entry(
              'description',
              'Ledgerly runs close for 40 brands, founded in 2021.'
            )
          ]
        }
      },
      {
        ...base,
        fetchedSources: [
          {
            url: 'https://ledgerly.in/',
            content:
              'We run month-end close for 40 D2C brands. Founded in 2021.'
          }
        ]
      }
    )
    assert.ok(suggestions.profile.description?.value.includes('40 brands'))
  })

  it("replaces the model's vague note about a link with the specific one", () => {
    const { suggestions } = sanitizeIdentitySetup(
      {
        profile: {
          fields: [entry('name', 'Ledgerly')],
          missing: ['Website URL: not provided', 'Founding year: not found']
        }
      },
      {
        ...base,
        researchNotes: [
          'Website: no official site for Ledgerly could be verified.'
        ]
      }
    )
    const missing = suggestions.profile.missing
    assert.ok(!missing.includes('Website URL: not provided'))
    assert.ok(missing.includes('Founding year: not found'))
    assert.ok(missing.some(m => m.startsWith('Website: no official site')))
  })

  it('reports what could not be verified under "missing"', () => {
    const { suggestions } = sanitizeIdentitySetup(
      { profile: { fields: [entry('name', 'Ledgerly')] } },
      {
        ...base,
        researchNotes: [
          'Website: no official site for Ledgerly could be verified.'
        ]
      }
    )
    assert.ok(
      suggestions.profile.missing.some(m =>
        m.startsWith('Website: no official site')
      )
    )
  })
})
