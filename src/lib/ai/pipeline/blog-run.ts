import 'server-only'

import { db } from '@/db'
import { blogsTable, ideasTable, type Blog, type Idea } from '@/db/schema'
import {
  applySentenceFixes,
  checkCitations,
  citedClaims,
  docSentences,
  sentenceRanges,
  unlinkSentences,
  wholeSentence,
  type CitationProblem
} from '@/lib/blogs/citations'
import {
  failBlogGeneration,
  saveGeneratedBlog,
  setBlogStage,
  type BlogClaim,
  type BlogDb,
  type GeneratedBlog
} from '@/lib/blogs/claim'
import {
  blogWordCount,
  docLinks,
  docOutline,
  docSections,
  docText,
  replaceSection,
  type BlogDoc
} from '@/lib/blogs/doc'
import {
  makeFeaturedImage as makeImage,
  type FeaturedImageRequest
} from '@/lib/blogs/featured-image'
import { FEATURED_IMAGE_DEPS } from '@/lib/blogs/featured-image-deps'
import { blogToText } from '@/lib/blogs/render'
import { runSeoChecks } from '@/lib/blogs/seo'
import { DEFAULT_BRAND_THEME } from '@/lib/brand/theme'
import {
  applySectionRewrite,
  findIdentityBlog,
  setBlogVerification,
  type SaveOutcome
} from '@/lib/blogs/store'
import {
  isGenerationStale,
  sourceQuotes,
  type BlogBrief,
  type BlogContent,
  type BlogPlan,
  type BlogSource,
  type BlogVerification,
  type FaqItem,
  type FeaturedImage,
  type FeaturedImageView,
  type InternalLink,
  type LinkCandidate,
  type VerificationIssueKind
} from '@/lib/blogs/types'
import { blockingFindings, runBlogLinter } from '@/lib/lint/blog-linter'
import type { LintFinding } from '@/lib/lint/run-linter'
import { longestSharedRun } from '@/lib/lint/writing-checks'
import {
  DEFAULT_WRITING_THRESHOLDS,
  writingSettingsForVoice
} from '@/lib/lint/writing-rules'
import { ownHosts } from '@/lib/research/source-credibility'
import { normalizeUrlForCompare } from '@/lib/urls'
import { and, eq } from 'drizzle-orm'
import { defaultModel } from '../../ai'
import {
  collectBannedWords,
  loadGenerationContext,
  type GenerationContext
} from '../context'
import { SkillError } from '../run-skill'
import {
  BLOG_WRITING_TIMEOUT_MS,
  fixBlogSentences,
  SENTENCE_FIX_TIMEOUT_MS,
  writeBlog,
  writeBlogSection,
  type SentenceFix
} from '../skills/blog-drafting'
import {
  cleanBlogDraft,
  cleanSectionDraft,
  isAllowedLink,
  ownLinksOf
} from '../skills/blog-drafting/guard'
import type { BlogPromptInput } from '../skills/blog-drafting/prompt'
import { BLOG_PLANNING_TIMEOUT_MS, planBlog } from '../skills/blog-planning'
import {
  CITATION_CHECK_TIMEOUT_MS,
  judgeCitations,
  type JudgeClaim
} from '../skills/blog-verification'
import { extractNumbers, mentionsFigure } from '../skills/ideation/guard'
import { AiSpendLimitError } from '../spend'
import { addUsage, EMPTY_USAGE, type CallUsage } from '../usage'
import { gatherBlogSources } from './blog-evidence'
import { gatherLinkCandidates } from './blog-links'
import { figureSourcesText, thirdPartyTexts } from './blog-sources'
import { accountTextOf } from './grounding-corpus'

/**
 * Writing a blog or article, after its claim (src/lib/blogs/claim.ts):
 *
 *   1. the identity's context (its settings, the chosen goal);
 *   2. sources: web research and knowledge passages (blog-evidence.ts), or
 *      the stored ones when regenerating without new research, and beside
 *      them the pages of the identity's site it could link (blog-links.ts);
 *   3. a plan: intent, angle, outline with sources and elements, product
 *      role, call to action, featured image, internal links;
 *   4. the text, written from the plan, while the featured image is made;
 *   5. the checks: each cited sentence against its source (by figure, and
 *      by a model for meaning), the truth, writing and SEO checks; failing
 *      sentences rewritten once; links a source does not support taken off;
 *   6. the result, saved only while the claim still holds.
 *
 * Every model call is charged to the caller's withAiSpend scope ('blogs').
 * On Vercel a generation must finish inside the 300 s function limit: each
 * step gets what is left of GENERATION_BUDGET_MS, steps that cannot fit are
 * skipped, and the image is given up rather than the text.
 */

/**
 * Of the 300 s function limit, what a generation may spend before saving:
 * each step gets at most what is left of it, so a call cut off by the
 * platform never takes a finished draft with it.
 */
export const GENERATION_BUDGET_MS = 270_000
/** The least a writing call is given, however late it starts. */
const MIN_WRITING_MS = 20_000
/** Planning starts only with this much left for writing and checking after it. */
const PLAN_RESERVE_MS = 120_000
/** A plan shorter than this is not worth starting. */
const MIN_PLANNING_MS = 15_000
/** Kept back from writing for the checks and the save. */
const CHECK_RESERVE_MS = 20_000
/** The citation check runs only with this much left. */
const MIN_CHECK_MS = 25_000
/** Sentence fixes run only with this much left. */
const MIN_FIX_MS = 45_000
/** The image is waited for until this long before the budget ends. */
const IMAGE_MARGIN_MS = 5_000
/** Sentences sent to be fixed, at most. */
const MAX_FIXES = 12

