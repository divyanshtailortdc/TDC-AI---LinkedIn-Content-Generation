import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  recentMotifs,
  renderIdeationHistoryBlock,
  type ReviewHistory
} from '../src/lib/ai/context-blocks'
import { recurringMotifs } from '../src/lib/ai/recurring-motifs'
import { findRepeats } from '../src/lib/ai/semantic-repeats'
import * as linkedInPrompt from '../src/lib/ai/skills/post-drafting/prompt'
import { buildFormatPrompt } from '../src/lib/ai/skills/variant-drafting/prompt'
import { account, context, goal, idea, offering } from './fixtures/generation'

/**
 * Ideas and posts that keep coming back to the same few things: ideation
 * sees every earlier post and idea, is told what keeps recurring, and an idea
 * that repeats an earlier one in other words is dropped by meaning. Taken
 * from a real account whose ideas kept returning to fries, the group chat
 * and the delivery fee.
 */

const phrases = (items: string[], exclude = '') =>
  recurringMotifs(items, { exclude }).map(m => m.phrase)

/** A food-delivery account's recent ideas and posts, as they came back. */
const foodHistory = [
  'Hot Take: Sharing Fries Is a Trust Exercise',
  'The Group Chat Math: Who Actually Pays for the Fries',
  "Who had the extra fries? 'I only had two bites.' Sure.",
  'The last fry on the plate is not free real estate',
  'POV: The Group Chat Food Vote That Never Ends',
  "The Group Chat Stage Where Everyone Is 'Fine With Anything'",
  'Behind the Order: The Group Chat Builds a Gold Cart',
  'POV: The Delivery Fee Shows Up Like a Plot Twist',
  "Let's be honest, I'll order again tonight",
  'Things We Say to Our Fridge at 1 AM',
  'Day in the Life of a Student Who Orders In With Gold'
]
const foodSubject =
  'Zomato Food delivery Promote Zomato Gold: free delivery and extra discounts on the meals you already love'

describe('what keeps recurring', () => {
  it('names the foods, settings and jokes that keep coming back', () => {
    const found = phrases(foodHistory, foodSubject)
    assert.ok(found.includes('fries'), String(found))
    assert.ok(found.includes('group chat'), String(found))
  })

  it('counts "fries" and "fry" as one, and a phrase instead of its words', () => {
    const motifs = recurringMotifs(foodHistory, { exclude: foodSubject })
    assert.strictEqual(motifs.find(m => m.phrase === 'fries')?.count, 4)
    const found = motifs.map(m => m.phrase)
    assert.ok(!found.includes('group') && !found.includes('chat'), String(found))
  })

  it("never flags the account's own subject: its name, goals and offerings", () => {
    const found = phrases(foodHistory, foodSubject)
    for (const own of ['zomato', 'gold', 'delivery', 'food']) {
      assert.ok(!found.includes(own), `${own} in ${found}`)
    }
  })

  it("keeps a professional account on its subject: an invoice auditor's invoices are not a habit", () => {
    const posts = [
      'Your freight invoice is wrong more often than you think',
      'Duplicate charges hide in plain sight on every invoice',
      'We audited 400 invoices at a loading dock in Pune',
      'The invoice your AP team never opens',
      'A loading dock at 6 AM tells you more than the invoice',
      'Accessorial fees: the invoice line nobody reads',
      'Why your invoice audit should start at the loading dock',
      'Three invoice mistakes we saw this quarter'
    ]
    const found = phrases(
      posts,
      'Northwind Freight freight invoice audit and recovery for shippers'
    )
    assert.ok(!found.includes('invoice'), String(found))
    assert.ok(found.includes('loading dock'), String(found))
  })

  it('reads nothing into a short history, filler or contractions', () => {
    assert.deepStrictEqual(
      recurringMotifs(foodHistory.slice(0, 4), { exclude: foodSubject, minTexts: 6 }),
      []
    )
    const found = phrases(foodHistory, foodSubject)
    for (const filler of ['lets', 'ill', 'pov', 'take', 'things', 'say']) {
      assert.ok(!found.includes(filler), `${filler} in ${found}`)
    }
  })
})

