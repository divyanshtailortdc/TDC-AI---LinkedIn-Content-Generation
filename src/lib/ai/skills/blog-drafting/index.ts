import 'server-only'

import { runSkill, SkillError } from '../../run-skill'
import type { CallUsage } from '../../usage'
import { isCompleteBlogDraft } from './guard'
import {
  buildBlogInstructions,
  buildBlogPrompt,
  buildBlogRegeneratePrompt,
  buildFixPrompt,
  buildSectionRewritePrompt,
  type BlogPromptInput,
  type SentenceFix
} from './prompt'
import {
  BlogDraftSchema,
  BlogSectionSchema,
  SentenceFixesSchema,
  type BlogDraft,
  type BlogSectionDraft
} from './schema'

export type { BlogPromptInput, SentenceFix } from './prompt'
export type { BlogDraft, BlogSectionDraft } from './schema'

/**
 * A bound on one blog-writing call, retries included. A long piece takes a
 * minute or two; this stays inside the 300 s function limit with research
 * and planning before it (src/lib/ai/pipeline/blog-run.ts).
 */
export const BLOG_WRITING_TIMEOUT_MS = 150_000

/** A section rewrite runs while the user waits. */
export const SECTION_REWRITE_TIMEOUT_MS = 60_000

/** Rewriting the sentences a check failed: short output. */
export const SENTENCE_FIX_TIMEOUT_MS = 45_000

/**
 * Skill: a brief, its plan, the evidence pool and the identity's settings in;
 * a whole blog or article out (title, SEO fields, takeaways, sections, FAQ,
 * the sources used). `regenerate` writes a new version of a blog that
 * exists; `modelId` runs another model than the stage's (a fallback).
 * Throws SkillError on failure or an incomplete draft; its usage is what
 * that attempt cost.
 */
export async function writeBlog(
  input: BlogPromptInput,
  mode: {
    regenerate?: {
      current: { title: string; outline: string[] }
      instruction: string | null
    }
    /** At most this long, when less time is left than BLOG_WRITING_TIMEOUT_MS. */
    timeoutMs?: number
    modelId?: string
  } = {}
): Promise<{ draft: BlogDraft; usage: CallUsage; modelId: string }> {
  const prompt = mode.regenerate
    ? buildBlogRegeneratePrompt(
        input,
        mode.regenerate.current,
        mode.regenerate.instruction
      )
    : buildBlogPrompt(input)
  const { output, usage, modelId } = await runSkill({
    stage: 'blog_drafting',
    instructions: buildBlogInstructions(input.ctx, input.kind, input.brief),
    cacheInstructions: true,
    prompt,
    schema: BlogDraftSchema,
    timeoutMs: mode.timeoutMs ?? BLOG_WRITING_TIMEOUT_MS,
    maxRetries: 1,
    ...(mode.modelId && { modelId: mode.modelId })
  })
  if (!isCompleteBlogDraft(output)) {
    throw new SkillError('The model returned an incomplete blog.', 'failed', {
      usage
    })
  }
  return { draft: output, usage, modelId }
}

/** Skill: one section of a blog written again, with what the author asked for. */
export async function writeBlogSection(
  input: BlogPromptInput & {
    outline: string[]
    section: { heading: string | null; text: string }
    instruction: string | null
  }
): Promise<{ section: BlogSectionDraft; usage: CallUsage; modelId: string }> {
  const { output, usage, modelId } = await runSkill({
    stage: 'blog_editing',
    instructions: buildBlogInstructions(input.ctx, input.kind, input.brief),
    cacheInstructions: true,
    prompt: buildSectionRewritePrompt(input),
    schema: BlogSectionSchema,
    timeoutMs: SECTION_REWRITE_TIMEOUT_MS,
    maxRetries: 1
  })
  if (!(output.blocks ?? []).length) {
    throw new SkillError('The model returned an empty section.', 'failed', {
      usage
    })
  }
  return { section: output, usage, modelId }
}

/**
 * Skill: the sentences a fact check failed, rewritten in the piece's voice;
 * nothing else changes. Replacements come back by problem id; an empty one
 * drops its sentence.
 */
export async function fixBlogSentences(
  input: Pick<BlogPromptInput, 'ctx' | 'kind' | 'brief' | 'sources'> & {
    fixes: SentenceFix[]
  },
  options: { timeoutMs?: number } = {}
): Promise<{
  replacements: Array<{ id: string; replacement: string }>
  usage: CallUsage
  modelId: string
}> {
  const { output, usage, modelId } = await runSkill({
    stage: 'blog_editing',
    instructions: buildBlogInstructions(input.ctx, input.kind, input.brief),
    cacheInstructions: true,
    prompt: buildFixPrompt(input),
    schema: SentenceFixesSchema,
    timeoutMs: options.timeoutMs ?? SENTENCE_FIX_TIMEOUT_MS,
    maxRetries: 1
  })
  const known = new Set(input.fixes.map(fix => fix.id))
  const replacements = (output.fixes ?? [])
    .filter(fix => known.has(fix.id))
    .map(fix => ({ id: fix.id, replacement: (fix.replacement ?? '').trim() }))
  return { replacements, usage, modelId }
}
