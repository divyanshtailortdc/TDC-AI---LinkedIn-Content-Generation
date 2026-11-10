import type { ArticleSnapshot, Idea } from '@/db/schema'
import { articleOutline, inlineToText } from '@/lib/articles/blocks'
import {
  platformOf,
  renderAlsoSupportsBlock,
  renderAudienceBlock,
  renderGoalBlock,
  renderGuardrailsBlock,
  renderIdentityBlock,
  renderReviewerFeedbackBlock,
  renderVoiceBlock,
  type GenerationContext
} from '../../context-blocks'
import { renderExemplars } from '../post-drafting/prompt'
import type { ArticleKnowledgePassage } from './guard'

/**
 * The article prompts. They share the context blocks every stage uses
 * (identity, reader, goal, voice, guardrails, reviewer feedback) with post
 * drafting, and keep their own format rules: an article is long, structured
 * and read on its own page, not a feed post that must survive the fold.
 */

/** About this many words; the checks warn well outside it. */
export const ARTICLE_TARGET_WORDS = { min: 1100, max: 1800 }

function renderEmojiRule(ctx: GenerationContext): string {
  return ctx.prefs.constraints.emoji_level === 'liberal'
    ? 'Emoji only where the author would use them, never in headings.'
    : 'No emoji.'
}

/** The call to action, from the idea's main goal. */
function describeArticleCta(ctx: GenerationContext): string {
  const goal = ctx.primaryGoal
  const action = goal?.desiredAction?.trim()
  const link = goal?.targetUrl?.trim()
  const parts = [
    action
      ? `Steer the reader toward: ${action}. Use it only if the article's argument leads there; otherwise ask the reader to try or examine one specific thing from the article in their own work.`
      : 'Ask the reader to try or examine one specific thing from the article in their own work.',
    'Offer nothing the goal does not name: no call, demo, audit, download, template or DM offer.',
    'Never a generic "Thoughts?" or "Let me know in the comments".'
  ]
  if (link) parts.push(`You may link it once as [text](${link}).`)
  return parts.join(' ')
}

/**
 * Everything stable for this account and goal, in one cacheable block: a
 * regeneration of the same article reads it from cache.
 */
export function buildArticleInstructions(ctx: GenerationContext): string {
  const platform = platformOf(ctx).name
  const exemplars = renderExemplars(ctx)
  const guardrails = renderGuardrailsBlock(ctx)
  const feedback = renderReviewerFeedbackBlock(ctx)
  const alsoSupports = renderAlsoSupportsBlock(ctx)

  return `You are a ghostwriter producing a finished long-form ${platform} article for one specific author. You write in their voice, not yours, and you never invent facts.

AUTHOR
${renderIdentityBlock(ctx)}

READER
${renderAudienceBlock(ctx)}

GOAL THIS ARTICLE SERVES
${renderGoalBlock(ctx.primaryGoal)}
${alsoSupports ? `\nIT ALSO SUPPORTS these goals: reinforce their messages where the argument meets them, with no second call to action:\n${alsoSupports}\n` : ''}
VOICE — match this precisely
${renderVoiceBlock(ctx)}
${guardrails ? `\nGUARDRAILS\n${guardrails}\n` : ''}
ARTICLE FORMAT
- ${ARTICLE_TARGET_WORDS.min}-${ARTICLE_TARGET_WORDS.max} words in the introduction, sections and closing together; never under ${ARTICLE_TARGET_WORDS.min}. The length comes from depth, not padding: each section has 3-5 paragraphs that make its point, show it in an example and draw out what follows from it for this reader.
- 3 to 6 sections. Each section makes one distinct point the article needs; no two sections make the same point in different words.
- Each section opens with a line that follows from the one before it, so the article reads as one argument, not a list of essays.
- Use concrete examples: a specific task, decision, scene or comparison a reader in this audience would recognise. At least one per section.
- Paragraphs of 2-5 sentences. Subheadings inside a section only when it has two clearly separate parts.
- Lists only for real steps or parallel items, never as a substitute for argument; at most two lists in the whole article.
- Plain text inside every field: no markdown headings, no HTML. **bold** at most once per section, for one key phrase.
- ${renderEmojiRule(ctx)}

TRUTH RULES
- Use only the evidence and knowledge supplied with the brief, and the author's own details above. If a number is not in them, do not write a number.
- When a fact comes from an evidence item or a knowledge passage, name where it comes from in the sentence (the source's title, or "our own guide on X" for the author's knowledge base), and list its id in sourcesUsed.
- Never claim first-hand experience ("I keep seeing", "clients tell me", "in my experience") unless the evidence or the author's details state it.
- Evidence from a web page is someone else's work: put it in your own words (never lift a sentence) and never write "studies show", "experts say" or "one recent report".
- Write "most", "everyone", "always" or "never" only when the evidence measures it. Otherwise use "many", "often" or "in some teams".
- Quotes (a quote block) only word for word from the evidence, with the source named.

HOW IT SHOULD READ
- Open on one concrete thing: a specific moment, a figure from the evidence, or a claim a reader could disagree with. No throat-clearing, no "In today's world", no definition of the topic.
- Vary sentence length. Use "it's not X, it's Y" at most twice in the whole article.
- Do not announce what the article is or is not ("in this article we will", "let's dive in", "this is not a pitch"). Show it.
- Do not summarise the sections at the end. The closing adds the final step of the argument.
- Write the way this author would explain it to one capable reader, not the way a report or a brochure is written.
${feedback ? `\nREVIEWER FEEDBACK ON EARLIER WORK — the author's own corrections; apply them\n${feedback}\n` : ''}${exemplars ? `\nHOW THIS AUTHOR ACTUALLY WRITES — match the idiom, rhythm and stance of these real posts (an article is longer, but the voice is the same):\n\n${exemplars}` : ''}`
}

