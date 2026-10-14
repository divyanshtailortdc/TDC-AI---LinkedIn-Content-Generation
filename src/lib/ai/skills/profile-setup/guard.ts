import { extractUrls, normalizeUrlForCompare } from '@/lib/urls'
import { z } from 'zod'
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
  fetchedSources: Array<{ url: string; content: string }>
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

  const allowedUrls = new Map<string, string>()
  for (const url of [
    ...context.providedUrls,
    ...extractUrls(context.description)
  ]) {
    allowedUrls.set(normalizeUrlForCompare(url), url)
  }
  const fetchedByKey = new Map(
    context.fetchedSources.map(s => [normalizeUrlForCompare(s.url), s])
  )

  const resolveSourceText = (source: string): string | null => {
    if (source.toLowerCase() === DESCRIPTION_SOURCE) return context.description
    return fetchedByKey.get(normalizeUrlForCompare(source))?.content ?? null
  }

  const resolveAllowedUrl = (value: string): string | null =>
    allowedUrls.get(normalizeUrlForCompare(value)) ?? null

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

      let kind = asString(entry.kind) === 'fact' ? 'fact' : 'recommendation'
      let source: string | undefined = asString(entry.source) || undefined

      if (spec.type === 'text' && spec.url) {
        const allowed = resolveAllowedUrl(String(value))
        if (!allowed) {
          warnings.push(
            `${SECTION_LABELS[section]} → ${spec.label}: dropped a URL you did not provide.`
          )
          continue
        }
        value = allowed
        kind = 'fact'
        source = PROVIDED_SOURCE
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
        confidence: CONFIDENCE.includes(asString(entry.confidence) as never)
          ? asString(entry.confidence)
          : 'medium'
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
    const url = resolveAllowedUrl(rawUrl)
    if (!url) {
      // Keep the idea, never the invented link.
      suggestedAdditions.push(`${title}: ${reason}`)
      warnings.push('Knowledge: dropped a source URL you did not provide.')
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
