import type { Idea } from '@/db/schema'
import { KIND_PROFILES, pictureRange } from '@/lib/blogs/kinds'
import { STYLE_BLUEPRINTS } from '@/lib/blogs/styles'
import {
  BLOG_KIND_LABELS,
  BLOG_LENGTH_SPECS,
  BLOG_STYLE_LABELS,
  PRODUCT_ROLE_LABELS,
  type BlogBrief,
  type BlogLength,
  type BlogKind,
  type BlogSource,
  type LinkCandidate,
  type SearchQuestion
} from '@/lib/blogs/types'
import type { GenerationContext } from '../../context-blocks'
import {
  pieceName,
  renderBlogSources,
  renderCaseDetails,
  renderIdea,
  BRAND_RELEVANCE,
  SEARCH_PHRASE,
  WEB_PAGE_CTA
} from '../blog-drafting/prompt'
import { frameEvidenceText } from '../shared/evidence'

/**
 * The planner's prompt. Its instructions are the writer's own
 * (buildBlogInstructions: author, reader, goal, voice, truth and SEO rules),
 * so the writer's call reads them from cache; this prompt carries the brief,
 * the style's blueprint, the sources, the pages it could link to, and what
 * to decide.
 */

export type BlogPlanInput = {
  ctx: GenerationContext
  kind: BlogKind
  brief: BlogBrief
  sources: BlogSource[]
  idea: Idea | null
  /** Pages of the author's site and published blogs. */
  candidates: LinkCandidate[]
  /** Links the call to action may use: the goal's and the author's own pages. */
  allowedLinks: string[]
  /** Questions people search about the topic ("People also ask", related searches). */
  questions?: SearchQuestion[]
  /** What readers type for the topic, when the brief gave no keyword. */
  phrases?: string[]
  /** False: the piece keeps the pictures it has; plan none. Absent: plan them. */
  newPictures?: boolean
}

