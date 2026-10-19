import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  researchIdentity,
  type LinkPickInput,
  type LinkPicks,
  type ResearchDeps
} from '../src/lib/ai/pipeline/identity-research'
import { sanitizeIdentitySetup } from '../src/lib/ai/skills/profile-setup/guard'
import {
  canonicalLinkedinUrl,
  guessEntity,
  ungroundedNumbers,
  type Entity,
  type SearchHit
} from '../src/lib/ai/skills/profile-setup/research'

const DESCRIPTION =
  'I am Priya Rao, founder of Ledgerly, a bookkeeping and month-end close service for direct-to-consumer brands in India. We help founders close their books in 5 days instead of 20.'

const company: Entity = { name: 'Ledgerly', kind: 'company', location: 'India' }

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

describe('LinkedIn URLs', () => {
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

describe('researchIdentity: the AI picks, code checks the picks are copied from results', () => {
  const samsung: Entity = { name: 'Samsung', kind: 'company' }
  const SAMSUNG =
    'Samsung inspires the world and shapes the future with transformative ideas and technologies. For the latest news, please visit the Samsung Newsroom at http://news.samsung.com.'
  const results = {
    website: [
      hit('https://www.samsung.com/us/', 'Samsung US | Mobile | TV'),
      hit('https://news.samsung.com/global/', 'Samsung Global Newsroom'),
      hit('https://www.samsungmobilepress.com/', 'Samsung Mobile Press')
    ],
    linkedin: [
      hit(
        'https://in.linkedin.com/company/samsung-electronics?trk=x',
        'Samsung Electronics | LinkedIn'
      )
    ],
    background: [
      hit('https://www.samsung.com/us/', 'Samsung US | Mobile | TV'),
      hit(
        'https://www.forbes.com/companies/samsung-electronics/',
        'Samsung Electronics | Forbes'
      ),
      hit('https://www.wsj.com/samsung-profile', 'Samsung profile'),
      hit('https://www.ft.com/samsung', 'Samsung | FT')
    ]
  }
  const queries: string[] = []
  const search: ResearchDeps['search'] = async query => {
    queries.push(query)
    return query.includes('linkedin.com')
      ? results.linkedin
      : query.includes('official website')
        ? results.website
        : results.background
  }
  const pick = (
    url: string,
    reason = 'It fits the description.',
    confidence: 'high' | 'medium' = 'high'
  ) => ({ url, reason, confidence })
  const picked = (overrides: Partial<LinkPicks> = {}): LinkPicks => ({
    website: pick(
      'https://www.samsung.com',
      "The top results are Samsung's own regional sites."
    ),
    linkedin: pick('https://in.linkedin.com/company/samsung-electronics?trk=x'),
    background: [
      {
        url: 'https://www.forbes.com/companies/samsung-electronics/',
        reason: 'A company profile.'
      }
    ],
    ...overrides
  })
  const readable =
    (hosts: string[]): ResearchDeps['fetchPage'] =>
    async url =>
      hosts.includes(new URL(url).hostname)
        ? {
            status: { url, kind: 'web', status: 'fetched', title: 'page' },
            content: 'Samsung page text'
          }
        : {
            status: { url, kind: 'web', status: 'unavailable', reason: 'timeout' }
          }
  const run = (
    picks: LinkPicks | null,
    options: {
      fetchable?: string[]
      provided?: { websiteUrl?: string; linkedinUrl?: string }
      inputs?: LinkPickInput[]
      search?: ResearchDeps['search']
    } = {}
  ) =>
    researchIdentity(
      { description: SAMSUNG, entity: samsung, provided: options.provided ?? {} },
      {
        searchConfigured: true,
        search: options.search ?? search,
        fetchPage: readable(options.fetchable ?? ['www.samsung.com', 'www.forbes.com']),
        pickLinks: async input => {
          options.inputs?.push(input)
          return picks
        }
      }
    )

  it('gives the AI the description and every result once', async () => {
    const inputs: LinkPickInput[] = []
    await run(picked(), { inputs })
    assert.strictEqual(inputs.length, 1)
    assert.strictEqual(inputs[0]?.description, SAMSUNG)
    assert.deepStrictEqual(inputs[0]?.need, { website: true, linkedin: true })
    const urls = inputs[0]!.hits.map(h => h.url)
    assert.strictEqual(urls.filter(u => u === 'https://www.samsung.com/us/').length, 1)
    assert.ok(urls.includes('https://news.samsung.com/global/'))
  })

  it('keeps the website exactly as the results write its host', async () => {
    const result = await run(picked())
    assert.deepStrictEqual(result.verified.websiteUrl, {
      url: 'https://www.samsung.com',
      evidence: "The top results are Samsung's own regional sites.",
      confidence: 'high'
    })
    assert.strictEqual(
      result.verified.linkedinUrl?.url,
      'https://www.linkedin.com/company/samsung-electronics'
    )
    assert.deepStrictEqual(
      result.sources.map(s => [s.status.url, s.status.kind]),
      [
        ['https://www.samsung.com', 'web'],
        ['https://www.forbes.com/companies/samsung-electronics/', 'web']
      ]
    )
    assert.deepStrictEqual(result.notes, [])
  })

  it('takes the root of a result picked as the website, on the same host', async () => {
    // A regional page was picked; the Website URL is the site's homepage.
    for (const url of ['https://www.samsung.com/us/', 'https://www.samsung.com/']) {
      const result = await run(picked({ website: pick(url) }))
      assert.strictEqual(result.verified.websiteUrl?.url, 'https://www.samsung.com', url)
    }
  })

  it('never uses a link that is not among the results, an altered domain included', async () => {
    for (const url of [
      'https://samsung.com',
      'https://new.samsung.com',
      'https://www.samsung.com/about',
      'https://www.samsung.co.kr'
    ]) {
      const result = await run(picked({ website: pick(url) }))
      assert.strictEqual(result.verified.websiteUrl, undefined, url)
      assert.ok(
        result.notes.some(n => n.includes('was not among the search results')),
        url
      )
    }
    const linkedin = await run(
      picked({ linkedin: pick('https://www.linkedin.com/company/samsung') })
    )
    assert.strictEqual(linkedin.verified.linkedinUrl, undefined)
  })

  it('keeps the website when its page cannot be read, without offering it as a source', async () => {
    // Big sites often turn readers away; it used to be dropped for that.
    const result = await run(picked(), { fetchable: ['www.forbes.com'] })
    assert.strictEqual(result.verified.websiteUrl?.url, 'https://www.samsung.com')
    assert.deepStrictEqual(
      result.sources.map(s => s.status.url),
      ['https://www.forbes.com/companies/samsung-electronics/']
    )
  })

  it('says so when the AI is not sure which site is theirs', async () => {
    const result = await run(
      picked({ website: pick('https://www.samsung.com', 'Likeliest of two.', 'medium') })
    )
    assert.strictEqual(result.verified.websiteUrl?.confidence, 'medium')
    assert.ok(result.notes.some(n => n.includes('likeliest of several')))
  })

  it('reads at most two background pages from the results, never their own site', async () => {
    const result = await run(
      picked({
        background: [
          { url: 'https://www.samsung.com/us/', reason: 'Their site' },
          { url: 'https://www.samsung.com/uk/', reason: 'Not a result' },
          { url: 'https://www.wsj.com/samsung-profile', reason: 'Profile' },
          { url: 'https://www.ft.com/samsung', reason: 'Profile' },
          {
            url: 'https://www.forbes.com/companies/samsung-electronics/',
            reason: 'Profile'
          }
        ]
      }),
      { fetchable: ['www.wsj.com', 'www.ft.com', 'www.forbes.com'] }
    )
    assert.deepStrictEqual(
      result.sources.map(s => s.status.url),
      ['https://www.wsj.com/samsung-profile', 'https://www.ft.com/samsung']
    )
  })

  it("reports what the AI could not find, in the AI's words", async () => {
    const result = await run(
      picked({
        website: pick('', 'Only a newsroom and press sites appeared.'),
        linkedin: pick('', '')
      })
    )
    assert.deepStrictEqual(result.verified, {})
    assert.deepStrictEqual(result.notes, [
      'LinkedIn: no company page for Samsung was found. Paste the URL if you have one.',
      'Website: no official site for Samsung was found (Only a newsroom and press sites appeared). Paste it if you have one.'
    ])
  })

  it('does not look for, or take, links the user already gave', async () => {
    queries.length = 0
    const inputs: LinkPickInput[] = []
    const result = await run(picked(), {
      inputs,
      provided: {
        websiteUrl: 'https://www.samsung.com',
        linkedinUrl: 'https://www.linkedin.com/company/samsung-electronics'
      }
    })
    assert.strictEqual(queries.length, 1, 'only the background search runs')
    assert.deepStrictEqual(inputs[0]?.need, { website: false, linkedin: false })
    assert.deepStrictEqual(result.verified, {})
    assert.deepStrictEqual(result.notes, [])
  })

  it('reports a failed AI step instead of guessing', async () => {
    const result = await run(null)
    assert.deepStrictEqual(result.verified, {})
    assert.ok(result.notes[0]?.includes('could not be completed'))
  })

  it('says so when search finds nothing, without asking the AI', async () => {
    const inputs: LinkPickInput[] = []
    const result = await run(picked(), { inputs, search: async () => [] })
    assert.strictEqual(inputs.length, 0)
    assert.deepStrictEqual(result.verified, {})
    assert.ok(result.notes.some(n => n.startsWith('Website:')))
    assert.ok(result.notes.some(n => n.startsWith('LinkedIn:')))
  })

  const deps = (overrides: Partial<ResearchDeps> = {}): ResearchDeps => ({
    searchConfigured: true,
    search,
    fetchPage: readable([]),
    pickLinks: async () => picked(),
    ...overrides
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
