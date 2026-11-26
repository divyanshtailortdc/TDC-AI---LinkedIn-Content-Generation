'use client'

import { PlatformMark } from '@/components/platform-mark'
import type { PlatformId } from '@/lib/platforms'
import {
  CalendarClock,
  Check,
  Images,
  Lightbulb,
  LoaderCircle,
  PenLine,
  Search
} from 'lucide-react'
import { useId, useState, type ComponentType, type ReactNode } from 'react'
import {
  Chip,
  MockAuthor,
  MockWindow,
  SAMPLE_IDEA,
  SAMPLE_POST,
  SAMPLE_SCORES,
  ScoreBar,
  YouTubeMark
} from './mock-parts'

type Step = {
  label: string
  summary: string
  title: string
  detail: string
  icon: ComponentType<{ className?: string }>
  picture: () => ReactNode
}

const STEPS: Step[] = [
  {
    label: 'Research',
    summary: 'Reads your field so you don’t have to',
    title: 'Every run starts with research',
    detail:
      'A run gathers who you are and what you want, then searches the web, your own knowledge and the newsletters your inbox receives, before it writes a single idea.',
    icon: Search,
    picture: ResearchPicture
  },
  {
    label: 'Ideas',
    summary: 'Proposes ideas with a scorecard',
    title: 'Ideas you can judge at a glance',
    detail:
      'Each idea is scored from 0 to 100 on goal fit, engagement, originality, trend relevance, brand fit and source quality, with a one-line reason for every score.',
    icon: Lightbulb,
    picture: IdeaPicture
  },
  {
    label: 'Drafts',
    summary: 'Writes the posts in your voice',
    title: 'Drafts that sound like you',
    detail:
      'Approved ideas become posts written your way, in each platform’s format. Edit them yourself, ask for a new version, or go back to an earlier one.',
    icon: PenLine,
    picture: DraftPicture
  },
  {
    label: 'Visuals',
    summary: 'Designs images, carousels and videos',
    title: 'Images in your brand, not stock',
    detail:
      'Images and swipeable carousels in your colours and typefaces, in the style you choose, plus short vertical videos of the script for Instagram Reels, YouTube Shorts and Facebook Reels.',
    icon: Images,
    picture: VisualsPicture
  },
  {
    label: 'Publish',
    summary: 'Schedules and publishes',
    title: 'Out on time, through your accounts',
    detail:
      'Publish an approved post now, schedule it, or let the engine send out what you planned for the day. Everything goes through the accounts you connect yourself.',
    icon: CalendarClock,
    picture: PublishPicture
  }
]

