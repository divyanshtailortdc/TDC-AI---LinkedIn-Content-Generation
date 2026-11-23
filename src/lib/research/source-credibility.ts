import { countriesNamed, countryName, countryOfUrl } from '../ai/region'
import { isReferencePage } from '../urls'

/**
 * How far a source can be trusted for a fact, judged from where it comes
 * from: the account's own details, an official site, an established news
 * outlet, a social post, a forum, or a page written to rank in search.
 *
 * This rates the SOURCE, never the idea that cites it. A social post or a
 * Reddit thread is weak proof of a fact but good evidence of what people are
 * posting and saying, which is what trend research looks for; the label says
 * which.
 *
 * Pure, with no server imports: the idea card rates older evidence with it.
 */

export const SOURCE_TIERS = [
  'own',
  'knowledge',
  'official',
  'news',
  'industry',
  'reference',
  'newsletter',
  'unrated',
  'social',
  'forum',
  'low'
] as const

export type SourceTier = (typeof SOURCE_TIERS)[number]

/** What a piece of research is for: a fact, the news, a trend, or what people say. */
export type SignalKind = 'background' | 'news' | 'trend' | 'conversation'

export type SourceRating = {
  tier: SourceTier
  /** 0-100: how far the source can be trusted for a fact. */
  score: number
  /** Short, for the card: "Established news", "Social post". */
  label: string
  /** Why, when there is more to say than the label ("about Australia, not India"). */
  note?: string
}

export const TIER_SCORES: Record<SourceTier, number> = {
  own: 95,
  knowledge: 90,
  official: 90,
  news: 80,
  industry: 75,
  reference: 65,
  newsletter: 60,
  unrated: 50,
  social: 40,
  forum: 35,
  low: 20
}

export const TIER_LABELS: Record<SourceTier, string> = {
  own: 'Your own details',
  knowledge: 'Your knowledge base',
  official: 'Official source',
  news: 'Established news',
  industry: 'Industry source',
  reference: 'Reference work',
  newsletter: 'Newsletter',
  unrated: 'Unrated site',
  social: 'Social post',
  forum: 'Community discussion',
  low: 'Low-quality source'
}

/** What each tier is good for, in a sentence the approver can read. */
export const TIER_NOTES: Partial<Record<SourceTier, string>> = {
  social:
    'shows what people are posting and sharing, but is not proof of a fact',
  forum: 'shows what people are saying, but is not proof of a fact',
  low: 'a page written to rank in search (a market-report summary, deals or stock page)',
  unrated: 'a site this app does not know; check it before relying on it'
}

/**
 * Established news outlets, global and Indian. A host matches its own entry
 * and every subdomain ("economictimes.indiatimes.com" matches "indiatimes.com").
 */
const NEWS = [
  'reuters.com', 'apnews.com', 'bloomberg.com', 'ft.com', 'wsj.com',
  'nytimes.com', 'washingtonpost.com', 'theguardian.com', 'bbc.com', 'bbc.co.uk',
  'cnbc.com', 'cnn.com', 'economist.com', 'axios.com', 'businessinsider.com',
  'forbes.com', 'fortune.com', 'time.com', 'theatlantic.com', 'npr.org',
  'latimes.com', 'usatoday.com', 'independent.co.uk', 'telegraph.co.uk',
  'aljazeera.com', 'scmp.com', 'straitstimes.com', 'nikkei.com', 'abc.net.au',
  'smh.com.au', 'cbc.ca', 'theglobeandmail.com', 'techcrunch.com', 'theverge.com',
  'wired.com', 'arstechnica.com', 'engadget.com', 'venturebeat.com',
  'theinformation.com', 'fastcompany.com', 'inc.com', 'hbr.org', 'semafor.com',
  // India
  'indiatimes.com', 'economictimes.com', 'livemint.com', 'business-standard.com',
  'thehindu.com', 'thehindubusinessline.com', 'hindustantimes.com',
  'indianexpress.com', 'ndtv.com', 'moneycontrol.com', 'financialexpress.com',
  'news18.com', 'indiatoday.in', 'theprint.in', 'scroll.in', 'thewire.in',
  'deccanherald.com', 'newindianexpress.com', 'firstpost.com', 'businesstoday.in',
  'fortuneindia.com', 'outlookindia.com', 'outlookbusiness.com', 'inc42.com',
  'yourstory.com', 'entrackr.com', 'the-ken.com', 'medianama.com', 'thequint.com',
  'timesnownews.com', 'gadgets360.com', 'ptinews.com', 'aninews.in', 'vccircle.com',
  'telegraphindia.com', 'tribuneindia.com', 'dnaindia.com', 'cnbctv18.com'
]

