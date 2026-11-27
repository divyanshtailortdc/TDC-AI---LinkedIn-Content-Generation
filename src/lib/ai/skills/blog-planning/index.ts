import 'server-only'

import { KIND_PROFILES } from '@/lib/blogs/kinds'
import type { BlogPlan } from '@/lib/blogs/types'
import { runSkill, SkillError } from '../../run-skill'
import type { CallUsage } from '../../usage'
import { buildBlogInstructions } from '../blog-drafting/prompt'
import { cleanPlan, isUsablePlan } from './guard'
import { buildPlanPrompt, type BlogPlanInput } from './prompt'
import { BlogPlanSchema } from './schema'

export type { BlogPlanInput } from './prompt'

/** Planning runs while the user waits on the progress page, before writing. */
export const BLOG_PLANNING_TIMEOUT_MS = 45_000

/**
 * Skill: the brief, the sources and the pages it could link to in; the
 * piece's plan out (intent, angle, outline with sources and elements,
 * product role, call to action, featured image, internal links, gaps).
 * Throws SkillError when the call fails or the plan is unusable; the
 * pipeline then lets the writer plan for itself.
 */
export async function planBlog(
  input: BlogPlanInput,
  options: { timeoutMs?: number } = {}
): Promise<{ plan: BlogPlan; usage: CallUsage; modelId: string }> {
  const { output, usage, modelId } = await runSkill({
    stage: 'blog_planning',
    instructions: buildBlogInstructions(input.ctx, input.kind, input.brief),
    prompt: buildPlanPrompt(input),
    schema: BlogPlanSchema,
    timeoutMs: options.timeoutMs ?? BLOG_PLANNING_TIMEOUT_MS,
    maxRetries: 1
  })
  const plan = cleanPlan(output, {
    sourceIds: input.sources.map(source => source.id),
    candidateUrls: input.candidates.map(candidate => candidate.url),
    allowedLinks: input.allowedLinks,
    faqWanted: input.brief.faq,
    keyword: input.brief.primaryKeyword,
    briefKeywords: input.brief.secondaryKeywords,
    questions: input.questions ?? [],
    maxPictures:
      input.newPictures === false
        ? 0
        : KIND_PROFILES[input.kind].pictures[input.brief.length][1]
  })
  if (!isUsablePlan(plan)) {
    throw new SkillError('The model returned an unusable plan.', 'failed', { usage })
  }
  return { plan, usage, modelId }
}