export type BlogRunDeps = {
  db: BlogDb
  loadContext: (
    blog: Blog
  ) => Promise<{ ctx: GenerationContext; idea: Idea | null }>
  gatherSources: typeof gatherBlogSources
  gatherLinks: (
    ctx: GenerationContext,
    input: { blogId: string }
  ) => Promise<{ candidates: LinkCandidate[]; related: unknown[] }>
  planBlog: typeof planBlog
  writeBlog: typeof writeBlog
  writeBlogSection: typeof writeBlogSection
  fixBlogSentences: typeof fixBlogSentences
  judgeCitations: typeof judgeCitations
  makeFeaturedImage: (
    request: FeaturedImageRequest
  ) => Promise<{ image: FeaturedImage; usage: CallUsage }>
  now: () => number
  /** Waits; tests resolve it at once. */
  sleep: (ms: number) => Promise<void>
}

/**
 * The identity's settings with the blog's chosen goal (none: no goal), and
 * the idea it came from while that idea still exists.
 */
export async function loadBlogContext(
  blog: Blog
): Promise<{ ctx: GenerationContext; idea: Idea | null }> {
  const [ctx, idea] = await Promise.all([
    loadGenerationContext(blog.accountId, {
      goalIds: blog.goalId ? [blog.goalId] : []
    }),
    blog.ideaId
      ? db.query.ideasTable.findFirst({
          where: and(
            eq(ideasTable.id, blog.ideaId),
            eq(ideasTable.accountId, blog.accountId)
          )
        })
      : undefined
  ])
  return { ctx, idea: idea ?? null }
}

const DEFAULT_DEPS: BlogRunDeps = {
  db,
  loadContext: loadBlogContext,
  gatherSources: gatherBlogSources,
  gatherLinks: gatherLinkCandidates,
  planBlog,
  writeBlog,
  writeBlogSection,
  fixBlogSentences,
  judgeCitations,
  makeFeaturedImage: request => makeImage(request, FEATURED_IMAGE_DEPS),
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
}

/** The author's own words: their details and what they wrote in the brief. */
function authorTexts(brief: BlogBrief): string[] {
  return [brief.instructions, brief.audience.note, brief.caseDetails ?? ''].filter(Boolean)
}

/** The truth, writing and SEO checks of a blog as it stands. */
export function blogChecksFor(
  ctx: GenerationContext,
  blog: BlogContent,
  brief: BlogBrief
): LintFinding[] {
  const website = ctx.account.websiteUrl?.trim()
  return [
    ...runBlogLinter({
      title: blog.title,
      content: blog.content,
      faq: blog.faq,
      bannedWords: collectBannedWords(ctx),
      bannedTopics: ctx.prefs.guardrails.banned_topics,
      emojiLevel: ctx.prefs.constraints.emoji_level,
      figureSources: figureSourcesText(ctx, blog.sources, authorTexts(brief)),
      evidenceTexts: thirdPartyTexts(blog.sources),
      writing: writingSettingsForVoice(ctx.voice, ctx.samplePosts),
      brandNames: [ctx.account.name, ...ctx.offerings.map(o => o.name)],
      searchIntent: blog.searchIntent,
      citations: {
        sources: blog.sources,
        authorText: [accountTextOf(ctx), ...authorTexts(brief)].join('\n')
      }
    }),
    ...runSeoChecks({
      title: blog.title,
      metaTitle: blog.metaTitle,
      metaDescription: blog.metaDescription,
      slug: blog.slug,
      primaryKeyword: blog.primaryKeyword,
      keywords: blog.keywords,
      content: blog.content,
      faq: blog.faq,
      length: brief.length,
      faqWanted: brief.faq,
      researchUsed: blog.sources.some(source => source.origin === 'web'),
      searchIntent: blog.searchIntent,
      featuredImage: blog.featuredImage ? { alt: blog.featuredImage.alt } : null,
      ...(website && { internalLinkHosts: ownHosts([website]) })
    })
  ]
}

/** Why a generation failed, in words the page can show as they are. */
export function friendlyBlogError(error: unknown): string {
  if (error instanceof SkillError) {
    switch (error.reason) {
      case 'spend_limit':
        return error.message
      case 'quota_exceeded':
        return 'The AI budget is used up for now. Try again later.'
      case 'not_configured':
        return 'AI is not set up: add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY.'
      case 'timeout':
        return 'Writing took too long and was stopped. Try again, or choose a shorter length.'
      default:
        return `The blog could not be written: ${error.message}`.slice(0, 400)
    }
  }
  if (error instanceof AiSpendLimitError) return error.message
  const message = error instanceof Error ? error.message : 'unknown error'
  return `The blog could not be written: ${message}`.slice(0, 400)
}

/** The featured image as the checks and renderers see it (src for display). */
export function featuredImageView(
  image: FeaturedImage | null | undefined,
  src?: string
): FeaturedImageView | null {
  if (image?.status !== 'ready') return null
  return {
    src: src ?? image.src,
    alt: image.alt,
    caption: image.caption,
    width: image.width,
    height: image.height
  }
}

