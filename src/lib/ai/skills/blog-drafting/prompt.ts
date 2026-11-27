import type { Idea } from '@/db/schema'
import { renderKindRules } from '@/lib/blogs/kinds'
import { STYLE_BLUEPRINTS } from '@/lib/blogs/styles'
import {
  BLOG_KIND_LABELS,
  BLOG_LENGTH_SPECS,
  BLOG_STYLE_LABELS,
  PRODUCT_ROLE_LABELS,
  SEARCH_INTENT_LABELS,
  sourceQuotes,
  type BlogBrief,
  type BlogKind,
  type BlogPlan,
  type BlogSource,
  type BlogStyle,
  type PlanSection
} from '@/lib/blogs/types'
import {
  renderAudienceBlock,
  renderGoalBlock,
  renderGuardrailsBlock,
  renderIdentityBlock,
  renderReviewerFeedbackBlock,
  renderVoiceBlock,
  type GenerationContext
} from '../../context-blocks'
import { renderExemplars } from '../post-drafting/prompt'
import {
  EVIDENCE_IS_DATA_RULES,
  fenceEvidence,
  frameEvidenceText
} from '../shared/evidence'

/**
 * What a keyword the model chooses is. Left open, a plan chose the topic
 * sentence ("unified ERP and eCommerce platform vs separate online store"),
 * which the piece then never used.
 */
export const SEARCH_PHRASE =
  'the phrase of 2-5 words this reader would type into a search box to find this piece, in English (the language the piece is written in, whatever country the readers are in), worded so it reads naturally in a sentence ("fever in children", not "child fever see doctor"), not the topic or the title'

/**
 * A web page is not a social post: an identity's goal written for posts
 * ("tag whoever is paying") made a live article close on an ask its reader
 * could not do.
 */
export const WEB_PAGE_CTA =
  'A reader of a web page cannot tag, mention or comment the way they would on a social post: ask for something they can do from the page, such as read, try, book, sign up, download or get in touch. The piece ends on that step, never on a question to the reader.'

/**
 * When the author's products, pages and call to action belong in a piece.
 * Left to "mention them where they help", a live article on grocery
 * shopping habits sent its readers to a restaurant-expansion service, a
 * supplier business and an investor-relations page "though no figures from
 * it are used here".
 */
export const BRAND_RELEVANCE = `- A product, service or page of the author's belongs in the piece only when a reader of this exact topic would use it for the problem the piece discusses. One that serves a different reader or a different problem is left out entirely, however much the author would like it seen.
- Introduce a product once, plainly, as the author's ("our …"): that is the disclosure. Never hedge it ("we make it, so weigh that accordingly"), never mention a page to say it is not used, and never stack several products in one paragraph.
- The call to action continues the reader's task: the page, tool, download or conversation that helps with the next step the piece has just described. When the goal's action does not follow from this topic, use the version of it that does (a related page, a guide, a contact) rather than forcing it. When no page of the author's continues the reader's task, the call to action is the step itself, with no link; a support or help page is never a call to action.`

/**
 * The blog and article prompts. One block of instructions (author, reader,
 * goal, voice, format, SEO, truth, product and visual rules) is shared by
 * every call about a blog (planning, writing, fixing sentences, rewriting a
 * section), so each reads it from cache after the first. The prompts carry
 * the brief, the plan, the sources and what to produce.
 */

export type BlogPromptInput = {
  ctx: GenerationContext
  kind: BlogKind
  brief: BlogBrief
  /** The evidence pool, numbered S1… and K1… (src/lib/ai/pipeline/blog-evidence.ts). */
  sources: BlogSource[]
  /** The idea it develops, when it was started from one. */
  idea: Idea | null
  /** Links allowed besides the sources: the goal's and the author's own pages. */
  ownLinks: string[]
  /** The plan it is written from; null when planning failed (the writer plans). */
  plan: BlogPlan | null
}

