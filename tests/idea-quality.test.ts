import assert from 'node:assert'
import { describe, it } from 'node:test'
import { ideaQuality, shownScore } from '../src/lib/ai/idea-diversity'
import { buildGroundingCorpus } from '../src/lib/ai/pipeline/grounding-corpus'
import { inferRegion, servedRegionInBio } from '../src/lib/ai/region'
import {
  applyGoalReviews,
  incompleteReviews,
  mergeSecondReview,
  missingDimensions,
  readGoalReviews
} from '../src/lib/ai/skills/goal-review/guard'
import {
  buildPrompt as buildReviewPrompt,
  INSTRUCTIONS as REVIEW_INSTRUCTIONS
} from '../src/lib/ai/skills/goal-review/prompt'
import { validateIdea, type GroundingCorpus } from '../src/lib/ai/skills/ideation/guard'
import {
  buildInstructions,
  buildPrompt,
  renderCorpusForPrompt
} from '../src/lib/ai/skills/ideation/prompt'
import type { GeneratedIdeaItem } from '../src/lib/ai/skills/ideation/schema'
import {
  hasWeakSources,
  scoreSources,
  withMeasuredNovelty
} from '../src/lib/idea-scorecard'
import { buildSearchQueries, planTrendScan } from '../src/lib/research/findings'
import { rateSource, screenFindings } from '../src/lib/research/source-credibility'
import type { Finding } from '../src/lib/research/web-search'
import { account, audience, context, goal, offering } from './fixtures/generation'

/**
 * Idea quality, from the complaint that nearly every idea was labelled
 * "Weak sources": 34 of a real account's 38. Creative ideas that state no
 * facts scored 55 by construction, and the brand's own offer was dropped as
 * "a homepage story". Source quality now covers only the facts an idea
 * states; research is screened and rated; and every idea is scored on
 * originality, trend relevance, brand fit and engagement, each with a reason.
 */

const zomato = (enabledFormats: string[] = ['instagram.caption']) =>
  context({
    account: account({
      name: 'Zomato',
      company: 'Eternal Limited',
      industry: 'Food delivery',
      websiteUrl: 'https://www.zomato.com/',
      bio: 'Zomato is a food discovery and delivery platform that connects people with restaurants across India.'
    }),
    audiences: [audience('Young adults ordering in with friends')],
    offerings: [offering('Zomato Gold', { description: 'Free delivery and extra discounts' })],
    goal: goal({
      id: 'g-share',
      title: 'Make people smile and share food moments',
      objective: 'engagement',
      keyMessage: 'Food is the most relatable thing in everyday life.'
    }),
    otherGoals: [
      goal({ id: 'g-gold', title: 'Promote Zomato Gold', objective: 'promote' })
    ],
    enabledFormats
  })

function idea(overrides: Partial<GeneratedIdeaItem> = {}): GeneratedIdeaItem {
  return {
    title: 'The fridge stare',
    thesis: 'Everyone has stared into a full fridge and found nothing to eat.',
    perspectiveAngle: 'relatable_moment',
    angle: 'A full fridge, nothing to eat',
    goalId: 'g-share',
    goalIds: ['g-share'],
    targetAudience: 'Young adults ordering in with friends',
    format: 'post',
    whyNow: 'Structural: it happens every evening.',
    hookConcept: 'POV: the fridge is full and you still order in.',
    coreArgument: 'The joke lands because everyone has done it.',
    audienceTakeaway: 'Tag the friend who does this.',
    supportingEvidence: [],
    suggestedMedia: { mode: 'none' },
    noveltyNote: 'Not a food tip; a confession.',
    estimatedStrength: 80,
    groundingScore: 0,
    originalityScore: 0,
    unsupportedClaims: [],
    sourceIds: [],
    risks: [],
    ...overrides
  }
}

