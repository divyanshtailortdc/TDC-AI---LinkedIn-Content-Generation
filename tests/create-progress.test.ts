import assert from 'node:assert'
import { describe, it } from 'node:test'
import { parseCreateProgress } from '../src/lib/onboarding/create-progress'

const saved = {
  v: 1,
  step: 'about',
  platforms: ['linkedin', 'instagram'],
  about: {
    description: 'I run a bakery in Pune.',
    links: { instagram: 'https://www.instagram.com/bakery' },
    websiteUrl: 'https://bakery.example'
  },
  values: { name: 'Pune Bakes', description: 'Home baking' },
  links: { linkedin: 'https://www.linkedin.com/company/pune-bakes' },
  accountType: 'company',
  styles: { instagram: 'fun' },
  notes: { instagram: { audience: 'Local food lovers', tone: 'Playful' } },
  usedAi: true
}

describe('the create-identity progress kept in the browser', () => {
  it('reads back what the user entered', () => {
    const progress = parseCreateProgress(JSON.stringify(saved))
    assert.ok(progress)
    assert.equal(progress.step, 'about')
    assert.deepEqual(progress.platforms, ['linkedin', 'instagram'])
    assert.equal(progress.about.description, 'I run a bakery in Pune.')
    assert.equal(progress.values.name, 'Pune Bakes')
    // Fields not saved come back empty, never undefined.
    assert.equal(progress.values.targetAudience, '')
    assert.equal(progress.accountType, 'company')
    assert.deepEqual(progress.styles, { instagram: 'fun' })
    assert.equal(progress.usedAi, true)
  })

  it('drops platforms that can no longer be picked, and their links', () => {
    const progress = parseCreateProgress(
      JSON.stringify({
        ...saved,
        platforms: ['linkedin', 'tiktok'],
        links: {
          tiktok: 'https://tiktok.example/x',
          linkedin: 'https://www.linkedin.com/in/x'
        }
      })
    )
    assert.deepEqual(progress?.platforms, ['linkedin'])
    assert.deepEqual(progress?.links, {
      linkedin: 'https://www.linkedin.com/in/x'
    })
  })

  it('starts over on a review step with no platforms left', () => {
    const progress = parseCreateProgress(
      JSON.stringify({ ...saved, step: 'review', platforms: [] })
    )
    assert.equal(progress?.step, 'where')
  })

  it('ignores anything it does not recognise', () => {
    for (const raw of [
      null,
      '',
      'not json',
      '[]',
      '{"v":2}',
      JSON.stringify({ ...saved, step: 'done' })
    ]) {
      assert.equal(parseCreateProgress(raw), null, String(raw))
    }
  })

  it('keeps only text where text is expected', () => {
    const progress = parseCreateProgress(
      JSON.stringify({
        ...saved,
        values: { name: 42, description: { x: 1 } },
        accountType: 'robot'
      })
    )
    assert.equal(progress?.values.name, '')
    assert.equal(progress?.values.description, '')
    assert.equal(progress?.accountType, 'personal')
  })
})