export const NO_SOURCES =
  "No sources were gathered for this piece: argue from reasoning and the author's own details, and state no figures that are not in them."

/**
 * How sections open, so a search or answer engine can lift each one: the
 * answer first, standing on its own, then the depth.
 */
export const ANSWER_FIRST_RULES = `- Every section starts with its lead: 1-3 sentences (about 30-70 words) that answer the heading directly, or for a step say what it achieves. The lead's first sentence is the answer itself: yes or no, the number, the name, the definition, the rule or the recommendation; never a sentence about the evidence or the section ("The evidence ranges from…", "There are several factors…", "This section looks at…"). The lead stands on its own if quoted alone: it names its subject instead of pointing back ("it", "this", "as mentioned above"), and carries its source's link when it states a fact. Then the section goes deeper: the why, the how, the example, the exception.
- The introduction's first paragraph answers the reader's need in 2-3 sentences; context comes after it.`

/**
 * How a confident expert writes, as against a nervous one. Without these a
 * live article spent a sentence in four on its evidence ("we saw only the
 * abstract snippet", "no source we can cite…", "this section is our analysis,
 * not sourced fact") and qualified every judgment with "in our view".
 */
export const CONFIDENT_RULES = `- State what the sources establish plainly, with its link. Say who measured a figure and when once, at its first use; after that, refer to it without explaining its provenance again.
- Explain mechanisms, trade-offs and practical judgment from the author's expertise directly: a judgment needs its reason, not a disclaimer. Mark a judgment as the author's ("we think", "in our view") only when informed people genuinely disagree about it, at most twice in the piece.
- Never narrate the research or the writing: what could or could not be found or confirmed, which source was a snippet, an abstract or cut off, what is "not available to us", that a chart was skipped, that a passage "is our analysis, not sourced fact", or "no source we can cite". What cannot be supported is simply left out.
- Mention a gap in the evidence only when it changes what the reader should do or believe, once, in one sentence about the subject ("No independent count of closures exists, so the 200,000 figure is a trade body's estimate"). Never a section, paragraph or list of caveats.
- Insight over inventory: say what the facts mean for this reader, what most people get wrong, what to do differently, and why. A paragraph that only lists who said what has not done its job.`

/** What makes facts and named things easy to understand, reference and cite. */
export const CITABLE_RULES = `- A sentence with a figure says who measured it, among whom when the source says, and when, so it stands alone when quoted: "In Sana's 2024 survey of 750 B2B buyers, 46% said …", not "46% of buyers say …".
- Name each entity in full at its first mention and say what it is in a few words ("Gartner, the IT research firm"). Then keep one name for it: do not swap a key term for synonyms, and spell names exactly as the sources do.
- When the plan gives a definition, state it early as a plain "X is …" sentence.
- Every abstract point gets a concrete example: a real one from the sources first (named and linked), otherwise a made-up one in an example box.`

const STYLE_RULES: Record<BlogStyle, string> = {
  how_to:
    'What the reader needs first, then the steps in order (one heading per step, numbered where order matters), and the mistakes to avoid. Each step says what to do and how to tell it worked.',
  listicle:
    'Each item is its own heading, numbered ("1. …"), with an explanation and an example under it. The items are distinct and in a deliberate order.',
  explainer:
    'What it is, why it matters to this reader, how it works and an example, building from simple to detailed. Define a term the first time it appears.',
  comparison:
    "Who each option suits and the verdict early, a comparison table, the criteria that matter with evidence for each option, and when to choose which. Fair to every option; the author's interest disclosed when they sell one.",
  industry_analysis:
    'The key findings first; dated, sourced data saying what each figure measures; the drivers behind it; what it means for this reader; what to watch; the limits of the data.',
  thought_leadership:
    'One clear thesis this author would defend, the reasoning and evidence for it, the strongest objection with an honest answer, and what the reader should do differently.',
  opinion:
    'State the position early, give the reasons in order of strength, take on the main counter-argument fairly, and close on what follows from the position.',
  news_analysis:
    'What happened, from the sources and with their dates; why it matters to this reader; what it changes; what to watch or do next. Only developments the sources report.',
  case_study:
    'The real case exactly as the author gives it: the situation, the challenge, the approach, the results and the lessons. Nothing about the case beyond its case details.'
}

