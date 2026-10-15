import { extractUrls, normalizeUrlForCompare } from '@/lib/urls'
import { z } from 'zod'
import {
  canonicalLinkedinUrl,
  figureChecker,
  splitSentences,
  type VerifiedLink
} from './research'
import {
  CONFIDENCE,
  DESCRIPTION_SOURCE,
  EMPTY_SUGGESTIONS,
  FIELD_SPECS,
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
  type KnowledgeSuggestions
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

/** Most lines each profile list keeps; past these it stops being a focus. */
const PROFILE_LIST_LIMITS: Record<string, number> = {
  targetAudience: 6,
  offerings: 8
}

/**
 * Audience and offerings are one item per line. Bullets are dropped, and a
 * line that repeats an earlier one (ignoring case and punctuation) is removed.
 */
export function tidyProfileList(value: string): string[] {
  const seen = new Set<string>()
  return readListValue(value).filter(line => {
    const key = line
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

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
    const entry = result[field] as { value?: unknown } | undefined
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

/** Largest-remainder rounding so the weights land on exactly 100. */
export function normalizeWeights(weights: number[]): number[] {
  if (weights.length === 0) return []
  const positive = weights.map(w => (Number.isFinite(w) && w > 0 ? w : 0))
  const total = positive.reduce((a, b) => a + b, 0)
  const shares =
    total > 0
      ? positive.map(w => (w / total) * 100)
      : positive.map(() => 100 / weights.length)
  const floored = shares.map(Math.floor)
  let remainder = 100 - floored.reduce((a, b) => a + b, 0)
  const order = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction)
  for (const { index } of order) {
    if (remainder <= 0) break
    floored[index] = (floored[index] ?? 0) + 1
    remainder--
  }
  return floored
}

/**
 * Validates raw model output field by field and applies the honesty rules:
 *
 * - An invalid or unexpected field is dropped with a warning; the rest survive.
 * - A "fact" must cite the description or a page that was actually fetched,
 *   otherwise it is downgraded to a recommendation.
 * - Voice settings are always recommendations: no posts were analyzed here.
 * - URLs (profile links, CTA link, knowledge sources) survive only if the user
 *   typed them, either in the form or in the description.
 * - Knowledge facts survive only if their quote appears verbatim in the text
 *   they cite.
 */
export function sanitizeIdentitySetup(
  raw: unknown,
  context: SanitizeContext
): { suggestions: IdentitySetupSuggestions; warnings: string[] } {
  const warnings: string[] = []
  const root = asRecord(raw)
  if (!root) {
    return {
      suggestions: structuredClone(EMPTY_SUGGESTIONS),
      warnings: [
        'The AI response was not a JSON object, so nothing could be used.'
      ]
    }
  }

  // Which links each kind of field may hold. A goal's call-to-action link is
  // only ever one the user wrote; a profile link may also be one web research
  // verified; a knowledge source may also be a page that was found and read.
  const userUrls = new Map<string, string>()
  for (const url of [
    ...context.providedUrls,
    ...extractUrls(context.description)
  ]) {
    userUrls.set(normalizeUrlForCompare(url), url)
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
    return fetchedByKey.get(normalizeUrlForCompare(source))?.content ?? null
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

      const listLimit =
        section === 'profile' ? PROFILE_LIST_LIMITS[field] : undefined
      if (listLimit) {
        const lines = tidyProfileList(String(value))
        if (lines.length === 0) continue
        if (lines.length > listLimit) {
          warnings.push(
            `Profile → ${spec.label}: kept the first ${listLimit} of ${lines.length} lines.`
          )
        }
        value = lines.slice(0, listLimit).join('\n')
      }

      let kind = asString(entry.kind) === 'fact' ? 'fact' : 'recommendation'
      let source: string | undefined = asString(entry.source) || undefined

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
      } else if (
        kind === 'fact' &&
        (!source || resolveSourceText(source) === null)
      ) {
        kind = 'recommendation'
        source = undefined
      }

      if (section === 'voice') {
        kind = 'recommendation'
        source = undefined
      }
      if (kind === 'recommendation') source = undefined

      const candidate = {
        value,
        kind,
        source,
        confidence:
          forcedConfidence ??
          (CONFIDENCE.includes(asString(entry.confidence) as never)
            ? asString(entry.confidence)
            : 'medium')
      }
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
    return result
  }

  const profile = readSection('profile', ProfileSuggestionsSchema)
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

  // Links the user typed into the form are facts by definition.
  for (const url of context.providedUrls) {
    const field = /(^|\.)linkedin\.com/i.test(normalizeUrlForCompare(url))
      ? 'linkedinUrl'
      : 'websiteUrl'
    if (!profile[field]) {
      profile[field] = {
        value: url,
        kind: 'fact',
        source: PROVIDED_SOURCE,
        confidence: 'high'
      }
    }
  }

  // Links web research verified fill any link field the user left empty. They
  // are sourced to themselves, so the review shows where each came from.
  for (const field of ['websiteUrl', 'linkedinUrl'] as const) {
    const link = context.verifiedLinks?.[field]
    if (link && !profile[field]) {
      profile[field] = {
        value: link.url,
        kind: 'fact',
        source: link.url,
        confidence: link.confidence
      }
    }
  }
  // What could not be found or verified is said plainly, not left to guess.
  // Research states these precisely, so the model's vaguer note on the same
  // link ("Website URL: not provided") is dropped.
  const notes = context.researchNotes ?? []
  const researchCovers = (label: 'website' | 'linkedin') =>
    notes.some(note => note.toLowerCase().startsWith(`${label}:`))
  const modelMissing = asArray(profile.missing)
    .map(String)
    .filter(item => {
      const lower = item.toLowerCase()
      if (researchCovers('website') && /^website( url)?\b/.test(lower))
        return false
      if (researchCovers('linkedin') && /^linkedin( url| page)?\b/.test(lower))
        return false
      return true
    })
  profile.missing = Array.from(
    new Set([...modelMissing, ...notes].map(note => note.slice(0, 300)))
  ).slice(0, 15)

  // Pillars: always recommendations, weights normalized to 100.
  const prefsRaw = asRecord(root.preferences)
  const pillarsRaw = asArray(prefsRaw?.pillars)
    .map(asRecord)
    .filter((p): p is Record<string, unknown> => Boolean(p && asString(p.name)))
    .slice(0, 6)
  if (pillarsRaw.length > 0) {
    const weights = normalizeWeights(pillarsRaw.map(p => Number(p.weightPct)))
    const pillars = pillarsRaw.map((p, index) => ({
      name: asString(p.name).slice(0, 120),
      weight_pct: weights[index] ?? 0,
      example_topics: readListValue(p.topics).slice(0, 10)
    }))
    const parsed = PreferencesSuggestionsSchema.shape.pillars.safeParse({
      value: pillars,
      kind: 'recommendation',
      confidence: 'medium'
    })
    if (parsed.success) {
      preferences.pillars = parsed.data
    } else {
      warnings.push('Preferences → Content pillars: ignored an invalid value.')
    }
  } else if (
    prefsRaw &&
    prefsRaw.pillars !== undefined &&
    !Array.isArray(prefsRaw.pillars)
  ) {
    warnings.push('Preferences → Content pillars: ignored an invalid value.')
  }

  // Knowledge
  const knowledgeRaw = asRecord(root.knowledge)
  const suggestedAdditions = readListValue(knowledgeRaw?.suggestedAdditions)
  const sources: KnowledgeSuggestions['sources'] = []
  for (const sourceRaw of asArray(knowledgeRaw?.sources)) {
    const item = asRecord(sourceRaw)
    const title = asString(item?.title).slice(0, 200)
    const reason = asString(item?.reason).slice(0, 500)
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
    sources.push({
      url,
      title,
      reason,
      accessible: fetchedByKey.has(normalizeUrlForCompare(url))
    })
  }

  // A page the user gave us and we could read is a knowledge source whether or
  // not the model thought to list it. It is only offered: nothing is added
  // until the user ticks it in the review.
  const foundByResearch = new Set(
    (context.webSourceUrls ?? []).map(normalizeUrlForCompare)
  )
  for (const page of context.fetchedSources) {
    const key = normalizeUrlForCompare(page.url)
    if (sources.some(s => s.url && normalizeUrlForCompare(s.url) === key)) {
      continue
    }
    sources.push({
      url: page.url,
      title: (page.title || page.url).slice(0, 200),
      reason: foundByResearch.has(key)
        ? 'Found by web search and checked to be about you. It was read for this analysis.'
        : 'A page you provided. It was read for this analysis.',
      accessible: true
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
    facts.push({
      statement: statement.slice(0, 500),
      quote: quote.slice(0, 1000),
      source:
        source.toLowerCase() === DESCRIPTION_SOURCE
          ? DESCRIPTION_SOURCE
          : (fetchedByKey.get(normalizeUrlForCompare(source))?.url ?? source)
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
      suggestions: structuredClone(EMPTY_SUGGESTIONS),
      warnings: [...warnings, 'The AI response could not be validated.']
    }
  }
  return { suggestions: final.data, warnings: Array.from(new Set(warnings)) }
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

/**
 * Writes the user's Advanced analysis choices into the suggestions as facts
 * they provided, replacing whatever the model chose for those fields. Runs
 * after sanitizeIdentitySetup, so a CTA link the user typed survives the URL
 * checks. Topics to avoid are added to the model's list rather than replacing it.
 */
export function applyGuidance(
  suggestions: IdentitySetupSuggestions,
  guidance: AnalysisGuidance | undefined
): IdentitySetupSuggestions {
  if (!guidance) return suggestions
  const provided = <T>(value: T) => ({
    value,
    kind: 'fact' as const,
    source: PROVIDED_SOURCE,
    confidence: 'high' as const
  })

  const voice = { ...suggestions.voice }
  if (guidance.tone) voice.tone = provided(guidance.tone)
  if (guidance.perspective) voice.perspective = provided(guidance.perspective)
  if (guidance.formality) voice.formality = provided(guidance.formality)
  if (guidance.emojiPolicy) voice.emojiPolicy = provided(guidance.emojiPolicy)

  const goals = { ...suggestions.goals }
  if (guidance.objectiveType) {
    goals.objectiveType = provided(guidance.objectiveType)
  }
  if (guidance.callToAction) {
    goals.desiredAction = provided(guidance.callToAction.slice(0, 500))
  }
  if (guidance.ctaUrl) goals.targetUrl = provided(guidance.ctaUrl)

  const profile = { ...suggestions.profile }
  if (guidance.targetAudience) {
    profile.targetAudience = provided(
      splitEntries(guidance.targetAudience).join('\n').slice(0, 2000)
    )
  }

  const preferences = { ...suggestions.preferences }
  if (guidance.avoidTopics) {
    const merged = Array.from(
      new Set([
        ...splitEntries(guidance.avoidTopics),
        ...(preferences.bannedTopics?.value ?? [])
      ])
    ).slice(0, 15)
    preferences.bannedTopics = provided(merged)
  }

  // Same strict validation as everything else that leaves this module.
  const checked = IdentitySetupSuggestionsSchema.safeParse({
    ...suggestions,
    profile,
    voice,
    goals,
    preferences
  })
  return checked.success ? checked.data : suggestions
}