/** "How it works": the five steps, each with a picture of that part of the app. */
export function WorkflowTabs() {
  const [active, setActive] = useState(0)
  const id = useId()
  const step = STEPS[active]
  if (!step) return null
  const Picture = step.picture

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
      <div>
        <div role="tablist" aria-label="How it works" className="space-y-2">
          {STEPS.map((item, index) => {
            const selected = index === active
            const Icon = item.icon
            return (
              <button
                key={item.label}
                type="button"
                role="tab"
                id={`${id}-tab-${index}`}
                aria-selected={selected}
                aria-controls={`${id}-panel`}
                onClick={() => setActive(index)}
                className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition-colors ${
                  selected
                    ? 'border-brand/40 bg-brand/5'
                    : 'hover:bg-surface-hover border-transparent'
                }`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
                    selected
                      ? 'border-brand/30 bg-surface text-brand-strong'
                      : 'border-border bg-surface text-muted'
                  }`}
                >
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-[15px] font-semibold ${selected ? 'text-foreground' : 'text-foreground/80'}`}
                  >
                    {index + 1}. {item.label}
                  </span>
                  <span className="text-muted block text-sm">
                    {item.summary}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="border-border bg-surface mt-5 rounded-xl border p-5">
          <p className="text-foreground text-[15px] font-semibold">
            {step.title}
          </p>
          <p className="text-muted mt-1.5 text-sm leading-relaxed">
            {step.detail}
          </p>
        </div>
      </div>

      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${active}`}
      >
        <MockWindow title={step.label} className="lg:sticky lg:top-24">
          <div key={active} className="site-fade-up min-h-96 p-5">
            <Picture />
          </div>
        </MockWindow>
      </div>
    </div>
  )
}

function ResearchPicture() {
  const rows: [string, string, boolean][] = [
    ['Gathered your profile, voice and goals', 'Context', true],
    ['Searched the web', '24 results', true],
    ['Read stories from your newsletters', '6 stories', true],
    ['Checked your knowledge base', '3 documents', true],
    ['Writing ideas for “Build authority with SaaS founders”', '', false]
  ]
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-foreground text-sm font-semibold">Run in progress</p>
        <Chip tone="brand">Researching</Chip>
      </div>
      <ol className="border-border mt-5 space-y-4 border-l pl-5">
        {rows.map(([text, note, done]) => (
          <li key={text} className="relative">
            <span
              className={`absolute top-0.5 -left-7.25x h-4 w-4 items-center justify-center rounded-full ${
                done
                  ? 'bg-emerald-600 text-white'
                  : 'bg-surface text-brand-strong'
              }`}
            >
              {done ? (
                <Check className="h-3 w-3" />
              ) : (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              )}
            </span>
            <p
              className={`text-sm ${done ? 'text-foreground' : 'text-brand-strong font-medium'}`}
            >
              {text}
            </p>
            {note && <p className="text-muted text-xs">{note}</p>}
          </li>
        ))}
      </ol>
    </div>
  )
}

function IdeaPicture() {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="brand">Goal · {SAMPLE_IDEA.goal}</Chip>
        <Chip>LinkedIn</Chip>
      </div>
      <p className="text-foreground mt-3 text-lg leading-snug font-semibold">
        {SAMPLE_IDEA.title}
      </p>
      <p className="text-muted mt-4 text-xs font-medium tracking-wide uppercase">
        How it scores
      </p>
      <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3.5">
        {SAMPLE_SCORES.map(score => (
          <ScoreBar key={score.label} {...score} />
        ))}
      </div>
      <p className="border-border text-muted mt-5 rounded-lg border border-dashed px-3 py-2 text-xs leading-relaxed">
        <span className="text-foreground font-medium">Trend relevance 71:</span>{' '}
        evergreen rather than news, which is fine for a story post.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <span className="border-border text-muted rounded-lg border px-3.5 py-1.5 text-sm">
          Reject
        </span>
        <span className="bg-cta text-cta-text rounded-lg px-3.5 py-1.5 text-sm font-medium">
          Approve
        </span>
      </div>
    </div>
  )
}

