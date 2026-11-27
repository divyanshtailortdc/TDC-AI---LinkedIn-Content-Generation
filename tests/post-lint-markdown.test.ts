import assert from 'node:assert'
import { describe, it } from 'node:test'
import { withoutMarkdown } from '../src/lib/ai/pipeline/post-lint'
import { runLinter } from '../src/lib/lint/run-linter'

const markdownFinding = (post: { hook: string; body: string; cta?: string }) =>
  runLinter({ hook: post.hook, body: post.body, cta: post.cta }).find(
    f => f.rule === 'no_markdown_leakage'
  )

describe('withoutMarkdown', () => {
  it('takes out what the linter calls markdown, keeping the words', () => {
    const draft = {
      hook: '## **Cart abandonment** costs more than you think',
      body: 'Three things help:\n- faster checkout\n* fewer fields\nSee [the study](https://example.com/s).\n```\ncode\n```',
      cta: 'What would you __add__?',
      firstComment: null,
      hashtags: ['#ecommerce']
    }
    assert.strictEqual(markdownFinding(draft)?.passed, false)
    const clean = withoutMarkdown(draft)
    assert.strictEqual(clean.hook, 'Cart abandonment costs more than you think')
    assert.strictEqual(
      clean.body,
      'Three things help:\n• faster checkout\n• fewer fields\nSee the study (https://example.com/s).\ncode\n'
    )
    assert.strictEqual(clean.cta, 'What would you add?')
    assert.deepStrictEqual(clean.hashtags, ['#ecommerce'])
    assert.strictEqual(markdownFinding(clean)?.passed, true)
  })

  it('leaves plain text as it was', () => {
    const draft = { hook: 'A plain hook.', body: 'Plain body, 2*3 = 6.', cta: '' }
    assert.deepStrictEqual(withoutMarkdown(draft), draft)
  })
})
