/**
 * What a goal sets out to do. Professionals and companies aim at authority,
 * leads or hires; a creator aims at followers, fun or a launch. Each identity
 * type is offered its own set (objectivesFor); every value stays valid for
 * every goal, so a goal keeps its objective if its identity changes type.
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

const CREATOR: GoalObjective[] = [
  'grow_audience',
  'engagement',
  'entertain',
  'community',
  'promote',
  'collabs',
  'awareness'
]

/** The objectives an identity of this type chooses from. */
export function objectivesFor(accountType?: string | null): GoalObjective[] {
  return accountType === 'creator' ? CREATOR : PROFESSIONAL
}

export function isGoalObjective(value: unknown): value is GoalObjective {
  return (
    typeof value === 'string' && (GOAL_OBJECTIVES as readonly string[]).includes(value)
  )
}
