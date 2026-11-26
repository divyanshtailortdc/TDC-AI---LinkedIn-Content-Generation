import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  BlogBriefSchema,
  normalizeKeywords,
  parseCreateInput,
  parseInstruction,
  parsePublishInput,
  parseSaveInput
} from '../src/lib/blogs/input'

const REQUEST_ID = '0b6f7c5e-2f4a-4c2b-9a51-6c3a0d2f9e11'
const BRIEF = { topic: 'Cart abandonment', length: 'medium', style: 'how_to' }

const saveInput = (overrides: Record<string, unknown> = {}) => ({
  lockVersion: 2,
  title: ' T ',
  slug: 'my-slug',
  metaTitle: '',
  metaDescription: '',
  primaryKeyword: '',
  keywords: [],
  faq: [],
  content: { type: 'doc', content: [] },
  ...overrides
})

describe('the brief', () => {
  it('fills its defaults and trims it', () => {
    assert.deepStrictEqual(
      BlogBriefSchema.parse({
        topic: '  x  ',
        length: 'medium',
        style: 'how_to'
      }),
      {
        topic: 'x',
        primaryKeyword: '',
        secondaryKeywords: [],
        length: 'medium',
        style: 'how_to',
        audience: { audienceId: null, note: '' },
        research: true,
        knowledge: true,
        faq: true,
        instructions: '',
        caseDetails: ''
      }
    )
  })

  it('refuses an empty topic', () => {
    assert.deepStrictEqual(
      parseCreateInput({
        requestId: REQUEST_ID,
        kind: 'blog',
        brief: { ...BRIEF, topic: '  ' }
      }),
      { ok: false, error: 'Enter a topic.' }
    )
  })

  it('dedupes secondary keywords without case, collapses spaces and keeps ten', () => {
    assert.deepStrictEqual(
      normalizeKeywords([
        'A',
        'a',
        ' b  c ',
        '',
        ...Array.from({ length: 12 }, (_, i) => `k${i}`)
      ]),
      ['A', 'b c', 'k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']
    )
  })

  it('leaves the primary keyword out of the secondary ones', () => {
    assert.deepStrictEqual(
      BlogBriefSchema.parse({
        ...BRIEF,
        primaryKeyword: 'Cart abandonment',
        secondaryKeywords: ['cart abandonment', 'checkout']
      }).secondaryKeywords,
      ['checkout']
    )
  })

  it('accepts a valid request with no idea or goal', () => {
    const result = parseCreateInput({
      requestId: REQUEST_ID,
      kind: 'article',
      brief: BRIEF
    })
    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.strictEqual(result.value.kind, 'article')
      assert.strictEqual(result.value.ideaId, null)
      assert.strictEqual(result.value.goalId, null)
      assert.strictEqual(result.value.requestId, REQUEST_ID)
    }
  })

  it('needs a request id', () => {
    assert.strictEqual(
      parseCreateInput({ kind: 'blog', brief: BRIEF }).ok,
      false
    )
  })

  it('refuses an unknown length', () => {
    assert.strictEqual(
      parseCreateInput({
        requestId: REQUEST_ID,
        kind: 'blog',
        brief: { ...BRIEF, length: 'huge' }
      }).ok,
      false
    )
  })
})

describe('case studies', () => {
  const CASE =
    'Northwind Valves, a distributor, moved orders and stock onto one system in 2025; credit notes for wrong shipments fell from 42 to 9 a month.'

  it('needs the real case details for a case study', () => {
    assert.deepStrictEqual(
      parseCreateInput({
        requestId: REQUEST_ID,
        kind: 'article',
        brief: { ...BRIEF, style: 'case_study', caseDetails: '  ' }
      }),
      {
        ok: false,
        error:
          'Describe the real case: who, the problem, what was done and the results.'
      }
    )
  })

  it('keeps the case details, trimmed', () => {
    const result = parseCreateInput({
      requestId: REQUEST_ID,
      kind: 'article',
      brief: { ...BRIEF, style: 'case_study', caseDetails: `  ${CASE}  ` }
    })
    assert.strictEqual(result.ok, true)
    if (!result.ok) return
    assert.strictEqual(result.value.brief.caseDetails, CASE)
    assert.strictEqual(result.value.brief.style, 'case_study')
  })

  it('does not ask other styles for case details', () => {
    const result = parseCreateInput({
      requestId: REQUEST_ID,
      kind: 'blog',
      brief: { ...BRIEF, style: 'comparison' }
    })
    assert.strictEqual(result.ok, true)
    if (!result.ok) return
    assert.strictEqual(result.value.brief.caseDetails, '')
  })

  it('refuses case details over 3,000 characters', () => {
    const result = parseCreateInput({
      requestId: REQUEST_ID,
      kind: 'article',
      brief: { ...BRIEF, style: 'case_study', caseDetails: 'x'.repeat(3001) }
    })
    assert.deepStrictEqual(result, {
      ok: false,
      error: 'Keep the case details under 3,000 characters.'
    })
  })
})

