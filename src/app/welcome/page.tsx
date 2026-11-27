import { AuthLogo } from '@/components/auth/auth-logo'
import { PlatformMark } from '@/components/platform-mark'
import { HeroPreview } from '@/components/site/hero-preview'
import { YouTubeMark } from '@/components/site/mock-parts'
import { SiteHeader } from '@/components/site/site-header'
import { SITE_NAV } from '@/components/site/site-nav'
import { WorkflowTabs } from '@/components/site/workflow-tabs'
import { getSession } from '@/lib/session'
import type { PlatformId } from '@/lib/platforms'
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Building2,
  ChevronDown,
  FileSearch,
  Gauge,
  Inbox,
  KeyRound,
  Layers,
  MessageSquareQuote,
  Plug,
  Rocket,
  ShieldCheck,
  Shuffle,
  Target,
  Users
} from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import type { ComponentType, ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'TDC Content Engine · Social posts researched and written in your voice',
  description:
    'TDC Content Engine researches your field, proposes post ideas tied to your goals and drafts the ones you approve, with images, carousels and short videos, for LinkedIn, X, Threads, Facebook and Instagram. Nothing is published until you say so.'
}

type Icon = ComponentType<{ className?: string }>

const PLATFORMS: { id: PlatformId; name: string }[] = [
  { id: 'linkedin', name: 'LinkedIn' },
  { id: 'x', name: 'X' },
  { id: 'threads', name: 'Threads' },
  { id: 'facebook', name: 'Facebook' },
  { id: 'instagram', name: 'Instagram' }
]

const FEATURES: { icon: Icon; title: string; body: string }[] = [
  {
    icon: MessageSquareQuote,
    title: 'Sounds like you',
    body: 'Set how formal and direct you are, your emoji and hashtags, and each platform’s style. It also studies the posts you have already published.'
  },
  {
    icon: Target,
    title: 'Goals come first',
    body: 'Say what your posts are for, such as winning clients or building a reputation. Every idea is written to move one of your goals forward.'
  },
  {
    icon: BookOpen,
    title: 'Grounded in what you know',
    body: 'Add articles, case studies and documents you stand behind, and posts draw on your facts instead of guesses.'
  },
  {
    icon: Inbox,
    title: 'A newsletter inbox of its own',
    body: 'Each identity gets its own email address. Sign it up to newsletters in your field, and their stories feed every run.'
  },
  {
    icon: Shuffle,
    title: 'Never the same idea twice',
    body: 'Rejected ideas stay rejected, and an idea too close to one you already have is marked down before it reaches you.'
  },
  {
    icon: Users,
    title: 'Many identities, one login',
    body: 'Write as yourself, your company or each of your clients, each with its own voice, goals, inbox and publishing accounts.'
  }
]

const AUDIENCES: { icon: Icon; title: string; body: string }[] = [
  {
    icon: Rocket,
    title: 'Founders and executives',
    body: 'Stay visible without giving up a morning to every post. Share what you know, in your own words, on the days that suit you.'
  },
  {
    icon: Building2,
    title: 'Companies and brands',
    body: 'Keep a steady, on-brand presence on every network you use, with posts that serve your goals and images in your brand.'
  },
  {
    icon: Briefcase,
    title: 'Agencies and consultants',
    body: 'Run each client as a separate identity with its own voice, goals and accounts, and switch between them in a click.'
  }
]

const FIRST_STEPS: { title: string; body: string }[] = [
  {
    title: 'Set up an identity',
    body: 'Tell it who is posting and where. Add your profile links and website, and AI fills in your profile and each platform’s style for you to check.'
  },
  {
    title: 'Set a goal and start a run',
    body: 'Say what your posts are for. A run researches your field and proposes ideas for your goal, usually in a few minutes.'
  },
  {
    title: 'Approve, polish, publish',
    body: 'Keep the ideas worth writing about, edit the drafts, and publish now or on a schedule through the accounts you connect.'
  }
]

