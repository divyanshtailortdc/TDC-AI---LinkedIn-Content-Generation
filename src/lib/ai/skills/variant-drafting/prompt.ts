import type { Idea } from '@/db/schema'
import {
  FORMATS,
  PLATFORMS,
  formatCharCount,
  isCasualStyle,
  type ContentStyle,
  videoScriptOf,
  WORDS_PER_SECOND,
  type FormatId,
  type FormatSpec
} from '@/lib/formats'
import { channelNote, forFormat } from '../../channel-context'
import {
  describeCta,
  renderAlsoSupportsBlock,
  renderAudienceBlock,
  renderGoalBlock,
  renderGuardrailsBlock,
  renderIdentityBlock,
  renderReviewerFeedbackBlock,
  renderVoiceBlock,
  resolveLinkPlacement,
  styleFor,
  type GenerationContext
} from '../../context-blocks'
import { CASUAL_TRUTH_RULES, casualStyleRules } from '../shared/casual-rules'
import { TRUTH_RULES } from '../shared/truth-rules'
import type { VariantDraft } from './schema'

/**
 * The prompt for every non-LinkedIn format, in three parts sent in this
 * order so the model's prompt cache does the most work:
 *
 * 1. buildSharedInstructions: the author, readers, goal, voice and rules.
 *    The same for every format of every idea with this goal.
 * 2. buildIdeaBlock: the approved idea and its evidence. The same for every
 *    format of this idea.
 * 3. buildFormatPrompt: the platform, its rules and what to produce. The only
 *    part that differs between an idea's X thread and its Instagram caption.
 *
 * LinkedIn keeps its own prompt (../post-drafting), unchanged.
 */

/**
 * Another post of the same idea that the reviewer approved: its text is the
 * reviewed account of the idea (argument, example, facts) that this format
 * carries over, rewritten for its own platform.
 */
export interface ApprovedSibling {
  formatId: FormatId
  /** Plain text: a single post's parts, or a thread's posts split by "---". */
  text: string
}

/** The style a format's posts are written in: its platform's. */
export const styleOfFormat = (ctx: GenerationContext, formatId: FormatId): ContentStyle =>
  styleFor(ctx, FORMATS[formatId].platform)

/**
 * The shared block for one style. Formats of the same style share it (and its
 * cache entry); a professional one is the block every format had before
 * styles existed.
 */
export function buildSharedInstructions(
  ctx: GenerationContext,
  style: ContentStyle = 'professional'
): string {
  const guardrails = renderGuardrailsBlock(ctx)
  const feedback = renderReviewerFeedbackBlock(ctx)
  const alsoSupports = renderAlsoSupportsBlock(ctx)
  const casual = isCasualStyle(style) ? style : null

  return `You are a ghostwriter who writes finished social media posts for one specific author${casual ? `, for the people who follow them: ${casual === 'fun' ? 'fun and playful' : 'casual and personal'}, never corporate` : ''}, one platform at a time. You write in their voice, not yours, and you never invent facts${casual ? ' about them' : ''}. Each request names the platform and its rules; the facts, the goal and the author's voice stay the same on every platform, while the length, shape and register change to suit it.

AUTHOR
${renderIdentityBlock(ctx)}

READER (the author's audience in general; a request may name who follows them on its platform)
${renderAudienceBlock(ctx)}

GOAL THIS POST SERVES
${renderGoalBlock(ctx.primaryGoal)}
${alsoSupports ? `\nIT ALSO SUPPORTS these goals: reinforce their messages where the argument meets them, with no second call to action or link:\n${alsoSupports}\n` : ''}
VOICE — the author's core voice, on every platform
${renderVoiceBlock(ctx)}
${guardrails ? `\nGUARDRAILS\n${guardrails}\n` : ''}
TRUTH RULES
${casual ? CASUAL_TRUTH_RULES : TRUTH_RULES}

HOW EVERY POST SHOULD READ
${
  casual
    ? casualStyleRules(casual)
    : `- Open on one concrete thing: a specific moment, a figure from the evidence, or a claim a reader could disagree with. No throat-clearing, no "Ever wondered...", no definition of the topic.
- One idea per post, made through one specific example rather than a list of abstractions. If the idea asks for an example, include it.
- When the platform is short, keep the core argument and its strongest piece of evidence; cut words, never the argument.
- Do not announce what the post is or is not ("this is not a pitch", "here's the thing"). Show it.
- Do not summarise at the end; the last line adds something.
- Never ask for engagement for its own sake ("comment YES", "tag a friend", "like if you agree").
- Write the way this author would say it to one reader, not the way a report is written.`
}
${feedback ? `\nREVIEWER FEEDBACK ON EARLIER POSTS — the author's own corrections; apply them\n${feedback}\n` : ''}`
}

