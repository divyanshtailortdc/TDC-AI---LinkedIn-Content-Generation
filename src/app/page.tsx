import { ArrowRight, CheckCircle, PenLine, Sparkles } from 'lucide-react'
import Link from 'next/link'

export default function Home() {
  const features = [
    {
      icon: <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />,
      title: 'Content Ideation',
      description:
        'Surface high-impact topics and engaging discussion angles tailored to your professional domain.'
    },
    {
      icon: <PenLine className="h-5 w-5 text-blue-600 dark:text-blue-400" />,
      title: 'Smart Drafting',
      description:
        'Generate well-structured post drafts designed to maintain high readability and audience retention.'
    },
    {
      icon: (
        <CheckCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
      ),
      title: 'Optimized Delivery',
      description:
        'Refine hooks, formatting, and post structure for maximum organic reach and conversation.'
    }
  ]

  return (
    <div className="flex min-h-screen flex-col justify-between bg-zinc-50 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Navbar */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">
              TDC
            </span>
            <span className="text-sm font-semibold tracking-tight">
              TDC AI — LinkedIn Content Generation
            </span>
          </div>
          <span className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            Phase 1 Starter
          </span>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex flex-1 flex-col justify-center">
        <section className="mx-auto max-w-4xl space-y-6 px-6 py-20 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-950 sm:text-5xl dark:text-zinc-50">
            TDC AI — LinkedIn Content Generation
          </h1>
          <p className="mx-auto max-w-2xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            A modular platform foundation built to streamline thought
            leadership, professional ideation, and high-impact LinkedIn content
            creation.
          </p>
          <div className="pt-2">
            <Link
              href="#"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <span>Get Started</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>

        {/* Simple Feature Overview (3 items max) */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-20">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {features.map((feature, idx) => (
              <div
                key={idx}
                className="space-y-3 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900/50"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/50">
                  {feature.icon}
                </div>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 px-6 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 sm:flex-row">
          <p>© {new Date().getFullYear()} TDC AI. All rights reserved.</p>
          <p>Project Foundation — Ready for modular feature development.</p>
        </div>
      </footer>
    </div>
  )
}
