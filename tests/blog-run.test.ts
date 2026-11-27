import { desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import {
  checkBlogSourcesNow,
  rewriteBlogSectionNow,
  runBlogGeneration
} from '../src/lib/ai/pipeline/blog-run'
import { SkillError } from '../src/lib/ai/run-skill'
import type {
  BlogDraft,
  BlogSectionDraft
} from '../src/lib/ai/skills/blog-drafting/schema'
import { EMPTY_USAGE, type CallUsage } from '../src/lib/ai/usage'
import {
  claimBlogGeneration,
  createClaimedBlog,
  type BlogClaim
} from '../src/lib/blogs/claim'
import { docLinks, docSections, docText } from '../src/lib/blogs/doc'
import type {
  BlogBrief,
  BlogImage,
  BlogPlan,
  BlogSource,
  FeaturedImage,
  SearchQuestion
} from '../src/lib/blogs/types'
import { account, context } from './fixtures/generation'

// Runs against the local development database with the model stubbed out:
// no paid call is made. Every row it makes is removed.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]

const BRIEF: BlogBrief = {
  topic: 'Reducing cart abandonment',
  primaryKeyword: 'cart abandonment',
  secondaryKeywords: ['checkout design'],
  length: 'medium',
  style: 'how_to',
  audience: { audienceId: null, note: '' },
  research: true,
  knowledge: true,
  faq: true,
  instructions: '',
  caseDetails: ''
}

const cost = (costUsd: number): CallUsage => ({
  ...EMPTY_USAGE,
  calls: 1,
  costUsd
})

const POOL: BlogSource[] = [
  {
    id: 'S1',
    origin: 'web',
    title: 'Checkout study',
    url: 'https://example.com/study',
    quote: 'Surprise fees drive cart abandonment.',
    cited: false
  },
  {
    id: 'K1',
    origin: 'knowledge',
    title: 'Pricing guide',
    url: null,
    quote: 'Our checkout has few steps.',
    cited: false
  }
]

const DRAFT: BlogDraft = {
  title: 'Cart abandonment: fixes for small shops',
  slug: 'cart-abandonment-fixes',
  metaTitle: 'Cart abandonment: fixes for small online shops',
  metaDescription:
    'Why shoppers leave carts behind and the checkout design changes that bring them back, from fees to reminders and trust.',
  primaryKeyword: 'cart abandonment',
  secondaryKeywords: ['checkout design'],
  introduction: [
    'Cart abandonment costs small shops sales, as [the checkout study](https://example.com/study) shows.'
  ],
  sections: [
    {
      heading: 'Why carts are left',
      lead: '',
      blocks: [
        { type: 'paragraph', text: 'Surprise fees drive shoppers away.' }
      ]
    },
    {
      heading: 'Fix the checkout design',
      lead: '',
      blocks: [
        { type: 'paragraph', text: 'Show every cost before the last step.' }
      ]
    },
    {
      heading: 'Send reminders',
      lead: '',
      blocks: [
        {
          type: 'paragraph',
          text: 'A short reminder brings some shoppers back.'
        }
      ]
    },
    {
      heading: 'Start with fees',
      lead: '',
      blocks: [
        {
          type: 'paragraph',
          text: 'Remove surprise fees first. See [our kit](https://qa.test/kit).'
        }
      ]
    }
  ],
  searchIntent: 'informational',
  keyTakeaways: [],
  faq: [
    {
      question: 'What is cart abandonment?',
      answer: 'Leaving a cart before paying.'
    },
    { question: 'Is it normal?', answer: 'Yes, every shop sees it.' },
    { question: 'What helps first?', answer: 'Showing fees early.' }
  ],
  sourcesUsed: ['S1'],
  selfFlags: []
}

const BAD: BlogDraft = {
  ...DRAFT,
  introduction: [
    '83% of carts are abandoned, which is a problem for cart abandonment.'
  ]
}

type Writer = (
  input: unknown,
  mode?: {
    regenerate?: { current: { title: string }; instruction: string | null }
    timeoutMs?: number
    modelId?: string
  }
) => Promise<{ draft: BlogDraft; usage: CallUsage; modelId: string }>

/** A model that answers with these drafts in turn; its calls are kept. */
function stubWriter(drafts: BlogDraft[]) {
  const calls: Array<Parameters<Writer>[1]> = []
  const inputs: Array<{ brief: BlogBrief; plan: BlogPlan | null }> = []
  const writer: Writer = async (input, mode) => {
    calls.push(mode)
    inputs.push(input as { brief: BlogBrief; plan: BlogPlan | null })
    const draft = drafts[Math.min(calls.length - 1, drafts.length - 1)]!
    return { draft, usage: cost(0.05), modelId: 'stub-model' }
  }
  return { writer, calls, inputs }
}

const PLAN: BlogPlan = {
  searchIntent: 'informational',
  primaryKeyword: 'cart abandonment',
  secondaryKeywords: ['checkout design'],
  readerNeed: 'Why do shoppers leave?',
  angle: 'Fees cause more abandonment than design.',
  originality: 'A ranking of fixes.',
  workingTitle: 'Cart abandonment fixes',
  sections: [
    { heading: 'Why carts are left', purpose: '', points: [], sourceIds: ['S1'], element: 'none', elementNote: '' },
    { heading: 'Fix the checkout design', purpose: '', points: [], sourceIds: [], element: 'none', elementNote: '' }
  ],
  takeaways: false,
  faq: [],
  product: { role: 'mention', where: 'Last section', note: '' },
  cta: { kind: 'resource', text: 'See the kit', url: null },
  featuredImage: { concept: 'A cart left in a shop aisle', alt: 'A cart left in an aisle', style: 'photo' },
  internalLinks: [
    { url: 'https://qa.test/kit', anchor: 'our kit', sectionIndex: 4, reason: 'The product' },
    { url: 'https://qa.test/guide', anchor: 'the guide', sectionIndex: 1, reason: 'More' }
  ],
  gaps: [],
  cautions: []
}

const QUESTIONS: SearchQuestion[] = [
  { text: 'Why do people abandon carts?', origin: 'people_also_ask' },
  { text: 'cart abandonment rate', origin: 'related' }
]

/** A plan that asks for pictures in its first two sections. */
const PICTURE_PLAN: BlogPlan = {
  ...PLAN,
  imageDirection: 'Soft daylight, muted colours',
  supportingImages: [
    { sectionIndex: 1, concept: 'A cart left by a till', alt: 'A full cart left by a till', caption: 'Fees surprise shoppers at the till.', style: 'photo' },
    { sectionIndex: 2, concept: 'A tidy checkout counter', alt: 'A tidy checkout counter', caption: 'A short checkout.', style: 'photo' }
  ]
}

const picture = (id: string): BlogImage => ({
  id,
  src: 'data:image/webp;base64,BBBB',
  width: 1200,
  height: 800,
  mediaType: 'image/webp',
  model: 'stub-image',
  prompt: 'p',
  concept: 'c',
  createdAt: '2026-11-26T10:00:00.000Z'
})

const READY_IMAGE: FeaturedImage = {
  status: 'ready',
  src: 'data:image/webp;base64,AAAA',
  alt: 'A cart left in an aisle',
  caption: '',
  width: 1600,
  height: 900,
  mediaType: 'image/webp',
  model: 'stub-image',
  prompt: 'p',
  createdAt: '2026-11-25T10:00:00.000Z'
}

describe('writing a blog', { skip: !url }, () => {
  const client = postgres(url!, { max: 4, prepare: false })
  const database = drizzle(client, { schema })
  const handle = `qa-blogrun-${Date.now().toString(36)}`
  let accountId = ''
  let gathered = 0

  const gatherSources = async (
    _ctx: unknown,
    input: { onStage: (stage: 'research' | 'knowledge') => Promise<unknown> }
  ) => {
    gathered++
    await input.onStage('research')
    return { sources: POOL, usage: cost(0.01), notes: [] }
  }
  const loadContext = async () => ({
    ctx: context({ account: account({ id: accountId, name: 'QA Run' }) }),
    idea: null
  })
  const planned: Array<{
    timeoutMs?: number
    brief: BlogBrief
    questions?: SearchQuestion[]
    newPictures?: boolean
  }> = []
  const asked: BlogBrief[] = []
  const images: string[] = []
  const judgedClaims: string[][] = []
  /** Every model call a run makes, faked: nothing here costs money. */
  const fakes = {
    gatherLinks: async () => ({
      candidates: [
        { url: 'https://qa.test/kit', title: 'Checkout kit', kind: 'offering' as const },
        { url: 'https://qa.test/guide', title: 'Guide', kind: 'page' as const }
      ],
      related: []
    }),
    planBlog: async (
      input: { brief: BlogBrief; questions?: SearchQuestion[]; newPictures?: boolean },
      options: { timeoutMs?: number }
    ) => {
      planned.push({
        timeoutMs: options.timeoutMs,
        brief: input.brief,
        questions: input.questions,
        newPictures: input.newPictures
      })
      return { plan: PLAN, usage: cost(0.02), modelId: 'stub-planner' }
    },
    gatherQuestions: async (_ctx: unknown, brief: BlogBrief) => {
      asked.push(brief)
      return { questions: QUESTIONS, phrases: ['cart abandonment'], usage: cost(0.001) }
    },
    judgeCitations: async (input: { claims: Array<{ id: string; sentence: string }> }) => {
      judgedClaims.push(input.claims.map(c => c.sentence))
      return {
        verdicts: input.claims.map(c => ({ id: c.id, verdict: 'supported' as const, reason: '' })),
        issues: [],
        usage: cost(0.01),
        modelId: 'stub-judge'
      }
    },
    fixBlogSentences: async () => ({ replacements: [], usage: cost(0.01), modelId: 'stub-fixer' }),
    makeFeaturedImage: async (request: { concept: string }) => {
      images.push(request.concept)
      return { image: READY_IMAGE, usage: cost(0.07) }
    },
    sleep: async () => {}
  }
  const deps = (more: Record<string, unknown> = {}) =>
    ({ db: database, loadContext, gatherSources, ...fakes, ...more }) as never

  const newClaim = async (
    now?: Date,
    ideaId: string | null = null,
    brief: BlogBrief = BRIEF
  ): Promise<BlogClaim> => {
    const created = await createClaimedBlog(
      database,
      {
        id: randomUUID(),
        accountId,
        ideaId,
        goalId: null,
        kind: 'blog',
        brief
      },
      now
    )
    if (created.outcome !== 'created') throw new Error('not created')
    return created.claim
  }
  const rowOf = async (blogId: string) => {
    const [row] = await database
      .select()
      .from(schema.blogsTable)
      .where(eq(schema.blogsTable.id, blogId))
    return row!
  }
  const written = async () => {
    const claim = await newClaim()
    const { writer } = stubWriter([DRAFT])
    assert.strictEqual(
      await runBlogGeneration(claim, {}, deps({ writeBlog: writer })),
      'saved'
    )
    return claim.blogId
  }

  before(async () => {
    await client`delete from accounts where handle like 'qa-blogrun-%'`
    const [row] = await database
      .insert(schema.accountsTable)
      .values({
        name: 'QA Run',
        accountType: 'company',
        handle,
        headline: 'QA'
      })
      .returning()
    accountId = row!.id
  })
  after(async () => {
    await client`delete from accounts where handle like 'qa-blogrun-%'`
    await client.end()
    // The app's own pool, used by the real context loader.
    await (globalThis as { conn?: { end: () => Promise<void> } }).conn?.end()
  })

  it('writes a blog: document, FAQ, slug, cited sources, checks, ready', async () => {
    const claim = await newClaim()
    const { writer } = stubWriter([DRAFT])
    assert.strictEqual(
      await runBlogGeneration(claim, {}, deps({ writeBlog: writer })),
      'saved'
    )
    const row = await rowOf(claim.blogId)
    assert.strictEqual(row.generationStatus, 'ready')
    assert.strictEqual(row.generationStage, null)
    assert.strictEqual(row.title, 'Cart abandonment: fixes for small shops')
    assert.strictEqual(row.slug, 'cart-abandonment-fixes')
    assert.strictEqual(row.content.type, 'doc')
    assert.strictEqual(row.faq.length, 3)
    assert.deepStrictEqual(
      row.sources.map(s => [s.id, s.cited]),
      [
        ['S1', true],
        ['K1', false]
      ]
    )
    assert.ok(row.wordCount > 30, String(row.wordCount))
    assert.ok(row.checks.some(f => f.rule === 'seo_meta_description'))
    assert.ok(row.checks.some(f => f.rule === 'unsupported_figures'))
    // Sources 0.01, questions 0.001, plan 0.02, text 0.05, citation check
    // 0.01, image 0.07.
    assert.ok(
      Math.abs(row.usage.costUsd! - 0.161) < 1e-9,
      String(row.usage.costUsd)
    )
    assert.strictEqual(row.model, 'stub-model')
    assert.deepStrictEqual(row.plan, PLAN)
    assert.strictEqual(row.searchIntent, 'informational')
    assert.deepStrictEqual(row.featuredImage, READY_IMAGE)
    assert.deepStrictEqual(
      row.verification?.citations.map(c => [c.sourceId, c.verdict]),
      [['S1', 'supported']]
    )
    assert.deepStrictEqual(
      row.internalLinks.map(link => [link.title, link.placed]),
      [
        ['Checkout kit', true],
        ['Guide', false]
      ]
    )
  })

  it('writes without a plan when planning fails, and says so', async () => {
    const claim = await newClaim()
    const { writer, inputs } = stubWriter([DRAFT])
    assert.strictEqual(
      await runBlogGeneration(
        claim,
        {},
        deps({
          writeBlog: writer,
          planBlog: async () => {
            throw new SkillError('The model returned an unusable plan.', 'failed', { usage: cost(0.02) })
          }
        })
      ),
      'saved'
    )
    assert.strictEqual(inputs[0]?.plan, null)
    const row = await rowOf(claim.blogId)
    assert.strictEqual(row.plan, null)
    assert.ok(row.selfFlags.some(flag => flag.startsWith('Planned while writing')), row.selfFlags.join('\n'))
  })

  it('takes a link off a sentence its source does not support, and flags it', async () => {
    const claim = await newClaim()
    const { writer } = stubWriter([DRAFT])
    const fixer = { calls: 0 }
    assert.strictEqual(
      await runBlogGeneration(
        claim,
        {},
        deps({
          writeBlog: writer,
          judgeCitations: async (input: { claims: Array<{ id: string }> }) => ({
            verdicts: input.claims.map(c => ({ id: c.id, verdict: 'unsupported', reason: 'The study does not say that.' })),
            issues: [],
            usage: cost(0.01),
            modelId: 'stub-judge'
          }),
          fixBlogSentences: async () => {
            fixer.calls++
            return { replacements: [], usage: cost(0.01), modelId: 'stub-fixer' }
          }
        })
      ),
      'saved'
    )
    assert.strictEqual(fixer.calls, 1)
    const row = await rowOf(claim.blogId)
    assert.ok(!docLinks(row.content).includes('https://example.com/study'))
    assert.ok(docText(row.content).includes('as the checkout study shows'))
    assert.strictEqual(row.verification?.removedLinks[0]?.sourceId, 'S1')
    assert.ok(row.selfFlags.some(flag => flag.startsWith('Took the link to Checkout study off')))
  })

  it('rewrites a sentence with an invented figure and keeps the rest', async () => {
    const claim = await newClaim()
    const { writer, calls } = stubWriter([BAD])
    const asked: Array<Array<{ id: string; sentence: string; problem: string }>> = []
    assert.strictEqual(
      await runBlogGeneration(
        claim,
        {},
        deps({
          writeBlog: writer,
          fixBlogSentences: async (input: { fixes: Array<{ id: string; sentence: string; problem: string }> }) => {
            asked.push(input.fixes)
            return {
              replacements: input.fixes.map(fix => ({ id: fix.id, replacement: 'Many carts are left before payment.' })),
              usage: cost(0.01),
              modelId: 'stub-fixer'
            }
          }
        })
      ),
      'saved'
    )
    assert.strictEqual(calls.length, 1)
    assert.ok(asked[0]?.some(fix => fix.problem.includes('"83%"')), JSON.stringify(asked))
    const row = await rowOf(claim.blogId)
    const text = docText(row.content)
    assert.ok(!text.includes('83%'))
    assert.ok(text.includes('Many carts are left before payment.'))
    assert.ok(text.includes('Show every cost before the last step.'))
    assert.strictEqual(row.checks.find(f => f.rule === 'unsupported_figures')?.passed, true)
  })

  it('asks for a sentence copied word for word from a source to be put in its own words', async () => {
    const claim = await newClaim()
    const pool: BlogSource[] = [
      { ...POOL[0]!, quote: 'Shoppers leave when shipping costs appear only at the final step of checkout.' },
      POOL[1]!
    ]
    const copied: BlogDraft = {
      ...DRAFT,
      sections: [
        {
          heading: 'Why carts are left',
          lead: '',
          blocks: [
            {
              type: 'paragraph',
              text: 'Shoppers leave when shipping costs appear only at the final step of checkout, according to [the checkout study](https://example.com/study).'
            }
          ]
        },
        ...DRAFT.sections.slice(1)
      ]
    }
    const { writer } = stubWriter([copied])
    const asked: Array<Array<{ id: string; sentence: string; problem: string }>> = []
    assert.strictEqual(
      await runBlogGeneration(
        claim,
        {},
        deps({
          writeBlog: writer,
          gatherSources: async (
            _ctx: unknown,
            input: { onStage: (stage: 'research' | 'knowledge') => Promise<unknown> }
          ) => {
            await input.onStage('research')
            return { sources: pool, usage: cost(0.01), notes: [] }
          },
          fixBlogSentences: async (input: { fixes: Array<{ id: string; sentence: string; problem: string }> }) => {
            asked.push(input.fixes)
            return {
              replacements: input.fixes.map(fix => ({
                id: fix.id,
                replacement:
                  'Shipping costs that show up only at the last step push shoppers away, according to [the checkout study](https://example.com/study).'
              })),
              usage: cost(0.01),
              modelId: 'stub-fixer'
            }
          }
        })
      ),
      'saved'
    )
    const fix = asked[0]?.find(f => f.sentence.includes('final step of checkout'))
    assert.ok(fix?.problem.includes('word for word'), JSON.stringify(asked))
    const row = await rowOf(claim.blogId)
    const text = docText(row.content)
    assert.ok(!text.includes('appear only at the final step of checkout'))
    assert.ok(text.includes('show up only at the last step'))
    // The check only reports a copy it finds.
    assert.ok(!row.checks.some(f => f.rule === 'copied_source_text' && !f.passed))
  })

  it('skips the fixes when time is short', async () => {
    const claim = await newClaim()
    const { writer } = stubWriter([BAD])
    const fixer = { calls: 0 }
    const late = () => claim.claimedAt.getTime() + 230_000
    assert.strictEqual(
      await runBlogGeneration(
        claim,
        {},
        deps({
          writeBlog: writer,
          now: late,
          fixBlogSentences: async () => {
            fixer.calls++
            return { replacements: [], usage: cost(0.01), modelId: 'stub-fixer' }
          }
        })
      ),
      'saved'
    )
    assert.strictEqual(fixer.calls, 0)
    const row = await rowOf(claim.blogId)
    const figures = row.checks.find(f => f.rule === 'unsupported_figures')!
    assert.strictEqual(figures.passed, false)
  })

  it('saves a slow run in time, giving up the image', async () => {
    const claim = await newClaim()
    const { writer } = stubWriter([DRAFT])
    let clock = claim.claimedAt.getTime()
    let aborted = false
    assert.strictEqual(
      await runBlogGeneration(
        claim,
        {},
        deps({
          now: () => clock,
          gatherSources: async () => {
            clock += 100_000
            return { sources: POOL, usage: cost(0.01), notes: [] }
          },
          planBlog: async () => {
            clock += 45_000
            return { plan: PLAN, usage: cost(0.02), modelId: 'stub-planner' }
          },
          writeBlog: async (input: unknown, mode: unknown) => {
            clock += 100_000
            return writer(input, mode as never)
          },
          makeFeaturedImage: (request: { abortSignal?: AbortSignal }) =>
            new Promise(resolve => {
              request.abortSignal?.addEventListener('abort', () => {
                aborted = true
                resolve({ image: READY_IMAGE, usage: cost(0.07) })
              })
            })
        })
      ),
      'saved'
    )
    assert.strictEqual(aborted, true)
    const row = await rowOf(claim.blogId)
    assert.strictEqual(row.generationStatus, 'ready')
    assert.strictEqual(row.featuredImage?.status, 'failed')
  })

  it('keeps the featured image when regenerating, unless asked for a new one', async () => {
    const blogId = await written()
    const before = images.length
    const again = await claimBlogGeneration(database, { accountId, blogId })
    await runBlogGeneration(again!, {}, deps({ writeBlog: stubWriter([DRAFT]).writer }))
    assert.strictEqual(images.length, before)
    assert.deepStrictEqual((await rowOf(blogId)).featuredImage, READY_IMAGE)
    const third = await claimBlogGeneration(database, { accountId, blogId })
    await runBlogGeneration(third!, { newImage: true }, deps({ writeBlog: stubWriter([DRAFT]).writer }))
    assert.strictEqual(images.length, before + 1)
  })

  it('regenerates a blog written before plans and checks existed', async () => {
    const [legacy] = await database
      .insert(schema.blogsTable)
      .values({
        accountId,
        brief: { ...BRIEF, caseDetails: undefined } as unknown as BlogBrief,
        title: 'An older blog',
        wordCount: 120,
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old text.' }] }] },
        sources: [{ id: 'S1', origin: 'web', title: 'Old', url: 'https://example.com/old', quote: 'Old quote.', cited: true }],
        generationStatus: 'ready'
      })
      .returning()
    const claim = await claimBlogGeneration(database, { accountId, blogId: legacy!.id })
    assert.strictEqual(
      await runBlogGeneration(claim!, {}, deps({ writeBlog: stubWriter([DRAFT]).writer })),
      'saved'
    )
    const row = await rowOf(legacy!.id)
    assert.strictEqual(row.generationStatus, 'ready')
    assert.ok(row.plan)
  })

  it("checks a saved blog's sources again without changing its text", async () => {
    const blogId = await written()
    // A blog never checked (an older one): every citation is judged.
    await database
      .update(schema.blogsTable)
      .set({ verification: null })
      .where(eq(schema.blogsTable.id, blogId))
    const before = await rowOf(blogId)
    const sent: number[] = []
    const judge = deps({
      judgeCitations: async (input: { claims: Array<{ id: string }> }) => {
        sent.push(input.claims.length)
        return {
          verdicts: input.claims.map(c => ({ id: c.id, verdict: 'partial', reason: 'Only fees.' })),
          issues: [],
          usage: cost(0.01),
          modelId: 'stub-judge'
        }
      }
    })
    const result = await checkBlogSourcesNow(
      { accountId, blogId, lockVersion: before.lockVersion },
      judge
    )
    assert.strictEqual(result.ok, true)
    const row = await rowOf(blogId)
    assert.deepStrictEqual(row.content, before.content)
    assert.ok(sent[0]! > 0)
    assert.strictEqual(row.verification?.citations[0]?.verdict, 'partial')
    assert.strictEqual(row.lockVersion, before.lockVersion)

    // Checked again with nothing edited: the verdicts are kept, none re-sent.
    const again = await checkBlogSourcesNow(
      { accountId, blogId, lockVersion: row.lockVersion },
      judge
    )
    assert.strictEqual(again.ok, true)
    assert.strictEqual(sent[1], 0)
    const after = await rowOf(blogId)
    assert.strictEqual(
      after.verification?.citations.length,
      row.verification?.citations.length
    )
    assert.strictEqual(after.verification?.citations[0]?.verdict, 'partial')
  })

  it('fails with a readable message', async () => {
    const claim = await newClaim()
    const failing = async () => {
      throw new SkillError(
        'Spending limit reached for this month.',
        'spend_limit'
      )
    }
    assert.strictEqual(
      await runBlogGeneration(claim, {}, deps({ writeBlog: failing })),
      'failed'
    )
    const row = await rowOf(claim.blogId)
    assert.strictEqual(row.generationStatus, 'failed')
    assert.strictEqual(
      row.generationError,
      'Spending limit reached for this month.'
    )
    // The sources (0.01), the questions (0.001), the plan (0.02) and the image
    // made beside the text (0.07) were paid for before writing failed; the
    // image is kept for a retry.
    assert.ok(
      Math.abs(row.usage.costUsd! - 0.101) < 1e-9,
      String(row.usage.costUsd)
    )
    assert.deepStrictEqual(row.featuredImage, READY_IMAGE)
    // The research it paid for is kept with the unwritten blog.
    assert.strictEqual(row.sources.length, POOL.length)
    const before = images.length
    const researchedBefore = gathered
    const retry = await claimBlogGeneration(database, { accountId, blogId: claim.blogId })
    assert.strictEqual(
      await runBlogGeneration(retry!, {}, deps({ writeBlog: stubWriter([DRAFT]).writer })),
      'saved'
    )
    assert.strictEqual(images.length, before, 'the kept image is not made again')
    assert.strictEqual(gathered, researchedBefore, 'the kept research is not done again')
    const saved = await rowOf(claim.blogId)
    assert.ok(saved.sources.some(source => source.cited), 'the kept sources are cited')
  })

  it('writes nothing under a lost claim', async () => {
    const stale = await newClaim(new Date(Date.now() - 10 * 60_000))
    const fresh = await claimBlogGeneration(database, {
      accountId,
      blogId: stale.blogId
    })
    assert.ok(fresh)
    const { writer, calls } = stubWriter([DRAFT])
    assert.strictEqual(
      await runBlogGeneration(stale, {}, deps({ writeBlog: writer })),
      'lost'
    )
    assert.strictEqual(calls.length, 0)
    const row = await rowOf(stale.blogId)
    assert.strictEqual(row.generationStatus, 'generating')
    assert.strictEqual(row.title, '')
  })

  it('reuses its sources when regenerating, unless asked to research again', async () => {
    const blogId = await written()
    const before = gathered
    const again = await claimBlogGeneration(database, { accountId, blogId })
    const { writer, calls } = stubWriter([DRAFT])
    assert.strictEqual(
      await runBlogGeneration(
        again!,
        { instruction: 'Make it shorter' },
        deps({ writeBlog: writer })
      ),
      'saved'
    )
    assert.strictEqual(gathered, before)
    assert.strictEqual(calls[0]?.regenerate?.instruction, 'Make it shorter')
    assert.strictEqual(
      calls[0]?.regenerate?.current.title,
      'Cart abandonment: fixes for small shops'
    )
    const third = await claimBlogGeneration(database, { accountId, blogId })
    await runBlogGeneration(
      third!,
      { researchAgain: true },
      deps({ writeBlog: stubWriter([DRAFT]).writer })
    )
    assert.strictEqual(gathered, before + 1)
    const [newest] = await database
      .select()
      .from(schema.blogRevisionsTable)
      .where(eq(schema.blogRevisionsTable.blogId, blogId))
      .orderBy(desc(schema.blogRevisionsTable.number))
    assert.strictEqual(newest?.replacedBy, 'regenerate')
  })

  it('regenerates after the idea it came from is deleted', async () => {
    const [idea] = await database
      .insert(schema.ideasTable)
      .values({ accountId, hook: 'An idea about carts', title: 'Carts' })
      .returning()
    const claim = await newClaim(undefined, idea!.id)
    await database
      .delete(schema.ideasTable)
      .where(eq(schema.ideasTable.id, idea!.id))
    assert.strictEqual((await rowOf(claim.blogId)).ideaId, null)
    const { writer } = stubWriter([DRAFT])
    // The real context loader: the identity's settings from the database.
    assert.strictEqual(
      await runBlogGeneration(claim, {}, {
        db: database,
        gatherSources,
        ...fakes,
        writeBlog: writer
      } as never),
      'saved'
    )
  })

  it('rewrites one section and keeps a version', async () => {
    const blogId = await written()
    const before = await rowOf(blogId)
    const section: BlogSectionDraft = {
      heading: 'Fix the checkout design',
      lead: '',
      blocks: [{ type: 'paragraph', text: 'A new example with a cart.' }],
      sourcesUsed: []
    }
    const result = await rewriteBlogSectionNow(
      {
        accountId,
        blogId,
        sectionIndex: 2,
        instruction: 'Add an example',
        lockVersion: before.lockVersion
      },
      deps({
        writeBlogSection: async () => ({
          section,
          usage: cost(0.02),
          modelId: 'stub-model'
        })
      })
    )
    assert.strictEqual(result.ok, true)
    const row = await rowOf(blogId)
    const old = docSections(before.content)
    const now = docSections(row.content)
    assert.deepStrictEqual(now[0], old[0])
    assert.deepStrictEqual(now[1], old[1])
    assert.deepStrictEqual(now[3], old[3])
    assert.ok(
      docText({ type: 'doc', content: now[2]!.blocks }).includes(
        'A new example with a cart.'
      )
    )
    const [newest] = await database
      .select()
      .from(schema.blogRevisionsTable)
      .where(eq(schema.blogRevisionsTable.blogId, blogId))
      .orderBy(desc(schema.blogRevisionsTable.number))
    assert.deepStrictEqual(
      [newest?.replacedBy, newest?.instruction],
      ['section_rewrite', 'Add an example']
    )

    const missing = await rewriteBlogSectionNow(
      {
        accountId,
        blogId,
        sectionIndex: 9,
        instruction: null,
        lockVersion: row.lockVersion
      },
      deps()
    )
    assert.strictEqual(missing.ok, false)
    if (!missing.ok) assert.strictEqual(missing.reason, 'bad_section')
  })

  it('gives planning and writing only the time left under the function limit', async () => {
    const early = await newClaim()
    const first = stubWriter([DRAFT])
    planned.length = 0
    await runBlogGeneration(
      early,
      {},
      deps({ writeBlog: first.writer, now: () => early.claimedAt.getTime() + 60_000 })
    )
    // 270 s of the 300 s limit; 60 s gone; planning leaves 120 s for the rest.
    assert.strictEqual(planned[0]?.timeoutMs, 45_000)
    assert.strictEqual(first.calls[0]?.timeoutMs, 150_000)

    const late = await newClaim()
    const second = stubWriter([DRAFT])
    planned.length = 0
    await runBlogGeneration(
      late,
      {},
      deps({ writeBlog: second.writer, now: () => late.claimedAt.getTime() + 140_000 })
    )
    // Too late to plan; writing keeps 20 s back for the checks and the save.
    assert.strictEqual(planned.length, 0)
    assert.strictEqual(second.calls[0]?.timeoutMs, 110_000)
  })

  it('regenerates with the keywords as edited, not as first asked', async () => {
    const blogId = await written()
    await database
      .update(schema.blogsTable)
      .set({
        primaryKeyword: 'abandoned checkout',
        keywords: ['payment options']
      })
      .where(eq(schema.blogsTable.id, blogId))
    const claim = await claimBlogGeneration(database, { accountId, blogId })
    const { writer, inputs } = stubWriter([
      { ...DRAFT, primaryKeyword: 'cart abandonment' }
    ])
    assert.strictEqual(
      await runBlogGeneration(claim!, {}, deps({ writeBlog: writer })),
      'saved'
    )
    assert.strictEqual(inputs[0]?.brief.primaryKeyword, 'abandoned checkout')
    assert.deepStrictEqual(inputs[0]?.brief.secondaryKeywords, [
      'payment options'
    ])
    const row = await rowOf(blogId)
    assert.strictEqual(row.primaryKeyword, 'abandoned checkout')
    assert.ok(row.keywords.includes('payment options'), row.keywords.join(', '))
  })

  it('does not flag a figure the author asked for', async () => {
    const claim = await newClaim(undefined, null, {
      ...BRIEF,
      instructions: 'Mention our 20% discount on first orders.'
    })
    const { writer } = stubWriter([
      {
        ...DRAFT,
        introduction: [
          'Cart abandonment costs small shops sales. New buyers get 20% off their first order.'
        ]
      }
    ])
    assert.strictEqual(
      await runBlogGeneration(claim, {}, deps({ writeBlog: writer })),
      'saved'
    )
    const row = await rowOf(claim.blogId)
    const figures = row.checks.find(f => f.rule === 'unsupported_figures')!
    assert.strictEqual(figures.passed, true, figures.message)
  })

  it('gathers the questions people search beside research, plans with them and keeps them', async () => {
    const claim = await newClaim()
    const before = planned.length
    assert.strictEqual(
      await runBlogGeneration(claim, {}, deps({ writeBlog: stubWriter([DRAFT]).writer })),
      'saved'
    )
    assert.deepStrictEqual(planned[before]!.questions, QUESTIONS)
    assert.strictEqual(planned[before]!.newPictures, true)
    const row = await rowOf(claim.blogId)
    assert.deepStrictEqual(row.searchQuestions, QUESTIONS)
    // Asked again only with new research: a plain regeneration reuses them.
    const count = asked.length
    const again = await claimBlogGeneration(database, { accountId, blogId: claim.blogId })
    await runBlogGeneration(again!, {}, deps({ writeBlog: stubWriter([DRAFT]).writer }))
    assert.strictEqual(asked.length, count)
    assert.deepStrictEqual(planned.at(-1)!.questions, QUESTIONS)
  })

  it("makes the planned section pictures beside the text and puts each after its section's answer", async () => {
    const claim = await newClaim()
    const requests: Array<{ concept: string; look?: string; section: string }> = []
    const result = await runBlogGeneration(
      claim,
      {},
      deps({
        writeBlog: stubWriter([DRAFT]).writer,
        planBlog: async () => ({ plan: PICTURE_PLAN, usage: cost(0.02), modelId: 'stub-planner' }),
        makeSupportingImage: async (request: { concept: string; look?: string; section: string }) => {
          requests.push(request)
          return request.concept.includes('till')
            ? { image: picture('pic-till'), usage: cost(0.06) }
            : { image: null, error: 'No image model produced an image.', usage: cost(0.01) }
        }
      })
    )
    assert.strictEqual(result, 'saved')
    assert.deepStrictEqual(
      requests.map(r => [r.concept, r.look, r.section]),
      [
        ['A cart left by a till', 'Soft daylight, muted colours', 'Why carts are left'],
        ['A tidy checkout counter', 'Soft daylight, muted colours', 'Fix the checkout design']
      ]
    )
    const row = await rowOf(claim.blogId)
    assert.deepStrictEqual(row.images.map(image => image.id), ['pic-till'])
    const first = docSections(row.content)[1]!
    assert.deepStrictEqual(
      first.blocks.map(block => block.type),
      ['heading', 'paragraph', 'image']
    )
    const node = first.blocks[2]!
    assert.ok(node.type === 'image')
    if (node.type === 'image') {
      assert.deepStrictEqual(node.attrs, {
        imageId: 'pic-till',
        alt: 'A full cart left by a till',
        caption: 'Fees surprise shoppers at the till.'
      })
    }
    assert.ok(row.selfFlags.some(flag => flag.includes('1 section picture could not be made')))
    assert.ok(Number(row.usage.costUsd) >= 0.07)
  })

  it('keeps its pictures on a regeneration, carried into the matching sections, unless new ones are asked for', async () => {
    const claim = await newClaim()
    const makeSupportingImage = async () => ({ image: picture(randomUUID()), usage: cost(0.06) })
    const pictureDeps = (more: Record<string, unknown> = {}) =>
      deps({
        writeBlog: stubWriter([DRAFT]).writer,
        planBlog: async (input: { newPictures?: boolean }) => {
          planned.push({ brief: BRIEF, newPictures: input.newPictures })
          return { plan: PICTURE_PLAN, usage: cost(0.02), modelId: 'stub-planner' }
        },
        makeSupportingImage,
        ...more
      })
    await runBlogGeneration(claim, {}, pictureDeps())
    const first = await rowOf(claim.blogId)
    const ids = first.images.map(image => image.id)
    assert.strictEqual(ids.length, 2)

    let made = 0
    const again = await claimBlogGeneration(database, { accountId, blogId: claim.blogId })
    await runBlogGeneration(
      again!,
      {},
      pictureDeps({
        makeSupportingImage: async () => {
          made++
          return { image: picture(randomUUID()), usage: cost(0.06) }
        }
      })
    )
    assert.strictEqual(made, 0)
    assert.strictEqual(planned.at(-1)!.newPictures, false)
    const second = await rowOf(claim.blogId)
    assert.deepStrictEqual(second.images.map(image => image.id), ids)
    const shown = second.content.content.flatMap(block =>
      block.type === 'image' ? [block.attrs.imageId] : []
    )
    assert.deepStrictEqual(shown.sort(), [...ids].sort())

    const third = await claimBlogGeneration(database, { accountId, blogId: claim.blogId })
    await runBlogGeneration(
      third!,
      { newImage: true },
      pictureDeps({
        makeSupportingImage: async () => {
          made++
          return { image: picture(randomUUID()), usage: cost(0.06) }
        }
      })
    )
    assert.strictEqual(made, 2)
    assert.strictEqual((await rowOf(claim.blogId)).images.length, 4)
  })

  it('keeps the section picture through a section rewrite', async () => {
    const claim = await newClaim()
    await runBlogGeneration(
      claim,
      {},
      deps({
        writeBlog: stubWriter([DRAFT]).writer,
        planBlog: async () => ({ plan: PICTURE_PLAN, usage: cost(0.02), modelId: 'stub-planner' }),
        makeSupportingImage: async (request: { concept: string }) => ({
          image: picture(request.concept.includes('till') ? 'pic-a' : 'pic-b'),
          usage: cost(0.06)
        })
      })
    )
    const row = await rowOf(claim.blogId)
    const result = await rewriteBlogSectionNow(
      { accountId, blogId: claim.blogId, sectionIndex: 1, instruction: null, lockVersion: row.lockVersion },
      deps({
        writeBlogSection: async () => ({
          section: {
            heading: 'Why carts are left',
            lead: 'Shoppers leave carts mostly because of costs they did not expect at the last step.',
            blocks: [{ type: 'paragraph', text: 'Fees shown late feel like a trick.' }],
            sourcesUsed: []
          },
          usage: cost(0.02),
          modelId: 'stub-model'
        })
      })
    )
    assert.strictEqual(result.ok, true)
    const after = await rowOf(claim.blogId)
    const section = docSections(after.content)[1]!
    assert.deepStrictEqual(
      section.blocks.map(block => (block.type === 'image' ? `image:${block.attrs.imageId}` : block.type)),
      ['heading', 'paragraph', 'paragraph', 'image:pic-a']
    )
  })
})
