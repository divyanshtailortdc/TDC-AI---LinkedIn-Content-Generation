'use client'

import { Button } from '@/components/button'
import { PageHeader } from '@/components/page-header'
import { markDataChanged } from '@/components/refresh-on-back'
import { newRequestId } from '@/lib/blogs/input'
import { styleFaqDefault } from '@/lib/blogs/styles'
import {
  BLOG_KIND_DEFAULTS,
  BLOG_KIND_LABELS,
  BLOG_KINDS,
  BLOG_LENGTH_SPECS,
  BLOG_LENGTHS,
  BLOG_LIMITS,
  BLOG_STYLE_LABELS,
  BLOG_STYLES,
  type BlogKind,
  type BlogLength,
  type BlogStyle
} from '@/lib/blogs/types'
import { Select, TextArea, TextField } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import {
  ArrowLeft,
  FileText,
  Library,
  Lightbulb,
  MessageSquareText,
  Shapes,
  Sparkles,
  Tag,
  Users,
  type LucideIcon
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition, type ReactNode } from 'react'
import { createBlog } from '../actions'
import type { NewBlogOptions } from '../blogs-data'
import { KeywordInput } from '../keyword-input'

const KIND_NOTES: Record<BlogKind, string> = {
  blog: 'Conversational and practical: written to the reader, short paragraphs, clear steps, an FAQ.',
  article: 'Authoritative and in-depth: more sources, context and counter-arguments, section by section.'
}

const STYLE_NOTES: Record<BlogStyle, string> = {
  how_to: 'Steps in order, with how to tell each worked and the mistakes to avoid.',
  listicle: 'Distinct, numbered items, each with an example.',
  explainer: 'What it is, why it matters and how it works, with a worked example.',
  comparison: 'Options side by side in a table, judged on what matters, with a verdict.',
  industry_analysis: 'Dated data, what drives it and what it means for your readers.',
  thought_leadership: 'One thesis you would defend, argued with evidence.',
  opinion: 'Your position, your reasons, and the strongest objection answered.',
  news_analysis: 'What happened recently, why it matters and what to watch.',
  case_study: 'A real customer story, told only from the details you give.'
}

const OTHER_READER = 'other'
const ALL_READERS = 'all'

