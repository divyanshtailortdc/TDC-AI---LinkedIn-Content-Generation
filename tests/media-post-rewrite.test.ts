import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  buildRewritePrompt,
  rewriteProblems
} from '../src/lib/ai/skills/media-post/rewrite'
import type { MediaAnalysis } from '../src/lib/ai/skills/media-post/schema'
import {
  draftColumnsOf,
  isMediaPostPart,
  mediaDraftOfPost,
  withRewrittenPart,
  type MediaPostDraft
} from '../src/lib/media-upload/drafts'
import {
  analysisFromSummary,
  parseMediaAnalysis,
  storedAnalysisFields,
  storedUploadOf
} from '../src/lib/media-upload/stored-analysis'
import { goldenCases } from './fixtures/generation'

/**
 * Regenerate on posts made from uploaded media: only the part asked for
 * changes, saved posts are read back as the Create from media page held
 * them, and what the AI saw is kept with the post so it can be used again.
 */

const draft = (overrides: Partial<MediaPostDraft> = {}): MediaPostDraft => ({
  platform: 'linkedin',
  formatId: 'linkedin.post',
  hook: 'Carrier pages send your customers away.',
  body: 'A tracking page in your brand keeps them with you.\n\nThey see offers while they check their order.',
  cta: 'Where do your customers go after they buy?',
  hashtags: ['OrderTracking', 'Ecommerce'],
  firstComment: '',
  title: '',
  altText: '',
  ...overrides
})

const analysis: MediaAnalysis = {
  summary: 'A walkthrough of a branded order tracking page builder.',
  details: ['A tracking page editor', 'A phone-width preview of the page'],
  visibleText: ['Carrier sites send customers away.', 'Your page keeps them.'],
  mood: 'Calm product demo',
  uncertain: ['What the voice-over says'],
  message: {
    kind: 'product',
    subject: 'Track360 tracking pages',
    problem: 'Carrier tracking sites send customers away after the sale.',
    audience: 'Online store owners',
    value: 'Customers check their order on a page that looks like the store.',
    features: [
      {
        name: 'Mobile preview',
        frames: [6],
        shown: 'A phone-width page',
        benefit: 'Check the page on a phone before it goes live',
        priority: 'lead',
        group: 'Nothing goes live unchecked',
        terms: ['mobile']
      }
    ],
    scaffolding: ['Northwind Outfitters']
  }
}

describe('regenerating one part of a post from media', () => {
  const current = draft({ altText: 'Kept' })
  const rewritten = draft({
    hook: 'New hook',
    body: 'New body',
    cta: 'New question?',
    hashtags: ['Other'],
    altText: 'New alt'
  })

  it('changes the hook alone', () => {
    assert.deepStrictEqual(withRewrittenPart(current, rewritten, 'hook'), {
      ...current,
      hook: 'New hook'
    })
  })

  it('changes the body alone, keeping the closing question and hashtags', () => {
    assert.deepStrictEqual(withRewrittenPart(current, rewritten, 'body'), {
      ...current,
      body: 'New body'
    })
    // A post that had no closing question takes the one the body ended on.
    const noCta = draft({ cta: '' })
    assert.strictEqual(
      withRewrittenPart(noCta, rewritten, 'body').cta,
      'New question?'
    )
  })

  it("changes the whole post, keeping an image's alt text", () => {
    const next = withRewrittenPart(current, rewritten, 'post')
    assert.strictEqual(next.hook, 'New hook')
    assert.deepStrictEqual(next.hashtags, ['Other'])
    assert.strictEqual(next.altText, 'Kept')
    assert.strictEqual(
      withRewrittenPart(draft(), rewritten, 'post').altText,
      'New alt'
    )
  })

  it('takes only the three parts', () => {
    assert.ok(isMediaPostPart('hook'))
    assert.ok(isMediaPostPart('post'))
    assert.ok(!isMediaPostPart('cta'))
    assert.ok(!isMediaPostPart(undefined))
  })
})