const SAFEGUARDS: { icon: Icon; title: string; body: string }[] = [
  {
    icon: ShieldCheck,
    title: 'Nothing posts without you',
    body: 'Ideas wait for your approval, drafts wait for your review, and only approved posts can be published.'
  },
  {
    icon: Plug,
    title: 'Your accounts, your say',
    body: 'Posts go out through the Buffer account you connect. Signing in never gives the app the right to post anywhere.'
  },
  {
    icon: FileSearch,
    title: 'Sources on every idea',
    body: 'Each idea shows where its facts came from and how far they can be trusted, so you never post a guess.'
  },
  {
    icon: KeyRound,
    title: 'Sign in your way',
    body: 'Use Google, a passkey, or an email and password. Add a passkey later to sign in with your fingerprint or face.'
  },
  {
    icon: Gauge,
    title: 'Spending you can see',
    body: 'The AI cost of every run is shown, with limits over 30 days and over 24 hours so there are no surprises.'
  },
  {
    icon: Layers,
    title: 'Identities kept apart',
    body: 'Each identity’s ideas, posts, inbox and publishing accounts stay separate from the others.'
  }
]

const FAQS: { question: string; answer: ReactNode }[] = [
  {
    question: 'Is anything posted without my approval?',
    answer:
      'No. A run’s ideas wait for your approval before any post is written, and only a post you have approved can be published. Publish now asks you to confirm, a scheduled post goes out only at the time you picked, and auto-publishing stays off until you turn it on.'
  },
  {
    question: 'Which platforms does it write for?',
    answer:
      'LinkedIn, X (single posts and threads), Threads, Facebook and Instagram, with text, image and carousel posts. It also makes short vertical videos of the script, in your brand, for Instagram Reels, YouTube Shorts and Facebook Reels.'
  },
  {
    question: 'Where do the ideas come from?',
    answer:
      'From runs. You pick the goals a run works toward; it gathers your identity’s context, researches the web and your knowledge base, including stories from the newsletters your inbox receives, and proposes ideas for those goals.'
  },
  {
    question: 'Will the posts sound like me?',
    answer:
      'They are written from your voice settings: who is speaking, how formal and direct you are, emoji and hashtags, and each platform’s style. You can edit any draft, ask for a new version, or go back to an earlier one.'
  },
  {
    question: 'Can I manage several brands or clients?',
    answer:
      'Yes. Each person or company you write for is an identity, with its own profile, voice, goals, ideas, posts, inbox address and publishing accounts.'
  },
  {
    question: 'Do I need a Buffer account?',
    answer:
      'To publish from the app, yes: posts go out through your own Buffer account, which you connect once. Without it, you can still copy an approved post and publish it yourself.'
  },
  {
    question: 'How do I sign in?',
    answer:
      'With Google, a passkey, or an email and password you choose when you sign up. Signing in only tells the app who you are; it never lets the app post on your behalf.'
  }
]

