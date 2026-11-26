import assert from 'node:assert'
import { describe, it } from 'node:test'
import { STYLE_BLUEPRINTS, styleFaqDefault } from '../src/lib/blogs/styles'
import {
  BLOG_STYLE_LABELS,
  BLOG_STYLES,
  SEARCH_INTENT_LABELS,
  SEARCH_INTENTS
} from '../src/lib/blogs/types'

describe('writing styles', () => {
  it('offers comparison, industry analysis and case study', () => {
    for (const style of ['comparison', 'industry_analysis', 'case_study']) {
      assert.ok(
        (BLOG_STYLES as readonly string[]).includes(style),
        `${style} is a style`
      )
    }
    assert.strictEqual(BLOG_STYLE_LABELS.explainer, 'Explainer (educational)')
    assert.strictEqual(BLOG_STYLE_LABELS.industry_analysis, 'Industry analysis')
  })

  it('gives every style a blueprint with its structure, elements and research', () => {
    for (const style of BLOG_STYLES) {
      const blueprint = STYLE_BLUEPRINTS[style]
      assert.ok(blueprint, `${style} has a blueprint`)
      assert.ok(blueprint.structure.length > 40, `${style} structure`)
      assert.ok(blueprint.elements.length > 10, `${style} elements`)
      assert.ok(blueprint.research.length > 20, `${style} research`)
    }
  })

  it('leaves the FAQ off for opinion, news analysis and case studies', () => {
    for (const style of ['opinion', 'news_analysis', 'case_study'] as const) {
      assert.strictEqual(styleFaqDefault('blog', style), false, style)
    }
    assert.strictEqual(styleFaqDefault('blog', 'how_to'), true)
    // An article answers the questions people search too, unless its style
    // has no use for an FAQ.
    assert.strictEqual(styleFaqDefault('article', 'thought_leadership'), true)
    assert.strictEqual(styleFaqDefault('article', 'opinion'), false)
    assert.strictEqual(styleFaqDefault('article', 'explainer'), true)
  })

  it('names the four search intents', () => {
    assert.deepStrictEqual(
      [...SEARCH_INTENTS],
      ['informational', 'commercial', 'transactional', 'navigational']
    )
    assert.strictEqual(SEARCH_INTENT_LABELS.commercial, 'Commercial')
  })
})
