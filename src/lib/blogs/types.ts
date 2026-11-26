import type { SourceRating } from '../research/source-credibility'
import type { BlogDoc } from './doc'

/**
 * Blogs and articles: long-form, SEO-ready pieces an identity writes for its
 * own website, kept apart from social posts (src/lib/formats). Plain data and
 * types only, so pages, the editor and the server all read the same values.
 * See docs/superpowers/specs/2026-11-24-blogs-and-articles-design.md.
 */

export const BLOG_KINDS = ['blog', 'article'] as const
export type BlogKind = (typeof BLOG_KINDS)[number]

export const BLOG_KIND_LABELS: Record<BlogKind, string> = {
  blog: 'Blog post',
  article: 'Article'
}

export const BLOG_LENGTHS = ['short', 'medium', 'long'] as const
export type BlogLength = (typeof BLOG_LENGTHS)[number]

/**
 * How long each length is, in words, counting the introduction, sections,
 * conclusion and FAQ; the SEO check warns outside min-max (±20%), and the
 * structure check wants at least `minSections` section headings.
 */
export const BLOG_LENGTH_SPECS: Record<
  BlogLength,
  {
    label: string
    words: number
    min: number
    max: number
    minSections: number
  }
> = {
  short: { label: 'Short', words: 800, min: 640, max: 960, minSections: 2 },
  medium: {
    label: 'Medium',
    words: 1500,
    min: 1200,
    max: 1800,
    minSections: 3
  },
  long: { label: 'Long', words: 2500, min: 2000, max: 3000, minSections: 3 }
}

/**
 * What changes with the kind besides how it reads (the prompt): the form's
 * starting length and FAQ, and the structured data type of the exported page.
 */
export const BLOG_KIND_DEFAULTS: Record<
  BlogKind,
  { length: BlogLength; faq: boolean; schemaType: 'BlogPosting' | 'Article' }
> = {
  blog: { length: 'medium', faq: true, schemaType: 'BlogPosting' },
  article: { length: 'long', faq: false, schemaType: 'Article' }
}

export const BLOG_STYLES = [
  'how_to',
  'listicle',
  'explainer',
  'comparison',
  'industry_analysis',
  'thought_leadership',
  'opinion',
  'news_analysis',
  'case_study'
] as const
export type BlogStyle = (typeof BLOG_STYLES)[number]

export const BLOG_STYLE_LABELS: Record<BlogStyle, string> = {
  how_to: 'How-to guide',
  listicle: 'List post',
  explainer: 'Explainer (educational)',
  comparison: 'Comparison',
  industry_analysis: 'Industry analysis',
  thought_leadership: 'Thought leadership',
  opinion: 'Opinion',
  news_analysis: 'News analysis',
  case_study: 'Case study'
}

/**
 * What the person searching wants: to learn (informational), to weigh options
 * before buying (commercial), to act now (transactional) or to reach a known
 * page (navigational). It shapes the structure, the product mentions and the
 * call to action. Empty for blogs written before it was recorded.
 */
export const SEARCH_INTENTS = [
  'informational',
  'commercial',
  'transactional',
  'navigational'
] as const
export type SearchIntent = (typeof SEARCH_INTENTS)[number]

export const SEARCH_INTENT_LABELS: Record<SearchIntent, string> = {
  informational: 'Informational',
  commercial: 'Commercial',
  transactional: 'Transactional',
  navigational: 'Navigational'
}

export const isSearchIntent = (value: unknown): value is SearchIntent =>
  typeof value === 'string' &&
  (SEARCH_INTENTS as readonly string[]).includes(value)

/** Publishing, set by the user: blogs are published by hand, outside the app. */
export const BLOG_STATUSES = ['draft', 'published'] as const
export type BlogStatus = (typeof BLOG_STATUSES)[number]

export const BLOG_GENERATION_STATUSES = [
  'generating',
  'ready',
  'failed'
] as const
export type BlogGenerationStatus = (typeof BLOG_GENERATION_STATUSES)[number]

export const BLOG_GENERATION_STAGES = [
  'research',
  'knowledge',
  'planning',
  'writing',
  'checking'
] as const
export type BlogGenerationStage = (typeof BLOG_GENERATION_STAGES)[number]

export const BLOG_STAGE_LABELS: Record<BlogGenerationStage, string> = {
  research: 'Researching the web',
  knowledge: 'Reading your knowledge base',
  planning: 'Planning the piece',
  writing: 'Writing',
  checking: 'Checking facts and sources'
}