/** A blog's fields as the checks and renderers read them. */
const contentOf = (blog: Blog): BlogContent => ({
  kind: blog.kind,
  title: blog.title,
  slug: blog.slug,
  metaTitle: blog.metaTitle,
  metaDescription: blog.metaDescription,
  primaryKeyword: blog.primaryKeyword,
  keywords: blog.keywords,
  searchIntent: blog.searchIntent ?? '',
  content: blog.content,
  faq: blog.faq,
  sources: blog.sources,
  featuredImage: featuredImageView(blog.featuredImage),
  verification: blog.verification ?? null
})

const sectionHeadings = (blog: Blog) =>
  docOutline(blog.content)
    .filter(heading => heading.level === 2)
    .map(heading => heading.text)

const excerpt = (sentence: string) =>
  sentence.length > 80 ? `${sentence.slice(0, 77)}…` : sentence

/** The claims to judge, each with its source's title and passages. */
function claimsToJudge(doc: BlogDoc, sources: BlogSource[]): JudgeClaim[] {
  const byId = new Map(sources.map(source => [source.id, source]))
  return citedClaims(doc, sources).map(claim => {
    const source = byId.get(claim.sourceId)!
    return {
      ...claim,
      sourceTitle: source.title,
      quotes: sourceQuotes(source)
    }
  })
}

type Judged = {
  verdicts: Map<string, { sourceId: string; sentence: string; verdict: BlogVerification['citations'][number]['verdict']; reason: string }>
  issues: Array<{ sentence: string; issue: VerificationIssueKind; note: string }>
}

/** Sentences that state a figure in no source and not in the author's details. */
function inventedFigureSentences(
  doc: BlogDoc,
  figureText: string
): Array<{ sentence: string; figures: string[] }> {
  const known = figureText.toLowerCase()
  const knownFigures = new Set(extractNumbers(known))
  return docSentences(doc)
    .filter(sentence => !sentence.inExample)
    .map(sentence => ({
      sentence: sentence.text,
      figures: extractNumbers(sentence.text).filter(
        figure => !knownFigures.has(figure) && !mentionsFigure(known, figure)
      )
    }))
    .filter(found => found.figures.length > 0)
}

/**
 * Sentences that repeat a run of another publisher's words without quotation
 * marks: the copied_source_text check, found per sentence so the fix pass can
 * rewrite them. Block quotes are quotations already.
 */
function copiedSentences(
  content: { doc: BlogDoc; faq: FaqItem[] },
  evidenceTexts: string[],
  minWords: number
): Array<{ sentence: string; text: string }> {
  if (evidenceTexts.length === 0) return []
  const sentences = [
    ...docSentences(content.doc)
      .filter(sentence => !sentence.inQuote)
      .map(sentence => sentence.text),
    ...content.faq.flatMap(item =>
      sentenceRanges(item.answer).map(([from, to]) => item.answer.slice(from, to).trim())
    )
  ]
  return sentences.flatMap(sentence => {
    const copied = longestSharedRun(sentence, evidenceTexts)
    return copied.length >= minWords ? [{ sentence, text: copied.text }] : []
  })
}

const ISSUE_PROBLEMS: Record<string, string> = {
  fact_without_source:
    'It states a specific fact with no source. Link the source that supports it, or remove the fact.',
  hypothetical_as_fact:
    'It presents a made-up scenario as something that happened. Remove it, or say plainly that it is an illustration.',
  sample_data_as_real:
    'It presents sample data from a product demo or screenshot as real. Remove the detail.',
  opinion_as_fact:
    "It states a judgment as established fact. Write it as the author's view, with the reason."
}