describe('source quality is about the facts an idea states, not the idea', () => {
  it('a creative idea that states no facts needs no sources and is not flagged', () => {
    const result = validateIdea(idea(), { verifiedClaims: [] })
    assert.strictEqual(result.isValid, true)
    const sources = result.idea.scorecard?.sources
    assert.strictEqual(sources?.status, 'not_needed')
    assert.strictEqual(sources?.score, null)
    assert.match(sources!.reason, /states no facts/)
    // It was 55 by construction, and so "Weak sources".
    assert.strictEqual(result.groundingScore, 100)
    assert.strictEqual(hasWeakSources(result.idea), false)
  })

  it("keeps a brand's own offer stated on its homepage, figures and all", () => {
    const corpus: GroundingCorpus = {
      verifiedClaims: [
        {
          claim: 'Gold gives free delivery within 7 km and up to 30% extra off at partner restaurants.',
          sourceUrl: 'https://www.zomato.com/',
          sourceTitle: 'Zomato',
          origin: 'knowledge'
        }
      ]
    }
    const result = validateIdea(
      idea({
        supportingEvidence: [
          {
            claim: 'Gold gives free delivery within 7 km and up to 30% extra off at partner restaurants.',
            sourceUrl: 'https://www.zomato.com/',
            factType: 'verified',
            confidence: 0.9
          }
        ]
      }),
      corpus
    )
    assert.strictEqual(result.idea.supportingEvidence.length, 1, result.issues.join(' | '))
    assert.strictEqual(result.idea.scorecard?.sources?.status, 'strong')
    assert.match(result.idea.scorecard!.sources!.reason, /knowledge base/)
  })

  it('still drops a launch a homepage never mentions', () => {
    const corpus: GroundingCorpus = {
      verifiedClaims: [
        {
          claim: 'Zomato Gold gives free delivery on the meals you love across the country',
          sourceUrl: 'https://www.zomato.com/',
          sourceTitle: 'Zomato',
          origin: 'web'
        }
      ]
    }
    const result = validateIdea(
      idea({
        supportingEvidence: [
          {
            claim: 'Zomato launched Gold free delivery on the meals you love across the country in 2026',
            sourceUrl: 'https://www.zomato.com/',
            factType: 'sourced',
            confidence: 0.9
          }
        ]
      }),
      corpus
    )
    assert.strictEqual(result.idea.supportingEvidence.length, 0)
    assert.match(result.issues.join(' '), /homepage or index/)
    assert.strictEqual(result.idea.scorecard?.sources?.status, 'weak')
    assert.strictEqual(hasWeakSources(result.idea), true)
  })

  it('says when a fact rests only on social posts, and rates news above them', () => {
    const social = scoreSources(
      [{ direct: true, credibility: rateSource({ url: 'https://www.instagram.com/p/abc/', origin: 'web' }) }],
      0
    )
    const news = scoreSources(
      [{ direct: true, credibility: rateSource({ url: 'https://economictimes.indiatimes.com/x', origin: 'web' }), sourceName: 'The Economic Times' }],
      0
    )
    assert.match(social.reason, /Social posts and forums show what people say/)
    assert.ok(news.score! > social.score!)
    assert.match(news.reason, /established news \(The Economic Times\)/)
  })

  it('says when a source only partly states a claim, which is why it counts for less', () => {
    const sources = scoreSources(
      [{ direct: false, credibility: rateSource({ url: 'https://www.ndtv.com/a', origin: 'web' }), sourceName: 'NDTV' }],
      0
    )
    assert.strictEqual(sources.score, 64)
    assert.match(sources.reason, /Its source only partly states it, so it counts for less\./)
  })

  it('counts a dropped claim against the idea, and says so', () => {
    const sources = scoreSources(
      [{ direct: true, credibility: rateSource({ origin: 'own' }) }],
      1
    )
    assert.ok(sources.score! < 55, String(sources.score))
    assert.match(sources.reason, /1 more could not be verified and was dropped/)
  })

  it('older ideas warn only when a claim of theirs was dropped', () => {
    assert.strictEqual(hasWeakSources({ groundingScore: 55, unsupportedClaims: [] }), false)
    assert.strictEqual(hasWeakSources({ groundingScore: 41, unsupportedClaims: ['x'] }), true)
  })
})