describe('a saved post made from media, read back', () => {
  it('reads a LinkedIn post from its columns', () => {
    const saved = draftColumnsOf(draft())
    const read = mediaDraftOfPost(
      {
        platform: 'linkedin',
        formatId: 'linkedin.post',
        hook: saved.hook,
        body: saved.body,
        cta: saved.cta,
        hashtags: saved.hashtags,
        firstComment: saved.firstComment,
        payload: { ...saved.payload, upload: { kind: 'video' } }
      },
      null
    )
    assert.deepStrictEqual(read, draft())
  })

  it("splits a Short's caption into hook, body and closing question, and stores it back the same", () => {
    const short = draft({
      platform: 'youtube',
      formatId: 'youtube.short',
      title: 'Branded tracking pages in a minute',
      hashtags: ['Shorts']
    })
    const saved = draftColumnsOf(short)
    const read = mediaDraftOfPost({
      platform: 'youtube',
      formatId: 'youtube.short',
      hook: saved.hook,
      body: saved.body,
      cta: saved.cta,
      hashtags: saved.hashtags,
      firstComment: saved.firstComment,
      payload: saved.payload
    })
    assert.strictEqual(read.hook, short.hook)
    assert.strictEqual(read.body, short.body)
    assert.strictEqual(read.cta, short.cta)
    assert.strictEqual(read.title, short.title)
    assert.deepStrictEqual(draftColumnsOf(read), saved)
  })

  it('reads a caption with no closing question as hook and body', () => {
    const read = mediaDraftOfPost({
      platform: 'youtube',
      formatId: 'youtube.short',
      hook: '',
      body: '',
      cta: null,
      hashtags: null,
      firstComment: null,
      payload: { caption: 'One\n\nTwo\n\nThree.' }
    })
    assert.strictEqual(read.hook, 'One')
    assert.strictEqual(read.body, 'Two\n\nThree.')
    assert.strictEqual(read.cta, '')
  })
})

describe('what a post from media keeps of its media', () => {
  it('keeps the analysis and notes, and reads them back', () => {
    const fields = storedAnalysisFields({ analysis, notes: '  Launch week  ' })
    assert.deepStrictEqual(fields, { analysis, notes: 'Launch week' })
    const stored = storedUploadOf({
      upload: { kind: 'video', fileName: null, summary: 'x', ...fields }
    })
    assert.deepStrictEqual(stored, {
      kind: 'video',
      analysis,
      notes: 'Launch week',
      analysed: true
    })
  })

  it('falls back to the summary for a post saved before analyses were kept', () => {
    const stored = storedUploadOf({
      upload: { kind: 'image', fileName: 'a.png', summary: 'A team photo.' }
    })
    assert.strictEqual(stored?.analysed, false)
    assert.deepStrictEqual(stored?.analysis, analysisFromSummary('A team photo.'))
    assert.strictEqual(stored?.notes, '')
  })

  it('is nothing for a post not made from uploaded media', () => {
    assert.strictEqual(storedUploadOf({ caption: 'x' }), null)
    assert.strictEqual(storedUploadOf(null), null)
  })

  it('refuses an analysis that is not one, or is far too long', () => {
    assert.strictEqual(parseMediaAnalysis({ summary: 'x' }), null)
    assert.strictEqual(parseMediaAnalysis('x'), null)
    assert.strictEqual(
      parseMediaAnalysis({ ...analysis, details: ['x'.repeat(30_000)] }),
      null
    )
    assert.deepStrictEqual(parseMediaAnalysis(analysis), analysis)
    assert.deepStrictEqual(storedAnalysisFields({ analysis: null, notes: ' ' }), {})
  })

  it('reads an analysis kept before features were ranked, grouped and tied to frames', () => {
    const { frames: _f, priority: _p, group: _g, ...feature } =
      analysis.message.features[0]!
    const kept = {
      ...analysis,
      message: {
        ...analysis.message,
        features: [
          { ...feature, important: true },
          { ...feature, name: 'Dark mode', important: false }
        ]
      }
    }
    assert.deepStrictEqual(
      parseMediaAnalysis(kept)?.message.features.map(f => [f.name, f.priority, f.group, f.frames]),
      [
        ['Mobile preview', 'supporting', 'Mobile preview', []],
        ['Dark mode', 'minor', 'Dark mode', []]
      ]
    )
    // From before features were listed at all: none.
    const older = {
      ...analysis,
      message: { ...analysis.message, features: undefined, benefits: ['x'] }
    }
    assert.deepStrictEqual(parseMediaAnalysis(older)?.message.features, [])
  })
})