export function buildIdeaBlock(idea: Idea): string {
  const evidence = idea.supportingEvidence || []
  return `THE APPROVED IDEA
Title: ${idea.title}
Thesis: ${idea.thesis || ''}
Angle: ${idea.angle || ''}
Why now: ${idea.whyNow || ''}
Opening idea (adapt it to the platform; do not copy it verbatim): ${idea.hookConcept || idea.hook}
Core argument: ${idea.coreArgument || ''}
Reader takeaway: ${idea.audienceTakeaway || ''}

EVIDENCE YOU MAY USE (nothing outside this):
${
  evidence.length > 0
    ? evidence
        .map(
          (e, i) =>
            `[${i + 1}] ${e.claim}${e.quote ? `\n    Quote: "${e.quote}"` : ''}${e.sourceTitle ? `\n    Source: ${e.sourceTitle}` : ''}${e.sourceUrl ? `\n    URL: ${e.sourceUrl}` : ''}`
        )
        .join('\n')
    : 'No external evidence was gathered. Write from reasoning alone and state no statistics.'
}`
}

function describeRange(range: { min: number; max: number }): string {
  if (range.max === 0) return 'none at all'
  if (range.min === range.max) return `exactly ${range.min}, at the end`
  return `between ${range.min} and ${range.max}, at the end`
}

function emojiRule(ctx: GenerationContext, spec: FormatSpec): string {
  const level = ctx.prefs.constraints.emoji_level
  if (level === 'none') return 'Use no emoji at all.'
  if (level === 'liberal') return 'Emoji are welcome where they add warmth.'
  // X posts have no lists to mark, and each emoji costs two of 280 characters.
  if (spec.platform === 'x') return 'At most one emoji, never mid-sentence.'
  return 'Emoji only as list markers, never mid-sentence.'
}

/** Where the goal's link goes on this platform, if it has one. */
function linkRule(ctx: GenerationContext, spec: FormatSpec): string {
  const link = ctx.primaryGoal?.targetUrl || null
  const comment = spec.commentLabel.toLowerCase()
  if (spec.links.inBody === 'not_clickable') {
    return link
      ? `Links are not clickable here. Never write a URL in the caption; when the post leads to the goal's action, say the link is in the bio. Leave linkComment empty.`
      : 'Links are not clickable here. Never write a URL. Leave linkComment empty.'
  }
  const inBody =
    spec.links.inBody === 'ok' && resolveLinkPlacement(ctx.primaryGoal) === 'body'
  const parts: string[] = []
  if (spec.links.note) parts.push(spec.links.note)
  if (!link) {
    parts.push(`No link is needed. Leave linkComment empty unless a source is worth linking in the ${comment}.`)
  } else if (inBody) {
    parts.push(`Include this link once in the post, near the call to action: ${link}. Leave linkComment empty.`)
  } else {
    parts.push(`Keep links out of the post itself. Put the goal's link in linkComment (the ${comment}): ${link}`)
  }
  return parts.join(' ')
}

function renderExemplars(ctx: GenerationContext, spec: FormatSpec): string {
  const platform = spec.platform
  const exemplars = ctx.samplePosts
    .slice()
    .sort((a, b) => Number(b.performedWell) - Number(a.performedWell))
    .slice(0, 4)
  if (exemplars.length === 0) return ''
  const fromElsewhere = exemplars.some(s => (s.platform || 'linkedin') !== platform)
  const label = PLATFORMS[platform].label
  const intro = fromElsewhere
    ? `HOW THIS AUTHOR WRITES — real posts, some written for other platforms. Match the voice and idiom, not their length or layout; this is a ${spec.label}:`
    : `HOW THIS AUTHOR WRITES ON ${label.toUpperCase()} — match the rhythm, structure and idiom of these real posts:`
  return `${intro}\n\n${exemplars
    .map((s, i) => {
      const tag = s.performedWell
        ? `Example ${i + 1} (performed well${s.engagementNote ? `: ${s.engagementNote}` : ''})`
        : `Example ${i + 1}`
      return `${tag}:\n"""\n${s.content}\n"""`
    })
    .join('\n\n')}`
}