export function NewBlogForm({ options }: { options: NewBlogOptions }) {
  const router = useRouter()
  const prefill = options.prefill
  const brief = prefill?.brief ?? {}
  // Made once per form: a double click or a resent request makes one blog.
  const [requestId] = useState(() => newRequestId())

  const [kind, setKind] = useState<BlogKind>(prefill?.kind ?? 'blog')
  const [topic, setTopic] = useState(brief.topic ?? '')
  const [primaryKeyword, setPrimaryKeyword] = useState(
    brief.primaryKeyword ?? ''
  )
  const [keywords, setKeywords] = useState<string[]>(
    brief.secondaryKeywords ?? []
  )
  const [length, setLength] = useState<BlogLength>(
    brief.length ?? BLOG_KIND_DEFAULTS[prefill?.kind ?? 'blog'].length
  )
  const [lengthChosen, setLengthChosen] = useState(
    Boolean(prefill && 'style' in brief)
  )
  const [style, setStyle] = useState<BlogStyle>(brief.style ?? 'how_to')
  const [reader, setReader] = useState<string>(
    brief.audience?.audienceId ??
      (brief.audience?.note ? OTHER_READER : ALL_READERS)
  )
  const [readerNote, setReaderNote] = useState(brief.audience?.note ?? '')
  const [goalId, setGoalId] = useState(prefill?.goalId ?? '')
  const [research, setResearch] = useState(
    options.researchAvailable && (brief.research ?? true)
  )
  const [knowledge, setKnowledge] = useState(
    options.knowledgeCount > 0 && (brief.knowledge ?? true)
  )
  const [faq, setFaq] = useState(
    brief.faq ??
      styleFaqDefault(prefill?.kind ?? 'blog', brief.style ?? 'how_to')
  )
  const [faqChosen, setFaqChosen] = useState(
    Boolean(prefill && 'style' in brief)
  )
  const [instructions, setInstructions] = useState(brief.instructions ?? '')
  const [caseDetails, setCaseDetails] = useState(brief.caseDetails ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const chooseKind = (next: BlogKind) => {
    setKind(next)
    // The kind's own starting length and FAQ, unless already chosen by hand.
    if (!lengthChosen) setLength(BLOG_KIND_DEFAULTS[next].length)
    if (!faqChosen) setFaq(styleFaqDefault(next, style))
  }
  const chooseStyle = (next: BlogStyle) => {
    setStyle(next)
    // Opinion, news and case studies start without an FAQ, unless chosen by hand.
    if (!faqChosen) setFaq(styleFaqDefault(kind, next))
  }

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const result = await createBlog({
        requestId,
        kind,
        ideaId: prefill?.ideaId ?? null,
        goalId: goalId || null,
        brief: {
          topic,
          primaryKeyword,
          secondaryKeywords: keywords,
          length,
          style,
          audience: {
            audienceId:
              reader !== ALL_READERS && reader !== OTHER_READER ? reader : null,
            note: reader === OTHER_READER ? readerNote : ''
          },
          research,
          knowledge,
          faq,
          instructions,
          caseDetails: style === 'case_study' ? caseDetails : ''
        }
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      markDataChanged()
      router.push(`/blogs/${result.id}`)
    })
  }

  const caseMissing = style === 'case_study' && caseDetails.trim().length < 40
  const ready =
    options.aiAvailable && topic.trim().length > 0 && !caseMissing && !pending

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        preTitle={
          <Link
            href="/blogs"
            aria-label="Back to Blogs & Articles"
            className="text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
        title="New blog or article"
        description="Researched, SEO-ready and written in your voice"
      />
      <div className="bg-background flex-1 overflow-y-auto px-4 pt-4 sm:px-6 sm:pt-6">
        <form
          className="mx-auto max-w-3xl space-y-4 sm:space-y-5"
          onSubmit={event => {
            event.preventDefault()
            if (ready) submit()
          }}
        >
          {prefill?.ideaTitle && (
            <p className="border-brand/25 bg-brand/5 text-muted flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm">
              <Lightbulb
                aria-hidden
                className="text-brand mt-0.5 h-4 w-4 shrink-0"
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                From the idea{' '}
                <span className="text-foreground font-medium">
                  {prefill.ideaTitle}
                </span>
                . Its sources are used too.
              </span>
            </p>
          )}

          <Section
            icon={FileText}
            title="What to write"
            description="The kind of piece and what it is about."
          >
            <fieldset>
              <legend className="text-foreground mb-2 text-sm font-medium">
                Type
              </legend>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {BLOG_KINDS.map(option => (
                  <ChoiceCard
                    key={option}
                    name="kind"
                    checked={kind === option}
                    onChange={() => chooseKind(option)}
                    title={BLOG_KIND_LABELS[option]}
                    note={KIND_NOTES[option]}
                  />
                ))}
              </div>
            </fieldset>
            <Field label="Topic" hint={`${topic.length}/${BLOG_LIMITS.topic}`}>
              {id => (
                <TextArea
                  id={id}
                  required
                  rows={2}
                  maxRows={8}
                  maxLength={BLOG_LIMITS.topic}
                  value={topic}
                  onChange={event => setTopic(event.target.value)}
                  placeholder="e.g. How small online shops can cut cart abandonment"
                />
              )}
            </Field>
          </Section>

          <Section
            icon={Tag}
            title="Keywords"
            description="What readers search for, so the piece can be found."
          >
            <Field
              label="Primary keyword"
              hint="Optional: leave it empty and the AI picks one"
            >
              {id => (
                <TextField
                  id={id}
                  maxLength={BLOG_LIMITS.keyword}
                  value={primaryKeyword}
                  onChange={event => setPrimaryKeyword(event.target.value)}
                  placeholder="e.g. cart abandonment"
                />
              )}
            </Field>
            <Field
              label="Secondary keywords"
              hint={`${keywords.length}/${BLOG_LIMITS.secondaryKeywords} · press Enter to add`}
            >
              {id => (
                <KeywordInput id={id} value={keywords} onChange={setKeywords} />
              )}
            </Field>
          </Section>

          <Section
            icon={Shapes}
            title="Shape"
            description="How long it runs and how it is laid out."
          >
            <fieldset>
              <legend className="text-foreground mb-2 text-sm font-medium">
                Length
              </legend>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {BLOG_LENGTHS.map(option => (
                  <ChoiceCard
                    key={option}
                    name="length"
                    checked={length === option}
                    onChange={() => {
                      setLength(option)
                      setLengthChosen(true)
                    }}
                    title={BLOG_LENGTH_SPECS[option].label}
                    note={`About ${BLOG_LENGTH_SPECS[option].words.toLocaleString('en-US')} words`}
                  />
                ))}
              </div>
            </fieldset>
            <Field label="Writing style">
              {id => (
                <>
                  <Select
                    id={id}
                    value={style}
                    aria-describedby={`${id}-note`}
                    onChange={event => chooseStyle(event.target.value as BlogStyle)}
                  >
                    {BLOG_STYLES.map(option => (
                      <option key={option} value={option}>
                        {BLOG_STYLE_LABELS[option]}
                      </option>
                    ))}
                  </Select>
                  <p id={`${id}-note`} className="text-muted text-xs leading-relaxed">
                    {STYLE_NOTES[style]}
                  </p>
                </>
              )}
            </Field>
            {style === 'case_study' && (
              <Field
                label="The real case"
                hint={`Required · ${caseDetails.length}/${BLOG_LIMITS.caseDetails}`}
              >
                {id => (
                  <TextArea
                    id={id}
                    rows={5}
                    maxLength={BLOG_LIMITS.caseDetails}
                    value={caseDetails}
                    aria-invalid={caseDetails.length > 0 && caseMissing}
                    onChange={event => setCaseDetails(event.target.value)}
                    placeholder="Who the customer is (or how to describe them if unnamed), the problem, what was done and the results with real figures. Only what is true and approved to share: nothing else about the case is written."
                  />
                )}
              </Field>
            )}
          </Section>

          <Section
            icon={Users}
            title="Reader and goal"
            description="Who it speaks to, and what it should lead them to do."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Who it is for">
                {id => (
                  <Select
                    id={id}
                    value={reader}
                    onChange={event => setReader(event.target.value)}
                  >
                    <option value={ALL_READERS}>
                      {options.audiences.length
                        ? 'All my audiences'
                        : 'My audience (not set up yet)'}
                    </option>
                    {options.audiences.map(audience => (
                      <option
                        key={audience.id}
                        value={audience.id}
                        title={audience.name}
                      >
                        {shorten(audience.name)}
                      </option>
                    ))}
                    <option value={OTHER_READER}>Someone else…</option>
                  </Select>
                )}
              </Field>
              <Field label="Goal" hint="Its call to action closes the piece">
                {id => (
                  <Select
                    id={id}
                    value={goalId}
                    onChange={event => setGoalId(event.target.value)}
                  >
                    <option value="">No specific goal</option>
                    {options.goals.map(goal => (
                      <option key={goal.id} value={goal.id} title={goal.title}>
                        {shorten(goal.title)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {reader === OTHER_READER && (
              <Field
                label="Describe the reader"
                hint={`${readerNote.length}/${BLOG_LIMITS.audienceNote}`}
              >
                {id => (
                  <TextField
                    id={id}
                    maxLength={BLOG_LIMITS.audienceNote}
                    value={readerNote}
                    onChange={event => setReaderNote(event.target.value)}
                    placeholder="e.g. first-time founders selling on Shopify"
                  />
                )}
              </Field>
            )}
          </Section>

          <Section
            icon={Library}
            title="Sources"
            description="Where the facts and examples come from."
          >
            <div className="divide-border -my-1 divide-y">
              <Toggle
                label="Research the web"
                note={
                  options.researchAvailable
                    ? 'Finds facts, figures and examples on the topic, and cites them with links.'
                    : 'Web research needs a search key (SERPER_API_KEY).'
                }
                checked={research}
                disabled={!options.researchAvailable}
                onChange={setResearch}
              />
              <Toggle
                label="Use my knowledge base"
                note={
                  options.knowledgeCount > 0
                    ? `Draws on the closest passages of your ${options.knowledgeCount} knowledge ${options.knowledgeCount === 1 ? 'document' : 'documents'}.`
                    : 'Your knowledge base is empty.'
                }
                checked={knowledge}
                disabled={options.knowledgeCount === 0}
                onChange={setKnowledge}
              />
              <Toggle
                label="Include an FAQ"
                note="Questions people search for, answered briefly; also marked up for search engines."
                checked={faq}
                onChange={value => {
                  setFaq(value)
                  setFaqChosen(true)
                }}
              />
            </div>
          </Section>

          <Section
            icon={MessageSquareText}
            title="Anything else"
            description="Optional notes for the writer."
          >
            <Field
              label="Extra instructions"
              hint={`Optional · ${instructions.length}/${BLOG_LIMITS.instructions}`}
            >
              {id => (
                <TextArea
                  id={id}
                  rows={3}
                  maxLength={BLOG_LIMITS.instructions}
                  value={instructions}
                  onChange={event => setInstructions(event.target.value)}
                  placeholder="e.g. Mention our free checkout audit. Avoid jargon."
                />
              )}
            </Field>
          </Section>

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-400"
            >
              {error}
            </p>
          )}
          {!options.aiAvailable && (
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
              AI is not set up: add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY.
            </p>
          )}

          {/* Stays in view at the foot of the screen while the form scrolls;
              the page fades out under it. Room is kept on the right for the
              floating Help button until the form sits clear of it. */}
          <div className="sticky bottom-0 z-10 -mx-4 bg-[linear-gradient(to_top,var(--background)_70%,transparent)] pt-4 sm:-mx-2 sm:pb-6">
            <div className="border-border bg-surface/95 flex flex-col gap-3 border-t py-3 pr-16 pl-4 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.18)] backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:rounded-2xl sm:border sm:pl-5 xl:pr-5">
              <p className="text-muted text-xs leading-relaxed">
                {caseMissing
                  ? 'Describe the real case (at least 40 characters) to continue.'
                  : !topic.trim()
                    ? 'Add a topic to continue.'
                    : 'Usually 2-3 minutes · about $0.35-0.70 with pictures'}
              </p>
              <Button
                type="submit"
                disabled={!ready}
                loading={pending}
                className="w-full sm:w-auto"
              >
                <Sparkles aria-hidden className="h-4 w-4" />
                Generate
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Audience and goal names can be a whole paragraph; menus show the start. */
const shorten = (text: string, max = 90) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

function Section({
  icon: Icon,
  title,
  description,
  children
}: {
  icon: LucideIcon
  title: string
  description?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      className="border-border bg-surface rounded-2xl border shadow-xs"
    >
      <div className="border-border flex items-start gap-3 border-b px-4 py-3.5 sm:px-5">
        <span className="bg-brand/10 text-brand flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <Icon aria-hidden className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-foreground text-sm font-semibold">
            {title}
          </h2>
          {description && (
            <p className="text-muted mt-0.5 text-xs">{description}</p>
          )}
        </div>
      </div>
      <div className="space-y-5 p-4 sm:p-5">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <label htmlFor={id} className="text-foreground text-sm font-medium">
          {label}
        </label>
        {hint && <span className="text-muted text-xs tabular-nums">{hint}</span>}
      </div>
      {children(id)}
    </div>
  )
}

function ChoiceCard({
  name,
  checked,
  onChange,
  title,
  note
}: {
  name: string
  checked: boolean
  onChange: () => void
  title: string
  note: string
}) {
  return (
    <label
      className={cn(
        'border-border hover:border-muted/60 has-[:focus-visible]:ring-brand/30 flex cursor-pointer flex-col gap-1 rounded-xl border px-3.5 py-3 transition-colors has-[:focus-visible]:ring-3',
        checked && 'border-brand bg-brand/5 hover:border-brand'
      )}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          checked={checked}
          onChange={onChange}
          className="accent-[var(--brand)]"
        />
        <span className="text-foreground text-sm font-medium">{title}</span>
      </span>
      <span className="text-muted pl-5 text-xs leading-relaxed">{note}</span>
    </label>
  )
}

function Toggle({
  label,
  note,
  checked,
  disabled = false,
  onChange
}: {
  label: string
  note: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  const id = useId()
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 py-3',
        disabled && 'opacity-60'
      )}
    >
      <div className="min-w-0">
        <label htmlFor={id} className="text-foreground text-sm font-medium">
          {label}
        </label>
        <p className="text-muted mt-0.5 text-xs leading-relaxed">{note}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'focus-visible:ring-brand/30 relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:cursor-not-allowed',
          checked ? 'bg-brand' : 'bg-border'
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5'
          )}
        />
      </button>
    </div>
  )
}
