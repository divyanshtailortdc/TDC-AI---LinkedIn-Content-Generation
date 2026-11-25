import { buttonClassName } from '@/components/button'
import {
  BLOG_KIND_LABELS,
  BLOG_LENGTH_SPECS,
  BLOG_STYLE_LABELS,
  PRODUCT_ROLE_LABELS,
  SEARCH_INTENT_LABELS,
  type BlogBrief,
  type BlogKind,
  type BlogPlan
} from '@/lib/blogs/types'
import { Copy } from 'lucide-react'
import Link from 'next/link'
import type { BlogLabels } from '../blogs-data'

/**
 * What was asked for when the blog was started, the plan it was written
 * from, and what it has cost.
 */
export function BriefPanel({
  blogId,
  kind,
  brief,
  plan,
  labels,
  costUsd,
  model
}: {
  blogId: string
  kind: BlogKind
  brief: BlogBrief
  plan: BlogPlan | null
  labels: BlogLabels
  costUsd: number
  model: string | null
}) {
  const reader = brief.audience.audienceId
    ? (labels.audience ?? 'One of your audiences')
    : brief.audience.note || 'All your audiences'
  const rows: Array<[string, string]> = [
    ['Type', BLOG_KIND_LABELS[kind]],
    ['Topic', brief.topic],
    ['Primary keyword', brief.primaryKeyword || 'Chosen by the AI'],
    ['Secondary keywords', brief.secondaryKeywords.join(', ') || 'None'],
    [
      'Length',
      `${BLOG_LENGTH_SPECS[brief.length].label}, about ${BLOG_LENGTH_SPECS[brief.length].words.toLocaleString('en-US')} words`
    ],
    ['Writing style', BLOG_STYLE_LABELS[brief.style]],
    ['Reader', reader],
    ['Goal', labels.goal ?? 'No specific goal'],
    ...(labels.idea
      ? ([['From the idea', labels.idea]] as Array<[string, string]>)
      : []),
    ['Web research', brief.research ? 'On' : 'Off'],
    ['Knowledge base', brief.knowledge ? 'On' : 'Off'],
    ['FAQ', brief.faq ? 'On' : 'Off'],
    ...(brief.instructions
      ? ([['Instructions', brief.instructions]] as Array<[string, string]>)
      : []),
    ...(brief.caseDetails
      ? ([['The real case', brief.caseDetails]] as Array<[string, string]>)
      : []),
    [
      'AI cost so far',
      `$${costUsd.toFixed(2)}${model ? ` · ${model.replace(/^anthropic\//, '')}` : ''}`
    ]
  ]
  return (
    <div className="space-y-4">
      {plan && <PlanSummary plan={plan} />}
      <dl className="space-y-2.5">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted text-xs">{label}</dt>
            <dd className="text-foreground text-sm leading-snug break-words">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <Link
        href={`/blogs/new?from=${blogId}`}
        className={buttonClassName({ variant: 'secondary', size: 'sm' })}
      >
        <Copy aria-hidden className="h-3.5 w-3.5" />
        Start a new blog from this brief
      </Link>
    </div>
  )
}

/** The plan the text was written from: its intent, angle, structure and call to action. */
function PlanSummary({ plan }: { plan: BlogPlan }) {
  const rows: Array<[string, string]> = [
    ['Search intent', `${SEARCH_INTENT_LABELS[plan.searchIntent]}${plan.readerNeed ? `: ${plan.readerNeed}` : ''}`],
    ['Angle', plan.angle],
    ...(plan.originality ? ([['What it adds', plan.originality]] as Array<[string, string]>) : []),
    ['Your products', `${PRODUCT_ROLE_LABELS[plan.product.role]}${plan.product.where ? ` (${plan.product.where})` : ''}`],
    ...(plan.cta.text ? ([['Call to action', plan.cta.text]] as Array<[string, string]>) : [])
  ]
  return (
    <section className="border-border space-y-2.5 rounded-xl border p-3">
      <h3 className="text-foreground text-xs font-semibold tracking-wide uppercase">
        The plan
      </h3>
      <dl className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted text-xs">{label}</dt>
            <dd className="text-foreground text-sm leading-snug break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="text-muted text-xs">Structure</p>
        <ol className="text-foreground mt-1 list-decimal space-y-0.5 pl-4 text-sm">
          {plan.sections.map(section => (
            <li key={section.heading}>
              {section.heading}
              {section.element !== 'none' && (
                <span className="text-muted text-xs"> · {section.element}</span>
              )}
            </li>
          ))}
        </ol>
      </div>
      {plan.gaps.length > 0 && (
        <div>
          <p className="text-muted text-xs">Left out (no source supports it)</p>
          <ul className="text-muted mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {plan.gaps.map(gap => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