describe('sources are rated, and research is screened', () => {
  it('rates sources by where they come from', () => {
    const rate = (url: string) => rateSource({ url, origin: 'web', ownHosts: ['zomato.com'] })
    assert.strictEqual(rate('https://www.livemint.com/a').tier, 'news')
    assert.strictEqual(rate('https://www.afaqs.com/a').tier, 'industry')
    assert.strictEqual(rate('https://blog.zomato.com/a').tier, 'official')
    assert.strictEqual(rate('https://www.pib.gov.in/a').tier, 'official')
    assert.strictEqual(rate('https://www.reddit.com/r/india/a').tier, 'forum')
    assert.strictEqual(rate('https://www.facebook.com/x/posts/1').tier, 'social')
    assert.strictEqual(rate('https://www.imarcgroup.com/report').tier, 'low')
    assert.strictEqual(rate('https://unknown.example/a').tier, 'unrated')
    assert.strictEqual(rateSource({ origin: 'own' }).tier, 'own')
  })

  it('marks down a page written for another market', () => {
    const home = rateSource({ url: 'https://www.livemint.com/a', origin: 'web', regionCode: 'in' })
    const away = rateSource({ url: 'https://merchants.doordash.com/en-au/blog', origin: 'web', regionCode: 'in' })
    assert.ok(away.score < 50)
    assert.match(away.note!, /Australia, not India/)
    assert.strictEqual(home.note, undefined)
  })

  it('drops ranking pages, stock quotes, other markets and syndicated copies', () => {
    const f = (url: string, title: string): Finding => ({
      url,
      title,
      snippet: '',
      provider: 'serper_search'
    })
    const { kept, dropped } = screenFindings(
      [
        f('https://www.imarcgroup.com/united-states-online-food-delivery-market', 'US Online Food Delivery Market'),
        f('https://upstox.com/stocks/zomato', 'Zomato Share Price - Live NSE'),
        f('https://merchants.doordash.com/en-au/blog/habits', 'Online ordering habits'),
        f('https://example.com/au', '2025 Food Delivery Trends in Australia'),
        f('https://www.livemint.com/a', 'Swiggy and Zomato Diwali orders rise 10.7%'),
        f('https://www.fortuneindia.com/b', 'Swiggy and Zomato Diwali orders rise 10.7%'),
        f('https://www.ndtv.com/c', 'From Georgia to India: a dance goes viral'),
        { ...f('https://www.telegraphindia.com/d', 'Kolkata welcomes Kenyan delegates'), snippet: 'Delegates from Kenya toured Durga Puja pandals across India.' }
      ],
      { regionCode: 'in', regionName: 'India' }
    )
    assert.deepStrictEqual(
      kept.map(k => k.url),
      ['https://www.livemint.com/a', 'https://www.ndtv.com/c', 'https://www.telegraphindia.com/d']
    )
    assert.strictEqual(dropped.length, 5)
    assert.ok(dropped.every(d => d.reason.length > 0))
  })

  it('keeps sensitive stories out of the trend scan, but not out of the news', () => {
    const story = (kind: 'trend' | 'news'): Finding => ({
      url: 'https://theprint.in/a',
      title: 'Jensen Huang ‘spy’ affair is meme material on Indian X',
      snippet: '',
      provider: 'serper_news',
      kind
    })
    assert.match(screenFindings([story('trend')]).dropped[0]!.reason, /sensitive story/)
    assert.strictEqual(screenFindings([story('news')]).kept.length, 1)
  })

  it('reads the market from where the bio says it operates, not where it comes from', () => {
    assert.strictEqual(servedRegionInBio('Restaurants across India.')?.code, 'in')
    assert.strictEqual(servedRegionInBio('Serving customers in Kenya')?.code, 'ke')
    assert.strictEqual(servedRegionInBio('A South Korean multinational.'), null)
    assert.strictEqual(servedRegionInBio('Across India and the UK'), null)
    assert.strictEqual(inferRegion(zomato())?.name, 'India')
  })
})