/** Trade press, research firms and the platforms' own blogs. */
const INDUSTRY = [
  'adage.com', 'adweek.com', 'campaignlive.com', 'campaignlive.co.uk',
  'campaignindia.in', 'thedrum.com', 'marketingweek.com', 'socialmediatoday.com',
  'digiday.com', 'marketingdive.com', 'retaildive.com', 'afaqs.com',
  'exchange4media.com', 'storyboard18.com', 'adgully.com', 'bestmediainfo.com',
  'impactonnet.com', 'socialsamosa.com', 'mediabrief.com', 'later.com',
  'hootsuite.com', 'sproutsocial.com', 'buffer.com', 'hubspot.com',
  'about.instagram.com', 'business.instagram.com', 'creators.instagram.com',
  'about.fb.com', 'newsroom.tiktok.com', 'blog.youtube', 'blog.x.com',
  'business.linkedin.com', 'news.linkedin.com', 'engineering.fb.com',
  'mckinsey.com', 'bcg.com', 'bain.com', 'deloitte.com', 'pwc.com', 'kpmg.com',
  'ey.com', 'accenture.com', 'gartner.com', 'forrester.com', 'pewresearch.org',
  'nielsen.com', 'kantar.com', 'ipsos.com', 'gwi.com', 'statista.com',
  'worldbank.org', 'imf.org', 'oecd.org', 'weforum.org', 'cbinsights.com',
  'crunchbase.com', 'tracxn.com', 'redseer.com', 'nasscom.in', 'ibef.org'
]

const REFERENCE = ['wikipedia.org', 'wikimedia.org', 'britannica.com', 'investopedia.com']

const SOCIAL = [
  'instagram.com', 'facebook.com', 'fb.com', 'x.com', 'twitter.com',
  'tiktok.com', 'threads.net', 'threads.com', 'linkedin.com', 'youtube.com',
  'youtu.be', 'pinterest.com', 'snapchat.com', 'medium.com', 'tumblr.com'
]

const FORUM = [
  'reddit.com', 'quora.com', 'stackexchange.com', 'stackoverflow.com',
  'news.ycombinator.com', 'teamblind.com', 'glassdoor.com', 'ambitionbox.com'
]

/**
 * Pages written to rank: paid market-report summaries (whose figures are
 * projections nobody can check), press-release wires, coupon and deals
 * pages, and stock-quote pages.
 */
const LOW = [
  'imarcgroup.com', 'fortunebusinessinsights.com', 'marketsandmarkets.com',
  'grandviewresearch.com', 'mordorintelligence.com', 'alliedmarketresearch.com',
  'precedenceresearch.com', 'researchandmarkets.com', 'expertmarketresearch.com',
  'custommarketinsights.com', 'databridgemarketresearch.com',
  'verifiedmarketresearch.com', 'gminsights.com', 'technavio.com',
  'transparencymarketresearch.com', 'persistencemarketresearch.com', 'factmr.com',
  'futuremarketinsights.com', 'coherentmarketinsights.com', 'zionmarketresearch.com',
  'maximizemarketresearch.com', 'straitsresearch.com', 'sphericalinsights.com',
  'businessresearchinsights.com', 'kbvresearch.com', 'marketresearchfuture.com',
  'thebusinessresearchcompany.com', 'researchnester.com', 'skyquestt.com',
  'openpr.com', 'einpresswire.com', 'prnewswire.com', 'globenewswire.com',
  'desidime.com', 'grabon.in', 'coupondunia.in', 'cashkaro.com', 'couponzguru.com',
  'upstox.com', 'univest.in', 'tickertape.in', 'marketscreener.com',
  'investing.com', 'techgraph.co', 'stockanalysis.com'
]