/**
 * A generation still running this long after its claim belongs to a process
 * that stopped (a restart, a frozen function): it may be taken over.
 */
export const BLOG_GENERATION_STALE_MS = 480_000

/** Caps on what the browser may send; the database columns are unbounded text. */
export const BLOG_LIMITS = {
  topic: 300,
  keyword: 80,
  secondaryKeywords: 10,
  instructions: 1000,
  audienceNote: 300,
  title: 200,
  metaTitle: 200,
  metaDescription: 500,
  slug: 120,
  faqItems: 12,
  faqQuestion: 300,
  faqAnswer: 2000,
  docJsonChars: 400_000,
  url: 2000,
  caseDetails: 3000,
  altText: 300,
  caption: 300
} as const

/** What the user asked for when the blog was started; kept for regenerations. */
export type BlogBrief = {
  topic: string
  /** Empty: the model picks the phrase this reader would search for. */
  primaryKeyword: string
  secondaryKeywords: string[]
  length: BlogLength
  style: BlogStyle
  /**
   * `audienceId` null with an empty note: all the identity's audiences. A
   * note: someone else, described by the user.
   */
  audience: { audienceId: string | null; note: string }
  research: boolean
  knowledge: boolean
  faq: boolean
  instructions: string
  /**
   * For a case study: the real case as the user tells it (who, the problem,
   * what was done, the results). The only case facts the piece may state.
   * Empty for other styles, and for blogs briefed before it existed.
   */
  caseDetails: string
}

export type FaqItem = { question: string; answer: string }

/**
 * One item of the evidence a blog is written from: a web finding or an idea's
 * evidence (`S1`…), or a knowledge-base passage (`K1`…). `quote` is the text
 * the model may draw on; `cited` marks the ones the blog relies on.
 */
export type BlogSource = {
  id: string
  origin: 'web' | 'idea' | 'knowledge'
  title: string
  url: string | null
  publisher?: string
  quote: string
  /**
   * Every passage taken from this page, `quote` first: several findings
   * from one page are one source. Absent on sources gathered before.
   */
  quotes?: string[]
  /**
   * Where the words were checked: on the page itself, or only in a search
   * result's snippet (a figure there is attributed, not stated as fact).
   */
  verifiedOn?: 'page' | 'snippet'
  /** A knowledge passage from the identity's own site (not a third party's page about it). */
  ownPage?: boolean
  publishedAt?: string
  rating?: SourceRating
  cited: boolean
}

/** Every passage a source gives, the main one first. */
export function sourceQuotes(source: BlogSource): string[] {
  const quotes = (source.quotes ?? []).filter(q => q.trim())
  if (quotes.length > 0) return quotes
  return source.quote.trim() ? [source.quote] : []
}

// ---------------------------------------------------------------------------
// The plan a piece is written from (src/lib/ai/skills/blog-planning)
// ---------------------------------------------------------------------------

/** What a section carries besides prose, chosen only where it informs. */
export const PLAN_ELEMENTS = [
  'none',
  'table',
  'diagram',
  'chart',
  'example',
  'steps',
  'checklist',
  'callout'
] as const
export type PlanElement = (typeof PLAN_ELEMENTS)[number]

/** How much of the piece is about the company's own products. */
export const PRODUCT_ROLES = ['none', 'mention', 'section', 'cta_only'] as const
export type ProductRole = (typeof PRODUCT_ROLES)[number]

export const PRODUCT_ROLE_LABELS: Record<ProductRole, string> = {
  none: 'Not mentioned',
  mention: 'Mentioned where it helps',
  section: 'One section',
  cta_only: 'Only in the call to action'
}

export const CTA_KINDS = [
  'demo',
  'trial',
  'contact',
  'resource',
  'subscribe',
  'conversation',
  'none'
] as const
export type CtaKind = (typeof CTA_KINDS)[number]

export type PlanSection = {
  heading: string
  /** What the section does for the reader. */
  purpose: string
  points: string[]
  /** The sources (S1, K2…) its facts come from. */
  sourceIds: string[]
  element: PlanElement
  /** What the element shows, when there is one. */
  elementNote: string
  /**
   * The searched question this section answers (copied from the search
   * questions), or empty. Absent on plans made before questions existed.
   */
  question?: string
  /**
   * The concrete example it uses: a real one with its source id ("S3: …") or
   * "hypothetical: …"; empty for a section that is itself steps or an example.
   */
  example?: string
}

