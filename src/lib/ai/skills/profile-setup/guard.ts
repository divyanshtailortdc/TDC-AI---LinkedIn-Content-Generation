import { findLinks, normalizeUrlForCompare } from '@/lib/urls'
import { z } from 'zod'
import { chooseWebsite } from './links'
import {
  canonicalLinkedinUrl,
  figureChecker,
  hostnameOf,
  splitSentences,
  type VerifiedLink
} from './research'
import {
  CONFIDENCE,
  DESCRIPTION_SOURCE,
  EMPTY_SUGGESTIONS,
  FIELD_SPECS,
  fieldLabel,
  GoalSuggestionsSchema,
  IdentitySetupSuggestionsSchema,
  PreferencesSuggestionsSchema,
  ProfileSuggestionsSchema,
  PROVIDED_SOURCE,
  SECTION_LABELS,
  VoiceSuggestionsSchema,
  type AnalysisGuidance,
  type EntrySection,
  type FieldSpec,
  type IdentitySetupSuggestions,
  type KnowledgeSuggestions,
  type LineBasis
} from './schema'

// ---------------------------------------------------------------------------
// Sanitizing model output
// ---------------------------------------------------------------------------

export type SanitizeContext = {
  /** The user's own description. Facts may quote it. */
  description: string
  /** URLs the user typed into the form. */
  providedUrls: string[]
  /** Pages that were fetched successfully, with the text the model saw. */
  fetchedSources: Array<{ url: string; content: string; title?: string }>
  /**
   * Links web research verified. Besides the user's own, these are the only
   * links a profile link field may hold.
   */
  verifiedLinks?: { websiteUrl?: VerifiedLink; linkedinUrl?: VerifiedLink }
  /** Pages found by web research and read; knowledge sources may list them. */
  webSourceUrls?: string[]
  /** What web research could not verify, reported under "missing". */
  researchNotes?: string[]
  /** Text the user wrote in Advanced analysis; figures in it are theirs. */
  trustedText?: string
  /** The identity type the user chose; without one, the model's choice holds. */
  accountType?: 'personal' | 'company'
}

type AccountType = 'personal' | 'company'

/** "Crumb & Co." and "crumb & co" are the same name. */
function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * `company` names an organisation other than the identity: a person's own
 * business or employer, or a company's parent. The model has filed the
 * identity's own name there, either as well as in `name` or instead of it, so
 * a company profile came back with an empty Display name and its own name
 * under Parent company / brand. A person's company may be the only name the
 * input gives, so it stays where it is.
 */
function reconcileNames(
  profile: Record<string, unknown>,
  accountType: AccountType
) {
  const name = profile.name as { value: string } | undefined
  const company = profile.company as { value: string } | undefined
  if (!company) return
  if (!name) {
    if (accountType === 'company') {
      profile.name = company
      delete profile.company
    }
    return
  }
  if (nameKey(name.value) === nameKey(company.value)) delete profile.company
}

const EMPTY_VALUE = /^(n\/?a|unknown|not specified|not provided|-+)$/i
/** "none" is a real answer for enums like emoji policy, but not for a company name. */
const NONE_VALUE = /^none$/i

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

function normalizeForQuote(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function readListValue(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value.map(asString)
    : asString(value).split(/\n+/)
  return Array.from(
    new Set(
      items
        .map(item => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
        .filter(
          item => item && !EMPTY_VALUE.test(item) && !NONE_VALUE.test(item)
        )
    )
  ).slice(0, 15)
}

function enumKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '_')
}

/** Reads one model entry's value into the type its field expects. */
function readEntryValue(spec: FieldSpec, raw: unknown): unknown {
  switch (spec.type) {
    case 'scale': {
      const match = /\d+(?:\.\d+)?/.exec(asString(raw))
      return match ? Math.round(Number(match[0])) : undefined
    }
    case 'enum': {
      // "first comment", "First_Comment" and "first-comment" all mean first_comment.
      const value = asString(raw)
      const key = enumKey(value)
      return spec.options.find(o => enumKey(o) === key) ?? value
    }
    case 'list': {
      const items = readListValue(raw)
      if (!spec.options) return items
      return items
        .map(item => {
          const key = enumKey(item)
          return spec.options!.find(o => enumKey(o) === key)
        })
        .filter((o): o is string => Boolean(o))
    }
    default:
      return asString(raw)
  }
}

const MAX_INDUSTRY_WORDS = 4
const MAX_INDUSTRY_LENGTH = 40

/** Words that start the rest of a sentence rather than naming a sector. */
const INDUSTRY_CLAUSE_BREAK =
  /\s*(?:[.;:!?\n\u2014\u2013,]|\s-\s|\b(?:for|that|which|who|helping|providing|serving|specializing|specialising|offering|founded|based)\b)\s*/i

function isIndustryLabel(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_INDUSTRY_LENGTH &&
    value.split(/\s+/).length <= MAX_INDUSTRY_WORDS &&
    !/[.;:!?]/.test(value) &&
    // "I am Priya Rao" and "A bookkeeping firm" are sentence openings.
    !/^(?:i|we|my|our|the|a|an|this|it|he|she|they)\b/i.test(value)
  )
}

/** Beyond this it is a pasted description, not a label with a qualifier. */
const MAX_QUALIFIED_INDUSTRY_WORDS = 12