function DraftPicture() {
  const tabs: [PlatformId, string][] = [
    ['linkedin', 'LinkedIn post'],
    ['x', 'X thread'],
    ['threads', 'Threads']
  ]
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(([platform, label], index) => (
          <span
            key={platform}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
              index === 0
                ? 'border-brand/40 bg-brand/5 text-foreground font-medium'
                : 'border-border text-muted'
            }`}
          >
            <PlatformMark platform={platform} className="h-3.5 w-3.5" />
            {label}
          </span>
        ))}
      </div>
      <div className="border-border mt-4 rounded-xl border p-4">
        <MockAuthor />
        <p className="text-foreground/90 mt-3 text-[13px] leading-relaxed whitespace-pre-line">
          {SAMPLE_POST}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip>Direct</Chip>
        <Chip>Warm</Chip>
        <Chip>No hashtags</Chip>
        <Chip>Version 2 of 2</Chip>
      </div>
    </div>
  )
}

function VisualsPicture() {
  return (
    <div>
      <p className="text-muted text-xs font-medium tracking-wide uppercase">
        Carousel · 7 slides
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className="bg-cta text-cta-text flex aspect-4/5 flex-col justify-between rounded-lg p-3">
          <span className="text-[10px] font-medium opacity-80">
            NORTHWIND STUDIO
          </span>
          <span className="text-sm leading-tight font-semibold">
            Why our onboarding emails got replies
          </span>
          <span className="text-[10px] opacity-80">Swipe →</span>
        </div>
        <div className="border-border bg-surface flex aspect-4/5 flex-col justify-between rounded-lg border p-3">
          <span className="bg-brand/15 text-brand-strong flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold">
            1
          </span>
          <span className="text-foreground text-xs leading-snug font-semibold">
            One ask per email
          </span>
          <span className="bg-brand/20 h-1 w-8 rounded-full" />
        </div>
        <div className="border-border bg-brand/10 flex aspect-4/5 flex-col justify-between rounded-lg border p-3">
          <span className="text-brand-strong text-[10px] font-medium">
            YOUR TURN
          </span>
          <span className="text-foreground text-xs leading-snug font-semibold">
            What’s the best onboarding email you’ve had?
          </span>
          <span className="text-muted text-[10px]">Comment below</span>
        </div>
      </div>
      <p className="text-muted mt-5 text-xs font-medium tracking-wide uppercase">
        Image style
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {['Photorealistic', 'Illustration', '3D Render', 'Minimal Graphic Design'].map(
          (style, index) => (
            <Chip key={style} tone={index === 1 ? 'brand' : 'plain'}>
              {style}
            </Chip>
          )
        )}
      </div>
      <div className="border-border mt-5 flex items-center gap-3 rounded-xl border p-3">
        <span className="from-brand/30 to-cta/60 relative flex h-14 w-9 shrink-0 items-end justify-center overflow-hidden rounded-md bg-linear-to-b">
          <span className="mb-1 text-[8px] font-semibold text-white">0:15</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-medium">Short video</p>
          <p className="text-muted text-xs">About 15 seconds, vertical 9:16</p>
        </div>
        <span className="flex items-center gap-1.5">
          <PlatformMark platform="instagram" className="h-4 w-4" />
          <YouTubeMark className="h-4 w-4" />
          <PlatformMark platform="facebook" className="h-4 w-4" />
        </span>
      </div>
    </div>
  )
}

function PublishPicture() {
  const days: { day: string; posts: [PlatformId, string][] }[] = [
    { day: 'Mon', posts: [['linkedin', '9:00']] },
    { day: 'Tue', posts: [['x', '12:30'], ['threads', '12:30']] },
    { day: 'Wed', posts: [] },
    { day: 'Thu', posts: [['linkedin', '8:45'], ['instagram', '18:00']] },
    { day: 'Fri', posts: [['facebook', '10:00']] }
  ]
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-foreground text-sm font-semibold">This week</p>
        <Chip tone="green">
          <Check className="h-3 w-3" /> Auto-publish on
        </Chip>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-2">
        {days.map(({ day, posts }) => (
          <div
            key={day}
            className="border-border bg-background/60 min-h-40 rounded-lg border p-2"
          >
            <p className="text-muted text-center text-[11px] font-medium">
              {day}
            </p>
            <div className="mt-2 space-y-1.5">
              {posts.map(([platform, time]) => (
                <div
                  key={platform + time}
                  className="border-border bg-surface flex flex-col items-center gap-1 rounded-md border px-1 py-1.5"
                >
                  <PlatformMark platform={platform} className="h-3.5 w-3.5" />
                  <span className="text-foreground text-[10px] tabular-nums">
                    {time}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="border-border mt-4 flex items-center justify-between gap-3 rounded-xl border p-3">
        <p className="text-muted text-xs">
          Approved posts only. Cancel any of them before they go out.
        </p>
        <span className="bg-cta text-cta-text shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium">
          Publish now
        </span>
      </div>
    </div>
  )
}
