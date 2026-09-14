'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  SlidersHorizontal,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  Search,
  Image as ImageIcon,
  ShieldAlert,
  FileText,
  Clock,
  Sparkles,
  Link as LinkIcon
} from 'lucide-react'
import { savePreferences, type PreferencesFullPayload, type PillarConfig } from './actions'

const formatOptions = [
  { id: 'thought_leadership', label: 'Thought Leadership', desc: 'Industry shifts, strategic theses, and future predictions' },
  { id: 'how_to_breakdown', label: 'Tactical Breakdown', desc: 'Step-by-step systems, architecture breakdowns, and checklists' },
  { id: 'contrarian_take', label: 'Contrarian Take', desc: 'Challenging conventional consensus with empirical proof' },
  { id: 'case_study', label: 'Customer Case Study', desc: 'Before/after transformation metrics and named logos' },
  { id: 'founder_story', label: 'Founder Story', desc: 'Lessons from the trenches, engineering culture, and failures' },
]

const dayOptions = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function PreferencesForm({
  accountId,
  accountName,
  existingPreferences
}: {
  accountId: string
  accountName: string
  existingPreferences: any | null
}) {
  const router = useRouter()

  // Initialize with Part 2 defaults
  const rawPillars = existingPreferences?.pillars
  let initialPillars: PillarConfig[] = [
    {
      name: 'AI Engineering & Production Architecture',
      description: 'Real-world lessons scaling LLMs, evals, and low-latency pipelines',
      weight_pct: 40,
      example_topics: ['RAG vs fine-tuning benchmarks', 'Cost optimization techniques', 'Evals in CI/CD'],
      preferred_formats: ['how_to_breakdown', 'case_study'],
    },
    {
      name: 'Modern Tech Leadership & Developer Culture',
      description: 'Building high-velocity autonomous engineering teams',
      weight_pct: 35,
      example_topics: ['Code review culture', 'Pair programming with AI agents', 'On-call sustainability'],
      preferred_formats: ['thought_leadership', 'founder_story'],
    },
    {
      name: 'Contrarian Software Engineering Takes',
      description: 'Challenging overhyped trends with production data',
      weight_pct: 25,
      example_topics: ['Why microservices often fail early', 'The myth of zero-shot accuracy'],
      preferred_formats: ['contrarian_take'],
    },
  ]

  let initialFormats = [
    { format: 'how_to_breakdown', weight: 35 },
    { format: 'thought_leadership', weight: 30 },
    { format: 'contrarian_take', weight: 20 },
    { format: 'case_study', weight: 15 },
  ]

  let initialCadence = {
    frequency: existingPreferences?.postsPerWeek || 3,
    days_of_week: ['Monday', 'Wednesday', 'Friday'],
    time_of_day: '08:30',
    posts_per_run: 1,
    ideas_per_run: 4,
  }

  let initialResearch: PreferencesFullPayload['research_policy'] = {
    use_knowledge_base: true,
    use_web_search: true,
    provider: 'serper',
    domain_mode: 'none',
    allowed_domains: [],
    blocked_domains: ['pinterest.com', 'quora.com'],
    freshness_days: 30,
    max_searches_per_run: 3,
    require_citations: true,
    min_citations_per_post: 1,
  }

  let initialMedia: PreferencesFullPayload['media_policy'] = {
    default_mode: 'ai_generated',
    image_style_prompt: 'Minimalist technical diagram, dark slate theme with emerald neon wireframe accents, high resolution clean typography',
    aspect_ratio: '1:1',
    always_include_alt_text: true,
  }

  let initialConstraints: PreferencesFullPayload['post_constraints'] = {
    max_chars: 3000,
    target_chars: 1300,
    hook_max_chars: 200, // Part 2 fold constraint
    hashtag_count: 3,
    emoji_level: 'bullets_only',
    link_placement: 'first_comment',
    cta_required: true,
    variants_per_post: 2,
  }

  let initialGuardrails: PreferencesFullPayload['guardrails'] = {
    banned_topics: ['politics', 'unverified health claims', 'crypto speculative hype'],
    banned_words: [
      'delve',
      'leverage',
      'unlock',
      'game-changer',
      "in today's fast-paced world",
      "I'm thrilled to announce",
      'supercharge',
      'synergy'
    ],
    compliance_notes: 'All benchmarks and customer metrics must point to verified claims in the Knowledge Base.',
  }

  // Hydrate if existing
  if (rawPillars && typeof rawPillars === 'object') {
    if (Array.isArray(rawPillars)) {
      initialPillars = rawPillars.map((p: any) => ({
        name: p.name,
        description: p.description || '',
        weight_pct: p.weight_pct || p.weight || 0,
        example_topics: p.example_topics || [],
        preferred_formats: p.preferred_formats || [],
      }))
    } else {
      if (rawPillars.pillars) initialPillars = rawPillars.pillars
      if (rawPillars.formats) initialFormats = rawPillars.formats
      if (rawPillars.cadence) initialCadence = { ...initialCadence, ...rawPillars.cadence }
      if (rawPillars.research_policy) initialResearch = { ...initialResearch, ...rawPillars.research_policy }
      if (rawPillars.media_policy) initialMedia = { ...initialMedia, ...rawPillars.media_policy }
      if (rawPillars.post_constraints) initialConstraints = { ...initialConstraints, ...rawPillars.post_constraints }
      if (rawPillars.guardrails) initialGuardrails = { ...initialGuardrails, ...rawPillars.guardrails }
    }
  }

  // Component states
  const [pillars, setPillars] = useState<PillarConfig[]>(initialPillars)
  const [cadence, setCadence] = useState(initialCadence)
  const [research, setResearch] = useState(initialResearch)
  const [domainListInput, setDomainListInput] = useState(
    (initialResearch.domain_mode === 'allowed'
      ? initialResearch.allowed_domains
      : initialResearch.blocked_domains
    )?.join(', ') || ''
  )
  const [media, setMedia] = useState(initialMedia)
  const [constraints, setConstraints] = useState(initialConstraints)
  const [guardrails, setGuardrails] = useState(initialGuardrails)
  const [bannedWordsInput, setBannedWordsInput] = useState(initialGuardrails.banned_words.join(', '))
  const [bannedTopicsInput, setBannedTopicsInput] = useState(initialGuardrails.banned_topics.join(', '))

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pillar weight validation (must sum to 100%)
  const totalPillarWeight = pillars.reduce((acc, p) => acc + (Number(p.weight_pct) || 0), 0)
  const isWeightValid = totalPillarWeight === 100

  const addPillar = () => {
    setPillars([...pillars, { name: '', description: '', weight_pct: 0, example_topics: [] }])
  }

  const updatePillar = (index: number, field: keyof PillarConfig, val: any) => {
    const next = [...pillars]
    if (next[index]) {
      next[index] = { ...next[index], [field]: field === 'weight_pct' ? Number(val) : val }
      setPillars(next)
    }
  }

  const removePillar = (index: number) => {
    setPillars(pillars.filter((_, i) => i !== index))
  }

  const toggleDay = (day: string) => {
    const current = cadence.days_of_week
    if (current.includes(day)) {
      setCadence({ ...cadence, days_of_week: current.filter(d => d !== day) })
    } else {
      setCadence({ ...cadence, days_of_week: [...current, day] })
    }
  }

  const handleSave = async () => {
    if (!isWeightValid) {
      setError(`Content pillar weights must sum to exactly 100%. Currently at ${totalPillarWeight}%.`)
      return
    }

    setError(null)
    setIsSaving(true)

    try {
      const domains = domainListInput
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)

      const payload: PreferencesFullPayload = {
        pillars: pillars.filter(p => p.name.trim().length > 0),
        formats: initialFormats,
        cadence,
        research_policy: {
          ...research,
          allowed_domains: research.domain_mode === 'allowed' ? domains : [],
          blocked_domains: research.domain_mode === 'blocked' ? domains : [],
        },
        media_policy: media,
        post_constraints: constraints,
        guardrails: {
          banned_topics: bannedTopicsInput.split(',').map(s => s.trim()).filter(Boolean),
          banned_words: bannedWordsInput.split(',').map(s => s.trim()).filter(Boolean),
          compliance_notes: guardrails.compliance_notes,
        },
      }

      await savePreferences(accountId, payload)
      router.push(`/accounts/${accountId}`)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to save preferences')
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Generation Preferences</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Configure content pillars, generation cadence, research &amp; citation policies, media styling, and compliance guardrails.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* Section 1: Content Pillars (Sum to 100%) */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)] flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[var(--accent)]" />
              1. Content Pillars ({totalPillarWeight}% / 100%)
            </h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              The agent distributes monthly posts across these core themes according to weight percentage.
            </p>
          </div>

          <button
            type="button"
            onClick={addPillar}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Pillar
          </button>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="w-full h-2.5 rounded-full bg-[var(--surface-hover)] overflow-hidden flex border border-[var(--border)]">
            <div
              className={`h-full transition-all duration-300 ${
                isWeightValid
                  ? 'bg-emerald-500'
                  : totalPillarWeight > 100
                  ? 'bg-rose-500'
                  : 'bg-amber-500'
              }`}
              style={{ width: `${Math.min(100, totalPillarWeight)}%` }}
            />
          </div>
          {!isWeightValid && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              {totalPillarWeight < 100
                ? `Allocate remaining ${100 - totalPillarWeight}% across your pillars to enable saving.`
                : `Total exceeds 100% by ${totalPillarWeight - 100}%.`}
            </p>
          )}
        </div>

        {/* Pillars List */}
        <div className="space-y-4">
          {pillars.map((pillar, idx) => (
            <div key={idx} className="p-4 rounded-xl bg-[var(--surface-hover)] border border-[var(--border)] space-y-3 relative">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={pillar.name}
                  onChange={(e) => updatePillar(idx, 'name', e.target.value)}
                  placeholder="Pillar Name (e.g. AI Engineering & Architecture)"
                  className="flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-semibold text-[var(--foreground)]"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={pillar.weight_pct}
                    onChange={(e) => updatePillar(idx, 'weight_pct', e.target.value)}
                    className="w-16 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm font-mono text-center font-bold text-[var(--foreground)]"
                  />
                  <span className="text-xs text-[var(--muted)] font-mono">%</span>
                </div>
                {pillars.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePillar(idx)}
                    className="text-[var(--muted)] hover:text-rose-500 p-1 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div>
                <input
                  type="text"
                  value={pillar.description || ''}
                  onChange={(e) => updatePillar(idx, 'description', e.target.value)}
                  placeholder="Short description of this pillar's focus and point of view..."
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--muted)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                  Example Topics (comma-separated)
                </label>
                <input
                  type="text"
                  value={(pillar.example_topics || []).join(', ')}
                  onChange={(e) =>
                    updatePillar(
                      idx,
                      'example_topics',
                      e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    )
                  }
                  placeholder="e.g. RAG latency benchmarks, cost optimization, prompt evals"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--foreground)]"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2: Cadence & Generation Volume */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)] flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--accent)]" />
            2. Cadence &amp; Ideas per Run
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            More ideas than posts are suggested per run so you have genuine choice at the human approval gate.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Posts per Week</label>
            <input
              type="number"
              min={1}
              max={14}
              value={cadence.frequency}
              onChange={(e) => setCadence({ ...cadence, frequency: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)] font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Posts per Run</label>
            <input
              type="number"
              min={1}
              max={5}
              value={cadence.posts_per_run}
              onChange={(e) => setCadence({ ...cadence, posts_per_run: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)] font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
              Ideas per Run (Approval Gate)
            </label>
            <input
              type="number"
              min={2}
              max={10}
              value={cadence.ideas_per_run}
              onChange={(e) => setCadence({ ...cadence, ideas_per_run: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--accent)] font-bold font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Target Posting Time
            </label>
            <input
              type="time"
              value={cadence.time_of_day}
              onChange={(e) => setCadence({ ...cadence, time_of_day: e.target.value })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)] font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--foreground)] mb-2">Publishing Target Days</label>
          <div className="flex gap-2 flex-wrap">
            {dayOptions.map((day) => {
              const active = cadence.days_of_week.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                    active
                      ? 'bg-[var(--accent)] border-[var(--accent)] text-white shadow-sm'
                      : 'border-[var(--border)] bg-[var(--surface-hover)] text-[var(--muted)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Section 3: Research & Citation Policy */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)] flex items-center gap-2">
            <Search className="w-4 h-4 text-[var(--accent)]" />
            3. Research &amp; Fact-Checking Policy
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Strict controls on evidence grounding, search freshness, and citation requirements.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-start gap-3 p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] cursor-pointer">
            <input
              type="checkbox"
              checked={research.use_knowledge_base}
              onChange={(e) => setResearch({ ...research, use_knowledge_base: e.target.checked })}
              className="mt-1 accent-[var(--accent)]"
            />
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">Ground with Knowledge Base</p>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Always prioritize claims and case study quotes from your ingested document library.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] cursor-pointer">
            <input
              type="checkbox"
              checked={research.use_web_search}
              onChange={(e) => setResearch({ ...research, use_web_search: e.target.checked })}
              className="mt-1 accent-[var(--accent)]"
            />
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">Enable Serper Web Search</p>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Search live tech news and benchmarks to discover current hooks and angles.
              </p>
            </div>
          </label>
        </div>

        {/* Domain Filtering (Allowed OR Blocked — Never Both) */}
        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-[var(--foreground)]">
              Domain Filtering (Allowed vs Blocked — Never Both)
            </label>
            <span className="text-[11px] text-[var(--muted)]">API constraint enforced</span>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="domain_mode"
                checked={research.domain_mode === 'none'}
                onChange={() => setResearch({ ...research, domain_mode: 'none' })}
                className="accent-[var(--accent)]"
              />
              No restrictions
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="domain_mode"
                checked={research.domain_mode === 'allowed'}
                onChange={() => setResearch({ ...research, domain_mode: 'allowed' })}
                className="accent-[var(--accent)]"
              />
              Allowed domains only
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="domain_mode"
                checked={research.domain_mode === 'blocked'}
                onChange={() => setResearch({ ...research, domain_mode: 'blocked' })}
                className="accent-[var(--accent)]"
              />
              Blocked domains
            </label>
          </div>

          {research.domain_mode !== 'none' && (
            <div>
              <input
                type="text"
                value={domainListInput}
                onChange={(e) => setDomainListInput(e.target.value)}
                placeholder={
                  research.domain_mode === 'allowed'
                    ? 'e.g. github.com, arxiv.org, techcrunch.com'
                    : 'e.g. pinterest.com, quora.com, buzzfeed.com'
                }
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--foreground)]"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
              Freshness Window (Days)
            </label>
            <input
              type="number"
              min={7}
              max={365}
              value={research.freshness_days}
              onChange={(e) => setResearch({ ...research, freshness_days: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </div>

          <label className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] cursor-pointer mt-5">
            <input
              type="checkbox"
              checked={research.require_citations}
              onChange={(e) => setResearch({ ...research, require_citations: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            <span className="text-xs font-medium text-[var(--foreground)]">Require Citations</span>
          </label>

          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
              Min Citations per Post
            </label>
            <input
              type="number"
              min={1}
              max={5}
              value={research.min_citations_per_post}
              onChange={(e) => setResearch({ ...research, min_citations_per_post: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </div>
        </div>
      </section>

      {/* Section 4: Media Policy */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)] flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-[var(--accent)]" />
            4. Visual Media Policy
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">Image generation and visual mode settings.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Default Mode</label>
            <select
              value={media.default_mode}
              onChange={(e) => setMedia({ ...media, default_mode: e.target.value as any })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)]"
            >
              <option value="ai_generated">AI Generated (via AI Gateway)</option>
              <option value="stock_search">Stock Image Search (Serper)</option>
              <option value="none">Text Only</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Aspect Ratio</label>
            <select
              value={media.aspect_ratio}
              onChange={(e) => setMedia({ ...media, aspect_ratio: e.target.value as any })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)]"
            >
              <option value="1:1">Square (1:1) — Ideal for feed</option>
              <option value="16:9">Landscape (16:9)</option>
              <option value="4:5">Portrait (4:5) — Maximum mobile height</option>
            </select>
          </div>

          <label className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] cursor-pointer mt-5">
            <input
              type="checkbox"
              checked={media.always_include_alt_text}
              onChange={(e) => setMedia({ ...media, always_include_alt_text: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            <span className="text-xs font-medium text-[var(--foreground)]">Always Include Alt Text</span>
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
            Brand Visual Style Prompt
          </label>
          <input
            type="text"
            value={media.image_style_prompt}
            onChange={(e) => setMedia({ ...media, image_style_prompt: e.target.value })}
            placeholder="e.g. Modern minimalist technical illustration, dark slate background with glowing neon wireframes"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)]"
          />
        </div>
      </section>

      {/* Section 5: Post Constraints (The Fold) */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)] flex items-center gap-2">
            <FileText className="w-4 h-4 text-[var(--accent)]" />
            5. Post Constraints &amp; The Fold
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Length, hashtag counts, and the critical 200-character hook fold limit before &quot;see more&quot;.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
              Target Length (Chars)
            </label>
            <input
              type="number"
              min={500}
              max={3000}
              value={constraints.target_chars}
              onChange={(e) => setConstraints({ ...constraints, target_chars: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)] font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--accent)] font-bold mb-1">
              Hook Max Chars (The Fold)
            </label>
            <input
              type="number"
              min={50}
              max={250}
              value={constraints.hook_max_chars}
              onChange={(e) => setConstraints({ ...constraints, hook_max_chars: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--accent)]/40 bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--accent)] font-bold font-mono"
            />
            <p className="text-[10px] text-[var(--muted)] mt-0.5">LinkedIn cuts off at ~210 chars</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Emoji Level</label>
            <select
              value={constraints.emoji_level}
              onChange={(e) => setConstraints({ ...constraints, emoji_level: e.target.value as any })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)]"
            >
              <option value="none">None (0 emojis)</option>
              <option value="bullets_only">Bullets Only (1-2 structural markers)</option>
              <option value="liberal">Liberal (High visual flair)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Hashtag Count</label>
            <input
              type="number"
              min={0}
              max={5}
              value={constraints.hashtag_count}
              onChange={(e) => setConstraints({ ...constraints, hashtag_count: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)] font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Link Placement</label>
            <select
              value={constraints.link_placement}
              onChange={(e) => setConstraints({ ...constraints, link_placement: e.target.value as any })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)]"
            >
              <option value="first_comment">First comment (Avoid algorithm penalty)</option>
              <option value="body">In post body (Direct click)</option>
            </select>
          </div>

          <label className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] cursor-pointer mt-5">
            <input
              type="checkbox"
              checked={constraints.cta_required}
              onChange={(e) => setConstraints({ ...constraints, cta_required: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            <span className="text-xs font-medium text-[var(--foreground)]">Mandatory Call to Action (CTA)</span>
          </label>
        </div>
      </section>

      {/* Section 6: Guardrails & Banned Clichés */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)] flex items-center gap-2 text-rose-500">
            <ShieldAlert className="w-4 h-4" />
            6. Guardrails &amp; Pre-Seeded Banned Words
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Explicit clichés, buzzwords, and compliance limits the model will never write.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
              Banned Topics (comma-separated)
            </label>
            <input
              type="text"
              value={bannedTopicsInput}
              onChange={(e) => setBannedTopicsInput(e.target.value)}
              placeholder="politics, crypto speculative hype, unverified health"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
              Banned Clichés &amp; Words (comma-separated)
            </label>
            <input
              type="text"
              value={bannedWordsInput}
              onChange={(e) => setBannedWordsInput(e.target.value)}
              placeholder="delve, leverage, unlock, game-changer, in today's fast-paced world"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
            Compliance Notes
          </label>
          <textarea
            rows={2}
            value={guardrails.compliance_notes}
            onChange={(e) => setGuardrails({ ...guardrails, compliance_notes: e.target.value })}
            placeholder="e.g. Ensure all revenue metrics point to verified claims in the Knowledge Base."
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] p-3 text-sm text-[var(--foreground)] resize-none"
          />
        </div>
      </section>

      {/* Save Button */}
      <div className="pt-4 border-t border-[var(--border)] flex items-center justify-between">
        <span className="text-xs text-[var(--muted)] flex items-center gap-1.5">
          {isWeightValid ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Pillars total 100% · Ready to save
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4 text-amber-500" />
              Adjust pillar weights to exactly 100%
            </>
          )}
        </span>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !isWeightValid}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors disabled:opacity-50 shadow-sm"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving preferences…
            </>
          ) : (
            'Save Preferences →'
          )}
        </button>
      </div>
    </div>
  )
}