function renderEvidence(idea: Idea): string {
  const evidence = idea.supportingEvidence || []
  if (evidence.length === 0) {
    return 'No external evidence was gathered for this idea. Argue from reasoning and the knowledge below, and state no statistics that are not in them.'
  }
  return evidence
    .map(
      (e, i) =>
        `[E${i + 1}] ${e.claim}${e.quote ? `\n    Quote: "${e.quote}"` : ''}${e.sourceTitle ? `\n    Source: ${e.sourceTitle}` : ''}${e.sourceUrl ? `\n    URL: ${e.sourceUrl}` : ''}`
    )
    .join('\n')
}

/** The author's own knowledge, closest to the idea first. */
function renderKnowledge(passages: ArticleKnowledgePassage[]): string {
  if (passages.length === 0) return 'None retrieved for this idea.'
  return passages
    .map(
      (p, i) =>
        `[K${i + 1}] From "${p.title}"${p.url ? ` (${p.url})` : ''}:\n    ${p.content.replace(/\s+/g, ' ').trim().slice(0, 1200)}`
    )
    .join('\n')
}

function renderPrevious(previous: ArticleSnapshot | null | undefined): string {
  if (!previous || previous.content.length === 0) return ''
  const outline = articleOutline(previous.content)
    .map(h => `${h.level === 3 ? '    - ' : '- '}${h.text}`)
    .join('\n')
  return `\nTHE CURRENT VERSION (the reviewer asked for a new one)
Title: ${inlineToText(previous.title)}
Outline:
${outline || '- (no headings)'}
Write a new version. Keep what serves the idea, fix what the reviewer's direction asks for, and do not reuse its sentences.
`
}

/** The approved idea, its evidence and knowledge, and exactly what to produce. */
export function buildArticlePrompt(
  ctx: GenerationContext,
  idea: Idea,
  options: {
    passages: ArticleKnowledgePassage[]
    guidance?: string | null
    previous?: ArticleSnapshot | null
  }
): string {
  const recentTitles = ctx.history.drafts
    .map(d => d.hook.trim())
    .filter(Boolean)
    .slice(0, 5)
  const recent =
    recentTitles.length > 0
      ? `\nThis author's latest posts opened with the lines below. Open differently and do not reuse their phrasing:\n${recentTitles.map(h => `- ${h}`).join('\n')}\n`
      : ''
  const guidance = options.guidance?.trim()

  return `Write the long-form article for this approved idea.
${recent}
Title idea: ${idea.title || idea.hook}
Thesis: ${idea.thesis || ''}
Angle: ${idea.angle || ''}
Why now: ${idea.whyNow || ''}
Hook concept (turn this into a real opening, do not copy it): ${idea.hookConcept || idea.hook}
Core argument: ${idea.coreArgument || ''}
Reader takeaway: ${idea.audienceTakeaway || ''}

EVIDENCE YOU MAY USE (ids E1, E2…):
${renderEvidence(idea)}

THE AUTHOR'S OWN KNOWLEDGE BASE (ids K1, K2…) — background you may draw on and name:
${renderKnowledge(options.passages)}
${renderPrevious(options.previous)}${guidance ? `\nTHE REVIEWER'S DIRECTION FOR THIS VERSION — follow it unless it breaks the truth rules:\n"""\n${guidance.slice(0, 1500)}\n"""\n` : ''}
Produce every field of the schema:
- title, subtitle
- introduction, sections (each a heading and its blocks), conclusionHeading, conclusion
- callToAction — ${describeArticleCta(ctx)}
- coverImage — a concept and alt text for a 16:9 cover
- promoPost — the short feed post that shares the article
- sourcesUsed — ids of the evidence and knowledge you relied on
- selfFlags — anything the reviewer should check`
}

/** The same brief, plus the checks the last version failed. */
export function buildArticleRevisionPrompt(
  ctx: GenerationContext,
  idea: Idea,
  options: {
    passages: ArticleKnowledgePassage[]
    guidance?: string | null
    previous?: ArticleSnapshot | null
  },
  draft: { title: string; text: string },
  failedChecks: string[]
): string {
  return `${buildArticlePrompt(ctx, idea, options)}

Your previous version failed these checks. Rewrite the whole article so every one passes, keeping the argument, structure and voice.

FAILED CHECKS
${failedChecks.map(m => `- ${m}`).join('\n')}

PREVIOUS VERSION
Title: ${draft.title}
${draft.text.slice(0, 20_000)}`
}