/** What to rewrite, most serious first, each sentence once. */
function fixesFor(input: {
  judged: Judged | null
  problems: CitationProblem[]
  invented: Array<{ sentence: string; figures: string[] }>
  copied: Array<{ sentence: string; text: string }>
}): SentenceFix[] {
  const quoted = (figures: string[] = []) => figures.map(f => `"${f}"`).join(', ')
  const candidates: Array<Omit<SentenceFix, 'id'>> = []
  for (const verdict of input.judged?.verdicts.values() ?? []) {
    if (verdict.verdict === 'unsupported') {
      candidates.push({
        sentence: verdict.sentence,
        problem: `The source it links [${verdict.sourceId}] does not support it: ${verdict.reason} Change the claim to what the source says, link a source that supports it, or remove it.`,
        sourceId: verdict.sourceId
      })
    }
  }
  for (const problem of input.problems) {
    if (problem.rule === 'figure_not_in_source') {
      candidates.push({
        sentence: problem.sentence,
        problem: `Its figure ${quoted(problem.figures)} is not in the source it links [${problem.sourceId}]. Link the source that gives the figure, or change it to what the source says.`,
        ...(problem.sourceId && { sourceId: problem.sourceId })
      })
    }
  }
  for (const found of input.invented) {
    candidates.push({
      sentence: found.sentence,
      problem: `${quoted(found.figures)} is in none of the sources or the author's details. Remove it, or use a figure a source gives (linked to that source).`
    })
  }
  for (const issue of input.judged?.issues ?? []) {
    if (issue.issue === 'sample_data_as_real' || issue.issue === 'hypothetical_as_fact') {
      candidates.push({ sentence: issue.sentence, problem: ISSUE_PROBLEMS[issue.issue]! })
    }
  }
  for (const verdict of input.judged?.verdicts.values() ?? []) {
    if (verdict.verdict === 'partial') {
      candidates.push({
        sentence: verdict.sentence,
        problem: `The source it links [${verdict.sourceId}] supports only part of it: ${verdict.reason} Say only what the source supports.`,
        sourceId: verdict.sourceId
      })
    }
  }
  for (const problem of input.problems) {
    if (problem.rule === 'uncited_figure') {
      candidates.push({
        sentence: problem.sentence,
        problem: `It states ${quoted(problem.figures)} from a source without linking it. Name the source and link it in this sentence.`
      })
    } else if (problem.rule === 'unlabelled_specific') {
      candidates.push({
        sentence: problem.sentence,
        problem: `It gives ${quoted(problem.figures)} as if it happened. Remove the detail; an illustration belongs in a hypothetical example.`
      })
    }
  }
  for (const issue of input.judged?.issues ?? []) {
    if (issue.issue === 'fact_without_source' || issue.issue === 'opinion_as_fact') {
      candidates.push({ sentence: issue.sentence, problem: ISSUE_PROBLEMS[issue.issue]! })
    }
  }
  for (const found of input.copied) {
    candidates.push({
      sentence: found.sentence,
      problem: `"${found.text}" is word for word from a source. Say it in your own words and keep its link, or put the exact words in quotation marks and name the source.`
    })
  }
  const seen = new Set<string>()
  const fixes: SentenceFix[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.sentence)) continue
    seen.add(candidate.sentence)
    fixes.push({ id: `F${fixes.length + 1}`, ...candidate })
    if (fixes.length >= MAX_FIXES) break
  }
  return fixes
}

/** The problems a check found, as verification issues, for sentences still there. */
function issuesOf(
  problems: CitationProblem[],
  judged: Judged | null,
  doc: BlogDoc
): BlogVerification['issues'] {
  const present = new Set(docSentences(doc).map(s => s.text))
  const issues: BlogVerification['issues'] = []
  for (const problem of problems) {
    const issue: VerificationIssueKind =
      problem.rule === 'chart_value_not_in_source' ? 'figure_not_in_source' : problem.rule
    issues.push({
      sentence: problem.sentence,
      issue,
      note: problem.figures?.length ? `Figures: ${problem.figures.join(', ')}` : ''
    })
  }
  for (const issue of judged?.issues ?? []) {
    if (present.has(issue.sentence)) issues.push(issue)
  }
  return issues
}

/**
 * Runs the generation `claim` holds: 'saved', 'failed' (recorded on the
 * blog), or 'lost' when a newer claim replaced it (nothing written).
 */