/** The context with only the chosen audience, when one was chosen. */
export function readerContext(
  ctx: GenerationContext,
  brief: BlogBrief
): GenerationContext {
  const id = brief.audience.audienceId
  if (!id) return ctx
  const chosen = ctx.audiences.filter(a => a.id === id)
  return chosen.length > 0 ? { ...ctx, audiences: chosen } : ctx
}

export const pieceName = (kind: BlogKind) =>
  kind === 'blog' ? 'blog post' : 'long-form article'

/**
 * Everything stable for this blog, in one block: planning, writing, fixing
 * sentences and rewriting a section all send it. It is not marked for the
 * prompt cache: each of those calls asks for a different output schema, and
 * the schema is part of the cached prefix, so no call could read another's
 * entry. Marked, every call paid the 1.25x cache write (5-6k tokens) and,
 * measured over 114 blog calls (2026-11-24 to 26), almost none read it.
 */
export function buildBlogInstructions(
  ctx: GenerationContext,
  kind: BlogKind,
  brief: BlogBrief
): string {
  const reader = readerContext(ctx, brief)
  const spec = BLOG_LENGTH_SPECS[brief.length]
  const guardrails = renderGuardrailsBlock(ctx)
  const feedback = renderReviewerFeedbackBlock(ctx)
  const exemplars = renderExemplars(ctx)
  const emojiRule =
    ctx.prefs.constraints.emoji_level === 'liberal'
      ? 'Emoji only where the author would use them, never in headings.'
      : 'No emoji.'

  return `You are a senior writer and editor producing a finished, publishable ${pieceName(kind)} for one specific author's website. You write in their voice, not yours. The standard is a piece a knowledgeable reader would trust and share: specific, accurate, useful and genuinely insightful, written with the confidence of someone who knows the field. You never invent facts, and you never pad the text with doubts about them.

AUTHOR
${renderIdentityBlock(ctx)}

READER
${renderAudienceBlock(reader)}

GOAL THIS PIECE SERVES
${ctx.primaryGoal ? renderGoalBlock(ctx.primaryGoal) : 'No specific goal: end with a next step that follows from the piece.'}

VOICE — match this precisely
${renderVoiceBlock(ctx)}
${guardrails ? `\nGUARDRAILS\n${guardrails}\n` : ''}
FORMAT
- Type: ${BLOG_KIND_LABELS[kind]}. The author's voice above decides person and formality; within it:
${renderKindRules(kind, ctx.voice ? { perspective: ctx.voice.perspective, formality: ctx.voice.formality } : null)}
- Writing style: ${BLOG_STYLE_LABELS[brief.style]}. ${STYLE_RULES[brief.style]}
- About ${spec.words} words at most (${spec.min}-${spec.max}), counting the introduction, sections and FAQ. Depth sets the length: stop when the reader has what they need. Shorter is fine; padding, repetition and restating a point in other words never are.
- At least ${spec.minSections} sections, each under its own H2. H3 subheadings only inside a section.
- ${emojiRule}

SEO
- Title (the H1): at most 70 characters, ideally 50-60, using the primary keyword naturally; specific, no clickbait.
- Meta title: 30-60 characters with the primary keyword near the start; it may differ from the title.
- Meta description: 120-160 characters with the primary keyword and a concrete reason to read: what the reader will be able to do or decide.
- Slug: 3-6 lowercase words from the primary keyword, joined by hyphens.
- Use the primary keyword in the first 100 words and in at least one section heading, then only where it fits naturally: never more than about 2.5% of the words, never in more than half the headings, never in sentences one after another. Use each secondary keyword at least once, naturally; vary the wording with the secondary keywords and plain synonyms rather than repeating the exact phrase.
- Headings say what the section covers. Where the plan gives a section a searched question, the heading is that question.
- FAQ, when asked for: 4-6 questions people search about this topic that the sections do not already answer and this piece can answer with substance. Each answer opens with the direct answer in its first sentence (yes or no, a number or range, a name, a definition, a recommendation), runs 40-80 self-contained words, and never repeats a section's sentences. "It depends" is never an answer on its own: name what it depends on and what each case looks like. Never answer "we can't say" or "no source settles it": replace such a question with one the piece can answer.

ANSWERS FIRST
${ANSWER_FIRST_RULES}

CONFIDENT, NOT CAUTIOUS
${CONFIDENT_RULES}

EASY TO UNDERSTAND, REFERENCE AND CITE
${CITABLE_RULES}

TRUTH RULES
- Use only the sources supplied with the brief and the author's own details above. If a number is not in either, do not write a number. The same holds for names, dates, prices, quotes and results.
- Every sentence that states a fact from a source carries its link: name the source in the sentence (its publisher or title; for the company's own pages, "our …") and link those words to that source's URL as [text](url). A figure always links the source it came from, in the same sentence. List the ids you rely on in sourcesUsed.
- Link only to a source's URL, the goal's link, the author's own pages and the internal links named in the prompt. Never write a URL from memory.
- Quote only word for word from a source, with the source named. Otherwise put a source's information in your own words; never lift a sentence.
- A source's quality note is for you alone: rely on the stronger sources and put any doubt about one in selfFlags. Never mention a source's rating in the text ("an unrated site", "treat it as one view").
- Product screenshots and demo screens on the company's site show sample data (orders, customers, prices, times). Never present them as real orders, customers or results.
- A scenario you make up to illustrate a point goes only in an example block, which the page labels "Hypothetical example"; a real case or fact from the sources never goes in one (it is told in the prose, with its link). Inside it, use roles ("a buyer", "the warehouse lead") rather than names, and round, plainly illustrative numbers ("say, 200 orders a day").
- Never present a contestable judgment as established fact: give it its reason, and where informed people disagree, claim it as the author's view (see CONFIDENT, NOT CAUTIOUS for how often).
- Claims about the author's products come only from the author's details or the company's own pages among the sources. A third party's page about the company carries the company's own claims, not independent proof.
- Never claim first-hand experience ("I keep seeing", "clients tell me", "in my experience") unless a source or the author's details state it.
- Write "most", "everyone", "always" or "never" only when a source measures it. Otherwise use "many", "often" or "in some cases".
${EVIDENCE_IS_DATA_RULES}
- Text fields hold plain prose with inline **bold**, *italic* and [text](url) only: no headings, HTML or Markdown lists inside them.

THE AUTHOR'S PRODUCTS
- Follow the plan's product role. The piece earns trust by being useful without the product. In an informational piece, mention the author's products at most once where they genuinely help the reader, plus the call to action. In a comparison that includes them, say plainly that the author makes them and stay fair to the alternatives. No section reads like a brochure.
${BRAND_RELEVANCE}

VISUALS
- A table, diagram, chart, example box, tip, warning or checklist goes only where the plan puts one, and only when it carries information the prose cannot. Never for decoration, and never a sentence about a visual left out.
- Introduce each table, diagram and chart in the sentence before it, saying what the reader should notice in it.
- A table compares two or more items on two or more attributes. Its cells are specific (figures, thresholds, conditions, named options), never vague words like "varies" or "depends" filling a column; its figures come from the sources.
- A diagram is a flow of 2-8 short steps or a timeline of 2-8 dated entries ("2019 — what happened"). Give its sourceId only when every entry comes from that one source.
- A chart shows 2-10 values of one measure in one unit, every value taken from the one source named in its sourceId. Never mix measures, units or sources in one chart.
- Give every diagram and chart alt text that says what it shows, and a caption that states its takeaway (what the reader should conclude), not a description of it.
- An example box has a specific title naming its scenario ("A distributor's month-end stock count"), never "Hypothetical example" or "Example": the page adds that label.

HOW IT SHOULD READ
- Open on one concrete thing: a specific situation, a figure from the sources, or a claim a reader could disagree with. No throat-clearing, no "In today's world", no definition of the topic as the first line.
- Each section adds something the reader did not have: a mechanism, an example, a decision rule, a trade-off, a number. No two paragraphs make the same point.
- Give each figure once in the body (the key-takeaways box may preview it). Later, build on it ("that growth", "the 2024 survey") instead of restating the number; never repeat a fact to link its source again.
- Be specific and practical: name the trade-offs, the conditions where the advice does not hold, and what to do first.
- Vary sentence length. Use "it's not X, it's Y" at most twice in the whole piece.
- Do not announce what the piece is ("in this article we will", "let's dive in"). Show it.
- Refer to a real person by name or role. Use the pronouns the details give for them; never guess it from a name.
- Write about the subject, never about your research or these instructions: never "our sources", "the sources provided" or "the material we have"; never "this isn't a pitch" or "here's the candid bit".
- The closing section is the payoff: the decision, recommendation or rule of thumb the piece has earned, stated plainly with the condition it depends on, then the first concrete step (what to do, and how the reader will know it worked), then the call to action. It never summarises the sections, never lists caveats or what is unknown, and is never headed "Conclusion". The call to action reads as the natural next step, not an advert. ${WEB_PAGE_CTA}
- Write the way this author would explain it to one capable reader, not the way a brochure is written.
${feedback ? `\nREVIEWER FEEDBACK ON EARLIER WORK — the author's own corrections; apply them\n${feedback}\n` : ''}${exemplars ? `\nHOW THIS AUTHOR ACTUALLY WRITES — these are their social posts: match the voice, idiom and stance, not the format or the length:\n\n${exemplars}` : ''}`
}