describe('research looks for what is happening now', () => {
  it('searches a company by the name people know, and goals by their subject', () => {
    // LinkedIn alone: the editorial queries, anchored on the brand.
    const queries = buildSearchQueries(zomato(['linkedin.post']), 4, { code: 'in', name: 'India' })
    assert.deepStrictEqual(queries, [
      'Zomato viral India',
      'Zomato Gold India'
    ])
    // A casual run searches trends in the field, with the goals' subjects.
    const casual = buildSearchQueries(zomato(), 6, { code: 'in', name: 'India' }).join(' | ')
    assert.ok(!/Eternal Limited|Make people smile|video ideas/.test(casual), casual)
    assert.match(casual, /Food delivery Zomato Gold India/)
  })

  it('scans the news, the trends, the memes and the conversations for a casual run', () => {
    const plan = planTrendScan(zomato(), {
      platforms: ['Instagram'],
      style: 'casual',
      region: { code: 'in', name: 'India' }
    })
    const show = plan.map(q => `${q.endpoint}:${q.kind}:${q.query}`)
    assert.ok(show.includes('news:news:Zomato'), show.join(' | '))
    assert.ok(show.includes('news:news:Food delivery India'), show.join(' | '))
    assert.ok(show.includes('news:trend:viral Instagram trend India'), show.join(' | '))
    assert.ok(show.includes('news:trend:viral meme India'), show.join(' | '))
    assert.ok(show.includes('search:conversation:site:reddit.com Food delivery India'), show.join(' | '))
    assert.ok(plan.every(q => q.freshnessDays <= 31))
  })

  it('looks for the field’s trends, not memes, for a professional run', () => {
    const plan = planTrendScan(
      context({ account: account({ name: 'Ledgerly', industry: 'Accounting' }), goal: goal() }),
      { platforms: [], style: 'professional', region: null }
    )
    const queries = plan.map(q => q.query)
    assert.ok(queries.includes('Accounting trend'), queries.join(' | '))
    assert.ok(!queries.some(q => /meme/.test(q)), queries.join(' | '))
  })

  it('rates and kinds trend findings in the corpus, ahead of plain web results', () => {
    const corpus = buildGroundingCorpus(
      zomato(),
      [
        { url: 'https://unknown.example/a', title: 'Some page', snippet: 'Some text about food', provider: 'serper_search' },
        { url: 'https://www.livemint.com/b', title: 'Zomato campaign', snippet: 'Zomato ran a campaign', provider: 'serper_news', kind: 'news', publisher: 'Mint', publishedAt: '2026-09-29' }
      ],
      [],
      new Date('2026-10-01T00:00:00Z')
    )
    const news = corpus.verifiedClaims.find(c => c.kind === 'news')!
    assert.strictEqual(news.credibility?.tier, 'news')
    assert.strictEqual(news.publisher, 'Mint')
    assert.strictEqual(corpus.sources.trendSignals, 1)
    const out = renderCorpusForPrompt(corpus, 30)
    assert.match(out, /Source type: established news \(Mint\)/)
    assert.match(out, /Kind: news: what is being reported/)
  })
})

describe('ideation aims for creative, shareable, current ideas', () => {
  it('asks for specific, surprising ideas with reach, and never a tragedy', () => {
    const instructions = buildInstructions(zomato())
    assert.match(instructions, /WHAT MAKES AN IDEA WORTH POSTING/)
    assert.match(instructions, /think of the obvious post on its subject, and do not write that one/)
    assert.match(instructions, /REACH, WHATEVER THE GOAL/)
    assert.match(instructions, /Not every idea has to sell/)
    assert.match(instructions, /Never build an idea on a tragedy/)
  })

  it('uses current items only when they fit, and claims no trend without research', () => {
    const base = { history: '', candidateCount: 3, assignedGoals: ['G1', 'G1', 'G1'], hookMaxChars: 200 }
    const withTrend = buildPrompt({
      ...base,
      corpus: { verifiedClaims: [{ claim: 'A meme', sourceTitle: 'Meme', kind: 'trend', origin: 'web' }] }
    })
    assert.match(withTrend, /Build on one only when it fits/)
    assert.match(withTrend, /a forced trend is worse than none/)
    const without = buildPrompt({ ...base, corpus: { verifiedClaims: [] } })
    assert.match(without, /Do not claim that anything is trending/)
  })
})