/**
 * Industry is a label ("Fintech", "B2B SaaS", "Bookkeeping services"), not a
 * sentence. A short value passes through. A label with a short qualifier is
 * cut back to its lead phrase ("Bookkeeping service for D2C brands" becomes
 * "Bookkeeping service"). Anything longer is treated as the description
 * pasted into the wrong box and returns null, because a blank field is
 * better than a wrong one.
 */
export function tidyIndustry(value: string): string | null {
  const label = value
    .trim()
    .replace(/^["'\u201c\u201d]+|["'\u201c\u201d.]+$/g, '')
    .trim()
  if (isIndustryLabel(label)) return label
  if (label.split(/\s+/).length > MAX_QUALIFIED_INDUSTRY_WORDS) return null
  const lead = label.split(INDUSTRY_CLAUSE_BREAK)[0]?.trim() ?? ''
  return isIndustryLabel(lead) ? lead : null
}

/** The prompt asks for under 70; past this it has stopped being a summary. */
const MAX_DESCRIPTION_WORDS = 80

/** "and uses LinkedIn to hire engineers": a plan for LinkedIn, inside a sentence. */
const LINKEDIN_PLAN =
  /,?\s*(?:\b(?:and|while|but)\s+)?(?:\b(?:it|we|i|they|he|she)\s+)?\b(?:uses?|using|wants?|wanting|plans?|planning|aims?|aiming|hopes?|hoping|looks?|looking|turns?|turning)\s+(?:[\w'-]+\s+){0,3}?linkedin\b[^.!?]*/i

/** "It aims to be the brand families trust most": an ambition, which is the goal's. */
const AMBITION = /\b(?:aims?|wants?|hopes?|strives?|seeks?|aspires?)\s+to\s+(?:be|become)\b/i

/**
 * The profile description says who they are and what they do. What they want
 * from LinkedIn belongs to the goal and audience, but the model kept closing
 * the description with it ("…and uses LinkedIn to hire engineers"). That
 * clause is cut, or its sentence dropped when nothing else is left; a
 * sentence stating an ambition ("It aims to be the most trusted brand") is
 * dropped too. The description is kept to whole sentences within
 * MAX_DESCRIPTION_WORDS. A business whose work is LinkedIn itself
 * (`aboutLinkedin`) keeps every mention.
 */
export function tidyDescription(text: string, aboutLinkedin = false): string {
  const kept: string[] = []
  let words = 0
  for (const original of splitSentences(text)) {
    let sentence = original
    if (AMBITION.test(sentence) && kept.length > 0) continue
    if (!aboutLinkedin && /\blinkedin\b/i.test(sentence)) {
      sentence = sentence.replace(LINKEDIN_PLAN, '').trim()
      if (/\blinkedin\b/i.test(sentence) || sentence.split(/\s+/).length < 4) {
        continue
      }
      if (!/[.!?]$/.test(sentence)) sentence += '.'
    }
    const count = sentence.split(/\s+/).length
    if (kept.length > 0 && words + count > MAX_DESCRIPTION_WORDS) break
    kept.push(sentence)
    words += count
  }
  return kept.join(' ')
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Most lines each profile list keeps; past these it stops being a focus. */
const PROFILE_LIST_LIMITS: Record<string, number> = {
  targetAudience: 6,
  offerings: 8
}

/** Two lines are the same item when they differ only in case and punctuation. */
const lineKey = (line: string) =>
  line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Audience and offerings are one item per line. Bullets are dropped, and a
 * line that repeats an earlier one (ignoring case and punctuation) is removed.
 */
export function tidyProfileList(value: string): string[] {
  const seen = new Set<string>()
  return readListValue(value).filter(line => {
    const key = lineKey(line)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Words that say nothing about whether a line is backed by its source. */
const FILLER = new Set(
  'with from that this their them they your into over more than what when want wants need needs looking about also have each other will using through'.split(
    ' '
  )
)

/** "IPO", "HR", "B2B": short enough to skip as a word, but they carry the meaning. */
const ACRONYM = /^[A-Z][A-Z0-9]{1,2}$/

/**
 * Content words with plural and tense endings removed: "referrals" →
 * "referral". Acronyms count as words: skipped for being short, "Bond and IPO
 * investing" read as stated by a description that never mentions IPOs.
 */
function stems(text: string): string[] {
  const out: string[] = []
  for (const word of text.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (ACRONYM.test(word)) {
      out.push(word.toLowerCase())
      continue
    }
    const lower = word.toLowerCase()
    if (lower.length < 4 || FILLER.has(lower)) continue
    const stem = lower.replace(/(?:es|s|ing|ed)$/, '')
    if (stem.length >= 3) out.push(stem)
  }
  return out
}

/**
 * Builds a check for whether `sourceText` states a line: at least three
 * quarters (or `share`) of the line's content words must appear there
 * ("injured" matches "injury", "physio" matches "physiotherapist"). Words in
 * `ignore` (the business's own name) do not count: "Canva Pro" is not stated
 * by every text that says "Canva". A line with no other words ("VAT", "Canva
 * Pro") must appear as written. Nothing is rewritten; this only decides
 * whether a line is shown as stated or as a suggestion.
 */
export function backedBy(
  sourceText: string,
  share = 0.75
): (line: string, ignore?: ReadonlySet<string>) => boolean {
  const known = Array.from(new Set(stems(sourceText)))
  const plain = lineKey(sourceText)
  const words = new Set(plain.split(' '))
  const matches = (stem: string) =>
    // An acronym matches only as a whole word, in any case.
    (stem.length <= 3 && words.has(stem)) ||
    known.some(
      k =>
        k === stem ||
        (Math.min(k.length, stem.length) >= 4 &&
          (k.startsWith(stem) || stem.startsWith(k)))
    )
  return (line, ignore = new Set()) => {
    const wanted = stems(line).filter(stem => !ignore.has(stem))
    if (wanted.length === 0) return plain.includes(lineKey(line))
    return wanted.filter(matches).length >= wanted.length * share
  }
}

/**
 * A list field from its lines. It is a fact only when every line is one from
 * the same source; any mix is a recommendation, with each line's own
 * provenance kept in `lines` for the review to show.
 */
export function summarizeLines(lines: LineBasis[]) {
  const first = lines[0]
  const uniform =
    first !== undefined &&
    lines.every(
      line => line.kind === first.kind && line.source === first.source
    )
  return {
    value: lines.map(line => line.text).join('\n'),
    kind: uniform ? first.kind : ('recommendation' as const),
    source: uniform ? first.source : undefined,
    lines
  }
}

const CONFIDENCE_ORDER = ['low', 'medium', 'high']

/** Longest link a suggestion or knowledge source may hold (see the schema). */
const MAX_URL_LENGTH = 500

/** Why a link does not fit the field it was put in, or null when it fits. */
function urlTypeProblem(field: string, url: string): string | null {
  const isLinkedin = canonicalLinkedinUrl(url) !== null
  let host = ''
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname
  } catch {
    return 'is not a valid web address'
  }
  const onLinkedin = /(^|\.)linkedin\.com$/i.test(host)
  if (field === 'linkedinUrl' && !isLinkedin) {
    return 'is not a LinkedIn profile or company page'
  }
  if (field === 'websiteUrl' && onLinkedin) {
    return 'is a LinkedIn page, not a website'
  }
  return null
}

/**
 * Figures that are not in the user's words or a page that was read are
 * invented. Sentences (in prose) or lines (in lists) carrying one are
 * removed; a single-value field with one is dropped. Nothing is rewritten.
 */
function groundFigures(
  section: 'profile' | 'goals',
  result: Record<string, unknown>,
  corpus: string,
  warnings: string[]
) {
  const unbacked = figureChecker(corpus)
  const labelFor = (field: string) =>
    (FIELD_SPECS[section] as Record<string, FieldSpec>)[field]?.label ?? field
  const fields =
    section === 'profile'
      ? (['description', 'offerings', 'targetAudience'] as const)
      : (['title', 'keyMessage', 'desiredAction'] as const)

  for (const field of fields) {
    const entry = result[field] as
      { value?: unknown; lines?: LineBasis[] } | undefined
    if (!entry || typeof entry.value !== 'string') continue
    const text = entry.value

    const pieces =
      field === 'description'
        ? splitSentences(text)
        : section === 'profile'
          ? text
              .split('\n')
              .map(line => line.trim())
              .filter(Boolean)
          : [text]
    const kept = pieces.filter(piece => unbacked(piece).length === 0)
    if (kept.length === pieces.length) continue

    const removed = unbacked(
      pieces.filter(piece => !kept.includes(piece)).join(' ')
    )
    const example = removed.slice(0, 3).join(', ')
    if (kept.length === 0) {
      delete result[field]
      warnings.push(
        `${SECTION_LABELS[section]} → ${labelFor(field)}: left blank because it stated figures that are not in your details or any source (${example}).`
      )
    } else {
      entry.value = kept.join(field === 'description' ? ' ' : '\n')
      if (entry.lines) {
        Object.assign(
          entry,
          summarizeLines(entry.lines.filter(line => kept.includes(line.text)))
        )
      }
      warnings.push(
        `${SECTION_LABELS[section]} → ${labelFor(field)}: removed text with figures that are not in your details or any source (${example}).`
      )
    }
  }
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string')
    return !value.trim() || EMPTY_VALUE.test(value.trim())
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Validates raw model output field by field and applies the honesty rules:
 *
 * - An invalid or unexpected field is dropped with a warning; the rest survive.
 * - A "fact" must cite the description or a page that was actually fetched,
 *   otherwise it is downgraded to a recommendation.
 * - Voice settings are always recommendations: no posts were analyzed here.
 * - URLs (profile links, CTA link, knowledge sources) survive only if the user
 *   typed them, either in the form or in the description. Links in the
 *   description are kept as absolute https:// addresses.
 * - The model decides which link is the website; a page rather than a site's
 *   homepage is only ever a recommendation with a note saying so (see
 *   chooseWebsite). Every page linked in the description is offered as a
 *   knowledge source.
 * - Knowledge facts survive only if their quote appears verbatim in the text
 *   they cite.
 * - The profile is written for one identity type, the user's or else the
 *   model's, and its name and company fit that type (see reconcileNames).
 */
export function sanitizeIdentitySetup(
  raw: unknown,
  context: SanitizeContext
): {
  suggestions: IdentitySetupSuggestions
  warnings: string[]
  accountType: AccountType
} {
  const warnings: string[] = []
  const root = asRecord(raw)
  if (!root) {
    return {
      accountType: context.accountType ?? 'personal',
      suggestions: structuredClone(EMPTY_SUGGESTIONS),
      warnings: [
        'The AI response was not a JSON object, so nothing could be used.'
      ]
    }
  }

  // Which links each kind of field may hold. A goal's call-to-action link is
  // only ever one the user wrote; a profile link may also be one web research
  // verified; a knowledge source may also be a page that was found and read.
  // Links in the description are kept with https:// added where it was left
  // off; the form's spelling of a link wins over the description's.
  const mentioned = findLinks(context.description).filter(
    link => link.url.length <= MAX_URL_LENGTH
  )
  const userUrls = new Map<string, string>()
  for (const url of [
    ...context.providedUrls,
    ...mentioned.map(link => link.url)
  ]) {
    const key = normalizeUrlForCompare(url)
    if (!userUrls.has(key)) userUrls.set(key, url)
  }
  const verifiedByUrl = new Map<string, VerifiedLink>()
  for (const link of Object.values(context.verifiedLinks ?? {})) {
    if (link) verifiedByUrl.set(normalizeUrlForCompare(link.url), link)
  }
  const profileUrls = new Map(userUrls)
  for (const link of verifiedByUrl.values()) {
    profileUrls.set(normalizeUrlForCompare(link.url), link.url)
  }
  const knowledgeUrls = new Map(profileUrls)
  for (const url of context.webSourceUrls ?? []) {
    knowledgeUrls.set(normalizeUrlForCompare(url), url)
  }
  const fetchedByKey = new Map(
    context.fetchedSources.map(s => [normalizeUrlForCompare(s.url), s])
  )

  const resolveSourceText = (source: string): string | null => {
    if (source.toLowerCase() === DESCRIPTION_SOURCE) return context.description
    if (source === PROVIDED_SOURCE) return context.trustedText?.trim() || null
    return fetchedByKey.get(normalizeUrlForCompare(source))?.content ?? null
  }

  // The business's own site: the one the user gave, or the one research
  // verified. Only it (or the user's own words) can state their offerings.
  const hostOf = (url: string) =>
    hostnameOf(/^https?:\/\//i.test(url) ? url : `https://${url}`)
  const officialHosts = new Set(
    [...context.providedUrls, context.verifiedLinks?.websiteUrl?.url]
      .map(url => (url ? hostOf(url) : null))
      .filter(
        (host): host is string =>
          Boolean(host) && !/(^|\.)linkedin\.com$/.test(host!)
      )
  )
  const isOfficial = (url: string) => {
    const host = hostOf(url)
    return host !== null && officialHosts.has(host)
  }

  // Who states each audience or offering line, checked line by line whatever
  // the model claimed. An audience is stated only in the user's own words
  // (description or Advanced analysis answers); a page never says who a
  // business is for, so any reading of one is the AI's suggestion. Offerings
  // may also come from the business's own site, but not other pages, which can
  // describe it wrongly or out of date.
  const lineBases = [
    { source: DESCRIPTION_SOURCE, backs: backedBy(context.description) },
    ...(context.trustedText?.trim()
      ? [{ source: PROVIDED_SOURCE, backs: backedBy(context.trustedText) }]
      : []),
    ...context.fetchedSources
      .filter(page => isOfficial(page.url))
      .map(page => ({
        source: page.url,
        backs: backedBy(page.content),
        offeringsOnly: true
      }))
  ]
  // Set from the profile's own name and company while it is read.
  let nameStems: ReadonlySet<string> = new Set()
  // The model's Website URL, chosen between once the profile is read.
  let proposedWebsite: string | undefined
  const lineBasis = (field: string, text: string): LineBasis => {
    const basis = lineBases.find(
      b =>
        (field === 'offerings' || !('offeringsOnly' in b)) &&
        b.backs(text, nameStems)
    )
    return basis
      ? { text, kind: 'fact', source: basis.source }
      : { text, kind: 'recommendation' }
  }

  /**
   * The source that states a single value, or undefined when none does. A
   * fact used to need only a source that existed, so a goal taken from the
   * Advanced choices read "from your description", and a synthesised summary
   * passed as a quote. The cited source is tried first, then the user's own
   * words. A pick from a fixed list or a scale ("lead_gen", 3/5) is the AI's
   * reading of the input, never something it states.
   */
  const backingSource = (
    value: string,
    claimed: string | undefined,
    spec: FieldSpec
  ): string | undefined => {
    if (spec.type === 'enum' || spec.type === 'scale') return undefined
    for (const candidate of new Set(
      [claimed, DESCRIPTION_SOURCE, PROVIDED_SOURCE].filter(
        (s): s is string => Boolean(s)
      )
    )) {
      const text = resolveSourceText(candidate)
      if (text === null || !backedBy(text)(value, nameStems)) continue
      if (candidate.toLowerCase() === DESCRIPTION_SOURCE) return DESCRIPTION_SOURCE
      if (candidate === PROVIDED_SOURCE) return PROVIDED_SOURCE
      return fetchedByKey.get(normalizeUrlForCompare(candidate))?.url ?? candidate
    }
    return undefined
  }

  const resolveAllowedUrl = (
    value: string,
    scope: 'user' | 'profile' | 'knowledge'
  ): string | null =>
    (scope === 'user'
      ? userUrls
      : scope === 'profile'
        ? profileUrls
        : knowledgeUrls
    ).get(normalizeUrlForCompare(value)) ?? null

  const readSection = <S extends EntrySection>(
    section: S,
    schema: z.ZodObject<z.ZodRawShape>
  ): Record<string, unknown> => {
    const sectionRaw = asRecord(root[section])
    const result: Record<string, unknown> = {
      missing: readListValue(sectionRaw?.missing)
    }
    if (!sectionRaw) {
      if (root[section] !== undefined) {
        warnings.push(
          `${SECTION_LABELS[section]}: the AI returned an invalid section.`
        )
      }
      return result
    }

    // Audience and offerings lines are pooled across entries, each labelled
    // by lineBasis, then built into one field after the loop.
    const pools: Record<string, { lines: LineBasis[]; confidence: string }> = {}
    const pool = (field: string, lines: string[], confidence: string) => {
      const target = (pools[field] ??= { lines: [], confidence: 'high' })
      target.lines.push(...lines.map(text => lineBasis(field, text)))
      if (
        CONFIDENCE_ORDER.indexOf(confidence) <
        CONFIDENCE_ORDER.indexOf(target.confidence)
      ) {
        target.confidence = confidence
      }
    }

    if (section === 'profile') {
      nameStems = new Set(
        asArray(sectionRaw.fields).flatMap(entryRaw => {
          const entry = asRecord(entryRaw)
          return entry && ['name', 'company'].includes(asString(entry.field))
            ? stems(asString(entry.value))
            : []
        })
      )
    }

    const specs = FIELD_SPECS[section] as Record<string, FieldSpec>
    for (const entryRaw of asArray(sectionRaw.fields)) {
      const entry = asRecord(entryRaw)
      const field = asString(entry?.field)
      const spec = specs[field]
      if (!entry || !spec) {
        warnings.push(
          `${SECTION_LABELS[section]}: ignored an unexpected field${field ? ` "${field}"` : ''}.`
        )
        continue
      }
      if (field in result) continue

      let value = readEntryValue(spec, entry.value)
      if (isEmptyValue(value)) continue
      if (
        spec.type === 'text' &&
        !spec.noneIsAnswer &&
        NONE_VALUE.test(String(value))
      ) {
        continue
      }

      if (section === 'profile' && field === 'industry') {
        const label = tidyIndustry(String(value))
        if (!label) {
          warnings.push(
            'Profile → Industry: the AI wrote a sentence instead of a short label, so it was left blank.'
          )
          continue
        }
        if (label !== String(value).trim()) {
          warnings.push('Profile → Industry: shortened to a short label.')
        }
        value = label
      }

      const isList = section === 'profile' && field in PROFILE_LIST_LIMITS
      const lines = isList ? tidyProfileList(String(value)) : []
      if (isList && lines.length === 0) continue

      let kind = asString(entry.kind) === 'fact' ? 'fact' : 'recommendation'
      let source: string | undefined = asString(entry.source) || undefined

      // The website is checked against the typed and verified links too, so
      // it is decided after the loop.
      if (section === 'profile' && field === 'websiteUrl') {
        proposedWebsite ??= String(value)
        continue
      }

      let forcedConfidence: string | undefined
      if (spec.type === 'text' && spec.url) {
        const allowed = resolveAllowedUrl(
          String(value),
          section === 'profile' ? 'profile' : 'user'
        )
        if (!allowed) {
          warnings.push(
            `${SECTION_LABELS[section]} → ${spec.label}: dropped a URL that was neither provided by you nor verified.`
          )
          continue
        }
        const wrongKind = urlTypeProblem(field, allowed)
        if (wrongKind) {
          warnings.push(
            `${SECTION_LABELS[section]} → ${spec.label}: dropped a link that ${wrongKind}.`
          )
          continue
        }
        value = allowed
        kind = 'fact'
        const verified = verifiedByUrl.get(normalizeUrlForCompare(allowed))
        // A link found by research is sourced to itself; one the user typed to them.
        source = verified ? verified.url : PROVIDED_SOURCE
        forcedConfidence = verified?.confidence
      } else if (kind === 'fact' && !isList) {
        source = backingSource(
          Array.isArray(value) ? value.join('\n') : String(value),
          source,
          spec
        )
        if (!source) kind = 'recommendation'
      }

      if (section === 'voice') {
        kind = 'recommendation'
        source = undefined
      }
      if (kind === 'recommendation') source = undefined

      const confidence =
        forcedConfidence ??
        (CONFIDENCE.includes(asString(entry.confidence) as never)
          ? asString(entry.confidence)
          : 'medium')
      if (isList) {
        pool(field, lines, confidence)
        continue
      }

      const candidate = { value, kind, source, confidence }
      const fieldSchema = schema.shape[field] as z.ZodType | undefined
      const parsed = fieldSchema?.safeParse(candidate)
      if (!parsed?.success) {
        warnings.push(
          `${SECTION_LABELS[section]} → ${spec.label}: ignored an invalid value.`
        )
        continue
      }
      result[field] = parsed.data
    }

    for (const [field, { lines, confidence }] of Object.entries(pools)) {
      // The same line from two entries is kept once.
      const byKey = new Map<string, LineBasis>()
      for (const line of lines) {
        if (!byKey.has(lineKey(line.text))) byKey.set(lineKey(line.text), line)
      }
      const unique = Array.from(byKey.values())
      const limit = PROFILE_LIST_LIMITS[field]!
      if (unique.length > limit) {
        warnings.push(
          `Profile → ${specs[field]!.label}: kept the first ${limit} of ${unique.length} lines.`
        )
      }
      const parsed = (schema.shape[field] as z.ZodType).safeParse({
        ...summarizeLines(unique.slice(0, limit)),
        confidence
      })
      if (parsed.success) {
        result[field] = parsed.data
      } else {
        warnings.push(
          `${SECTION_LABELS[section]} → ${specs[field]!.label}: ignored an invalid value.`
        )
      }
    }
    return result
  }

  const profile = readSection('profile', ProfileSuggestionsSchema)
  // A person unless the model says otherwise, as the Profile form starts out.
  const accountType: AccountType =
    context.accountType ??
    (asString(asRecord(root.profile)?.identityType).toLowerCase() === 'company'
      ? 'company'
      : 'personal')
  reconcileNames(profile, accountType)
  const description = profile.description as { value: string } | undefined
  if (description) {
    const field = (key: string) =>
      (profile[key] as { value?: string } | undefined)?.value ?? ''
    const tidy = tidyDescription(
      description.value,
      /\blinkedin\b/i.test(`${field('offerings')} ${field('industry')}`)
    )
    if (tidy) description.value = tidy
    else delete profile.description
  }
  const voice = readSection('voice', VoiceSuggestionsSchema)
  const goals = readSection('goals', GoalSuggestionsSchema)

  // Every figure must come from the user or a page that was read.
  const figureCorpus = [
    context.description,
    context.trustedText ?? '',
    ...context.fetchedSources.map(s => s.content)
  ].join('\n')
  groundFigures('profile', profile, figureCorpus, warnings)
  groundFigures('goals', goals, figureCorpus, warnings)
  // Placement only means something next to a link that survived the URL check.
  if (!goals.targetUrl) delete goals.linkStrategy
  const preferences = readSection('preferences', PreferencesSuggestionsSchema)

  // Profile links: what the user typed into the form wins, then the model's
  // checked choice, then what research verified. Which page is the website is
  // the model's call; chooseWebsite only checks it is grounded (see links.ts).
  const typed = (linkedin: boolean) =>
    context.providedUrls.find(
      url =>
        /(^|\.)linkedin\.com/i.test(normalizeUrlForCompare(url)) === linkedin
    )
  const { website, warnings: websiteWarnings } = chooseWebsite({
    proposed: proposedWebsite,
    typed: typed(false),
    mentioned,
    verified: context.verifiedLinks?.websiteUrl
  })
  warnings.push(...websiteWarnings)
  const parsedWebsite = website
    ? ProfileSuggestionsSchema.shape.websiteUrl.safeParse(website)
    : undefined
  if (parsedWebsite?.success) {
    profile.websiteUrl = parsedWebsite.data
  } else if (parsedWebsite) {
    warnings.push('Profile → Website URL: ignored an invalid value.')
  }

  const typedLinkedin = typed(true)
  const verifiedLinkedin = context.verifiedLinks?.linkedinUrl
  if (typedLinkedin) {
    profile.linkedinUrl = {
      value: typedLinkedin,
      kind: 'fact',
      source: PROVIDED_SOURCE,
      confidence: 'high'
    }
  } else if (!profile.linkedinUrl && verifiedLinkedin) {
    // Sourced to itself, so the review shows where it came from.
    profile.linkedinUrl = {
      value: verifiedLinkedin.url,
      kind: 'fact',
      source: verifiedLinkedin.url,
      confidence: verifiedLinkedin.confidence
    }
  }
  // What could not be found or verified is said plainly, not left to guess.
  // Research states these precisely, so the model's vaguer note on the same
  // link ("Website URL: not provided", "Your LinkedIn profile URL: none was
  // found") is dropped, however it is worded.
  const notes = context.researchNotes ?? []
  const researchCovers = (label: 'website' | 'linkedin') =>
    notes.some(note => note.toLowerCase().startsWith(`${label}:`))
  const modelMissing = asArray(profile.missing)
    .map(String)
    .filter(item => {
      const lower = item.toLowerCase()
      if (researchCovers('website') && /\b(?:website|web site)\b/.test(lower))
        return false
      if (researchCovers('linkedin') && /\blinkedin\b/.test(lower))
        return false
      return true
    })
  profile.missing = Array.from(
    new Set([...modelMissing, ...notes].map(note => note.slice(0, 300)))
  ).slice(0, 15)

  // Knowledge
  const knowledgeRaw = asRecord(root.knowledge)
  const suggestedAdditions = readListValue(knowledgeRaw?.suggestedAdditions)
  const sources: KnowledgeSuggestions['sources'] = []
  const foundByResearch = new Set(
    (context.webSourceUrls ?? []).map(normalizeUrlForCompare)
  )
  for (const sourceRaw of asArray(knowledgeRaw?.sources)) {
    const item = asRecord(sourceRaw)
    let title = oneLine(asString(item?.title)).slice(0, 200)
    let reason = oneLine(asString(item?.reason)).slice(0, 500)
    const rawUrl = asString(item?.url)
    if (!title || !reason) continue

    if (!rawUrl) {
      suggestedAdditions.push(`${title}: ${reason}`)
      continue
    }
    const url = resolveAllowedUrl(rawUrl, 'knowledge')
    if (!url) {
      // Keep the idea, never the invented link.
      suggestedAdditions.push(`${title}: ${reason}`)
      warnings.push(
        'Knowledge: dropped a source URL that was neither provided nor verified.'
      )
      continue
    }
    if (
      sources.some(
        s =>
          s.url && normalizeUrlForCompare(s.url) === normalizeUrlForCompare(url)
      )
    ) {
      continue
    }
    const key = normalizeUrlForCompare(url)
    const page = fetchedByKey.get(key)
    const official = isOfficial(url)
    // The model names each page; it must not call a page off their own site
    // their official one. The page's own title replaces such a label.
    if (!official && /\bofficial\b/i.test(title)) {
      title = oneLine(page?.title || hostOf(url) || url).slice(0, 200)
    }
    if (!official && /\bofficial\b/i.test(reason)) {
      reason = foundByResearch.has(key)
        ? 'Found by web search and checked to be about you.'
        : 'A page linked in your details.'
    }
    sources.push({ url, title, reason, accessible: Boolean(page), official })
  }

  // A page the user gave us and we could read is a knowledge source whether or
  // not the model thought to list it. It is only offered: nothing is added
  // until the user ticks it in the review.
  for (const page of context.fetchedSources) {
    const key = normalizeUrlForCompare(page.url)
    if (sources.some(s => s.url && normalizeUrlForCompare(s.url) === key)) {
      continue
    }
    sources.push({
      url: page.url,
      title: oneLine(page.title || page.url).slice(0, 200),
      reason: foundByResearch.has(key)
        ? 'Found by web search and checked to be about you. It was read for this analysis.'
        : 'A page you provided. It was read for this analysis.',
      accessible: true,
      official: isOfficial(page.url)
    })
  }

  // So is every page linked in their details, so none of their links is lost.
  // The model names each page it lists ("Careers page"); one it left out is
  // offered under a plain title. A bare "name.word" is left to the model, as
  // it may not be a site at all ("Node.js"). LinkedIn cannot be read signed
  // out, so its links only go to the LinkedIn field.
  for (const link of mentioned) {
    if (
      !link.explicit ||
      /(^|\.)linkedin\.com$/.test(new URL(link.url).hostname)
    ) {
      continue
    }
    const key = normalizeUrlForCompare(link.url)
    if (sources.some(s => s.url && normalizeUrlForCompare(s.url) === key)) {
      continue
    }
    sources.push({
      url: link.url,
      title: 'Page from your details',
      reason: 'Your details link to this page.',
      accessible: fetchedByKey.has(key),
      official: isOfficial(link.url)
    })
  }

  const facts: KnowledgeSuggestions['facts'] = []
  for (const factRaw of asArray(knowledgeRaw?.facts)) {
    const item = asRecord(factRaw)
    const statement = asString(item?.statement)
    const quote = asString(item?.quote)
    const source = asString(item?.source)
    const sourceText = source ? resolveSourceText(source) : null
    if (!statement || quote.length < 15 || sourceText === null) {
      warnings.push('Knowledge: dropped a fact without a checkable source.')
      continue
    }
    if (!normalizeForQuote(sourceText).includes(normalizeForQuote(quote))) {
      warnings.push(
        'Knowledge: dropped a fact whose quote is not in its source.'
      )
      continue
    }
    const fromDescription = source.toLowerCase() === DESCRIPTION_SOURCE
    facts.push({
      statement: statement.slice(0, 500),
      quote: quote.slice(0, 1000),
      source: fromDescription
        ? DESCRIPTION_SOURCE
        : (fetchedByKey.get(normalizeUrlForCompare(source))?.url ?? source),
      official: !fromDescription && isOfficial(source)
    })
  }

  const knowledge = {
    sources: sources.slice(0, 10),
    facts: facts.slice(0, 15),
    suggestedAdditions: Array.from(new Set(suggestedAdditions))
      .map(s => s.slice(0, 300))
      .slice(0, 10),
    missing: readListValue(knowledgeRaw?.missing)
  }

  // Every field was checked above; this guarantees the overall shape.
  const final = IdentitySetupSuggestionsSchema.safeParse({
    profile,
    voice,
    goals,
    preferences,
    knowledge
  })
  if (!final.success) {
    return {
      accountType,
      suggestions: structuredClone(EMPTY_SUGGESTIONS),
      warnings: [...warnings, 'The AI response could not be validated.']
    }
  }
  return {
    accountType,
    suggestions: final.data,
    warnings: Array.from(new Set(warnings))
  }
}

// ---------------------------------------------------------------------------
// Advanced analysis: the user's own choices win
// ---------------------------------------------------------------------------

/** Splits "a, b\nc" into ["a", "b", "c"]. */
function splitEntries(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,]+/)
        .map(entry => entry.trim())
        .filter(Boolean)
    )
  ).slice(0, 15)
}

const GUIDED_SCHEMAS = {
  profile: ProfileSuggestionsSchema,
  voice: VoiceSuggestionsSchema,
  goals: GoalSuggestionsSchema,
  preferences: PreferencesSuggestionsSchema
}

/**
 * Writes the user's Advanced analysis choices into the suggestions as facts
 * they provided, replacing whatever the model chose for those fields. Runs
 * after sanitizeIdentitySetup, so a CTA link the user typed survives the URL
 * checks. Topics to avoid are added to the model's list rather than replacing it.
 *
 * Each choice is checked on its own. One that cannot be used is left out with
 * a warning and the rest still apply: checked all together, a single topic
 * that was too long used to throw away every choice without a word.
 */
export function applyGuidance(
  suggestions: IdentitySetupSuggestions,
  guidance: AnalysisGuidance | undefined
): { suggestions: IdentitySetupSuggestions; warnings: string[] } {
  const warnings: string[] = []
  if (!guidance) return { suggestions, warnings }
  const provided = <T>(value: T) => ({
    value,
    kind: 'fact' as const,
    source: PROVIDED_SOURCE,
    confidence: 'high' as const
  })

  const next = {
    ...suggestions,
    profile: { ...suggestions.profile },
    voice: { ...suggestions.voice },
    goals: { ...suggestions.goals },
    preferences: { ...suggestions.preferences }
  }
  const write = (
    section: keyof typeof GUIDED_SCHEMAS,
    field: string,
    value: unknown
  ) => {
    const item = provided(value)
    const shape = GUIDED_SCHEMAS[section].shape as Record<string, z.ZodType>
    if (shape[field]!.safeParse(item).success) {
      ;(next[section] as Record<string, unknown>)[field] = item
    } else {
      warnings.push(
        `${SECTION_LABELS[section]} → ${fieldLabel(section, field)}: your Advanced analysis choice could not be used, so the AI's suggestion was kept.`
      )
    }
  }

  if (guidance.tone) write('voice', 'tone', guidance.tone)
  if (guidance.perspective) write('voice', 'perspective', guidance.perspective)
  if (guidance.formality) write('voice', 'formality', guidance.formality)
  if (guidance.emojiPolicy) write('voice', 'emojiPolicy', guidance.emojiPolicy)

  // What they want LinkedIn to achieve is the goal. Only its objective, CTA and
  // link used to be enforced, so a goal written about another aim kept the
  // user's objective under a different strategy. A goal that does not share
  // most of its words with theirs (the business's own name aside) is named in
  // their words, and a key message arguing for something else is dropped.
  if (guidance.goal) {
    const aim = oneLine(guidance.goal)
    const names = new Set(
      [next.profile.name?.value, next.profile.company?.value].flatMap(v =>
        v ? stems(v) : []
      )
    )
    const relates = backedBy(aim, 0.5)
    const title = next.goals.title?.value
    if (!title || !relates(title, names)) {
      write(
        'goals',
        'title',
        aim.length > 200 ? `${aim.slice(0, 199).replace(/\s+\S*$/, '')}…` : aim
      )
      if (title) {
        warnings.push(
          `${SECTION_LABELS.goals} → ${fieldLabel('goals', 'title')}: the AI's goal ("${title.slice(0, 80)}") was about something other than the goal you gave, so your own words name it.`
        )
      }
      const keyMessage = next.goals.keyMessage?.value
      if (keyMessage && !relates(keyMessage, names)) {
        delete next.goals.keyMessage
        warnings.push(
          `${SECTION_LABELS.goals} → ${fieldLabel('goals', 'keyMessage')}: left blank because it argued for a different goal than yours.`
        )
      }
    }
  }

  if (guidance.objectiveType) {
    write('goals', 'objectiveType', guidance.objectiveType)
  }
  if (guidance.callToAction) {
    write('goals', 'desiredAction', guidance.callToAction.slice(0, 500))
  }
  if (guidance.ctaUrl) write('goals', 'targetUrl', guidance.ctaUrl)

  if (guidance.targetAudience) {
    write(
      'profile',
      'targetAudience',
      splitEntries(guidance.targetAudience).join('\n').slice(0, 2000)
    )
  }

  if (guidance.avoidTopics) {
    // A topic too long for the list is left out by itself, not with the rest.
    const fits = (topic: string) =>
      PreferencesSuggestionsSchema.shape.bannedTopics.safeParse(
        provided([topic])
      ).success
    const topics = splitEntries(guidance.avoidTopics)
    for (const topic of topics.filter(t => !fits(t))) {
      warnings.push(
        `${SECTION_LABELS.preferences} → ${fieldLabel('preferences', 'bannedTopics')}: "${topic.slice(0, 60)}…" from Advanced analysis was left out because it is too long for one topic. Separate topics with commas or new lines.`
      )
    }
    const kept = topics.filter(fits)
    if (kept.length > 0) {
      write(
        'preferences',
        'bannedTopics',
        Array.from(
          new Set([...kept, ...(next.preferences.bannedTopics?.value ?? [])])
        ).slice(0, 15)
      )
    }
  }

  // Same strict validation as everything else that leaves this module.
  const checked = IdentitySetupSuggestionsSchema.safeParse(next)
  if (checked.success) return { suggestions: checked.data, warnings }
  return {
    suggestions,
    warnings: [
      ...warnings,
      'Your Advanced analysis choices could not be used, so the AI chose every field.'
    ]
  }
}