export async function runBlogGeneration(
  claim: BlogClaim,
  options: {
    instruction?: string | null
    researchAgain?: boolean
    /** Make a new featured image even though the blog has one. */
    newImage?: boolean
  } = {},
  deps: Partial<BlogRunDeps> = {}
): Promise<'saved' | 'failed' | 'lost'> {
  const d: BlogRunDeps = { ...DEFAULT_DEPS, ...deps }
  const instruction = options.instruction ?? null
  let usage: CallUsage = EMPTY_USAGE
  const imageAbort = new AbortController()
  // The image once it is made, so a failure later still keeps it.
  let madeImage: FeaturedImage | null = null
  try {
    const [row] = await d.db
      .select()
      .from(blogsTable)
      .where(eq(blogsTable.id, claim.blogId))
    if (
      !row ||
      row.generationStatus !== 'generating' ||
      row.generationStartedAt?.getTime() !== claim.claimedAt.getTime()
    ) {
      return 'lost'
    }
    // A blog with text is being regenerated: its text is kept as a version.
    const regenerating = row.wordCount > 0 || row.title.trim() !== ''
    // A regeneration writes for the keywords as they now stand (edited in
    // the SEO panel, or chosen by the model the first time), not as first asked.
    const brief: BlogBrief = {
      ...row.brief,
      caseDetails: row.brief.caseDetails ?? '',
      ...(regenerating && {
        primaryKeyword: row.primaryKeyword || row.brief.primaryKeyword,
        secondaryKeywords:
          row.keywords.length > 0 ? row.keywords : row.brief.secondaryKeywords
      })
    }
    const remaining = () =>
      GENERATION_BUDGET_MS - (d.now() - claim.claimedAt.getTime())
    const notes: string[] = []
    const { ctx, idea } = await d.loadContext(row)
    const ownLinks = ownLinksOf(ctx)

    // Sources, and beside them the pages of the site it could link to.
    let sources = row.sources.map(source => ({ ...source, cited: false }))
    const links = d
      .gatherLinks(ctx, { blogId: row.id })
      .catch(() => ({ candidates: [] as LinkCandidate[], related: [] }))
    if (!regenerating || options.researchAgain || sources.length === 0) {
      const gathered = await d.gatherSources(ctx, {
        brief,
        idea,
        onStage: stage => setBlogStage(d.db, claim, stage)
      })
      usage = addUsage(usage, gathered.usage)
      sources = gathered.sources
      notes.push(...gathered.notes)
    }
    const { candidates } = await links

    // The plan.
    let plan: BlogPlan | null = null
    const planTime = Math.min(BLOG_PLANNING_TIMEOUT_MS, remaining() - PLAN_RESERVE_MS)
    if (planTime >= MIN_PLANNING_MS) {
      await setBlogStage(d.db, claim, 'planning')
      try {
        const planned = await d.planBlog(
          {
            ctx,
            kind: row.kind,
            brief: instruction
              ? {
                  ...brief,
                  instructions: [brief.instructions, `For this new version: ${instruction}`]
                    .filter(Boolean)
                    .join('\n')
                }
              : brief,
            sources,
            idea,
            candidates,
            allowedLinks: ownLinks
          },
          { timeoutMs: planTime }
        )
        usage = addUsage(usage, planned.usage)
        plan = planned.plan
      } catch (error) {
        if (error instanceof SkillError) {
          usage = addUsage(usage, error.usage)
          if (['spend_limit', 'quota_exceeded', 'not_configured'].includes(error.reason)) throw error
        }
        console.warn('Blog planning failed; the writer plans for itself:', error)
        notes.push('Planned while writing: the planning step did not finish.')
      }
    } else {
      notes.push('Planned while writing: there was no time for a separate plan.')
    }

    // The text, and the featured image beside it.
    await setBlogStage(d.db, claim, 'writing')
    // An image the blog already has stays: one kept from a failed first
    // generation too. A regeneration makes a new one only when asked.
    const keepImage = !options.newImage && row.featuredImage?.status === 'ready'
    const image = keepImage
      ? null
      : d
          .makeFeaturedImage({
            blogId: row.id,
            title: plan?.workingTitle || brief.topic,
            concept:
              plan?.featuredImage.concept ||
              `An editorial picture about ${brief.topic}`,
            alt: plan?.featuredImage.alt || brief.topic,
            style: plan?.featuredImage.style ?? 'photo',
            theme: ctx.brand ?? DEFAULT_BRAND_THEME,
            abortSignal: imageAbort.signal
          })
          .then(result => {
            usage = addUsage(usage, result.usage)
            madeImage = result.image
            return result.image
          })
          .catch((error): FeaturedImage => ({
            status: 'failed',
            error: error instanceof Error ? error.message : 'The image could not be made.',
            alt: plan?.featuredImage.alt || brief.topic,
            prompt: ''
          }))

    const input: BlogPromptInput = {
      ctx,
      kind: row.kind,
      brief,
      sources,
      idea,
      ownLinks,
      plan
    }
    const mode = regenerating
      ? {
          regenerate: {
            current: { title: row.title, outline: sectionHeadings(row) },
            instruction
          }
        }
      : {}
    const writeTime = () =>
      Math.max(MIN_WRITING_MS, Math.min(BLOG_WRITING_TIMEOUT_MS, remaining() - CHECK_RESERVE_MS))
    let written: Awaited<ReturnType<typeof writeBlog>>
    try {
      written = await d.writeBlog(input, { ...mode, timeoutMs: writeTime() })
      usage = addUsage(usage, written.usage)
    } catch (error) {
      if (error instanceof SkillError) usage = addUsage(usage, error.usage)
      // The long-form model failing (not a limit, not the clock) is worth one
      // try on the default model while there is time for it.
      const retry =
        error instanceof SkillError &&
        error.reason === 'failed' &&
        remaining() - CHECK_RESERVE_MS >= 60_000
      if (!retry) throw error
      written = await d.writeBlog(input, {
        ...mode,
        timeoutMs: writeTime(),
        modelId: defaultModel
      })
      usage = addUsage(usage, written.usage)
    }

    // The checks, and one round of fixes.
    await setBlogStage(d.db, claim, 'checking')
    const clean = cleanBlogDraft(written.draft, {
      sources,
      ownLinks,
      faqWanted: brief.faq,
      keyword: brief.primaryKeyword,
      briefKeywords: brief.secondaryKeywords,
      plan
    })
    const allowed = [
      ...sources.flatMap(source => (source.url ? [source.url] : [])),
      ...ownLinks,
      ...(plan?.internalLinks ?? []).map(link => link.url)
    ]
    const allow = (url: string) => isAllowedLink(url, allowed)
    const authorText = [accountTextOf(ctx), ...authorTexts(brief)].join('\n')
    const figureText = figureSourcesText(ctx, sources, authorTexts(brief))
    let doc = clean.doc
    let faq: FaqItem[] = clean.faq
    const flags = [...clean.flags]

    const judge = async (): Promise<Judged | null> => {
      if (remaining() < MIN_CHECK_MS) return null
      const claims = claimsToJudge(doc, clean.sources)
      if (claims.length === 0) return { verdicts: new Map(), issues: [] }
      try {
        const result = await d.judgeCitations(
          { claims, articleText: blogToText({ ...contentFor(), content: doc, faq }) },
          { timeoutMs: Math.min(CITATION_CHECK_TIMEOUT_MS, remaining() - 15_000) }
        )
        usage = addUsage(usage, result.usage)
        const byId = new Map(claims.map(claim => [claim.id, claim]))
        const verdicts: Judged['verdicts'] = new Map()
        for (const verdict of result.verdicts) {
          const claim = byId.get(verdict.id)
          if (!claim) continue
          verdicts.set(`${claim.sourceId}\n${claim.sentence}`, {
            sourceId: claim.sourceId,
            sentence: claim.sentence,
            verdict: verdict.verdict,
            reason: verdict.reason
          })
        }
        // A checker may quote part of a sentence: the issue is the whole one,
        // or nothing when the quote is not in the piece.
        const issues = result.issues.flatMap(issue => {
          const sentence = wholeSentence(doc, issue.sentence)
          return sentence ? [{ ...issue, sentence }] : []
        })
        return { verdicts, issues }
      } catch (error) {
        if (error instanceof SkillError) usage = addUsage(usage, error.usage)
        console.warn('Blog citation check failed; keeping the checks without a model:', error)
        return null
      }
    }
    const contentFor = (): BlogContent => ({
      kind: row.kind,
      title: clean.title,
      slug: clean.slug,
      metaTitle: clean.metaTitle,
      metaDescription: clean.metaDescription,
      primaryKeyword: clean.primaryKeyword,
      keywords: clean.keywords,
      searchIntent: clean.searchIntent,
      content: doc,
      faq,
      sources: clean.sources,
      featuredImage: null,
      verification: null
    })

    let judged = await judge()
    let problems = checkCitations({ doc, sources: clean.sources, authorText })
    const fixes = fixesFor({
      judged,
      problems,
      invented: inventedFigureSentences(doc, figureText),
      copied: copiedSentences(
        { doc, faq },
        thirdPartyTexts(clean.sources),
        writingSettingsForVoice(ctx.voice, ctx.samplePosts).thresholds?.copiedRunWords ??
          DEFAULT_WRITING_THRESHOLDS.copiedRunWords
      )
    })
    if (fixes.length > 0 && remaining() >= MIN_FIX_MS) {
      try {
        const fixed = await d.fixBlogSentences(
          { ctx, kind: row.kind, brief, sources: clean.sources, fixes },
          { timeoutMs: Math.min(SENTENCE_FIX_TIMEOUT_MS, remaining() - CHECK_RESERVE_MS) }
        )
        usage = addUsage(usage, fixed.usage)
        const byId = new Map(fixes.map(fix => [fix.id, fix]))
        const applied = applySentenceFixes(
          { doc, faq },
          fixed.replacements.flatMap(({ id, replacement }) => {
            const fix = byId.get(id)
            return fix ? [{ sentence: fix.sentence, replacement }] : []
          }),
          allow
        )
        doc = applied.doc
        faq = applied.faq
        flags.push(
          ...Array.from(new Set(applied.removedLinks)).map(
            url => `Removed a link to ${url} that was not among the sources.`
          )
        )
        // What changed is checked again; what did not keeps its verdict.
        const previous = judged
        const again = await judge()
        if (again) {
          for (const [key, verdict] of previous?.verdicts ?? []) {
            if (!again.verdicts.has(key) && docSentences(doc).some(s => s.text === verdict.sentence)) {
              again.verdicts.set(key, verdict)
            }
          }
          judged = again
        }
        problems = checkCitations({ doc, sources: clean.sources, authorText })
      } catch (error) {
        if (error instanceof SkillError) usage = addUsage(usage, error.usage)
        console.warn('Blog sentence fixes failed; keeping the text as written:', error)
      }
    }

    // A link whose source does not say what its sentence claims comes off.
    const sourceById = new Map(clean.sources.map(source => [source.id, source]))
    const present = new Set(docSentences(doc).map(s => s.text))
    const unsupported = [...(judged?.verdicts.values() ?? [])].filter(
      verdict =>
        verdict.verdict === 'unsupported' &&
        present.has(verdict.sentence) &&
        sourceById.get(verdict.sourceId)?.url
    )
    const removedLinks: BlogVerification['removedLinks'] = []
    if (unsupported.length > 0) {
      const result = unlinkSentences(
        doc,
        unsupported.map(verdict => ({
          sentence: verdict.sentence,
          url: sourceById.get(verdict.sourceId)!.url!
        }))
      )
      doc = result.doc
      for (const verdict of unsupported) {
        removedLinks.push({ sourceId: verdict.sourceId, sentence: verdict.sentence })
        flags.push(
          `Took the link to ${sourceById.get(verdict.sourceId)!.title} off "${excerpt(verdict.sentence)}": the source does not say it. Check the sentence before publishing.`
        )
      }
      problems = checkCitations({ doc, sources: clean.sources, authorText })
    }
    const verification: BlogVerification = {
      checkedAt: new Date(d.now()).toISOString(),
      citations: [...(judged?.verdicts.values() ?? [])]
        .filter(verdict => present.has(verdict.sentence))
        .map(verdict => ({
          sourceId: verdict.sourceId,
          sentence: verdict.sentence,
          verdict: verdict.verdict,
          reason: verdict.reason
        })),
      issues: issuesOf(problems, judged, doc),
      removedLinks
    }
    if (!judged) {
      notes.push(
        'The citations were checked by figure only: the full source check did not run. Use Check sources in the editor.'
      )
    }

    // The featured image, waited for until the budget runs out.
    let featuredImage: FeaturedImage | null | 'keep' = 'keep'
    if (image) {
      const waited = await Promise.race([
        image,
        d.sleep(Math.max(0, remaining() - IMAGE_MARGIN_MS)).then(() => null)
      ])
      if (waited) featuredImage = waited
      else {
        imageAbort.abort()
        featuredImage = {
          status: 'failed',
          error: 'Making the image took too long. Make it again from the editor.',
          alt: plan?.featuredImage.alt || brief.topic,
          prompt: ''
        }
      }
    }

    const content: BlogContent = {
      ...contentFor(),
      sources: clean.sources.map(source => ({
        ...source,
        cited:
          source.cited ||
          (source.url !== null &&
            docLinks(doc).some(href => normalizeUrlForCompare(href) === normalizeUrlForCompare(source.url!)))
      })),
      featuredImage: featuredImageView(
        featuredImage === 'keep' ? row.featuredImage : featuredImage
      ),
      verification
    }
    const checks = blogChecksFor(ctx, content, brief)
    const placed = new Set(docLinks(doc).map(normalizeUrlForCompare))
    const titles = new Map(candidates.map(c => [normalizeUrlForCompare(c.url), c.title]))
    const internalLinks: InternalLink[] = (plan?.internalLinks ?? []).map(link => ({
      url: link.url,
      title: titles.get(normalizeUrlForCompare(link.url)) ?? link.anchor,
      anchor: link.anchor,
      reason: link.reason,
      placed: placed.has(normalizeUrlForCompare(link.url))
    }))
    if (blockingFindings(checks).length > 0) {
      flags.push('Some checks still fail: see the SEO panel before publishing.')
    }

    const result: GeneratedBlog = {
      title: content.title,
      slug: content.slug,
      metaTitle: content.metaTitle,
      metaDescription: content.metaDescription,
      primaryKeyword: content.primaryKeyword,
      keywords: content.keywords,
      content: doc,
      faq,
      sources: content.sources,
      wordCount: blogWordCount(doc, faq),
      checks,
      selfFlags: Array.from(
        new Set([...(written.draft.selfFlags ?? []), ...flags, ...notes])
      ),
      usage,
      model: written.modelId,
      searchIntent: content.searchIntent,
      plan,
      featuredImage,
      verification,
      internalLinks
    }
    const saved = await saveGeneratedBlog(d.db, claim, result, {
      keepRevision: regenerating,
      instruction
    })
    return saved ? 'saved' : 'lost'
  } catch (error) {
    imageAbort.abort()
    console.error(`Blog ${claim.blogId} could not be written:`, error)
    const recorded = await failBlogGeneration(
      d.db,
      claim,
      friendlyBlogError(error),
      usage,
      new Date(),
      { featuredImage: madeImage }
    ).catch(() => false)
    return recorded ? 'failed' : 'lost'
  }
}