describe('every idea is scored, each score with its reason', () => {
  const judged = (score: number, reason = 'Because.') => ({ score, reason })

  it('reads all five judged scores and keeps them on the idea', () => {
    const reviews = readGoalReviews(
      {
        reviews: [
          {
            idea: 'I1',
            readerFit: true,
            score: 82,
            reason: 'Lands the message.',
            originality: judged(140, 'A take nobody posts.'),
            trendRelevance: judged(45, 'Evergreen.'),
            brandFit: judged(88),
            engagement: judged(76)
          }
        ]
      },
      1
    )
    assert.strictEqual(reviews[0]?.scorecard?.originality?.score, 100)
    const validated = validateIdea(idea(), { verifiedClaims: [] }).idea
    const { kept } = applyGoalReviews([validated], reviews)
    const card = kept[0]!.scorecard!
    assert.strictEqual(kept[0]!.originalityScore, 100)
    assert.strictEqual(card.trendRelevance?.reason, 'Evergreen.')
    // The validator's source score survives the review.
    assert.strictEqual(card.sources?.status, 'not_needed')
  })

  it('reads a score with no reason as no score, so it can be asked for again', () => {
    // Seen live: after the first ideas, every originality came back as 0 and "".
    const [review] = readGoalReviews(
      {
        reviews: [
          {
            idea: 'I1',
            readerFit: true,
            score: 80,
            reason: 'Lands it.',
            originality: { score: 0, reason: '' },
            trendRelevance: judged(40, 'Evergreen.'),
            brandFit: judged(80),
            engagement: judged(70)
          }
        ]
      },
      1
    )
    assert.strictEqual(review?.scorecard?.originality, undefined)
    assert.deepStrictEqual(missingDimensions(review!), ['originality'])
  })

  it('asks again for skipped ideas and missing scores, keeping what the first review gave', () => {
    const full = { score: 80, readerFit: true, reason: 'Lands it.' }
    const reviews = [
      { ...full, scorecard: { originality: judged(70, 'First.'), trendRelevance: judged(40, 'Evergreen.'), brandFit: judged(80), engagement: judged(75) } },
      { ...full, scorecard: { trendRelevance: judged(40, 'Evergreen.'), brandFit: judged(80), engagement: judged(75) } },
      null
    ]
    const incomplete = incompleteReviews(reviews)
    assert.deepStrictEqual(incomplete, [1, 2])
    const again = [
      { ...full, score: 10, scorecard: { originality: judged(66, 'Second.'), brandFit: judged(20) } },
      { ...full, score: 77, scorecard: { originality: judged(60, 'Skipped one.') } }
    ]
    const merged = mergeSecondReview(reviews, incomplete, again)
    assert.strictEqual(merged[0], reviews[0])
    // The second review fills only what was missing; goal fit stays the first's.
    assert.strictEqual(merged[1]!.score, 80)
    assert.strictEqual(merged[1]!.scorecard!.originality!.reason, 'Second.')
    assert.strictEqual(merged[1]!.scorecard!.brandFit!.score, 80)
    // A skipped idea takes the whole second review.
    assert.strictEqual(merged[2]!.score, 77)
  })

  it('caps originality for an idea close to an earlier one, and names it', () => {
    const scored = withMeasuredNovelty(
      idea({ scorecard: { originality: judged(90, 'Fresh.') } }),
      { title: 'The fridge is full', similarity: 0.8 }
    )
    assert.strictEqual(scored.scorecard?.originality?.score, 65)
    assert.match(scored.scorecard!.originality!.reason, /“The fridge is full” \(80% alike\)/)
    assert.strictEqual(withMeasuredNovelty(idea(), { title: 'x', similarity: 0.6 }).scorecard, undefined)
  })

  it('ranks on reach and originality, lightly on trends, and only weak facts cost rank', () => {
    const scored = (card: Record<string, number>, sources?: 'weak' | 'not_needed') =>
      idea({
        goalFitScore: card.goal ?? 80,
        scorecard: {
          engagement: judged(card.engagement ?? 70),
          originality: judged(card.originality ?? 70),
          trendRelevance: judged(card.trend ?? 50),
          brandFit: judged(card.brand ?? 80),
          ...(sources === 'weak'
            ? { sources: { status: 'weak', score: 30, reason: '', claims: 1, dropped: 1 } }
            : sources === 'not_needed'
              ? { sources: { status: 'not_needed', score: null, reason: '', claims: 0, dropped: 0 } }
              : {})
        }
      })
    // An evergreen idea people would share beats a trend-chaser nobody would.
    assert.ok(
      ideaQuality(scored({ engagement: 90, trend: 40 })) >
        ideaQuality(scored({ engagement: 50, trend: 95 }))
    )
    // Needing no sources costs nothing; weak facts do.
    assert.strictEqual(ideaQuality(scored({}, 'not_needed')), ideaQuality(scored({})))
    assert.ok(ideaQuality(scored({}, 'weak')) < ideaQuality(scored({})))
  })

  it('ranks an idea the review never scored below one it scored well', () => {
    // Seen live: the review skipped four ideas, and their unjudged craft
    // score (grounding 100 for needing no sources) put them at the top.
    const unjudged = validateIdea(idea({ estimatedStrength: 90 }), { verifiedClaims: [] }).idea
    const judgedWell = idea({
      goalFitScore: 82,
      scorecard: {
        engagement: judged(80),
        originality: judged(75),
        trendRelevance: judged(40),
        brandFit: judged(85)
      }
    })
    assert.ok(ideaQuality(judgedWell) > ideaQuality(unjudged), `${ideaQuality(judgedWell)} vs ${ideaQuality(unjudged)}`)
  })

  it('shows the review\'s overall score, not the writer\'s own estimate', () => {
    // Zomato, 2026-11-20: the writer left estimatedStrength out, so every
    // idea showed "Strength score 85/100" whatever the review said.
    const reviewed = (engagement: number) =>
      idea({
        estimatedStrength: 85,
        goalFitScore: 80,
        scorecard: {
          engagement: judged(engagement),
          originality: judged(70),
          trendRelevance: judged(40),
          brandFit: judged(85)
        }
      })
    assert.strictEqual(shownScore(reviewed(90)), Math.round(ideaQuality(reviewed(90))))
    assert.notStrictEqual(shownScore(reviewed(90)), shownScore(reviewed(50)))
    // Not reviewed: the writer's estimate is all there is.
    assert.strictEqual(shownScore(idea({ estimatedStrength: 72 })), 72)
  })

  it('briefs the reviewer on the brand, what is current and what came before', () => {
    assert.match(REVIEW_INSTRUCTIONS, /ORIGINALITY:[\s\S]*TREND RELEVANCE:[\s\S]*BRAND FIT:[\s\S]*ENGAGEMENT POTENTIAL:/)
    assert.match(REVIEW_INSTRUCTIONS, /evergreen: tied to nothing happening now\. That is fine/)
    assert.match(REVIEW_INSTRUCTIONS, /potential, not a prediction/)
    const prompt = buildReviewPrompt({
      account: 'Zomato, Food delivery',
      brand: 'Voice: playful',
      platform: 'Instagram',
      now: ['Bollywood memes of the week (The Indian Express, 2026-11-15) [trend]'],
      earlier: ['The fridge is full'],
      goals: [{ label: 'G1', title: 'Share food moments', objective: 'engagement', keyMessage: null, desiredAction: null }],
      ideas: [
        {
          label: 'I1',
          goalLabel: 'G1',
          readers: 'Students',
          title: 't',
          thesis: 't',
          hookConcept: 'h',
          coreArgument: 'c',
          audienceTakeaway: 'k',
          whyNow: 'Rides the meme',
          cites: ['The Indian Express']
        }
      ]
    })
    assert.match(prompt, /Posting on: Instagram\nVoice: playful/)
    assert.match(prompt, /<now>\n- Bollywood memes of the week/)
    assert.match(prompt, /<earlier>\n- The fridge is full/)
    assert.match(prompt, /Why now: Rides the meme/)
    assert.match(prompt, /Cites: The Indian Express/)
  })
})
