import type { StyleMix } from '@/lib/formats/styles'

/**
 * What a goal sets out to do. Professional posting aims at authority, leads
 * or hires; casual and fun posting at followers, fun or a launch. Which set an
 * identity is offered follows the styles of its platforms (objectivesFor);
 * every value stays valid for every goal, so a goal keeps its objective when
 * the styles change.
 */

export const GOAL_OBJECTIVES = [
  'awareness',
  'engagement',
  'authority',
  'lead_gen',
  'recruiting',
  'community',
  'grow_audience',
  'entertain',
  'promote',
  'collabs'
] as const

export type GoalObjective = (typeof GOAL_OBJECTIVES)[number]

export const OBJECTIVE_LABELS: Record<GoalObjective, string> = {
  awareness: 'Awareness (Reach & impressions)',
  engagement: 'Engagement (Comments, shares & DMs)',
  authority: 'Authority (Thought leadership & POV)',
  lead_gen: 'Lead gen (Inbound inquiries & demos)',
  recruiting: 'Recruiting (Attracting talent)',
  community: 'Community (Building a loyal following)',
  grow_audience: 'Grow followers (New people find and follow you)',
  entertain: 'Entertain (Make people laugh, smile or feel something)',
  promote: 'Promote (A class, event, product or launch)',
  collabs: 'Collabs (Attract brands and other creators)'
}

/** The professional set, in the order the Goals page always showed it. */
const PROFESSIONAL: GoalObjective[] = [
  'authority',
  'awareness',
  'engagement',
  'lead_gen',
  'recruiting',
  'community'
]

/** For platforms where the identity posts casually or for fun. */
const CASUAL: GoalObjective[] = [
  'grow_audience',
  'engagement',
  'entertain',
  'community',
  'promote',
  'collabs',
  'awareness'
]

/**
 * The objectives an identity chooses from, by the style mix of its platforms:
 * professional, casual, or both sets for a mix.
 */
export function objectivesFor(style?: StyleMix | null): GoalObjective[] {
  if (style === 'casual') return CASUAL
  if (style === 'mixed') {
    return [...PROFESSIONAL, ...CASUAL.filter(o => !PROFESSIONAL.includes(o))]
  }
  return PROFESSIONAL
}

export function isGoalObjective(value: unknown): value is GoalObjective {
  return (
    typeof value === 'string' && (GOAL_OBJECTIVES as readonly string[]).includes(value)
  )
}