/**
 * Writes one section of the identity's blog again (index 1 = the first H2
 * section) while the user waits, checks the citations of the new section,
 * and saves it as a new version.
 */
export async function rewriteBlogSectionNow(
  input: {
    accountId: string
    blogId: string
    sectionIndex: number
    instruction: string | null
    lockVersion: number
  },
  deps: Partial<BlogRunDeps> = {}
): Promise<
  SaveOutcome | { ok: false; reason: 'bad_section' | 'failed'; error: string }
> {
  const d: BlogRunDeps = { ...DEFAULT_DEPS, ...deps }
  const row = await findIdentityBlog(d.db, input.accountId, input.blogId)
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.generationStatus === 'generating' && !isGenerationStale(row))
    return { ok: false, reason: 'generating' }
  if (row.lockVersion !== input.lockVersion)
    return { ok: false, reason: 'conflict' }

  const sections = docSections(row.content)
  const section = sections[input.sectionIndex]
  if (
    !Number.isInteger(input.sectionIndex) ||
    input.sectionIndex < 1 ||
    !section
  ) {
    return {
      ok: false,
      reason: 'bad_section',
      error:
        'That section is not in the blog any more. Reload to see it as it is.'
    }
  }

  const { ctx, idea } = await d.loadContext(row)
  const brief: BlogBrief = { ...row.brief, caseDetails: row.brief.caseDetails ?? '' }
  const promptInput: BlogPromptInput = {
    ctx,
    kind: row.kind,
    brief,
    sources: row.sources,
    idea,
    ownLinks: ownLinksOf(ctx),
    plan: row.plan ?? null
  }
  let usage: CallUsage = EMPTY_USAGE
  let written: Awaited<ReturnType<typeof writeBlogSection>>
  try {
    written = await d.writeBlogSection({
      ...promptInput,
      outline: sections.slice(1).map(s => s.heading ?? ''),
      section: {
        heading: section.heading,
        text: docText({ type: 'doc', content: section.blocks.slice(1) })
      },
      instruction: input.instruction
    })
    usage = addUsage(usage, written.usage)
  } catch (error) {
    return { ok: false, reason: 'failed', error: friendlyBlogError(error) }
  }

  const clean = cleanSectionDraft(written.section, {
    sources: row.sources,
    ownLinks: promptInput.ownLinks,
    fallbackHeading: section.heading ?? '',
    extraLinks: (row.internalLinks ?? []).map(link => link.url)
  })
  let content = replaceSection(row.content, input.sectionIndex, clean.blocks)

  // The new section's citations, checked; an unsupported link comes off.
  const sectionDoc: BlogDoc = { type: 'doc', content: clean.blocks }
  const claims = claimsToJudge(sectionDoc, clean.sources)
  const verdicts: BlogVerification['citations'] = []
  if (claims.length > 0) {
    try {
      const judged = await d.judgeCitations(
        { claims, articleText: docText(sectionDoc) },
        { timeoutMs: 20_000 }
      )
      usage = addUsage(usage, judged.usage)
      const byId = new Map(claims.map(claim => [claim.id, claim]))
      for (const verdict of judged.verdicts) {
        const claim = byId.get(verdict.id)
        if (claim) {
          verdicts.push({
            sourceId: claim.sourceId,
            sentence: claim.sentence,
            verdict: verdict.verdict,
            reason: verdict.reason
          })
        }
      }
    } catch (error) {
      if (error instanceof SkillError) usage = addUsage(usage, error.usage)
    }
  }
  const sourceById = new Map(clean.sources.map(source => [source.id, source]))
  const unsupported = verdicts.filter(
    v => v.verdict === 'unsupported' && sourceById.get(v.sourceId)?.url
  )
  if (unsupported.length > 0) {
    content = unlinkSentences(
      content,
      unsupported.map(v => ({ sentence: v.sentence, url: sourceById.get(v.sourceId)!.url! }))
    ).doc
  }
  const present = new Set(docSentences(content).map(s => s.text))
  const previous = row.verification
  const verification: BlogVerification | null =
    previous || verdicts.length > 0
      ? {
          checkedAt: new Date(d.now()).toISOString(),
          citations: [
            ...(previous?.citations ?? []).filter(
              c => present.has(c.sentence) && !verdicts.some(v => v.sentence === c.sentence)
            ),
            ...verdicts.filter(v => present.has(v.sentence))
          ],
          issues: (previous?.issues ?? []).filter(issue => present.has(issue.sentence)),
          removedLinks: [
            ...(previous?.removedLinks ?? []),
            ...unsupported.map(v => ({ sourceId: v.sourceId, sentence: v.sentence }))
          ]
        }
      : null
  const checks = blogChecksFor(
    ctx,
    { ...contentOf(row), content, sources: clean.sources, verification },
    brief
  )
  return applySectionRewrite(d.db, {
    accountId: input.accountId,
    blogId: input.blogId,
    lockVersion: input.lockVersion,
    content,
    sources: clean.sources,
    wordCount: blogWordCount(content, row.faq),
    checks,
    usage,
    instruction: input.instruction,
    verification
  })
}

