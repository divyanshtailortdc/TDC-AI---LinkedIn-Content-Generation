import React from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, PenLine, CheckCircle } from "lucide-react";

export default function Home() {
  const features = [
    {
      icon: <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
      title: "Content Ideation",
      description:
        "Surface high-impact topics and engaging discussion angles tailored to your professional domain.",
    },
    {
      icon: <PenLine className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
      title: "Smart Drafting",
      description:
        "Generate well-structured post drafts designed to maintain high readability and audience retention.",
    },
    {
      icon: <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
      title: "Optimized Delivery",
      description:
        "Refine hooks, formatting, and post structure for maximum organic reach and conversation.",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col justify-between bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      {/* Navbar */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center font-bold text-xs text-white">
              TDC
            </span>
            <span className="font-semibold text-sm tracking-tight">
              TDC AI — LinkedIn Content Generation
            </span>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
            Phase 1 Starter
          </span>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col justify-center">
        <section className="max-w-4xl mx-auto px-6 py-20 text-center space-y-6">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            TDC AI — LinkedIn Content Generation
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto leading-relaxed">
            A modular platform foundation built to streamline thought leadership, professional ideation, and high-impact LinkedIn content creation.
          </p>
          <div className="pt-2">
            <Link
              href="#"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors shadow-sm"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>

        {/* Simple Feature Overview (3 items max) */}
        <section className="max-w-5xl mx-auto px-6 pb-20 w-full">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {features.map((feature, idx) => (
              <div
                key={idx}
                className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-3"
              >
                <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center">
                  {feature.icon}
                </div>
                <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
                  {feature.title}
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 py-6 px-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>© {new Date().getFullYear()} TDC AI. All rights reserved.</p>
          <p>Project Foundation — Ready for modular feature development.</p>
        </div>
      </footer>
    </div>
  );
}