describe('media-post rewrite prompt', () => {
  const { ctx } = goldenCases()[0]!
  const base = {
    kind: 'video' as const,
    analysis,
    notes: 'Launch week',
    draft: draft()
  }

  it('asks for a new hook alone, leading into the body as it stands', () => {
    const prompt = buildRewritePrompt(ctx, { ...base, part: 'hook' })
    assert.match(prompt, /THE VIDEO, AS DESCRIBED WHEN IT WAS LOOKED AT/)
    assert.match(prompt, /Track360 tracking pages/)
    assert.match(prompt, /Launch week/)
    assert.match(prompt, /PLATFORM: linkedin/)
    assert.match(prompt, /Write a new hook for this post, and only the hook/)
    assert.match(prompt, /stay exactly as they are/)
    assert.match(prompt, /within \d+ characters/)
    assert.match(prompt, /Return the hook alone, in "hook"/)
    // The post as it stands is shown, so the hook fits it.
    assert.ok(prompt.includes(draft().body))
    assert.match(prompt, /#OrderTracking #Ecommerce/)
  })

  it("asks for a new body alone, within the room the rest leaves", () => {
    const prompt = buildRewritePrompt(ctx, { ...base, part: 'body' })
    assert.match(prompt, /Write a new body for this post, and only the body/)
    assert.match(prompt, /without asking it or ending on another question/)
    assert.match(prompt, /The rest of the post takes \d+ characters, so the body must stay under \d+/)
    const noCta = buildRewritePrompt(ctx, {
      ...base,
      draft: draft({ cta: '' }),
      part: 'body'
    })
    assert.match(noCta, /end on one closing question/)
  })

  it('asks for the whole post, with what the author wants changed', () => {
    const prompt = buildRewritePrompt(ctx, {
      ...base,
      part: 'post',
      instruction: 'Shorter'
    })
    assert.match(prompt, /Write the whole post again/)
    assert.match(prompt, /"platform" set to "linkedin"/)
    assert.match(prompt, /Leave altText empty/)
    assert.match(prompt, /WHAT THE AUTHOR WANTS CHANGED\n"""\nShorter\n"""/)
  })

  it('shows a failed attempt with what to fix', () => {
    const prompt = buildRewritePrompt(
      ctx,
      { ...base, part: 'hook' },
      { draft: draft({ hook: 'Tried hook' }), problems: ['Too long.'] }
    )
    assert.match(prompt, /YOUR LAST ATTEMPT, TO FIX/)
    assert.match(prompt, /- Too long\./)
    assert.match(prompt, /Tried hook/)
  })
})

describe('checking a rewritten part', () => {
  const { ctx } = goldenCases()[0]!
  const check = { ctx, kind: 'video' as const, analysis, notes: '' }

  it('sends back the same hook, or none', () => {
    const current = draft()
    assert.match(
      rewriteProblems(current, current, 'hook', check)[0]!,
      /same hook/
    )
    assert.match(
      rewriteProblems({ ...current, hook: '' }, current, 'hook', check)[0]!,
      /no hook/
    )
  })

  it('counts only the problems the new part brought in', () => {
    // A body naming the demo's sample store is a problem the post already
    // has; a new hook does not answer for it.
    const current = draft({
      body: 'Northwind Outfitters keeps buyers on its own page.'
    })
    const newHook = { ...current, hook: 'Your buyers leave to track a parcel.' }
    assert.ok(
      !rewriteProblems(newHook, current, 'hook', check).some(p =>
        p.includes('Northwind')
      )
    )
    // A new hook that names it brings that problem in.
    const badHook = { ...draft(), hook: 'Northwind Outfitters shows how.' }
    assert.ok(
      rewriteProblems(badHook, draft(), 'hook', check).some(p =>
        p.includes('Northwind')
      )
    )
  })
})