function renderProduceList(ctx: GenerationContext, spec: FormatSpec): string {
  const hashtags =
    spec.hashtags === 'voice'
      ? `follow the author's policy: "${ctx.prefs.constraints.hashtag_policy}"`
      : describeRange(spec.hashtags)
  const cta = describeCta(ctx)

  if (spec.structure === 'script') {
    const seconds = spec.limits.seconds!
    const words = Math.round(seconds.target * WORDS_PER_SECOND)
    return `Produce:
1. shots — the video in order, usually 4 to 8 shots. Each has: say (the words spoken, written to be said aloud), show (what is on screen) and, when it helps, onScreenText (a few words of overlay). The first shot is the hook. All the spoken words together take about ${seconds.target} seconds (about ${words} words), never over ${seconds.max} seconds. The last shot carries the call to action: ${cta}
2. caption — the text posted with the video, about ${spec.limits.targetChars} characters, never over ${spec.limits.maxChars}${spec.limits.foldChars ? `; its first ${spec.limits.foldChars} characters show before "more"` : ''}
${spec.platform === 'youtube' ? '3. title — at most 100 characters: exactly what the viewer gets, in the words they would search' : '3. title — leave empty'}
4. hashtags — ${hashtags}, without the # symbol; they go after the caption
5. alternateHooks — 2 to 3 genuinely different spoken first lines
6. linkComment — as the link rule above says
7. hook, body, cta, posts and visualIdea — leave empty; the shots carry them
8. selfScores — honest 1-10 ratings`
  }

  if (spec.structure === 'thread') {
    const parts = spec.limits.parts!
    return `Produce:
1. posts — ${parts.min} to ${parts.max} posts, each about ${spec.limits.targetChars} characters and never over ${spec.limits.maxChars}. The last post carries the call to action: ${cta}
2. hook, body and cta — leave empty; the posts carry them
3. linkComment — as the link rule above says
4. hashtags — ${hashtags}, without the # symbol
5. alternateHooks — 2 to 3 genuinely different first posts
6. visualIdea, shots, caption and title — leave empty
7. selfScores — honest 1-10 ratings`
  }

  const fold = spec.limits.foldChars
  return `Produce:
1. hook — the opening line${fold ? `, a complete thought within ${fold} characters` : ''}
2. body — the rest of the post; do not repeat the hook. Hook, body, call to action and hashtags together about ${spec.limits.targetChars} characters, never over ${spec.limits.maxChars}
3. cta — ${cta}
4. linkComment — as the link rule above says
5. hashtags — ${hashtags}, without the # symbol
6. alternateHooks — 2 to 3 genuinely different openings
7. visualIdea — ${
    spec.id === 'instagram.caption'
      ? 'the image or short carousel this caption goes with'
      : isCasualStyle(styleOfFormat(ctx, spec.id))
        ? 'what the author should photograph or film to go with this post, in one or two sentences'
        : 'leave empty'
  }
8. posts, shots, caption and title — leave empty; this is a single post
9. selfScores — honest 1-10 ratings`
}

/**
 * The idea's approved posts on other platforms, to carry over: an X version
 * written after the reviewer approved (and perhaps corrected) the LinkedIn
 * post keeps that post's argument and facts instead of drifting from it.
 */
function renderApprovedSiblings(siblings: ApprovedSibling[], spec: FormatSpec): string {
  const one = siblings.length === 1
  return [
    `THIS IDEA, ALREADY APPROVED ELSEWHERE — the reviewer checked ${one ? 'this post' : 'these posts'}:`,
    ...siblings.map(s => `${FORMATS[s.formatId].label}:\n"""\n${s.text}\n"""`),
    `Carry over ${one ? 'its' : 'their'} argument, example and facts: you may use ${one ? 'its' : 'their'} facts as you use the evidence, leave out nothing the argument needs, and add nothing ${one ? 'it does' : 'they do'} not say and the evidence does not hold. Do not copy sentences or the opening; write the ${spec.label} fresh, within its rules and limits.`
  ].join('\n')
}