/**
 * Checks the saved blog's citations again with the model (after the author
 * edited it), recording the verdicts and the checks without changing the
 * text: links stay for the author to decide.
 */
export async function checkBlogSourcesNow(
  input: { accountId: string; blogId: string; lockVersion: number },
  deps: Partial<BlogRunDeps> = {}
): Promise<SaveOutcome | { ok: false; reason: 'failed'; error: string }> {
  const d: BlogRunDeps = { ...DEFAULT_DEPS, ...deps }
  const row = await findIdentityBlog(d.db, input.accountId, input.blogId)
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.generationStatus === 'generating' && !isGenerationStale(row))
    return { ok: false, reason: 'generating' }
  if (row.lockVersion !== input.lockVersion)
    return { ok: false, reason: 'conflict' }
  const { ctx } = await d.loadContext(row)
  const brief: BlogBrief = { ...row.brief, caseDetails: row.brief.caseDetails ?? '' }
  const content = contentOf(row)
  const claims = claimsToJudge(row.content, row.sources)
  let usage: CallUsage = EMPTY_USAGE
  let judged: Awaited<ReturnType<typeof judgeCitations>> | null = null
  try {
    judged = await d.judgeCitations(
      { claims, articleText: blogToText(content) },
      { timeoutMs: CITATION_CHECK_TIMEOUT_MS }
    )
    usage = addUsage(usage, judged.usage)
  } catch (error) {
    return { ok: false, reason: 'failed', error: friendlyBlogError(error) }
  }
  const byId = new Map(claims.map(claim => [claim.id, claim]))
  const authorText = [accountTextOf(ctx), ...authorTexts(brief)].join('\n')
  const problems = checkCitations({ doc: row.content, sources: row.sources, authorText })
  const verification: BlogVerification = {
    checkedAt: new Date(d.now()).toISOString(),
    citations: judged.verdicts.flatMap(verdict => {
      const claim = byId.get(verdict.id)
      return claim
        ? [{ sourceId: claim.sourceId, sentence: claim.sentence, verdict: verdict.verdict, reason: verdict.reason }]
        : []
    }),
    issues: [
      ...problems.map(problem => ({
        sentence: problem.sentence,
        issue: (problem.rule === 'chart_value_not_in_source'
          ? 'figure_not_in_source'
          : problem.rule) as VerificationIssueKind,
        note: problem.figures?.length ? `Figures: ${problem.figures.join(', ')}` : ''
      })),
      ...judged.issues
    ],
    removedLinks: row.verification?.removedLinks ?? []
  }
  return setBlogVerification(d.db, {
    accountId: input.accountId,
    blogId: input.blogId,
    lockVersion: input.lockVersion,
    verification,
    checks: blogChecksFor(ctx, { ...content, verification }, brief),
    usage
  })
}

export { contentOf as blogContentOf }