/** What a named thing in a piece is; maps to a schema.org type in JSON-LD. */
export const ENTITY_TYPES = [
  'organization',
  'product',
  'standard',
  'technology',
  'concept',
  'person',
  'place',
  'event'
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

/** A named thing the piece covers: named in full and defined at first mention. */
export type PlanEntity = {
  name: string
  type: EntityType
  /** What it is, from the sources or the author's details. */
  note: string
  /** The source that says what it is, when one does. */
  sourceId: string
}

/** A picture planned for one section: a scene or object, never text or data. */
export type PlannedImage = {
  /** 1 = the first section… */
  sectionIndex: number
  concept: string
  alt: string
  caption: string
  style: 'photo' | 'illustration'
}

/** A page of the company's site (or a published blog) the piece should link to. */
export type InternalLinkPick = {
  url: string
  anchor: string
  /** 0 = the introduction, 1 = the first section… */
  sectionIndex: number
  reason: string
}

export type BlogPlan = {
  searchIntent: SearchIntent
  /** The keyword the brief gave, or the one the plan chose. */
  primaryKeyword: string
  secondaryKeywords: string[]
  /** The question or job the reader arrives with. */
  readerNeed: string
  /** The specific take of this piece. */
  angle: string
  /** What it adds that typical coverage of the topic lacks. */
  originality: string
  workingTitle: string
  sections: PlanSection[]
  /** Open with a key-takeaways box. */
  takeaways: boolean
  faq: string[]
  product: { role: ProductRole; where: string; note: string }
  cta: { kind: CtaKind; text: string; url: string | null }
  featuredImage: {
    concept: string
    alt: string
    style: 'photo' | 'illustration'
    /** Absent on plans made before captions were planned. */
    caption?: string
  }
  internalLinks: InternalLinkPick[]
  /** Facts the piece would want but no source supports: never stated. */
  gaps: string[]
  cautions: string[]
  /**
   * When the primary keyword names a term: the one-sentence definition the
   * piece gives in its first 200 words. Empty otherwise; absent on older plans.
   */
  definition?: string
  /** The named things the piece covers; absent on older plans. */
  entities?: PlanEntity[]
  /** The entity the piece is about (one of `entities`), or empty. */
  mainEntity?: string
  /** One line for the look of the whole picture set, so the pictures match. */
  imageDirection?: string
  /** Pictures for sections, 0-3; absent on older plans. */
  supportingImages?: PlannedImage[]
}

// ---------------------------------------------------------------------------
// Search questions (src/lib/ai/pipeline/blog-questions.ts)
// ---------------------------------------------------------------------------

/**
 * A question people search about the topic: Google's "People also ask" or a
 * related search. Only the words are kept: the answer boxes come from pages
 * of any quality and are never sources.
 */
export type SearchQuestion = {
  text: string
  origin: 'people_also_ask' | 'related'
}

// ---------------------------------------------------------------------------
// Internal links
// ---------------------------------------------------------------------------

/** A page a blog could link to: the company's site, an offering, a published blog. */
export type LinkCandidate = {
  url: string
  title: string
  description?: string
  kind: 'page' | 'offering' | 'blog'
}

/** One of the identity's drafts on a related subject: worth a link once published. */
export type RelatedDraft = { blogId: string; title: string }

/** A suggested internal link, and whether the text already carries it. */
export type InternalLink = {
  url: string
  title: string
  anchor: string
  reason: string
  placed: boolean
}

// ---------------------------------------------------------------------------
// Featured image
// ---------------------------------------------------------------------------

/**
 * The piece's featured image as stored: `src` is a `storage://` key or a
 * data URL (src/lib/media/image-store.ts). A failed attempt keeps why, so
 * the editor can offer Make again. Null: none.
 */
export type FeaturedImage =
  | {
      status: 'ready'
      src: string
      alt: string
      caption: string
      width: number
      height: number
      mediaType: string
      model: string | null
      prompt: string
      createdAt: string
    }
  | { status: 'failed'; error: string; alt: string; prompt: string }

/** The featured image as a page shows it: `src` is a link or data URL a browser can load. */
export type FeaturedImageView = {
  src: string
  alt: string
  caption: string
  width: number
  height: number
}

/**
 * A picture made for a section (blogs.images). The list only grows: the
 * document's image nodes name a picture by `id` and carry their own alt text
 * and caption, so an earlier version still finds its pictures. `src` is a
 * `storage://` key or a data URL, like the featured image's.
 */
export type BlogImage = {
  id: string
  src: string
  width: number
  height: number
  mediaType: string
  model: string | null
  prompt: string
  concept: string
  createdAt: string
  /** The vision check still saw problems after the retry: worth a look. */
  flagged?: boolean
}

/** A picture as renderers and the editor see it: where to load it, and its size. */
export type BlogImageView = { src: string; width: number; height: number }

// ---------------------------------------------------------------------------
// Verification (src/lib/blogs/citations.ts, src/lib/ai/skills/blog-verification)
// ---------------------------------------------------------------------------

export const CITATION_VERDICTS = ['supported', 'partial', 'unsupported'] as const
export type CitationVerdict = (typeof CITATION_VERDICTS)[number]

export const VERIFICATION_ISSUES = [
  'fact_without_source',
  'hypothetical_as_fact',
  'sample_data_as_real',
  'opinion_as_fact',
  'figure_not_in_source',
  'uncited_figure',
  'unlabelled_specific',
  'generic_passage',
  'repeats_earlier_point'
] as const
export type VerificationIssueKind = (typeof VERIFICATION_ISSUES)[number]

export type BlogVerification = {
  checkedAt: string
  /** Each sentence linked to a source, and whether that source says it. */
  citations: Array<{
    sourceId: string
    sentence: string
    verdict: CitationVerdict
    reason: string
  }>
  /** What else needs the author's eye before publishing. */
  issues: Array<{ sentence: string; issue: VerificationIssueKind; note: string }>
  /** Links taken off sentences their source does not support. */
  removedLinks: Array<{ sourceId: string; sentence: string }>
}

/** A blog as the renderers, checks and exports read it. */
export type BlogContent = {
  kind: BlogKind
  title: string
  slug: string
  metaTitle: string
  metaDescription: string
  primaryKeyword: string
  keywords: string[]
  searchIntent: SearchIntent | ''
  content: BlogDoc
  faq: FaqItem[]
  sources: BlogSource[]
  featuredImage: FeaturedImageView | null
  /** The last check of its citations; null before one ran (older blogs). */
  verification: BlogVerification | null
  /**
   * The section pictures by id, as the renderer should load them (a signed
   * link, a data URL, or an export's file name). Absent: none resolve, and
   * image nodes render as nothing.
   */
  images?: Record<string, BlogImageView>
  /** The named things the plan said it covers, for structured data. */
  entities?: PlanEntity[]
  /** The one it is about, when there is one. */
  mainEntity?: string
}

/** What replaced an earlier version of a blog (blog_revisions.replaced_by). */
export const BLOG_REPLACED_BY = [
  'user_edit',
  'regenerate',
  'section_rewrite',
  'restore',
  'image'
] as const
export type BlogReplacedBy = (typeof BLOG_REPLACED_BY)[number]

/**
 * The text an earlier version keeps (blog_revisions.snapshot). Versions saved
 * before search intent and featured images existed have neither.
 */
export type BlogSnapshot = Omit<
  BlogContent,
  | 'kind'
  | 'sources'
  | 'searchIntent'
  | 'featuredImage'
  | 'verification'
  | 'images'
  | 'entities'
  | 'mainEntity'
> & {
  wordCount: number
  searchIntent?: SearchIntent | ''
  featuredImage?: FeaturedImage | null
}

/** Generating, under a claim made more than BLOG_GENERATION_STALE_MS ago. */
export function isGenerationStale(
  row: {
    generationStatus: string
    generationStartedAt: Date | string | null
  },
  now: number = Date.now()
): boolean {
  if (row.generationStatus !== 'generating') return false
  if (!row.generationStartedAt) return true
  const started = new Date(row.generationStartedAt).getTime()
  return Number.isNaN(started) || now - started > BLOG_GENERATION_STALE_MS
}

/**
 * What the blog page keys its editor by: a new version of the text, a run
 * started, failed or stopped all open the editor afresh from the server's
 * copy, so it never keeps a state the server has moved past.
 */
export function blogViewKey(blog: {
  lockVersion: number
  generationStatus: string
  generationStartedAt: Date | string | null
  stale: boolean
}): string {
  const started = blog.generationStartedAt
    ? new Date(blog.generationStartedAt).getTime()
    : 0
  return `${blog.lockVersion}:${blog.generationStatus}:${started}:${blog.stale ? 'stale' : 'live'}`
}
