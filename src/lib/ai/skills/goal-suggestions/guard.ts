import { extractUrls, normalizeUrlForCompare } from '@/lib/urls'
import {
  MAX_SUGGESTIONS,
  type GoalSuggestion,
  type GoalSuggestionsModelOutput
} from './schema'

/**
 * Links the user saved themselves: their website, offering pages, and URLs
 * written in their bio or offerings. Keyed by normalized form.
 */
export function collectAllowedUrls(profile: {
  websiteUrl?: string | null
  bio?: string | null
  offerings: Array<{ url?: string | null; description?: string | null }>
}): Map<string, string> {
  const allowed = new Map<string, string>()
  const userText = [
    profile.bio,
    ...profile.offerings.map(o => o.description)
  ].filter((t): t is string => Boolean(t))
  for (const url of [
    profile.websiteUrl,
    ...profile.offerings.map(o => o.url),
    ...userText.flatMap(extractUrls)
  ]) {
    if (url) allowed.set(normalizeUrlForCompare(url), url)
  }
  return allowed
}

/**
 * Drops empty and duplicate suggestions (including ones that repeat an
 * existing goal), trims lengths, and replaces any link the user did not save
 * with no link.
 */
export function keepValidSuggestions(
  output: GoalSuggestionsModelOutput,
  context: { allowedUrls: Map<string, string>; existingGoals: string[] }
): GoalSuggestion[] {
  const taken = new Set(context.existingGoals.map(t => t.toLowerCase()))
  const suggestions: GoalSuggestion[] = []
  for (const goal of output.goals) {
    const title = goal.title.trim().slice(0, 200)
    const keyMessage = goal.keyMessage.trim().slice(0, 1000)
    if (!title || !keyMessage || taken.has(title.toLowerCase())) continue
    taken.add(title.toLowerCase())
    suggestions.push({
      title,
      objectiveType: goal.objectiveType,
      keyMessage,
      desiredAction: goal.desiredAction.trim().slice(0, 500) || undefined,
      targetUrl: goal.targetUrl.trim()
        ? context.allowedUrls.get(normalizeUrlForCompare(goal.targetUrl))
        : undefined,
      basedOn: goal.basedOn.trim().slice(0, 200)
    })
  }
  return suggestions.slice(0, MAX_SUGGESTIONS)
}