describe('saving', () => {
  it('keeps the search intent, the image alt text and caption', () => {
    const result = parseSaveInput(
      saveInput({
        searchIntent: 'commercial',
        featuredAlt: '  A warehouse team packing orders  ',
        featuredCaption: ' Packing at a distributor '
      })
    )
    assert.strictEqual(result.ok, true)
    if (!result.ok) return
    assert.strictEqual(result.edit.searchIntent, 'commercial')
    assert.strictEqual(result.edit.featuredAlt, 'A warehouse team packing orders')
    assert.strictEqual(result.edit.featuredCaption, 'Packing at a distributor')
  })

  it('reads an unknown search intent as none, and missing image text as empty', () => {
    const result = parseSaveInput(saveInput({ searchIntent: 'weird' }))
    assert.strictEqual(result.ok, true)
    if (!result.ok) return
    assert.strictEqual(result.edit.searchIntent, '')
    assert.strictEqual(result.edit.featuredAlt, '')
    assert.strictEqual(result.edit.featuredCaption, '')
  })

  it('refuses alt text over 300 characters', () => {
    assert.deepStrictEqual(
      parseSaveInput(saveInput({ featuredAlt: 'a'.repeat(301) })),
      { ok: false, error: 'Keep the alt text under 300 characters.' }
    )
  })

  it('sanitizes the document, the slug, the title and the FAQ', () => {
    const result = parseSaveInput(
      saveInput({
        slug: 'My Slug!',
        faq: [
          { question: 'Q', answer: '' },
          { question: ' ', answer: ' ' }
        ],
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'x',
                  marks: [
                    { type: 'link', attrs: { href: 'javascript:alert(1)' } }
                  ]
                }
              ]
            }
          ]
        }
      })
    )
    assert.strictEqual(result.ok, true)
    if (!result.ok) return
    assert.strictEqual(result.lockVersion, 2)
    assert.strictEqual(result.edit.title, 'T')
    assert.strictEqual(result.edit.slug, 'my-slug')
    assert.deepStrictEqual(result.edit.faq, [{ question: 'Q', answer: '' }])
    assert.deepStrictEqual(result.edit.content, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }]
    })
  })

  it('refuses an unsupported document', () => {
    assert.deepStrictEqual(
      parseSaveInput(
        saveInput({ content: { type: 'doc', content: [{ type: 'codeBlock' }] } })
      ),
      {
        ok: false,
        error: 'This document has content the editor cannot save (codeBlock).'
      }
    )
  })

  it('needs the lock version it was loaded with', () => {
    const { lockVersion: _, ...rest } = saveInput()
    assert.strictEqual(parseSaveInput(rest).ok, false)
  })
})

describe('instructions and publishing', () => {
  it('refuses instructions over 1,000 characters and reads blank as none', () => {
    assert.deepStrictEqual(parseInstruction('x'.repeat(1001)), {
      ok: false,
      error: 'Keep the instructions under 1,000 characters.'
    })
    assert.deepStrictEqual(parseInstruction('  '), {
      ok: true,
      instruction: null
    })
    assert.deepStrictEqual(parseInstruction(undefined), {
      ok: true,
      instruction: null
    })
    assert.deepStrictEqual(parseInstruction(' Shorter. '), {
      ok: true,
      instruction: 'Shorter.'
    })
  })

  it('accepts only http(s) addresses for a published blog', () => {
    assert.deepStrictEqual(
      parsePublishInput({ published: true, url: 'javascript:alert(1)' }),
      {
        ok: false,
        error: 'Enter a web address that starts with http:// or https://.'
      }
    )
    assert.deepStrictEqual(parsePublishInput({ published: true, url: '' }), {
      ok: true,
      published: true,
      url: null,
      destination: 'website',
      publishedAt: null
    })
    assert.deepStrictEqual(
      parsePublishInput({ published: true, url: ' https://example.com/post ' }),
      {
        ok: true,
        published: true,
        url: 'https://example.com/post',
        destination: 'website',
        publishedAt: null
      }
    )
  })

  it('records where and when a blog was published', () => {
    const result = parsePublishInput({
      published: true,
      url: null,
      destination: 'shopify',
      publishedAt: '2026-11-20T06:30:00.000Z'
    })
    assert.ok(result.ok)
    assert.strictEqual(result.destination, 'shopify')
    assert.strictEqual(
      result.publishedAt?.toISOString(),
      '2026-11-20T06:30:00.000Z'
    )
  })

  it('refuses a destination it does not know', () => {
    assert.strictEqual(
      parsePublishInput({ published: true, destination: 'medium' }).ok,
      false
    )
    assert.strictEqual(
      parsePublishInput({ published: true, destination: 'linkedin' }).ok,
      false
    )
  })

  it('refuses a publication date in the future, before 2000, or unreadable', () => {
    const twoDaysAhead = new Date(Date.now() + 2 * 86_400_000).toISOString()
    assert.deepStrictEqual(
      parsePublishInput({ published: true, publishedAt: twoDaysAhead }),
      { ok: false, error: 'The publication date can’t be in the future.' }
    )
    assert.deepStrictEqual(
      parsePublishInput({ published: true, publishedAt: '1999-12-31T12:00:00Z' }),
      { ok: false, error: 'Enter a publication date from 2000 on.' }
    )
    assert.strictEqual(
      parsePublishInput({ published: true, publishedAt: 'yesterday' }).ok,
      false
    )
  })

  it('accepts a date a few hours ahead, for time zones east of the server', () => {
    const later = new Date(Date.now() + 6 * 3_600_000).toISOString()
    assert.strictEqual(
      parsePublishInput({ published: true, publishedAt: later }).ok,
      true
    )
  })

  it('keeps nothing about publishing for a draft', () => {
    assert.deepStrictEqual(
      parsePublishInput({
        published: false,
        url: 'https://x.test/a',
        destination: 'wordpress',
        publishedAt: '2026-11-20T06:30:00.000Z'
      }),
      {
        ok: true,
        published: false,
        url: null,
        destination: null,
        publishedAt: null
      }
    )
  })
})
