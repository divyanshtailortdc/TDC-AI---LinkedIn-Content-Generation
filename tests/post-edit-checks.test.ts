import assert from 'node:assert'
import { describe, it } from 'node:test'
import { EMPTY_HISTORY, resolvePreferences } from '../src/lib/ai/context-blocks'
import { buildPostLintOptions } from '../src/lib/ai/pipeline/post-lint'
import { runLinter } from '../src/lib/lint/run-linter'
import { postCharCount, postFullText } from '../src/lib/post-text'

const now = new Date('2026-10-01T00:00:00Z')

// The pieces of a generation context the quality checks read.
const ctx = {
  account: { id: 'acc', name: 'Acme', handle: 'acme', headline: 'h', accountType: 'company', isActive: true, createdAt: now, updatedAt: now },
  voice: null,
  offerings: [],
  audiences: [],
  knowledgeDocs: [],
  samplePosts: [],
  goals: [],
  activeGoals: [],
  primaryGoal: null,
  preferencesId: null,
  prefs: resolvePreferences(
    { id: 'p', accountId: 'acc', pillars: [], ideasPerRun: 5, postConstraints: { cta_required: true }, guardrails: null, createdAt: now, updatedAt: now } as never,
    null
  ),
  history: EMPTY_HISTORY
} as never

const lint = (post: { hook: string; body: string; cta?: string | null }) =>
  runLinter(buildPostLintOptions(ctx, null, post, 0))
const charLine = (post: { hook: string; body: string; cta?: string | null }) =>
  lint(post).find(f => f.rule === 'char_limit')!.message

describe('character count of a post', () => {
  it('counts hook, body and call to action together, as published', () => {
    assert.equal(postFullText({ hook: 'H', body: 'B', cta: 'C' }), 'H\n\nB\n\nC')
    assert.equal(postCharCount({ hook: 'Hook', body: 'Body', cta: 'Call' }), 'Hook\n\nBody\n\nCall'.length)
  })

  it('leaves out an empty call to action and its blank line', () => {
    assert.equal(postCharCount({ hook: 'Hook', body: 'Body', cta: '' }), 'Hook\n\nBody'.length)
    assert.equal(postCharCount({ hook: 'Hook', body: 'Body', cta: null }), 'Hook\n\nBody'.length)
  })

  it('agrees with what the quality check reports', () => {
    const post = { hook: 'A hook line', body: 'The body of the post.', cta: 'What do you think about that?' }
    assert.match(charLine(post), new RegExp(`Character count: ${postCharCount(post)} /`))
  })

  it('the old edit formula (no call to action) disagreed with the draft', () => {
    const post = { hook: 'Hook', body: 'Body', cta: 'Call to action here' }
    const oldFormula = `${post.hook}\n\n${post.body}`.length
    assert.notEqual(oldFormula, postCharCount(post))
  })
})

describe('quality checks follow the edited text', () => {
  const base = { hook: 'A short, clear hook.', body: 'A plain body with a point.', cta: 'Which of these do you do?' }

  it('a hook edited past the fold is now flagged', () => {
    const before = lint(base).find(f => f.rule === 'hook_fold')
    const after = lint({ ...base, hook: 'x'.repeat(260) }).find(f => f.rule === 'hook_fold')
    assert.ok(!before || before.passed, 'the original hook fits')
    assert.equal(after?.passed, false)
  })

  it('a banned buzzword added by the edit is now flagged, and one removed is cleared', () => {
    const flagged = lint({ ...base, body: 'We will leverage synergy to delve deeper.' })
    assert.ok(flagged.some(f => !f.passed && /leverage|delve|synergy/i.test(`${f.rule} ${f.message}`)))
    const clean = lint(base)
    assert.ok(!clean.some(f => !f.passed && /leverage|delve|synergy/i.test(`${f.rule} ${f.message}`)))
  })

  it('a post edited over the length limit fails the length check', () => {
    const long = lint({ ...base, body: 'word '.repeat(900) }).find(f => f.rule === 'char_limit')!
    assert.equal(long.passed, false)
    assert.equal(lint(base).find(f => f.rule === 'char_limit')!.passed, true)
  })
})
