import assert from 'node:assert'
import { describe, it } from 'node:test'
import { featureGroups, groupsToCover } from '../src/lib/ai/skills/media-post/features'
import {
  hashtagsInText,
  mediaPostProblems,
  missingFeatures,
  verifiedAnalysis
} from '../src/lib/ai/skills/media-post/quality'
import type {
  MediaAnalysis,
  MediaFeature
} from '../src/lib/ai/skills/media-post/schema'
import type { MediaPostDraft } from '../src/lib/media-upload/drafts'
import {
  countListLines,
  countSequenceOpenings,
  findFeatureSheetPhrases,
  findLongLists,
  findMediaNarration,
  findPromotionalPhrases,
  findRepeatedWording,
  findRestatedSentences,
  findRetoldCaptions,
  findUnsupportedCapabilities
} from '../src/lib/lint/writing-checks'
import { goldenCases } from './fixtures/generation'

/**
 * A 65-second launch video for a tracking page builder, as the model
 * described it: caption cards over a demo in a sample store.
 */
const analysis: MediaAnalysis = {
  summary:
    'A product walkthrough of Track360, a branded order tracking page builder, shown in a sample workspace for a store called Northwind Outfitters.',
  details: [
    'Caption cards over screens of a tracking page editor',
    'A tracking page showing an In transit parcel from Austin to Denver',
    'A banner: Thanks for your order: 15% off your next one'
  ],
  visibleText: [
    'Carrier sites send customers away.',
    'Your page keeps them.',
    'Set your brand once, see it live.',
    'Banners, offers and links, shown to every visitor.',
    'Customers get answers without leaving your brand.',
    'Offers right where they are already looking.',
    'Thanks for your order: 15% off your next one',
    'Keep customers on your brand'
  ],
  mood: 'Clean, calm product demo',
  uncertain: ['What the voice-over says'],
  message: {
    kind: 'product',
    subject: 'Track360 tracking pages',
    problem:
      'Carrier tracking sites send customers away from the store after the sale.',
    audience: 'Online store owners and ecommerce teams',
    value:
      'Customers check their order on a page that looks like the store, next to its offers.',
    features: [
      {
        name: 'Brand styling',
        frames: [5],
        shown: 'Caption "Set your brand once, see it live." over logo, brand colour, font and rounding controls',
        benefit: 'The tracking page looks like the rest of the store',
        priority: 'lead',
        group: 'Looks like your own store',
        terms: ['brand', 'logo', 'colours']
      },
      {
        name: 'Mobile preview',
        frames: [6],
        shown: 'Caption "Check it on mobile before you publish." over a phone-width page',
        benefit: 'Check the page on a phone before it goes live',
        priority: 'supporting',
        group: 'Looks like your own store',
        terms: ['mobile']
      },
      {
        name: 'Banners and offers',
        frames: [7, 8],
        shown: 'Caption "Banners, offers and links, shown to every visitor." over a Marketing tab with a fall banner, a repeat-order discount and bestsellers',
        benefit: 'Sell again to buyers while they check their order',
        priority: 'lead',
        group: 'Sells while they wait',
        terms: ['banner', 'offer', 'discount']
      },
      {
        name: 'Preview link',
        frames: [10],
        shown: 'Caption "A preview link, to check edits before you publish."',
        benefit: 'Check saved edits before customers see them',
        priority: 'supporting',
        group: 'Nothing goes live unchecked',
        terms: ['preview']
      },
      {
        name: 'Light and dark designs',
        frames: [4],
        shown: 'A Light design / Dark design switch in the editor',
        benefit: 'Match the store whichever look it uses',
        priority: 'minor',
        group: 'Looks like your own store',
        terms: ['dark']
      }
    ],
    scaffolding: ['Northwind Outfitters', 'Austin to Denver', '794644790001']
  }
}

const draft = (overrides: Partial<MediaPostDraft> = {}): MediaPostDraft => ({
  platform: 'linkedin',
  formatId: 'linkedin.post',
  hook: '',
  body: '',
  cta: '',
  hashtags: [],
  firstComment: '',
  title: '',
  altText: '',
  ...overrides
})

/**
 * A post that carries the video's message and what it demonstrates as a
 * short story: the lead demonstrations with why they matter, the supporting
 * ones in a clause, grouped, the main message said once.
 */