export default async function WelcomePage() {
  // Signed in already: the buttons lead into the app rather than to sign-in.
  const signedIn = Boolean(await getSession())
  const start = signedIn
    ? { href: '/', label: 'Open the app' }
    : { href: '/signup', label: 'Get started' }

  return (
    <div className="bg-surface min-h-full">
      <Link
        href="/docs/publishing/posts/post-types#short-videos"
        className="border-border bg-brand/5 text-foreground/80 hover:text-foreground flex items-center justify-center gap-2 border-b px-4 py-2 text-center text-[13px] transition-colors"
      >
        <span className="bg-brand/15 text-brand-strong rounded-md px-1.5 py-0.5 text-[11px] font-semibold">
          NEW
        </span>
        <span className="truncate">
          Short videos for Instagram Reels, YouTube Shorts and Facebook Reels
        </span>
        <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
      </Link>

      <SiteHeader signedIn={signedIn} />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="bg-brand/10 pointer-events-none absolute -top-40 right-0 h-[36rem] w-[42rem] rounded-full blur-3xl"
          />
          <div
            aria-hidden
            className="bg-brand/5 pointer-events-none absolute top-40 -left-40 h-96 w-96 rounded-full blur-3xl"
          />
          <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:pt-20 lg:pb-28">
            <div>
              <p className="border-border bg-surface inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[13px] shadow-sm">
                <span className="flex shrink-0 gap-1">
                  {PLATFORMS.slice(0, 3).map(platform => (
                    <PlatformMark
                      key={platform.id}
                      platform={platform.id}
                      className="h-3.5 w-3.5"
                    />
                  ))}
                </span>
                <span className="text-muted">
                  For LinkedIn, X, Threads, Facebook and Instagram
                </span>
              </p>
              <h1 className="text-foreground mt-6 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                It finds what to say. Then writes it in your voice.
              </h1>
              <p className="text-muted mt-6 max-w-xl text-lg leading-relaxed">
                TDC Content Engine researches your field, proposes post ideas
                that serve your goals, and drafts the ones you approve, with
                images, carousels and short videos. Nothing is published until
                you say so.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <PrimaryLink href={start.href}>{start.label}</PrimaryLink>
                <SecondaryLink href="#how-it-works">See how it works</SecondaryLink>
              </div>
              <ul className="text-muted mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {[
                  'Sign in with Google or a passkey',
                  'Your goals, your voice',
                  'You approve every post'
                ].map(item => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="bg-brand h-1.5 w-1.5 rounded-full" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <HeroPreview />
          </div>
        </section>

        {/* Platforms */}
        <section className="border-border border-y">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-muted text-center text-sm">
              One workspace for every network you post on
            </p>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-5">
              {PLATFORMS.map(platform => (
                <li
                  key={platform.id}
                  className="text-foreground/70 flex items-center gap-2.5 text-lg font-medium"
                >
                  <PlatformMark platform={platform.id} className="h-6 w-6" />
                  {platform.name}
                </li>
              ))}
              <li className="text-foreground/70 flex items-center gap-2.5 text-lg font-medium">
                <YouTubeMark className="h-6 w-6" />
                YouTube Shorts
              </li>
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHeading
              eyebrow="How it works"
              title="From a blank page to a published post"
              intro="The same five steps every time. You decide at each one; the engine does the reading, the writing and the remembering."
            />
            <div className="mt-14">
              <WorkflowTabs />
            </div>
          </div>
        </section>

        {/* Features */}
        <section
          id="features"
          className="border-border bg-background scroll-mt-20 border-y"
        >
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHeading
              eyebrow="Features"
              title="Everything between an empty feed and a good post"
              intro="Not a prompt box with a post button. A full workflow: your goals, your knowledge, your voice and your brand, every time."
            />
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(feature => (
                <IconCard key={feature.title} {...feature} />
              ))}
            </div>
          </div>
        </section>

        {/* Who it's for */}
        <section id="who-its-for" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHeading
              eyebrow="Who it’s for"
              title="Whoever you’re writing as"
              intro="One person, one company or a dozen clients: each gets an identity of its own, set up once."
            />
            <div className="mt-14 grid gap-4 md:grid-cols-3">
              {AUDIENCES.map(audience => (
                <div
                  key={audience.title}
                  className="border-border bg-surface rounded-2xl border p-7"
                >
                  <span className="bg-brand/10 text-brand-strong flex h-11 w-11 items-center justify-center rounded-xl">
                    <audience.icon className="h-5 w-5" />
                  </span>
                  <h3 className="text-foreground mt-5 text-lg font-semibold">
                    {audience.title}
                  </h3>
                  <p className="text-muted mt-2 text-[15px] leading-relaxed">
                    {audience.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* First steps */}
        <section className="border-border bg-background border-y">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHeading
              eyebrow="Getting started"
              title="Your first post in three steps"
              intro="No templates to fill in and no prompts to write. Most of the setup is filled in for you to check."
            />
            <ol className="mt-14 grid gap-4 md:grid-cols-3">
              {FIRST_STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="border-border bg-surface relative rounded-2xl border p-7"
                >
                  <span className="bg-cta text-cta-text flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold">
                    {index + 1}
                  </span>
                  <h3 className="text-foreground mt-5 text-lg font-semibold">
                    {step.title}
                  </h3>
                  <p className="text-muted mt-2 text-[15px] leading-relaxed">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-8 text-center">
              <Link
                href="/docs/getting-started"
                className="text-brand-strong inline-flex items-center gap-1.5 text-[15px] font-medium hover:underline"
              >
                Read the Quick Start guide
                <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
            </p>
          </div>
        </section>

        {/* Control */}
        <section>
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHeading
              eyebrow="You stay in control"
              title="Automation you can sign off on"
              intro="The engine suggests and drafts. You decide what goes out, where, and when."
            />
            <div className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {SAFEGUARDS.map(item => (
                <div key={item.title} className="flex gap-4">
                  <span className="border-border text-brand-strong flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-foreground text-[15px] font-semibold">
                      {item.title}
                    </h3>
                    <p className="text-muted mt-1 text-[15px] leading-relaxed">
                      {item.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section
          id="faq"
          className="border-border bg-background scroll-mt-20 border-y"
        >
          <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
            <SectionHeading
              eyebrow="FAQ"
              title="Questions worth asking first"
            />
            <div className="border-border bg-surface mt-12 divide-border divide-y rounded-2xl border">
              {FAQS.map(faq => (
                <details key={faq.question} className="group px-6">
                  <summary className="text-foreground flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
                    {faq.question}
                    <ChevronDown
                      aria-hidden
                      className="text-muted h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <p className="text-muted -mt-1 pb-5 text-[15px] leading-relaxed">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
            <p className="text-muted mt-6 text-center text-sm">
              More answers in the{' '}
              <Link
                href="/docs/help/faq"
                className="text-brand-strong font-medium hover:underline"
              >
                help center
              </Link>
              .
            </p>
          </div>
        </section>

        {/* Final call to action */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="bg-brand/10 pointer-events-none absolute top-1/2 left-1/2 h-72 w-[48rem] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          />
          <div className="relative mx-auto max-w-3xl px-4 py-28 text-center sm:px-6">
            <h2 className="text-foreground text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Give your feed a content engine
            </h2>
            <p className="text-muted mx-auto mt-5 max-w-xl text-lg leading-relaxed">
              Set up your first identity in minutes and see ideas for your goals
              before you write a word.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <PrimaryLink href={start.href}>{start.label}</PrimaryLink>
              <SecondaryLink href="/docs">Read the docs</SecondaryLink>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter start={start} />
    </div>
  )
}

function SectionHeading({
  eyebrow,
  title,
  intro
}: {
  eyebrow: string
  title: string
  intro?: string
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-brand-strong text-[13px] font-semibold tracking-[0.12em] uppercase">
        {eyebrow}
      </p>
      <h2 className="text-foreground mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-[2.6rem] sm:leading-[1.12]">
        {title}
      </h2>
      {intro && (
        <p className="text-muted mt-4 text-lg leading-relaxed text-pretty">
          {intro}
        </p>
      )}
    </div>
  )
}

function IconCard({
  icon: Icon,
  title,
  body
}: {
  icon: Icon
  title: string
  body: string
}) {
  return (
    <div className="border-border bg-surface hover:border-brand/40 rounded-2xl border p-7 transition-colors">
      <span className="bg-brand/10 text-brand-strong flex h-11 w-11 items-center justify-center rounded-xl">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="text-foreground mt-5 text-lg font-semibold">{title}</h3>
      <p className="text-muted mt-2 text-[15px] leading-relaxed">{body}</p>
    </div>
  )
}

function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="bg-cta text-cta-text hover:bg-cta-hover inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-base font-medium shadow-sm transition-colors"
    >
      {children}
      <ArrowRight aria-hidden className="h-4 w-4" />
    </Link>
  )
}

function SecondaryLink({
  href,
  children
}: {
  href: string
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex items-center gap-2 rounded-xl border px-6 py-3.5 text-base font-medium transition-colors"
    >
      {children}
    </Link>
  )
}

function SiteFooter({ start }: { start: { href: string; label: string } }) {
  const columns: { title: string; links: { label: string; href: string }[] }[] = [
    {
      title: 'Product',
      links: SITE_NAV.filter(item => item.href.startsWith('#'))
    },
    {
      title: 'Help',
      links: [
        { label: 'Documentation', href: '/docs' },
        { label: 'Quick Start', href: '/docs/getting-started' },
        { label: 'Troubleshooting', href: '/docs/help/troubleshooting' },
        { label: 'FAQ', href: '/docs/help/faq' }
      ]
    },
    {
      title: 'Account',
      links:
        start.href === '/signup'
          ? [{ label: 'Sign in', href: '/login' }, start]
          : [start]
    }
  ]

  return (
    <footer className="border-border bg-background border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <AuthLogo className="h-8 w-auto" />
          <p className="text-muted mt-4 max-w-xs text-sm leading-relaxed">
            Social posts researched, drafted and designed for you, and published
            only when you say so.
          </p>
        </div>
        {columns.map(column => (
          <div key={column.title}>
            <p className="text-foreground text-sm font-semibold">
              {column.title}
            </p>
            <ul className="mt-4 space-y-2.5">
              {column.links.map(link => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-muted hover:text-foreground text-sm transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-border border-t">
        <p className="text-muted mx-auto max-w-6xl px-4 py-6 text-sm sm:px-6">
          &copy; {new Date().getFullYear()} TDC Content Engine · Powered by
          TDCCommerce
        </p>
      </div>
    </footer>
  )
}