/** A food-delivery identity on Instagram alone, with the history above. */
function foodContext(): ReturnType<typeof context> {
  const history: ReviewHistory = {
    drafts: [],
    otherDrafts: foodHistory.slice(2, 4).map(hook => ({
      hook,
      originalHook: hook,
      body: '',
      cta: null,
      status: 'awaiting_review',
      formatId: 'instagram.caption'
    })),
    ideas: foodHistory
      .filter((_, i) => i < 2 || i > 3)
      .map((title, i) => ({
        title,
        hookConcept: '',
        thesis: '',
        coreArgument: '',
        status: i % 3 === 0 ? 'drafted' : 'proposed',
        runId: 'old-run'
      })),
    rejectionReasons: []
  }
  return context({
    account: account({ name: 'Zomato', industry: 'Food delivery' }),
    offerings: [offering('Zomato Gold', { description: 'Free delivery and extra discounts' })],
    goal: goal({ title: 'Promote Zomato Gold', keyMessage: 'Gold means free delivery on the meals you love.' }),
    enabledFormats: ['instagram.caption'],
    history
  })
}

describe('what ideation is told about earlier work', () => {
  const block = renderIdeationHistoryBlock(foodContext(), 'new-run')

  it('lists the posts of every format, not just LinkedIn', () => {
    assert.ok(block.includes("Who had the extra fries? 'I only had two bites.' Sure."), block)
  })

  it('lists drafted ideas too: a post\'s first line does not say what its idea was', () => {
    assert.ok(block.includes('POV: The Delivery Fee Shows Up Like a Plot Twist'), block)
    assert.ok(block.includes('Hot Take: Sharing Fries Is a Trust Exercise'), block)
  })

  it('names what keeps recurring, and asks for something else', () => {
    assert.match(block, /RECURRING LATELY/)
    assert.match(block, /- fries \(\d+\)/)
    assert.match(block, /- group chat \(\d+\)/)
  })

  it('says nothing of the kind for an account with little history', () => {
    const quiet = renderIdeationHistoryBlock(
      context({ account: account(), history: { ...foodContext().history, ideas: [], otherDrafts: [] } }),
      'new-run'
    )
    assert.ok(!quiet.includes('RECURRING LATELY'))
  })
})

describe('what drafting is told about the specifics it keeps reusing', () => {
  it('tells an Instagram post to pick other examples', () => {
    const prompt = buildFormatPrompt(foodContext(), 'instagram.caption')
    assert.match(prompt, /keep using the same specifics: .*fries/)
  })

  it('leaves the LinkedIn prompt as it was when nothing recurs', () => {
    const ctx = context({ account: account(), history: { drafts: [], ideas: [], rejectionReasons: [] } })
    assert.strictEqual(recentMotifs(ctx, { drafts: 'own' }).length, 0)
    assert.ok(!linkedInPrompt.buildPrompt(ctx, idea()).includes('keep using the same specifics'))
  })
})

describe('an idea repeated in other words', () => {
  // Unit vectors at a chosen angle: cos(theta) is their similarity.
  const at = (degrees: number) => {
    const r = (degrees * Math.PI) / 180
    return [Math.cos(r), Math.sin(r), 0]
  }

  it('is caught against earlier ideas by meaning', () => {
    // cos 20 deg = 0.94: the same idea; cos 60 deg = 0.5: a different one.
    const repeats = findRepeats([at(20), at(60)], [at(0)])
    assert.strictEqual(repeats[0]?.kind, 'earlier')
    assert.strictEqual(repeats[1], null)
  })

  it('keeps the better of two alike in one batch', () => {
    const repeats = findRepeats([at(90), at(100)], [at(0)])
    assert.strictEqual(repeats[0], null)
    assert.deepStrictEqual(
      repeats[1] && { kind: repeats[1].kind, index: repeats[1].index },
      { kind: 'batch', index: 0 }
    )
  })

  it('lets related but different ideas through', () => {
    // cos 40 deg = 0.77, as close as two different ideas of one account came.
    assert.deepStrictEqual(findRepeats([at(40)], [at(0)]), [null])
  })
})