/** Hosts of government, education and international bodies. */
const OFFICIAL_HOST =
  /(?:^|\.)(?:gov|gouv|gob|govt|nic|mil|edu|ac|int)(?:\.[a-z]{2})?$|(?:^|\.)europa\.eu$|(?:^|\.)(?:who\.int|un\.org)$/i

/**
 * Stories no brand should build a trend post on: crime, death, disaster,
 * politics, a person's scandal, misinformation. Screened from the trend scan
 * only: news about a field (a court ruling for a legal account) can matter,
 * and the ideation rules keep ideas off such stories anyway.
 */
const SENSITIVE =
  /\b(?:dies|died|dead|deaths?|killed|kills|killing|murder(?:ed|s)?|rape[ds]?|suicide|accident|crash(?:ed|es)?|attack(?:ed|s)?|terror\w*|riots?|bomb\w*|shooting|stampede|traged(?:y|ies)|tragic|funeral|arrest(?:ed|s)?|bail|custody|court|lawsuit|sued|fact[- ]?check|false flag|doctored|fake news|elections?|affair|scandal|controvers(?:y|ies|ial)|outrage)\b/i

/** Stock-quote and price pages: they say nothing a post can use. */
const STOCK_PAGE =
  /\b(?:share|stock) price\b|\blive (?:nse|bse)\b|\b52[- ]week (?:high|low)\b|\bstock (?:quote|chart)\b/i

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

const onList = (host: string, list: readonly string[]) =>
  list.some(domain => host === domain || host.endsWith(`.${domain}`))

/**
 * "zomato.com" from "https://www.zomato.com/ncr": the site an account's own
 * pages live on, so its newsroom and investor pages count as official.
 */
export function ownHosts(urls: Array<string | null | undefined>): string[] {
  const hosts = urls.map(u => hostOf(u ?? undefined)).filter((h): h is string => !!h)
  return Array.from(new Set(hosts.filter(h => !onList(h, SOCIAL))))
}

export interface RateSourceInput {
  url?: string
  /** Where the corpus got it; the account's own details and knowledge base outrank any web page. */
  origin?: 'own' | 'knowledge' | 'web' | 'newsletter'
  /** The account's own sites (ownHosts). */
  ownHosts?: string[]
  /** The readers' country code; a page localised for another market is marked down. */
  regionCode?: string
  /** The publisher a news search named, for an outlet this module does not know. */
  publisher?: string
  /** It came from a news search: an indexed news site, if not one known here. */
  fromNewsSearch?: boolean
}

function tierOf(input: RateSourceInput, host: string | null): SourceTier {
  if (input.origin === 'own') return 'own'
  if (input.origin === 'knowledge' && !host) return 'knowledge'
  if (!host) return input.origin === 'newsletter' ? 'newsletter' : 'unrated'
  if (input.ownHosts?.some(own => host === own || host.endsWith(`.${own}`))) {
    return input.origin === 'knowledge' ? 'knowledge' : 'official'
  }
  if (input.origin === 'knowledge') return 'knowledge'
  if (onList(host, LOW)) return 'low'
  if (OFFICIAL_HOST.test(host)) return 'official'
  if (onList(host, INDUSTRY)) return 'industry'
  if (onList(host, NEWS)) return 'news'
  if (onList(host, REFERENCE) || (input.url && isReferencePage(input.url))) return 'reference'
  if (onList(host, FORUM)) return 'forum'
  if (onList(host, SOCIAL)) return 'social'
  return input.origin === 'newsletter' ? 'newsletter' : 'unrated'
}