/** The platform, its rules and what to produce: the only per-format part. */
export function buildFormatPrompt(
  baseCtx: GenerationContext,
  formatId: FormatId,
  /** How this idea's posts on other platforms already open. */
  siblingOpenings: string[] = [],
  /** This idea's posts the reviewer approved on other platforms. */
  approvedSiblings: ApprovedSibling[] = []
): string {
  const spec = FORMATS[formatId]
  const platform = PLATFORMS[spec.platform]
  const ctx = forFormat(baseCtx, formatId)
  const note = channelNote(ctx, spec.platform)

  const recentHooks = ctx.history.drafts
    .map(d => d.hook.trim())
    .filter(Boolean)
    .slice(0, 5)
  const exemplars = renderExemplars(ctx, spec)

  const lines = [
    `Write the ${spec.label} for this idea.`,
    ...(approvedSiblings.length > 0
      ? ['', renderApprovedSiblings(approvedSiblings, spec)]
      : []),
    '',
    `PLATFORM: ${platform.label}`,
    `How posts read here: ${spec.register ?? platform.register}`,
    `How posts open here: ${spec.opening ?? platform.opening} Do not reuse the idea's opening concept word for word.`,
    ...(note?.audience
      ? [`Who follows this author on ${platform.label}: ${note.audience}. Write for them.`]
      : []),
    ...(note?.tone
      ? [`How this author sounds on ${platform.label}, beyond the core voice: ${note.tone}`]
      : []),
    '',
    'FORMAT RULES',
    ...spec.rules.map(r => `- ${r}`),
    `- ${emojiRule(ctx, spec)}`,
    `- Links: ${linkRule(ctx, spec)}`,
    ...(siblingOpenings.length > 0
      ? [
          '',
          "This idea's posts on other platforms already open with the lines below. Someone who follows the author on both should not read the same opening twice, so open differently:",
          ...siblingOpenings.map(h => `- ${h}`)
        ]
      : []),
    ...(recentHooks.length > 0
      ? [
          '',
          `This author's latest ${spec.label}s opened with the lines below. Open differently, and do not reuse their phrasing:`,
          ...recentHooks.map(h => `- ${h}`)
        ]
      : []),
    ...(exemplars ? ['', exemplars] : []),
    '',
    renderProduceList(ctx, spec)
  ]
  return lines.join('\n')
}

/** A post as the regenerate and revision prompts show it, in its own shape. */
function renderVersion(
  formatId: FormatId,
  post: { hook: string; body: string; cta?: string | null; payload?: Record<string, unknown> | null }
): string {
  const spec = FORMATS[formatId]
  if (spec.structure === 'thread') {
    return `Posts:\n${[post.hook, post.body].filter(Boolean).join('\n---\n')}`
  }
  if (spec.structure === 'script') {
    const script = videoScriptOf(post)
    const shots = script.shots
      .map(
        (shot, i) =>
          `${i + 1}. Say: ${shot.say}${shot.show ? `\n   Show: ${shot.show}` : ''}${shot.onScreenText ? `\n   On screen: ${shot.onScreenText}` : ''}`
      )
      .join('\n')
    return `${script.title ? `Title: ${script.title}\n` : ''}Shots (about ${script.seconds} seconds spoken):\n${shots}\nCaption: ${script.caption}`
  }
  return `Hook: ${post.hook}\nBody:\n${post.body}\nCTA: ${post.cta || ''}`
}

/**
 * The same request, plus the post as it stands and what the reviewer wants
 * changed. Without an instruction the reviewer just wants another take.
 */
export function buildRegeneratePrompt(
  baseCtx: GenerationContext,
  formatId: FormatId,
  current: {
    hook: string
    body: string
    cta?: string | null
    payload?: Record<string, unknown> | null
  },
  instruction: string | null,
  siblingOpenings: string[] = [],
  approvedSiblings: ApprovedSibling[] = []
): string {
  const spec = FORMATS[formatId]
  const shown = renderVersion(formatId, current)
  return `${buildFormatPrompt(baseCtx, formatId, siblingOpenings, approvedSiblings)}

The reviewer asked for a new version of this ${spec.label}.${
    instruction
      ? ' Keep what works and change what they ask for.'
      : ' Write a genuinely different take: a different opening and a different example, with the same argument and evidence.'
  }

CURRENT VERSION
${shown}${
    instruction
      ? `

WHAT THE REVIEWER WANTS CHANGED — follow it, within the truth rules:
${instruction}`
      : ''
  }`
}

/** The same request, plus the previous attempt and the checks it failed. */
export function buildRevisionPrompt(
  baseCtx: GenerationContext,
  formatId: FormatId,
  previous: VariantDraft,
  failedChecks: string[],
  siblingOpenings: string[] = [],
  approvedSiblings: ApprovedSibling[] = []
): string {
  const spec = FORMATS[formatId]
  const shown = renderVersion(formatId, previous)
  const length = formatCharCount(formatId, previous)
  return `${buildFormatPrompt(baseCtx, formatId, siblingOpenings, approvedSiblings)}

Your previous draft failed these checks. Rewrite it so every one passes, keeping the argument and the voice intact.

PREVIOUS DRAFT (${length} characters as ${PLATFORMS[spec.platform].label} counts them)
${shown}

FAILED CHECKS
${failedChecks.map(m => `- ${m}`).join('\n')}`
}
