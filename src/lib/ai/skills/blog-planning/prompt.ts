import type { Idea } from '@/db/schema'
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
  type LinkCandidate
} from '@/lib/blogs/types'
import type { GenerationContext } from '../../context-blocks'
import {
  pieceName,
  renderBlogSources,
  renderCaseDetails,
  renderIdea,
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
  return [
    `Plan the ${pieceName(kind)} described below. Do not write it yet: decide what it says, how it is built, and which source backs each claim. A writer will follow this plan.`,
    '',
    'THE BRIEF',
    `Topic: ${brief.topic}`,
    brief.primaryKeyword
      ? `Primary keyword: "${brief.primaryKeyword}"`
      : `Primary keyword: choose ${SEARCH_PHRASE}.`,
    brief.secondaryKeywords.length > 0
      ? `Secondary keywords: ${brief.secondaryKeywords.map(k => `"${k}"`).join(', ')}`
      : 'Secondary keywords: choose 2-5 related search phrases of 2-5 words that the outline will use naturally.',
    `Kind: ${BLOG_KIND_LABELS[kind]}.`,
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
    "PAGES OF THE AUTHOR'S SITE AND BLOG THE PIECE COULD LINK TO",
    renderCandidates(candidates),
    '',
    'LINKS THE CALL TO ACTION MAY USE',
    allowedLinks.length > 0 ? allowedLinks.map(url => `- ${url}`).join('\n') : 'None: leave ctaUrl empty.',
    '',
    'DECIDE',
    '1. searchIntent: what the person searching the primary keyword wants. readerNeed: the question or job they arrive with.',
    '2. angle and originality: the specific take, and what this piece adds that the typical articles on this topic do not: a decision rule, a worked example, a comparison, data put side by side, or a contrarian point the sources back. Advice anyone could write without the sources is not an angle. Where the sources disagree or the honest answer is "it depends", say on what.',
    `3. sections: the outline, ${OUTLINE_SIZE[brief.length]} for this length; fewer, fuller sections beat many thin ones. Each heading says what the section covers (questions people search make good headings). Each section has its purpose, the points it makes, the ids of the sources its facts come from, and at most one element, only where it carries information the prose cannot: a table for two or more options compared on two or more attributes; a diagram for a process, sequence or structure; a chart for three or more comparable figures from the sources (one measure, one unit); an example box for a scenario that makes an abstract point concrete; steps or a checklist where the reader acts. Otherwise none: no visual for decoration. Each section adds something new; no two say the same thing. The last section closes the piece with the reader's next step; name it for what it says, never "Conclusion".`,
    '4. takeaways: open with a key-takeaways box when the piece is long, analytical or a case study.',
    `5. faq: ${brief.faq ? '4-6 questions people search about this topic that the sections do not already answer.' : 'not asked for: return an empty list.'}`,
    "6. productRole, productWhere, productNote: how much the piece says about the author's own products, and where. Informational pieces mention them at most once where they truly help the reader, plus the call to action; commercial pieces may give them one section; a comparison that includes them says the author makes them and stays fair to the alternatives. Never a sales pitch: the piece earns trust by being useful without the product. Claims about the products come only from the author's details or the company's own pages among the sources.",
    '7. Sample data: product screenshots and demo screens on the company\'s site show sample data (orders, customers, prices, times). Never plan to present them as real events, customers or results.',
    `8. ctaKind, ctaText, ctaUrl: the next step that fits the piece's purpose: the goal in the instructions when one is set; otherwise a related resource or soft mention for informational pieces, a demo, trial or conversation for commercial ones, the action itself for transactional ones. ${WEB_PAGE_CTA} ctaUrl is one of the links above, or empty.`,
    '9. imageConcept, imageAlt, imageStyle: an editorial picture for the top of the page that fits this topic specifically (a scene, an object, a metaphor), never a generic stock scene of people at laptops, with no text, screens, logos or charts in it; the alt text says what the picture shows; photo or illustration, whichever suits the subject.',
    `10. internalLinks: ${candidates.length > 0 ? '2-5 pages from the list above that a reader of a given section would want next, each with natural anchor words (never "click here") and the section it belongs in (0 is the introduction).' : 'none.'}`,
    '11. gaps: facts the piece would want that no source supports; the writer will not state them. cautions: sources that disagree, dated or narrow data, figures seen only in a search snippet.'
  ]
    .filter(line => line !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}