/** How far a source can be trusted for a fact, and why. */
export function rateSource(input: RateSourceInput): SourceRating {
  const host = hostOf(input.url)
  const tier = tierOf(input, host)
  let score = TIER_SCORES[tier]
  // A news search only returns indexed news sites: better than any page.
  if (tier === 'unrated' && input.fromNewsSearch) score = 60
  const notes: string[] = []
  if (TIER_NOTES[tier]) notes.push(TIER_NOTES[tier]!)
  const country = input.url ? countryOfUrl(input.url) : undefined
  if (
    input.regionCode &&
    country &&
    country !== input.regionCode &&
    tier !== 'own' &&
    tier !== 'knowledge'
  ) {
    score -= 15
    notes.push(
      `written for ${countryName(country) ?? country.toUpperCase()}, not ${countryName(input.regionCode) ?? input.regionCode.toUpperCase()}`
    )
  }
  const label =
    tier === 'unrated' && input.fromNewsSearch
      ? 'News site'
      : TIER_LABELS[tier]
  return {
    tier,
    score: Math.max(0, Math.min(100, score)),
    label,
    ...(notes.length > 0 ? { note: notes.join('; ') } : {})
  }
}

/**
 * How a finding is saved: its provider, with its kind when it is not plain
 * background ("serper_news:trend"), so the run page can say what it was for.
 */
export function providerTag(f: { provider: string; kind?: SignalKind }): string {
  return f.kind && f.kind !== 'background' ? `${f.provider}:${f.kind}` : f.provider
}

/** The kind a saved provider tag names, if any. */
export function kindOfProvider(
  provider: string | null | undefined
): Exclude<SignalKind, 'background'> | undefined {
  const kind = provider?.split(':')[1]
  return kind === 'news' || kind === 'trend' || kind === 'conversation' ? kind : undefined
}

/** What a research item was for, in a word or two for the page. */
export const KIND_LABELS: Record<Exclude<SignalKind, 'background'>, string> = {
  news: 'In the news',
  trend: 'Trend',
  conversation: 'What people say'
}

/** A display name for a source: the publisher a search named, else its site. */
export function sourceName(url: string | undefined, publisher?: string): string | undefined {
  const named = publisher?.trim()
  if (named && !/^https?:\/\//i.test(named)) return named
  return hostOf(url) ?? undefined
}

export type ScreenedOut = { url: string; title: string; reason: string }

/**
 * Research results worth showing the writer. Dropped, with why: pages written
 * to rank (market-report summaries, deals, stock quotes), trend items about a
 * sensitive story, pages about another market than the readers', and the
 * same story syndicated twice.
 */
export function screenFindings<
  T extends { url: string; title: string; snippet: string; kind?: SignalKind }
>(
  findings: T[],
  options: { regionCode?: string; regionName?: string } = {}
): { kept: T[]; dropped: ScreenedOut[] } {
  const kept: T[] = []
  const dropped: ScreenedOut[] = []
  const seenTitles = new Set<string>()
  const drop = (f: T, reason: string) =>
    dropped.push({ url: f.url, title: f.title, reason })

  for (const f of findings) {
    const host = hostOf(f.url)
    if (host && onList(host, LOW)) {
      drop(f, 'a page written to rank in search (market-report summary, press-release wire, deals or stock page)')
      continue
    }
    if (STOCK_PAGE.test(f.title)) {
      drop(f, 'a stock-price page')
      continue
    }
    if (f.kind === 'trend' && SENSITIVE.test(f.title)) {
      drop(f, 'a sensitive story (crime, death, disaster, politics or a scandal) no brand should ride')
      continue
    }
    const region = options.regionCode
    if (region) {
      const country = countryOfUrl(f.url)
      if (country && country !== region) {
        drop(f, `written for ${countryName(country) ?? country.toUpperCase()}, not the readers' market`)
        continue
      }
      // "US Online Food Delivery Market" for readers in India: another
      // market's story. Judged by the title, since snippets name countries in
      // passing; but a snippet naming the readers' own market keeps it
      // ("Kolkata welcomes Kenyan delegates" is an Indian story).
      const named = countriesNamed(f.title)
      const ours = (text: string) => countriesNamed(text).some(c => c.code === region)
      if (named.length > 0 && !ours(f.title) && !ours(f.snippet)) {
        drop(f, `about ${named.map(c => c.name).join(', ')}, not ${options.regionName ?? 'the readers’ market'}`)
        continue
      }
    }
    const title = f.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (title.length > 20 && seenTitles.has(title)) {
      drop(f, 'the same story as another result')
      continue
    }
    seenTitles.add(title)
    kept.push(f)
  }
  return { kept, dropped }
}
