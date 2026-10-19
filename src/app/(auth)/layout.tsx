import { AuthLogo } from '@/components/auth/auth-logo'
import { LinkedInMark } from '@/components/auth/linkedin-mark'
import { ThemeToggle } from '@/components/theme-toggle'
import { BadgeCheck, Check, LifeBuoy, TrendingUp } from 'lucide-react'
import type { ReactNode } from 'react'

// Placeholders until these pages exist; every link on the sign-in page
// points here, so there is one place to fill them in.
const LINKS = {
  support: '#',
  terms: '#',
  privacy: '#',
  status: '#'
}

/** A sample LinkedIn post, showing the kind of content the engine writes. */
function SamplePost() {
  return (
    <figure className="border-border bg-surface rounded-2xl border p-7 shadow-[0_8px_30px_-12px_rgb(15_40_80/0.12)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="bg-foreground text-background flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold">
            TC
          </span>
          <div>
            <p className="text-foreground flex items-center gap-1.5 text-[17px] font-semibold">
              TDC Commerce Advisory
              <BadgeCheck
                aria-label="Verified"
                className="fill-linkedin-text text-surface h-5 w-5"
              />
            </p>
            <p className="text-muted text-sm">
              B2B Commerce Strategy &amp; Thought Leadership
            </p>
          </div>
        </div>
        <span className="bg-linkedin/10 text-linkedin-text flex h-8 w-8 items-center justify-center rounded-md">
          <LinkedInMark className="h-4 w-4" />
        </span>
      </div>

      <blockquote className="border-border text-foreground/90 mt-6 border-y py-6 text-[15px] leading-relaxed">
        &ldquo;The fastest way to scale commerce isn&rsquo;t louder
        acquisition&mdash;it&rsquo;s genuine category authority. When leaders
        share clear frameworks, resonance compounds.&rdquo;
      </blockquote>

      <figcaption className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex -space-x-1.5">
            {[
              ['👍', 'bg-blue-500'],
              ['💡', 'bg-emerald-500'],
              ['👏', 'bg-amber-400']
            ].map(([emoji, bg]) => (
              <span
                key={emoji}
                className={`${bg} ring-surface flex h-6 w-6 items-center justify-center rounded-full text-[13px] ring-2`}
              >
                {emoji}
              </span>
            ))}
          </span>
          <span className="text-foreground/80 text-sm">1,842 interactions</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 font-medium text-emerald-700 dark:text-emerald-300">
            <TrendingUp aria-hidden className="h-3.5 w-3.5" />
            +410% Engagement Growth
          </span>
          <span className="border-border text-muted rounded-full border px-3 py-1">
            Top Voice 98.4
          </span>
        </div>
      </figcaption>
    </figure>
  )
}

/** The sign-in page's frame: header, a showcase panel, the form, and a footer. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const linkClass = 'hover:text-foreground transition-colors'

  return (
    <div className="bg-background flex min-h-full flex-col">
      <header className="border-border bg-surface/80 flex h-14 shrink-0 items-center justify-between border-b px-4 backdrop-blur sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <AuthLogo className="h-7 w-auto shrink-0 sm:h-8" />
          <span aria-hidden className="text-border text-lg">
            /
          </span>
          <span className="text-linkedin-text truncate text-[15px] font-medium">
            LinkedIn Content Engine
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={LINKS.support}
            className={`text-muted hidden items-center gap-1.5 text-[15px] sm:flex ${linkClass}`}
          >
            <LifeBuoy aria-hidden className="h-4 w-4" />
            Support &amp; Guide
          </a>
          <ThemeToggle />
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[55fr_45fr]">
        <section className="border-border bg-auth-hero relative hidden overflow-hidden border-r lg:flex lg:items-center">
          {/* Soft glows, as on the reference design. */}
          <div
            aria-hidden
            className="bg-auth-hero-glow pointer-events-none absolute -top-40 -left-40 h-128 w-lg rounded-full opacity-70 blur-3xl"
          />
          <div
            aria-hidden
            className="bg-auth-hero-glow pointer-events-none absolute right-0 -bottom-48 h-144 w-xl rounded-full opacity-60 blur-3xl"
          />

          <div className="relative w-full max-w-208 px-12 py-16 xl:px-18">
            <p className="border-border bg-surface inline-flex items-center gap-2.5 rounded-full border px-4 py-1.5 text-sm shadow-sm">
              <span className="bg-linkedin-text h-2 w-2 rounded-full" />
              <span className="text-foreground font-medium">
                Executive Creator Suite
              </span>
              
      
            </p>

            <h2 className="text-foreground mt-8 text-5xl leading-[1.05] font-bold tracking-tight">
              Elevate your voice on LinkedIn with executive precision.
            </h2>
            <p className="text-muted mt-6 max-w-180 text-lg leading-relaxed">
              Transform strategic ideas, industry perspectives, and commerce
              data into high-engagement authority. Trusted by enterprise leaders
              and modern founders.
            </p>

            <div className="mt-11 max-w-180">
              <SamplePost />
            </div>

            <ul className="text-muted mt-9 flex flex-wrap gap-x-7 gap-y-2 text-[15px]">
              {['Direct LinkedIn API Sync', 'Enterprise Passkey Ready'].map(
                item => (
                  <li key={item} className="flex items-center gap-2">
                    <Check aria-hidden className="text-linkedin-text h-4 w-4" />
                    {item}
                  </li>
                )
              )}
            </ul>
          </div>
        </section>

        <main className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
          {children}
          
        </main>
      </div>

      <footer className="border-border bg-surface/80 text-muted flex shrink-0 flex-col gap-4 border-t px-6 py-6 text-[15px] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 whitespace-nowrap">
          <span className="text-foreground/80">
            &copy; {new Date().getFullYear()} LinkedIn Content Engine.
          </span>
          <span aria-hidden className="text-muted/60">
            •
          </span>
          <span>Powered by TDCCommerce</span>
        </p>
     
      </footer>
    </div>
  )
}