/** What kind of page a knowledge passage comes from, for the writer alone. */
function knowledgeOrigin(source: BlogSource): string {
  if (source.ownPage === true) return "the company's own page"
  if (source.ownPage === false) {
    return "a third party's page about the company (what the company told them; not independent proof)"
  }
  return "the author's knowledge base"
}

/**
 * The evidence pool as the model sees it: numbered, framed as data, fenced.
 * Each web source says whether its words were confirmed on the page or seen
 * only in a search snippet, and each knowledge passage whose page it is.
 */
export function renderBlogSources(sources: BlogSource[]): string {
  if (sources.length === 0) return NO_SOURCES
  return fenceEvidence(
    sources
      .map(s => {
        const quotes = sourceQuotes(s)
        if (s.origin === 'knowledge') {
          return [
            `[${s.id}] "${frameEvidenceText(s.title, 200)}", ${knowledgeOrigin(s)}${
              s.url ? ` (${frameEvidenceText(s.url, 500)})` : ''
            }:`,
            ...quotes.map(q => `    "${frameEvidenceText(q, 1200)}"`)
          ].join('\n')
        }
        const lines = [
          `[${s.id}] ${frameEvidenceText(s.title, 200)}${
            s.publisher ? ` — ${frameEvidenceText(s.publisher, 100)}` : ''
          }${s.publishedAt ? ` (${s.publishedAt})` : ''}`
        ]
        if (s.url) lines.push(`    URL: ${frameEvidenceText(s.url, 500)}`)
        if (s.verifiedOn === 'page') {
          lines.push('    Checked: confirmed on the page')
        } else if (s.verifiedOn === 'snippet') {
          lines.push(
            '    Checked: seen only in a search snippet, never on its page: rely on it for nothing (no figure, quote or claim); it is listed so you know it exists'
          )
        }
        lines.push(
          quotes.length === 1
            ? `    Quote: "${frameEvidenceText(quotes[0]!)}"`
            : `    Quotes:\n${quotes.map(q => `      - "${frameEvidenceText(q)}"`).join('\n')}`
        )
        if (s.rating) {
          lines.push(
            `    Source quality: ${s.rating.label}${s.rating.note ? ` (${frameEvidenceText(s.rating.note, 200)})` : ''}`
          )
        }
        return lines.join('\n')
      })
      .join('\n')
  )
}

