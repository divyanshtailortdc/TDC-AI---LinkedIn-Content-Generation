import {
  BLOG_KIND_DEFAULTS,
  type BlogKind,
  type BlogStyle,
  type ProductRole
} from './types'

/**
 * How each writing style is usually built: its structure, the elements that
 * carry information in it, what its research looks for, whether it has an
 * FAQ, and how much it says about the author's own products. Guidance for
 * the planner and the writer, not a template: the plan adapts it to the
 * topic, so two pieces of one style need not share an outline.
 */

export type StyleBlueprint = {
  structure: string
  elements: string
  research: string
  /** on / off, or the kind's own default (blog posts on, articles off). */
  faq: 'on' | 'off' | 'kind'
  /** The usual product role; the plan may choose less, never a pitch. */
  product: ProductRole
}

export const STYLE_BLUEPRINTS: Record<BlogStyle, StyleBlueprint> = {
  how_to: {
    structure:
      'Open with the outcome the reader gets and who the guide is for. Then what they need before starting (access, tools, data). Then the steps in order: one H2 per major step, or one H2 holding a numbered list when the steps are short. Each step says what to do, how, and how to tell it worked. Close with the common mistakes or troubleshooting, and the next step.',
    elements:
      'numbered steps; a checklist of prerequisites; a table when a step differs by situation (by plan, platform or size); a flow diagram only when the order or the branching is hard to follow in text',
    research:
      'official documentation, standards and vendor guides for each step; measured time, cost or error figures; the failure points practitioners report',
    faq: 'on',
    product: 'mention'
  },
  listicle: {
    structure:
      'A short opening that says what the list is for and how the items were chosen. Each item under its own numbered H2 ("1. …") with what it is, why it matters to this reader, and a concrete example or how to apply it. The items are distinct and in a deliberate order (most important first, or the order a reader would use them). Close with how to choose or where to start.',
    elements:
      'a summary table when the items share attributes; an example box where an item needs a scenario to make sense',
    research:
      'evidence for each item: data, studies or documented examples; drop items that only other list posts mention',
    faq: 'on',
    product: 'mention'
  },
  explainer: {
    structure:
      'Answer the core question in plain words within the first paragraphs: what it is, in a sentence or two. Then why it matters to this reader, how it works (the parts, the mechanism, the sequence), one worked example, the common misconceptions or limits, and what to do with this understanding. Define each term the first time it appears.',
    elements:
      'a diagram of how it works (a flow); a table contrasting it with what readers confuse it with; a hypothetical example box that walks one case through',
    research:
      'definitions from standards bodies or authoritative references; data showing its scale or impact; how practitioners describe it',
    faq: 'on',
    product: 'mention'
  },
  comparison: {
    structure:
      'Say early who each option suits and give the verdict (it depends on X: choose A when…, B when…). Put the comparison table near the top. Then one section per criterion this reader weighs, with evidence for each option, and a section on when to choose which. If the author sells one of the options, say so plainly and keep it fair: the real strengths of the alternatives and the real limits of the author\'s own.',
    elements:
      'a comparison table, options as columns and criteria as rows (always); a decision checklist',
    research:
      "each option's documented capabilities, pricing model and limits from its own pages; independent reviews or analyst notes; outcome data",
    faq: 'on',
    product: 'mention'
  },
  industry_analysis: {
    structure:
      'Open with the key findings in a takeaways box. Then the data, dated and sourced, saying what each figure measures; the drivers behind it; what it means for this reader\'s decisions; what to watch next. End with a short note on the limits of the data (sample, region, date).',
    elements:
      'a bar chart when three or more comparable figures come from the sources; a timeline of developments; a table of figures with their sources',
    research:
      'recent, dated data from research firms, official statistics, regulators, company filings and trade press; the original study behind any figure quoted second-hand',
    faq: 'kind',
    product: 'none'
  },
  thought_leadership: {
    structure:
      'State one clear thesis the author would defend, early. Build the argument section by section with evidence and the author\'s reasoning. Take on the strongest objection honestly. Close with what the reader should do differently, and what the author would do.',
    elements:
      'mostly prose; a diagram only when the argument rests on a model or framework; a hypothetical example box for an illustrative scenario',
    research:
      'evidence for and against the thesis: studies, data, documented cases; the best evidence for the strongest counter-argument',
    faq: 'kind',
    product: 'mention'
  },
  opinion: {
    structure:
      'Take the position in the first paragraph, in the author\'s voice. Give the reasons in order of strength, each with its evidence. Represent the main counter-argument fairly and answer it. Close on what follows from the position. Opinions are written as the author\'s view ("I think", "we believe"); the facts inside them are sourced.',
    elements: 'prose; at most one hypothetical example box',
    research:
      'the facts the argument rests on, and the best evidence for the opposing view',
    faq: 'off',
    product: 'none'
  },
  news_analysis: {
    structure:
      'What happened, with dates and the sources that reported it. Why it matters to this reader. What changes, and what does not. What to watch or do next. Only developments the sources report; no speculation stated as fact.',
    elements:
      'a timeline when the story has several dated steps; a table of who is affected and how',
    research:
      "this month's reporting from established outlets, and the primary announcement itself (press release, filing, regulator's notice)",
    faq: 'off',
    product: 'none'
  },
  case_study: {
    structure:
      'A snapshot first (a takeaways box: who, the challenge, what was done, the result). Then the situation before, the challenge, the approach (the decisions and why), the results exactly as given, and the lessons other readers can apply. Close with a call to action that fits. Every fact about the case comes from the case details; nothing is added to them.',
    elements:
      'a snapshot box; a before-and-after table only with figures from the case details; a flow diagram of the approach when it had clear steps',
    research:
      'context for the problem the case addresses (industry benchmarks, data); never facts about the case itself',
    faq: 'off',
    product: 'section'
  }
}

/** Whether a new piece of this kind and style starts with an FAQ. */
export function styleFaqDefault(kind: BlogKind, style: BlogStyle): boolean {
  const faq = STYLE_BLUEPRINTS[style].faq
  return faq === 'kind' ? BLOG_KIND_DEFAULTS[kind].faq : faq === 'on'
}