const goodPost = draft({
  hook: "Your customers ask where their order is, and the carrier link sends them to someone else's site.",
  body: [
    'A tracking page on your own address keeps that moment with you, and it can do more than report a status.',
    "Set your logo and colours once, and the page looks like the rest of your store. A mobile preview shows you how it reads on a phone before anyone opens it.",
    'Then it starts to sell. A banner or a discount for the next order sits right under the parcel status, where buyers are already looking, so the visit can end in another basket.',
    'Edits stay private until you are happy with them: a preview link shows the saved version to your team before any customer sees it.'
  ].join('\n\n'),
  cta: 'Where do your customers land today when they track a parcel?',
  hashtags: ['OrderTracking', 'Ecommerce', 'CustomerRetention']
})

describe('checking a post written from a video', () => {
  const { ctx } = goldenCases()[0]!
  const check = { ctx, kind: 'video' as const, analysis, notes: '' }

  it('passes a post that leads with the reader and ends on a question', () => {
    assert.deepStrictEqual(mediaPostProblems(goodPost, check), [])
  })

  it('sends back a post that narrates the video and drops what it demonstrates', () => {
    // Written from this video after the first rework (two or three features
    // at most, "point to the moment worth watching"): no mobile preview.
    const abstract = draft({
      hook: 'Once an order ships, the buyer asks one question: where is it? A carrier site often answers it, and your brand is gone.',
      body: [
        "This video shows a different route. The tracking page carries the store's own logo, name, phone line and heading, so the answer arrives inside the brand.",
        'The moment worth watching is the view a shopper sees. A tracking number goes in, the status comes back, and a discount code and a product row sit right below it.',
        'There is also a preview link that shows saved edits before anything goes live.'
      ].join('\n\n'),
      cta: 'When a shopper asks where their order is, whose page do they land on?',
      hashtags: ['OrderTracking', 'CustomerExperience', 'eCommerce']
    })
    const problems = mediaPostProblems(abstract, check)
    const narration = problems.find(p => /narrates the video/.test(p))
    assert.ok(narration, problems.join('\n'))
    assert.match(narration, /"this video shows"/)
    assert.match(narration, /"moment worth watching"/)
    // A supporting feature is kept, in a clause.
    const missing = problems.find(p => /leaves out what the video demonstrates/.test(p))
    assert.ok(missing, problems.join('\n'))
    assert.match(missing, /Mobile preview, for "Looks like your own store" \(Check the page on a phone before it goes live\)/)
    // Covered, or minor: not asked for.
    assert.doesNotMatch(missing, /Brand styling|Banners and offers|Preview link|Light and dark/)

    // Without the offers, a lead demonstration is missing too.
    const noOffers = draft({
      ...abstract,
      body: abstract.body.replace(/, and a discount code and a product row sit right below it/, '')
    })
    const both = mediaPostProblems(noOffers, check).find(p =>
      /leaves out what the video demonstrates/.test(p)
    )
    assert.match(both!, /Mobile preview, .*; Banners and offers, a lead demonstration \(Sell again to buyers while they check their order\)/)
  })

  it('sends back a post too short to say what the features do', () => {
    const terse = draft({
      hook: 'Carrier links send your buyers away.',
      body: 'Brand it, preview it on mobile, add a banner.',
      cta: 'Where do your buyers land?',
      hashtags: ['OrderTracking']
    })
    const problems = mediaPostProblems(terse, check)
    assert.ok(
      problems.some(p => /^At \d+ characters it is too short for what the video demonstrates\. .*\(610 characters or more/.test(p)),
      problems.join('\n')
    )
  })

  it('holds only platforms with room to every feature, and only for what demonstrates something', () => {
    const tweet = draft({
      platform: 'x',
      formatId: 'x.post',
      hook: 'Carrier links send your buyers away. A tracking page in your own colours keeps them on your store.',
      body: '',
      cta: 'Where do yours land?'
    })
    const xProblems = mediaPostProblems(tweet, check)
    assert.ok(!xProblems.some(p => /leaves out|too short/.test(p)), xProblems.join('\n'))

    const moment = {
      ...check,
      analysis: { ...analysis, message: { ...analysis.message, kind: 'moment' as const } }
    }
    const short = draft({ ...goodPost, body: 'A tracking page on your own address.' })
    const momentProblems = mediaPostProblems(short, moment)
    assert.ok(!momentProblems.some(p => /leaves out|too short/.test(p)), momentProblems.join('\n'))
  })

  it('sends back hashtags written into the text, unless the author writes them there', () => {
    const tagged = draft({
      ...goodPost,
      body: `${goodPost.body}\n\nBuilt for #ecommerce teams who care about #CX.`
    })
    const problems = mediaPostProblems(tagged, check)
    assert.ok(
      problems.some(p => /"#ecommerce", "#CX" are written into the text\. Hashtags go only in the hashtags field/.test(p)),
      problems.join('\n')
    )
    const theirs = mediaPostProblems(tagged, {
      ...check,
      notes: 'We always say #ecommerce and #CX in our posts.'
    })
    assert.ok(!theirs.some(p => /written into the text/.test(p)), theirs.join('\n'))
  })

  it('sends back the walkthrough the engine used to write', () => {
    // The post written from this video before the rework, as published.
    const walkthrough = draft({
      hook: 'A customer asks where their order is. Your answer is a carrier link that sends them off your brand.',
      body: [
        'That is the gap this walkthrough shows. It is a sample workspace for a fictional store, Northwind Outfitters, building a tracking page in five steps.',
        "First, set the brand once: name, logo, phone line and a heading like 'Track your Northwind order'.",
        'Then add offers. The Marketing tab holds a fall banner, a repeat-order discount, a bestsellers grid and a delivery promise. Each one switches on or off.',
        "Then share one link. Preview the saved edits first, since customers can't see the preview. The sample shows an 'In transit' parcel from Austin to Denver and a 15% off code under the tracking steps.",
        'Where do your customers go today when they ask where their order is?'
      ].join('\n\n'),
      hashtags: ['OrderTracking', 'eCommerce', 'CustomerExperience']
    })
    const problems = mediaPostProblems(walkthrough, check)
    assert.ok(problems.some(p => /walks through the video step by step/.test(p)))
    assert.ok(
      problems.some(p => /"this walkthrough shows" narrates the video/.test(p)),
      problems.join('\n')
    )
    // Every control in a row, as the manual has them.
    assert.ok(
      problems.some(p => /^"First, set the brand once: name, logo, phone line and a heading .*" names 4 things in one sentence, as a manual would\./.test(p)),
      problems.join('\n')
    )
    assert.ok(
      problems.some(p =>
        /sample data \("Northwind Outfitters", "Austin to Denver"\)/.test(p)
      )
    )
    assert.ok(problems.some(p => /does not end on a question/.test(p)))
    // The 15% is on screen: not an invented figure.
    assert.ok(!problems.some(p => /15%/.test(p)), problems.join('\n'))
  })

  it('sends back the feature sheet the engine wrote next', () => {
    // Written from this video on 2026-11-26, once every feature was
    // required: a list announced, a bullet per feature, every control in a
    // row, and the main message said again at the end.
    const sheet = draft({
      hook: "A customer buys from you, then clicks through to a carrier's site to ask where the order is.",
      body: [
        'That is where they leave your brand. A tracking page on your own address keeps them with you.',
        'Track360 builds that page. Here is what it does for you:',
        [
          "• Your logo, colours, font and button shape go on the page, so it looks like your store and not a carrier's. A light and dark option lets visitors pick the one they prefer.",
          '• A mobile preview lets you see how the page reads on a phone before you publish it.',
          '• Banners, a promo code, a product grid, a delivery promise and social links sit on the page, so customers see an offer while they are already checking an order.',
          '• One tracking link goes into your emails and onto your website, so nobody is pointed to a carrier page.',
          '• A separate preview link shows your saved edits with sample data, so you check changes before customers see anything.'
        ].join('\n'),
        'Customers still get their status and event history, and a button to track another order. They just get it without leaving your brand.'
      ].join('\n\n'),
      cta: "When a customer asks about their delivery today, do they land on your brand or on someone else's page?",
      hashtags: ['OrderTracking', 'Ecommerce', 'CustomerExperience']
    })
    const problems = mediaPostProblems(sheet, check)
    const has = (pattern: RegExp) =>
      assert.ok(problems.some(p => pattern.test(p)), `${pattern}\n${problems.join('\n')}`)
    has(/^It is a list of 5 points, one under another, which reads like a feature sheet\./)
    has(/^"Your logo, colours, font and button shape go on the page, .*" names 4 things in one sentence/)
    has(/^"here is what it does" announces a feature list\./)
    has(/^"They just get it without leaving your brand\." says again what "That is where they leave your brand\." already said\./)
    // What it covers is not the problem.
    assert.ok(!problems.some(p => /leaves out|too short/.test(p)), problems.join('\n'))
  })

  it('sends back capabilities the video does not show, unless the notes say so', () => {
    const claims = draft({
      ...goodPost,
      body: `${goodPost.body}\n\nIt integrates with Shopify and updates in real time, with analytics on every visit.`
    })
    const problems = mediaPostProblems(claims, check)
    const claimed = problems.find(p => /neither the video nor the author's notes show/.test(p))
    assert.ok(claimed, problems.join('\n'))
    assert.match(claimed, /^It claims "integrates", "analytics", "real time", "shopify", which/)
    const told = mediaPostProblems(claims, {
      ...check,
      notes: 'It integrates with Shopify, with live analytics and real-time updates.'
    })
    assert.ok(!told.some(p => /neither the video/.test(p)), told.join('\n'))
  })

  it('drops a feature no frame shows, and sends back a post that names it', () => {
    const guessed: MediaFeature = {
      name: 'Delivery text alerts',
      frames: [],
      shown: '',
      benefit: 'Customers hear about delays',
      priority: 'supporting',
      group: 'Fewer questions',
      terms: ['alerts']
    }
    const { analysis: verified, unverified } = verifiedAnalysis(
      {
        ...analysis,
        message: {
          ...analysis.message,
          features: [
            ...analysis.message.features,
            guessed,
            { ...guessed, name: 'Out of range', frames: [0, 99, 2.5], terms: ['range'] },
            { ...guessed, name: 'Seen twice', frames: [9, 3, 3], terms: ['twice'] }
          ]
        }
      },
      16,
      ''
    )
    assert.deepStrictEqual(unverified.map(f => f.name), ['Delivery text alerts', 'Out of range'])
    assert.deepStrictEqual(
      verified.message.features.map(f => [f.name, f.frames]).slice(-2),
      [['Light and dark designs', [4]], ['Seen twice', [3, 9]]]
    )
    const post = draft({
      ...goodPost,
      body: `${goodPost.body}\n\nCustomers also get alerts when a parcel runs late.`
    })
    const problems = mediaPostProblems(post, { ...check, analysis: verified, unverified })
    assert.ok(
      problems.some(p => /^It names "Delivery text alerts", which none of the video's frames shows\./.test(p)),
      problems.join('\n')
    )
    // Named in the notes, it stays, with no frames.
    const noted = verifiedAnalysis(
      { ...analysis, message: { ...analysis.message, features: [guessed] } },
      16,
      'We also send text alerts on delays.'
    )
    assert.deepStrictEqual(noted.unverified, [])
    assert.deepStrictEqual(noted.analysis.message.features[0]!.frames, [])
  })

  it('never leaves a feature that a caption names as minor', () => {
    const minor = (name: string, terms: string[]): MediaFeature => ({
      name,
      frames: [6],
      shown: '',
      benefit: '',
      priority: 'minor',
      group: 'Safe to publish',
      terms
    })
    const { analysis: ranked } = verifiedAnalysis(
      {
        ...analysis,
        visibleText: ['Check it on mobile before you publish.', 'Dark', 'Save as template'],
        message: {
          ...analysis.message,
          features: [minor('Mobile preview', ['mobile']), minor('Dark mode', ['dark']), minor('Templates', ['template'])]
        }
      },
      16,
      ''
    )
    // A caption card names the first; a label or a button is no caption.
    assert.deepStrictEqual(
      ranked.message.features.map(f => [f.name, f.priority]),
      [
        ['Mobile preview', 'supporting'],
        ['Dark mode', 'minor'],
        ['Templates', 'minor']
      ]
    )
  })

  it("sends back the demo's sample offer quoted as the product's", () => {
    const sampled = {
      ...check,
      analysis: {
        ...analysis,
        message: { ...analysis.message, scaffolding: ['THANKS15', '15% off your next order', '$49'] }
      }
    }
    const post = draft({
      ...goodPost,
      body: goodPost.body.replace('a discount for the next order', 'a 15% discount for the next order')
    })
    const problems = mediaPostProblems(post, sampled)
    assert.ok(
      problems.some(p => /^It names the demo's sample data \("15%"\)/.test(p)),
      problems.join('\n')
    )
    const theirs = mediaPostProblems(post, { ...sampled, notes: 'Our launch offer is 15% off.' })
    assert.ok(!theirs.some(p => /sample data/.test(p)), theirs.join('\n'))
  })

  it('catches advert language, unless the author writes that way', () => {
    const advert = draft({
      ...goodPost,
      body: `${goodPost.body}\n\nIt's a game-changer: a seamless, world-class experience!! Don't miss out.`
    })
    const problems = mediaPostProblems(advert, check)
    const hype = problems.find(p => /reads as an advert/.test(p))
    assert.ok(hype)
    for (const phrase of ['game-changer', 'seamless', 'world-class', "don't miss out"]) {
      assert.ok(hype.includes(phrase), `${phrase} in ${hype}`)
    }
    assert.ok(problems.some(p => /2 exclamation marks/.test(p)))

    const mine = mediaPostProblems(
      draft({ ...goodPost, body: `${goodPost.body}\n\nA seamless handover.` }),
      { ...check, notes: 'We call it a seamless handover.' }
    )
    assert.ok(!mine.some(p => /seamless/.test(p)), mine.join('\n'))
  })

  it('catches invented figures and a post that repeats itself', () => {
    const post = draft({
      ...goodPost,
      body: [
        'Tracking pages cut support tickets by 40%.',
        'Tracking pages keep shoppers. Tracking pages show offers. Tracking pages carry your brand.',
        'Every shopper sees your offers, every shopper sees your logo, every shopper stays.'
      ].join('\n\n')
    })
    const problems = mediaPostProblems(post, check)
    assert.ok(problems.some(p => /"40%"/.test(p)), problems.join('\n'))
    const repeats = problems.find(p => /It repeats itself/.test(p))
    assert.ok(repeats, problems.join('\n'))
    assert.match(repeats, /"every shopper sees" more than once/)
    assert.match(repeats, /opening with "tracking"/)
  })

  it('catches captions retold one after another', () => {
    const post = draft({
      ...goodPost,
      body: [
        'Set your brand once, see it live.',
        'Banners, offers and links, shown to every visitor.',
        'Customers get answers without leaving your brand.'
      ].join('\n\n')
    })
    const problems = mediaPostProblems(post, check)
    assert.ok(
      problems.some(p => /repeats 3 of the video's captions word for word/.test(p)),
      problems.join('\n')
    )
  })

  it('asks for specific hashtags on a professional platform', () => {
    const problems = mediaPostProblems(
      draft({ ...goodPost, hashtags: ['Video', 'OrderTracking'] }),
      check
    )
    assert.ok(problems.some(p => /"#Video" is too general/.test(p)))
  })

  it('asks for a Short title, and checks its description as prose', () => {
    const short = draft({
      platform: 'youtube',
      formatId: 'youtube.short',
      hook: 'Carrier links send shoppers away.',
      body: 'This one keeps them on the store. It is a game-changer.',
      cta: 'Where do yours land?'
    })
    const problems = mediaPostProblems(short, check)
    assert.ok(problems.some(p => /has no title/.test(p)))
    assert.ok(problems.some(p => /game-changer/.test(p)), problems.join('\n'))
    // A caption is not a script: it is not timed.
    assert.ok(!problems.some(p => /seconds to say/.test(p)))
  })

  it('leaves the closing question to LinkedIn and casual tone to casual platforms', () => {
    const insta = draft({
      platform: 'instagram',
      formatId: 'instagram.caption',
      hook: 'Your store, all the way to the doorstep!',
      body: 'Tracking that looks like you!',
      cta: ''
    })
    const problems = mediaPostProblems(insta, check)
    assert.ok(!problems.some(p => /end on a question/.test(p)), problems.join('\n'))
  })
})

describe('writing checks for posts from media', () => {
  it('counts sentences that walk through steps', () => {
    assert.strictEqual(
      countSequenceOpenings(
        'First, set the brand. Then add offers.\n\nNext, share it. • Finally preview.'
      ),
      4
    )
    assert.strictEqual(countSequenceOpenings('The first thing you see is the logo.'), 0)
  })

  it('finds captions repeated word for word, not quoted or paraphrased ones', () => {
    const captions = ['Customers get answers without leaving your brand.', 'Go.']
    assert.deepStrictEqual(
      findRetoldCaptions('Customers get answers without leaving your brand, fast.', captions),
      ['Customers get answers without leaving your brand.']
    )
    assert.deepStrictEqual(
      findRetoldCaptions('“Customers get answers without leaving your brand.”', captions),
      []
    )
    assert.deepStrictEqual(
      findRetoldCaptions('Shoppers get their answer on your own page.', captions),
      []
    )
  })

  it('finds overused words and repeated phrases (a product name aside) and repeated openings', () => {
    const text =
      'Track360 keeps customers. Track360 shows customers offers. Track360 helps customers. Customers stay with Track360. Customers return to Track360 without leaving your brand, never leaving your brand.'
    const found = findRepeatedWording(text, { ignore: ['Track360'] })
    assert.deepStrictEqual(found.words, [{ word: 'customers', count: 5 }])
    assert.deepStrictEqual(found.phrases, ['leaving your brand'])
    // Three sentences opening on the name still read as a list.
    assert.deepStrictEqual(found.openings, ['track360'])
    const named = findRepeatedWording(text)
    assert.deepStrictEqual(
      named.words.map(w => w.word).sort(),
      ['customers', 'track360']
    )
  })

  it('finds a sentence naming every control, not a pair or a triad', () => {
    assert.deepStrictEqual(
      findLongLists(
        'Set your brand colours, fonts, logo and button shape in one place. Banners, a promo code, a product grid, a delivery promise and social links sit on the page.'
      ).map(l => l.items),
      [4, 5]
    )
    assert.deepStrictEqual(
      findLongLists(
        'Your colours, logo and fonts go on it. If a customer asks, you answer, and they stay. The page is quick, clear and yours.'
      ),
      []
    )
  })

  it('counts list lines, and finds a list announced', () => {
    assert.strictEqual(
      countListLines('Intro\n• One\n• Two\n- Three\n1. Four\n🚚 Five\nPlain line'),
      5
    )
    assert.deepStrictEqual(
      findFeatureSheetPhrases("Here's what it does for you: key features include banners."),
      ["here's what it does", 'key features', 'features include']
    )
    assert.deepStrictEqual(findFeatureSheetPhrases('What it does for your buyers matters.'), [])
  })

  it('finds a sentence that says again what an earlier paragraph said', () => {
    assert.deepStrictEqual(
      findRestatedSentences(
        'That is where they leave your brand.\n\nThe page sells.\n\nThey get it all without leaving your brand.'
      ),
      [
        {
          first: 'That is where they leave your brand.',
          again: 'They get it all without leaving your brand.'
        }
      ]
    )
    // In one paragraph, or a word or two shared with a longer sentence: no.
    assert.deepStrictEqual(
      findRestatedSentences(
        'Your brand stays. Your brand sells.\n\nCustomers check the brand page before buying again.'
      ),
      []
    )
    // Names expected to recur do not count.
    assert.deepStrictEqual(
      findRestatedSentences('Track360 pages convert.\n\nTrack360 pages convert visitors.', {
        ignore: ['Track360']
      }),
      [{ first: 'Track360 pages convert.', again: 'Track360 pages convert visitors.' }]
    )
  })

  it('finds capabilities the evidence does not show', () => {
    assert.deepStrictEqual(
      findUnsupportedCapabilities(
        'It syncs with your Shopify store, sends SMS alerts and uses AI to predict delays.',
        'A tracking page editor with banners.'
      ),
      ['syncs with your', 'ai', 'sms', 'shopify']
    )
    assert.deepStrictEqual(
      findUnsupportedCapabilities(
        'It connects to your Shopify store.',
        'Connect your Shopify store in Settings.'
      ),
      []
    )
    // "AI" only as a word; "the app" is the product itself.
    assert.deepStrictEqual(
      findUnsupportedCapabilities('Said plainly, the app keeps buyers on your page.', ''),
      []
    )
  })

  it('finds hype and generic AI phrasing', () => {
    assert.deepStrictEqual(
      findPromotionalPhrases(
        'The ultimate solution: industry-leading, effortless, and it will skyrocket results. Unlock the power of tracking.'
      ).sort(),
      ['effortless', 'industry-leading', 'skyrocket', 'the ultimate solution', 'unlock the power'].sort()
    )
    assert.deepStrictEqual(findPromotionalPhrases('A tracking page in your colours.'), [])
    // Urgency is an order opening a sentence, not the words anywhere.
    assert.deepStrictEqual(findPromotionalPhrases('Great deal. Order now!'), ['order now'])
    assert.deepStrictEqual(
      findPromotionalPhrases(
        'Customers checking their order now see your offer. It adds buy now, pay later at checkout.'
      ),
      []
    )
  })
})

describe('what a post from media covers', () => {
  const feature = (
    name: string,
    terms: string[],
    priority: MediaFeature['priority'] = 'lead',
    group = name,
    frames = [1]
  ): MediaFeature => ({
    name,
    frames,
    shown: '',
    benefit: '',
    priority,
    group,
    terms
  })

  it('finds a feature by its words, stems and spellings included', () => {
    const features = [
      feature('Customisation', ['customise']),
      feature('Banners', ['banner']),
      feature('Sharing link', ['link']),
      feature('Analytics', ['analytics'], 'minor')
    ]
    assert.deepStrictEqual(
      missingFeatures('You can customize it and add banners. More on LinkedIn.', features).map(
        f => f.name
      ),
      // "LinkedIn" is not "link"; a minor feature is never asked for.
      ['Sharing link']
    )
    assert.deepStrictEqual(
      missingFeatures('Share one link everywhere; customisation takes a minute; one banner.', features),
      []
    )
  })

  it("falls back to a feature's name when it has no terms", () => {
    assert.deepStrictEqual(
      missingFeatures('A mobile view for shoppers.', [feature('Mobile preview', [])]),
      []
    )
    assert.strictEqual(
      missingFeatures('Your colours.', [feature('Mobile preview', [])]).length,
      1
    )
  })

  it('groups features by the outcome they serve, the strongest group first', () => {
    const features = [
      feature('Dark mode', ['dark'], 'minor', 'Looks like your store'),
      feature('Offers', ['offer'], 'supporting', 'Sells while they wait'),
      feature('Brand styling', ['brand'], 'lead', 'looks like  your store'),
      feature('Extras', ['extra'], 'minor', 'Odds and ends')
    ]
    assert.deepStrictEqual(
      featureGroups(features).map(g => [g.name, g.features.map(f => f.name)]),
      [
        ['Looks like your store', ['Brand styling', 'Dark mode']],
        ['Sells while they wait', ['Offers']],
        ['Odds and ends', ['Extras']]
      ]
    )
    // A group of minor features is not carried.
    assert.deepStrictEqual(
      groupsToCover(features).map(g => g.name),
      ['Looks like your store', 'Sells while they wait']
    )
  })

  it('asks for every lead and supporting feature, never a minor one', () => {
    const features = [
      feature('Brand styling', ['brand'], 'lead', 'Looks like your store'),
      feature('Mobile preview', ['mobile'], 'supporting', 'Looks like your store'),
      feature('Offers', ['offer'], 'lead', 'Sells'),
      feature('Preview link', ['preview'], 'supporting', 'Checked first'),
      feature('Share link', ['share'], 'supporting', 'Checked first'),
      feature('Dark mode', ['dark'], 'minor', 'Looks like your store')
    ]
    assert.deepStrictEqual(
      missingFeatures('Your brand, everywhere.', features).map(f => f.name),
      ['Mobile preview', 'Offers', 'Preview link', 'Share link']
    )
    assert.deepStrictEqual(
      missingFeatures('Your brand on mobile, with offers; preview it, then share it once.', features),
      []
    )
  })

  it('finds hashtags in the text, not link anchors or numbers', () => {
    assert.deepStrictEqual(
      hashtagsInText('See example.com/page#pricing, we are #1, built for #ecommerce and #CX. #ecommerce'),
      ['#ecommerce', '#CX']
    )
  })

  it('finds narration of the media, not ordinary business language', () => {
    assert.deepStrictEqual(
      findMediaNarration(
        'In this demo you get a page. This video shows the editor. The moment worth watching is the last scene.'
      ).sort(),
      ['in this demo', 'last scene', 'moment worth watching', 'this video shows'].sort()
    )
    assert.deepStrictEqual(
      findMediaNarration(
        'The first screen your buyer sees after checkout. Watch for delays at 9:30. You can see the status on your phone.'
      ),
      []
    )
  })
})