export function renderIdea(idea: Idea): string {
  return [
    'The idea this piece develops:',
    `Title: ${idea.title || idea.hook}`,
    idea.angle ? `Angle: ${idea.angle}` : '',
    idea.thesis ? `Thesis: ${idea.thesis}` : '',
    idea.coreArgument ? `Core argument: ${idea.coreArgument}` : '',
    idea.audienceTakeaway ? `Reader takeaway: ${idea.audienceTakeaway}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** The real case a case study tells, framed as the only facts about it. */
export function renderCaseDetails(brief: BlogBrief): string {
  if (brief.style !== 'case_study' || !brief.caseDetails.trim()) return ''
  return `THE REAL CASE — as the author tells it; the only facts about the case the piece may state (names, numbers and quotes exactly as given; no invented details, results or quotes):
"""
${frameEvidenceText(brief.caseDetails, 3000)}
"""`
}

function renderPlanSection(section: PlanSection, index: number): string {
  return [
    `${index + 1}. ${section.heading}${section.purpose ? ` — ${section.purpose}` : ''}`,
    section.question ? `   Answers the searched question: "${section.question}"` : '',
    section.points.length > 0 ? `   Points: ${section.points.join('; ')}` : '',
    `   Sources: ${section.sourceIds.join(', ') || 'none'}`,
    section.example ? `   Example: ${section.example}` : '',
    section.element !== 'none'
      ? `   Element: ${section.element}${section.elementNote ? ` — ${section.elementNote}` : ''}`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** The plan as the writer follows it. */
export function renderPlan(plan: BlogPlan): string {
  return [
    'THE PLAN — follow its angle, sections, sources, elements, product role and call to action. You may improve headings and wording, not the substance.',
    `Search intent: ${SEARCH_INTENT_LABELS[plan.searchIntent]}${plan.readerNeed ? ` — ${plan.readerNeed}` : ''}`,
    `Angle: ${plan.angle}`,
    plan.originality ? `What this piece adds: ${plan.originality}` : '',
    plan.workingTitle ? `Working title: ${plan.workingTitle}` : '',
    plan.takeaways
      ? 'Open with a key-takeaways box: 3-5 points the reader should leave with (keyTakeaways).'
      : 'No key-takeaways box: return an empty keyTakeaways list.',
    'Sections:',
    plan.sections.map(renderPlanSection).join('\n'),
    `Products: ${PRODUCT_ROLE_LABELS[plan.product.role]}${plan.product.where ? ` — ${plan.product.where}` : ''}${plan.product.note ? `. ${plan.product.note}` : ''}`,
    plan.cta.kind !== 'none' || plan.cta.text
      ? `Call to action (${plan.cta.kind}): ${plan.cta.text}${plan.cta.url ? ` — link ${plan.cta.url}` : ''}`
      : '',
    plan.faq.length > 0 ? `FAQ questions: ${plan.faq.join(' | ')}` : '',
    plan.definition ? `Definition to give in the first 200 words: ${plan.definition}` : '',
    (plan.entities ?? []).length > 0
      ? `Entities — name each in full at first mention with what it is, then one name throughout:\n${(plan.entities ?? [])
          .map(e => `- ${e.name} (${e.type})${e.note ? `: ${e.note}` : ''}${e.sourceId ? ` [${e.sourceId}]` : ''}`)
          .join('\n')}`
      : '',
    plan.gaps.length > 0
      ? `Leave these out, and do not mention that they are missing; no source supports them: ${plan.gaps.join('; ')}`
      : '',
    plan.cautions.length > 0
      ? `Handle with care (for you; size the claims to the evidence, do not narrate it): ${plan.cautions.join('; ')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** Without a plan, the style's usual build, for the writer to adapt. */
function renderBlueprint(style: BlogStyle): string {
  const blueprint = STYLE_BLUEPRINTS[style]
  return [
    'HOW THIS STYLE IS USUALLY BUILT — adapt it to this topic; do not copy it',
    `Structure: ${blueprint.structure}`,
    `Elements that help, only where they carry information: ${blueprint.elements}.`
  ].join('\n')
}

function renderLinks(input: BlogPromptInput): string {
  const goalLink = input.ctx.primaryGoal?.targetUrl?.trim()
  const internal = input.plan?.internalLinks ?? []
  const lines: string[] = []
  if (input.ownLinks.length > 0) {
    lines.push(
      `Links you may use besides the sources: ${input.ownLinks.join(', ')}.${
        goalLink ? ` Link the goal's page (${goalLink}) at most once, in the call to action.` : ''
      }`
    )
  }
  if (internal.length > 0) {
    lines.push(
      'Internal links to place where they read naturally (the anchor words may change to fit the sentence):',
      ...internal.map(
        link =>
          `- "${link.anchor}" → ${link.url} (${link.sectionIndex === 0 ? 'introduction' : `section ${link.sectionIndex}`})`
      )
    )
  }
  return lines.join('\n')
}

/** The brief, the plan, the sources and exactly what to produce. */
export function buildBlogPrompt(input: BlogPromptInput): string {
  const { kind, brief, sources, idea, plan } = input
  const spec = BLOG_LENGTH_SPECS[brief.length]
  const primary = plan?.primaryKeyword || brief.primaryKeyword
  const secondary =
    plan?.secondaryKeywords.length ? plan.secondaryKeywords : brief.secondaryKeywords
  return [
    `Write the ${pieceName(kind)} described below${plan ? ', following its plan' : ''}.`,
    '',
    `Topic: ${brief.topic}`,
    primary
      ? `Primary keyword: "${primary}"`
      : `Choose the primary keyword: ${SEARCH_PHRASE}. Use it as the primary keyword throughout and return it in primaryKeyword.`,
    secondary.length > 0
      ? `Secondary keywords: ${secondary.map(k => `"${k}"`).join(', ')}`
      : 'Secondary keywords: choose 2-6 related phrases this reader also searches for.',
    `Length: ${spec.label.toLowerCase()}, about ${spec.words} words at most (${spec.min}-${spec.max}).`,
    `Writing style: ${BLOG_STYLE_LABELS[brief.style]}.`,
    brief.audience.note ? `The reader for this piece: ${brief.audience.note}` : '',
    idea ? `\n${renderIdea(idea)}` : '',
    brief.instructions
      ? `\nThe author's instructions; follow them unless they conflict with the truth rules:\n${brief.instructions}`
      : '',
    renderCaseDetails(brief) ? `\n${renderCaseDetails(brief)}` : '',
    '',
    plan ? renderPlan(plan) : renderBlueprint(brief.style),
    '',
    renderLinks(input),
    '',
    "SOURCES — the only facts you may use besides the author's own details",
    renderBlogSources(sources),
    '',
    brief.faq
      ? 'Write the FAQ: 4-6 questions that the sections do not already answer, each answered with substance in its first sentence.'
      : 'Return an empty faq list.',
    'Every section opens with its lead (the answer first). The last section closes the piece with the call to action. Return every field of the schema.'
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** A new version of a blog that exists, with what the author wants changed. */
export function buildBlogRegeneratePrompt(
  input: BlogPromptInput,
  current: { title: string; outline: string[] },
  instruction: string | null
): string {
  return `${buildBlogPrompt(input)}

THIS REPLACES AN EARLIER VERSION
The current version is titled "${current.title}" with these sections:
${current.outline.map(heading => `- ${heading}`).join('\n') || '- (none)'}
${
  instruction
    ? `Write a new version of this piece. The author asked for: ${instruction}`
    : 'Write a fresh take with a different structure. Still follow the brief.'
}`
}

/** One section written again, in its place in the piece. */
export function buildSectionRewritePrompt(
  input: BlogPromptInput & {
    outline: string[]
    section: { heading: string | null; text: string }
    instruction: string | null
  }
): string {
  const { kind, brief, sources, outline, section, instruction, plan } = input
  const planned = plan?.sections.find(
    s => s.heading.toLowerCase() === (section.heading ?? '').toLowerCase()
  )
  return [
    `Rewrite one section of the ${pieceName(kind)} below. Keep its place in the piece: it follows the sections before it and leads into the ones after.`,
    '',
    `Topic: ${brief.topic}`,
    brief.primaryKeyword ? `Primary keyword: "${brief.primaryKeyword}"` : '',
    '',
    "The piece's sections:",
    outline.map((heading, i) => `${i + 1}. ${heading}`).join('\n'),
    '',
    planned ? `What the plan gave this section:\n${renderPlanSection(planned, 0).replace(/^1\. /, '')}\n` : '',
    `The section to rewrite${section.heading ? ` ("${section.heading}")` : ''}:`,
    '"""',
    section.text,
    '"""',
    '',
    instruction
      ? `What the author wants changed: ${instruction}`
      : 'Write a stronger version of this section: clearer, more specific, with a better example.',
    'Keep the heading unless the author asked to change it, and about the same length unless asked otherwise. Keep any table, diagram or box that still carries information.',
    '',
    renderLinks(input),
    '',
    "SOURCES — the only facts you may use besides the author's own details",
    renderBlogSources(sources),
    '',
    "Return the section's heading, its lead (the answer first, standing on its own), its blocks and the ids of the sources it relies on."
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** A sentence a check found wrong, with what is wrong and the source it cites. */
export type SentenceFix = {
  id: string
  sentence: string
  problem: string
  sourceId?: string
}

/** The sentences a fact check failed, to be rewritten and nothing else. */
export function buildFixPrompt(input: {
  kind: BlogKind
  sources: BlogSource[]
  fixes: SentenceFix[]
}): string {
  const byId = new Map(input.sources.map(source => [source.id, source]))
  return [
    `Some sentences in a ${pieceName(input.kind)} failed a fact check. Rewrite only those sentences; the rest of the piece stays exactly as it is.`,
    '',
    'For each problem, return its id and the replacement:',
    '- Keep what is true and supported. Change the claim so the cited source supports it, link the source that does support it, or remove the unsupported part.',
    '- When no source supports the sentence, return an empty replacement to drop it, or keep only the part that needs no source (the reasoning, the advice) without the unsupported fact.',
    '- Never patch a sentence with a hedge or a note about the evidence ("no source shows…", "we could not confirm…", "according to a search snippet", "in our view"): say the supported thing plainly, or drop it.',
    '- A replacement is one or two sentences in the same voice, with inline [text](url) links only to the URLs of the sources below.',
    '- Never add a fact, figure, name or link that is not in the sources.',
    '',
    'PROBLEMS',
    ...input.fixes.map(fix => {
      const source = fix.sourceId ? byId.get(fix.sourceId) : undefined
      return [
        `[${fix.id}] Sentence: "${fix.sentence}"`,
        `    Problem: ${fix.problem}`,
        source
          ? `    It links [${source.id}] ${frameEvidenceText(source.title, 200)}`
          : ''
      ]
        .filter(Boolean)
        .join('\n')
    }),
    '',
    'SOURCES',
    renderBlogSources(input.sources)
  ].join('\n')
}