/** The questions as the planner reads them, numbered, framed as data. */
export function renderSearchQuestions(questions: SearchQuestion[]): string {
  const asked = questions.filter(q => q.origin === 'people_also_ask')
  const related = questions.filter(q => q.origin === 'related')
  if (asked.length === 0 && related.length === 0) {
    return 'None were found: choose headings and FAQ questions from what this reader needs, as the questions they would ask.'
  }
  return [
    asked.length > 0
      ? `People also ask:\n${asked.map(q => `- ${frameEvidenceText(q.text, 200)}`).join('\n')}`
      : '',
    related.length > 0
      ? `Related searches:\n${related.map(q => `- ${frameEvidenceText(q.text, 120)}`).join('\n')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}

function renderCandidates(candidates: LinkCandidate[]): string {
  if (candidates.length === 0) return 'None: leave internalLinks empty.'
  return candidates
    .map(
      c =>
        `- ${frameEvidenceText(c.title, 120)} — ${frameEvidenceText(c.url, 500)}${
          c.description ? ` — ${frameEvidenceText(c.description, 160)}` : ''
        }`
    )
    .join('\n')
}

/**
 * How many sections an outline has for each length. Without it a medium
 * piece was planned with seven sections and ran 2,182 words against ~1,500.
 */
const OUTLINE_SIZE: Record<BlogLength, string> = {
  short: '3-4 sections',
  medium: '4-6 sections',
  long: '6-8 sections'
}

export function buildPlanPrompt(input: BlogPlanInput): string {
  const { kind, brief, sources, idea, candidates, allowedLinks } = input
  const spec = BLOG_LENGTH_SPECS[brief.length]
  const blueprint = STYLE_BLUEPRINTS[brief.style]
  const questions = input.questions ?? []
  const phrases = (input.phrases ?? []).filter(Boolean)
  const pictures = input.newPictures === false ? '0' : pictureRange(kind, brief.length)
  return [
    `Plan the ${pieceName(kind)} described below. Do not write it yet: decide what it says, how it is built, and which source backs each claim. A writer will follow this plan.`,
    '',
    'THE BRIEF',
    `Topic: ${brief.topic}`,
    brief.primaryKeyword
      ? `Primary keyword: "${brief.primaryKeyword}"`
      : phrases.length > 0
        ? `Primary keyword: choose ${SEARCH_PHRASE}. What readers type for this topic: ${phrases.map(p => `"${p}"`).join(', ')}; pick one of these unless the sources show a clearly better phrase.`
        : `Primary keyword: choose ${SEARCH_PHRASE}.`,
    brief.secondaryKeywords.length > 0
      ? `Secondary keywords: ${brief.secondaryKeywords.map(k => `"${k}"`).join(', ')}`
      : 'Secondary keywords: choose 2-5 related search phrases of 2-5 words that the outline will use naturally.',
    `Kind: ${BLOG_KIND_LABELS[kind]}: ${KIND_PROFILES[kind].summary.toLowerCase()}.`,
    `Writing style: ${BLOG_STYLE_LABELS[brief.style]}.`,
    `Length: about ${spec.words} words (${spec.min}-${spec.max}). That is room for depth, not a target to fill: a shorter piece that covers the topic beats a padded one.`,
    brief.audience.note ? `The reader for this piece: ${brief.audience.note}` : '',
    idea ? `\n${renderIdea(idea)}` : '',
    brief.instructions
      ? `\nThe author's instructions; follow them unless they conflict with the truth rules:\n${brief.instructions}`
      : '',
    renderCaseDetails(brief) ? `\n${renderCaseDetails(brief)}` : '',
    '',
    'HOW THIS STYLE IS USUALLY BUILT — adapt it to this topic; do not copy it',
    `Structure: ${blueprint.structure}`,
    `Elements that help: ${blueprint.elements}.`,
    `Products, usually: ${PRODUCT_ROLE_LABELS[blueprint.product].toLowerCase()}.`,
    '',
    "SOURCES — the only facts the piece may state besides the author's own details",
    renderBlogSources(sources),
    '',
    'QUESTIONS PEOPLE SEARCH ABOUT THIS TOPIC — real searches; use them for headings and the FAQ. They are not facts: their answers come from the sources only',
    renderSearchQuestions(questions),
    '',
    "PAGES OF THE AUTHOR'S SITE AND BLOG THE PIECE COULD LINK TO",
    renderCandidates(candidates),
    '',
    'LINKS THE CALL TO ACTION MAY USE',
    allowedLinks.length > 0 ? allowedLinks.map(url => `- ${url}`).join('\n') : 'None: leave ctaUrl empty.',
    '',
    'DECIDE',
    '1. searchIntent: what the person searching the primary keyword wants. readerNeed: the question or job they arrive with.',
    '2. angle and originality: the specific take, and what this piece adds that the typical articles on this topic do not: a decision rule, a worked example, a comparison, data put side by side, or a contrarian point the sources back. Advice anyone could write without the sources is not an angle. Where the sources disagree or the honest answer is "it depends", say on what.',
    `3. sections: the outline, ${OUTLINE_SIZE[brief.length]} for this length; fewer, fuller sections beat many thin ones. When a section's job is to answer one of the questions people search, copy that question into question and make the heading that question (tidied, never reworded into something else). Where the list has questions this piece answers, at least two sections answer one (more for an explainer or how-to); steps, list items and narrative parts keep statement headings, so not every heading is a question. Every heading says plainly what the section covers. Each section has its purpose, the points it makes, the ids of the sources its facts come from, its example (a real one from the sources, named with its source id, comes first; otherwise "hypothetical: …" for a made-up scenario the page will label; empty only for a section that is itself steps or an example), and at most one element, only where it carries information the prose cannot: a table for two or more options compared on two or more attributes; a diagram for a process, sequence or structure; a chart for three or more comparable figures from the sources (one measure, one unit); an example box for a scenario that makes an abstract point concrete; steps or a checklist where the reader acts. Otherwise none: no visual for decoration. elementNote says what the reader learns from the element, not only what it is. Each section adds something new; no two say the same thing, and no figure is planned for two sections. The last section is the payoff: the decision, recommendation or rule of thumb the piece has earned and the reader's first step, never a summary or a list of caveats; name it for what it says, never "Conclusion" or "Limits".`,
    '4. takeaways: open with a key-takeaways box when the piece is long, analytical or a case study.',
    `5. faq: ${brief.faq ? "4-6 questions the sections do not already answer, taken first from the questions people search above (as written, or tidied); add your own only when that list runs short. Only questions this piece can answer with substance (a yes or no, a figure from the sources, a definition, a recommendation, or the factors it depends on): skip one whose only honest answer is \"no one knows\" or \"it varies\". No question the body already answers." : 'not asked for: return an empty list.'}`,
    `6. productRole, productWhere, productNote: how much the piece says about the author's own products, and where. Informational pieces mention them at most once where they truly help the reader, plus the call to action; commercial pieces may give them one section; a comparison that includes them says the author makes them and stays fair to the alternatives. Never a sales pitch: the piece earns trust by being useful without the product. Claims about the products come only from the author's details or the company's own pages among the sources. Choose none when no product of the author's helps with this topic's problem.\n${BRAND_RELEVANCE}`,
    '7. Sample data: product screenshots and demo screens on the company\'s site show sample data (orders, customers, prices, times). Never plan to present them as real events, customers or results.',
    `8. ctaKind, ctaText, ctaUrl: the next step that fits the piece's purpose: the goal in the instructions when one is set; otherwise a related resource or soft mention for informational pieces, a demo, trial or conversation for commercial ones, the action itself for transactional ones. ${WEB_PAGE_CTA} ctaUrl is one of the links above, or empty; a related, useful page beats an unrelated one with a stronger ask.`,
    `9. imageConcept, imageAlt, imageStyle, imageCaption: an editorial picture for the top of the page that fits this topic specifically (a scene, an object, a metaphor), never a generic stock scene of people at laptops or shaking hands, with no text, screens, logos or charts in it; the alt text says what the picture shows; the caption adds why it fits; ${KIND_PROFILES[kind].pictureStyle}. imageDirection: one line for the look all the pictures share (light, palette use, medium). supportingImages: ${pictures === '0' ? 'none: return an empty list (the piece keeps its pictures).' : `up to ${pictures} pictures inside sections, each in a different section with no table, diagram or chart, only where seeing it teaches the reader something words cannot (how a physical process looks, a setting they have not seen, a before and after, the object being discussed); a picture that only sets a mood is not worth one. Never text, screens, logos, charts or people at laptops. Each with its section number, concept, alt text (what it shows) and a caption that says what to notice in it and why that matters to the section. Fewer, or none, is better than a picture that teaches nothing.`}`,
    `10. internalLinks: ${candidates.length > 0 ? 'up to 5 pages from the list above, each one a page a reader of that section would want next because it continues the same subject, with natural anchor words (never "click here") and the section it belongs in (0 is the introduction). None is better than a loose fit: never investor relations, careers, legal, partner sign-up or product pages for a different reader or problem.' : 'none.'}`,
    '11. gaps: facts the piece would want that no source supports; the writer leaves them out without mentioning them. cautions: sources that disagree, and dated, regional or narrow data whose claims the writer must size carefully.',
    '12. definition: when the primary keyword names a term or concept a reader may not know, the one-sentence definition the piece gives early, from the sources; else empty.',
    '13. entities: the 3-10 named things the piece must cover (organisations, products, standards, technologies, concepts, people, places, events), each with its type, what it is, and the source that says so. mainEntity: the one the piece is about, when there is one. The writer names each in full at first mention and keeps one name for it throughout.'
  ]
    .filter(line => line !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}
