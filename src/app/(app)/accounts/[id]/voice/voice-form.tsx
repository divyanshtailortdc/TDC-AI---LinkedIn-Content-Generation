'use client'

import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { VoiceAnalysisResult } from '~/lib/ai/schemas'
import { analyzeVoiceAction, saveVoiceConfigAction } from './actions'

interface VoiceFormProps {
  accountId: string
  initialConfig?: {
    derivedStyleRubric?: string | null
    rawSamplesText?: string | null
    formality?: number | null
    warmth?: number | null
    directness?: number | null
    humor?: string | null
    energy?: string | null
    perspective?: string | null
    storyVsData?: number | null
    emojiPolicy?: string | null
    hashtagPolicy?: string | null
    sentenceLength?: string | null
    paragraphStyle?: string | null
    readingLevelTarget?: string | null
    bannedWords?: string[] | null
    signaturePhrases?: string[] | null
    openingStyles?: string[] | null
    closingStyles?: string[] | null
    rules?: string | null
  } | null
}

function parseWritingPatterns(rules?: string | null): string[] {
  if (!rules) return []
  const match = rules.match(/Core Writing Patterns:\n([\s\S]*?)(?:\n\n|$)/)
  if (match && match[1]) {
    return match[1]
      .split('\n')
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(Boolean)
  }
  return []
}

const DEMO_SAMPLES = `I spent 4 years building our first SaaS before making a single dollar of net profit. [PERFORMED WELL]

Everyone told us to pivot to enterprise. We stayed in self-serve.

Here is the one number that saved us:
Net revenue retention on our $49/mo plans was 114%.

If your smallest users expand with you, your unit economics will catch up.
Don't abandon your core audience just because enterprise looks shinier on LinkedIn.
---
Most founders over-complicate their stack in year one.

You do not need Kubernetes.
You do not need microservices.
You do not need multi-region clusters.

We ran $2M ARR on a single Postgres instance with automated daily backups.

Ship features people pay for today. Optimize infrastructure when real customer load demands it.
---
An uncomfortable truth about engineering leadership: [PERFORMED WELL]

Your team remembers how you reacted to their worst outage 10x more than any bonus.

Blame creates hesitation. Curiosity creates problem solvers.

Next time something breaks, ask "what failed in our system?", not "who pushed that commit?".`

export function VoiceForm({ accountId, initialConfig }: VoiceFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [analysisNotice, setAnalysisNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Form states — start unselected / empty unless already saved in initialConfig
  const [samplesText, setSamplesText] = useState(
    initialConfig?.rawSamplesText || ''
  )
  const [derivedRubric, setDerivedRubric] = useState(
    initialConfig?.derivedStyleRubric || ''
  )
  const [formality, setFormality] = useState<number | null>(
    initialConfig?.formality ?? null
  )
  const [warmth, setWarmth] = useState<number | null>(
    initialConfig?.warmth ?? null
  )
  const [directness, setDirectness] = useState<number | null>(
    initialConfig?.directness ?? null
  )
  const [humor, setHumor] = useState(initialConfig?.humor || '')
  const [energy, setEnergy] = useState(initialConfig?.energy || '')
  const [perspective, setPerspective] = useState(
    initialConfig?.perspective || ''
  )
  const [storyVsData, setStoryVsData] = useState<number | null>(
    initialConfig?.storyVsData ?? null
  )
  const [emojiPolicy, setEmojiPolicy] = useState(
    initialConfig?.emojiPolicy || ''
  )
  const [hashtagPolicy, setHashtagPolicy] = useState(
    initialConfig?.hashtagPolicy || ''
  )
  const [sentenceLength, setSentenceLength] = useState(
    initialConfig?.sentenceLength || ''
  )
  const [paragraphStyle, setParagraphStyle] = useState(
    initialConfig?.paragraphStyle || ''
  )
  const [readingLevelTarget, setReadingLevelTarget] = useState(
    initialConfig?.readingLevelTarget || ''
  )

  const [bannedWords, setBannedWords] = useState<string[]>(
    initialConfig?.bannedWords && initialConfig.bannedWords.length > 0
      ? initialConfig.bannedWords
      : []
  )
  const [newBannedWord, setNewBannedWord] = useState('')

  const initialPatterns = parseWritingPatterns(initialConfig?.rules)
  const [writingPatterns, setWritingPatterns] = useState<string[]>(
    initialPatterns.length > 0 ? initialPatterns : []
  )
  const [newPattern, setNewPattern] = useState('')

  const [signaturePhrases, setSignaturePhrases] = useState<string[]>(
    initialConfig?.signaturePhrases && initialConfig.signaturePhrases.length > 0
      ? initialConfig.signaturePhrases
      : []
  )
  const [newPhrase, setNewPhrase] = useState('')

  const [openingStyles, setOpeningStyles] = useState<string[]>(
    initialConfig?.openingStyles && initialConfig.openingStyles.length > 0
      ? initialConfig.openingStyles
      : []
  )
  const [newOpeningStyle, setNewOpeningStyle] = useState('')

  const [closingStyles, setClosingStyles] = useState<string[]>(
    initialConfig?.closingStyles && initialConfig.closingStyles.length > 0
      ? initialConfig.closingStyles
      : []
  )
  const [newClosingStyle, setNewClosingStyle] = useState('')

  // Resets all sliders, dropdowns, and dimensions to unselected / empty
  const resetAllVoiceFields = () => {
    setDerivedRubric('')
    setFormality(null)
    setWarmth(null)
    setDirectness(null)
    setStoryVsData(null)
    setHumor('')
    setEnergy('')
    setPerspective('')
    setEmojiPolicy('')
    setHashtagPolicy('')
    setSentenceLength('')
    setParagraphStyle('')
    setReadingLevelTarget('')
    setBannedWords([])
    setSignaturePhrases([])
    setWritingPatterns([])
    setOpeningStyles([])
    setClosingStyles([])
  }

  const handleSamplesChange = (text: string) => {
    setSamplesText(text)
    // Whenever user provides new sample data, clear all sliders and dimensions so nothing remains selected
    resetAllVoiceFields()
  }

  // Handle Voice Analysis
  const handleAnalyze = async () => {
    if (!samplesText.trim()) {
      setError('Please paste sample posts into the box before analyzing.')
      return
    }

    setError(null)
    setIsAnalyzing(true)
    setAnalysisNotice(null)

    // Reset all AI-generated voice fields to empty/unselected state before analysis starts
    resetAllVoiceFields()
    setSignaturePhrases([])
    setWritingPatterns([])
    setOpeningStyles([])
    setClosingStyles([])

    try {
      const res = await analyzeVoiceAction(samplesText)
      if (!res.success || !res.data) {
        throw new Error(res.error || 'Voice analysis failed')
      }

      const data: VoiceAnalysisResult = res.data

      // Pre-fill all fields with fresh AI output
      setDerivedRubric(data.derivedStyleRubric)
      setFormality(data.formality)
      setWarmth(data.warmth)
      setDirectness(data.directness)
      setHumor(data.humor)
      setEnergy(data.energy)
      setPerspective(data.perspective)
      setStoryVsData(data.storyVsData)
      setEmojiPolicy(data.emojiPolicy)
      setHashtagPolicy(data.hashtagPolicy)
      setSentenceLength(data.sentenceLength)
      setParagraphStyle(data.paragraphStyle)
      setReadingLevelTarget(data.readingLevelTarget)

      // Set fresh arrays from AI results
      setBannedWords(
        data.bannedWords && data.bannedWords.length > 0 ? data.bannedWords : []
      )
      setSignaturePhrases(
        data.signaturePhrases && data.signaturePhrases.length > 0
          ? data.signaturePhrases
          : []
      )
      setWritingPatterns(
        data.writingPatterns && data.writingPatterns.length > 0
          ? data.writingPatterns
          : []
      )
      setOpeningStyles(
        data.openingStyles && data.openingStyles.length > 0
          ? data.openingStyles
          : []
      )
      setClosingStyles(
        data.closingStyles && data.closingStyles.length > 0
          ? data.closingStyles
          : []
      )

      setAnalysisNotice(
        res.provider === 'claude'
          ? `Analyzed successfully with Claude (${res.modelUsed || 'Claude via AI Gateway'}). All style sliders pre-filled.`
          : 'Analyzed with linguistic engine. Add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to .env.local to use Claude.'
      )
    } catch (err: any) {
      setError(err.message || 'Error running voice analysis')
      // Fields stay empty/unselected on failure and are re-enabled in finally block
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Handle Save
  const handleSave = () => {
    setError(null)
    setSaveSuccess(false)

    startTransition(async () => {
      const res = await saveVoiceConfigAction({
        accountId,
        derivedStyleRubric: derivedRubric,
        rawSamplesText: samplesText,
        formality: formality ?? 3,
        warmth: warmth ?? 3,
        directness: directness ?? 3,
        humor: humor || 'dry',
        energy: energy || 'measured',
        perspective: perspective || 'I',
        storyVsData: storyVsData ?? 3,
        emojiPolicy: emojiPolicy || 'none',
        hashtagPolicy: hashtagPolicy || '0-3, end of post',
        sentenceLength: sentenceLength || 'short',
        paragraphStyle: paragraphStyle || 'short paras',
        readingLevelTarget: readingLevelTarget || 'grade 7-9',
        bannedWords,
        signaturePhrases,
        writingPatterns,
        openingStyles,
        closingStyles
      })

      if (res.success) {
        setSaveSuccess(true)
        router.refresh()
        setTimeout(() => setSaveSuccess(false), 4000)
      } else {
        setError(res.error || 'Failed to save voice profile')
      }
    })
  }

  const addBannedWord = () => {
    if (!newBannedWord.trim()) return
    if (!bannedWords.includes(newBannedWord.trim())) {
      setBannedWords([...bannedWords, newBannedWord.trim()])
    }
    setNewBannedWord('')
  }

  const removeBannedWord = (word: string) => {
    setBannedWords(bannedWords.filter(w => w !== word))
  }

  const addSignaturePhrase = () => {
    if (!newPhrase.trim()) return
    if (!signaturePhrases.includes(newPhrase.trim())) {
      setSignaturePhrases([...signaturePhrases, newPhrase.trim()])
    }
    setNewPhrase('')
  }

  const removeSignaturePhrase = (phrase: string) => {
    setSignaturePhrases(signaturePhrases.filter(p => p !== phrase))
  }

  const addWritingPattern = () => {
    if (!newPattern.trim()) return
    if (!writingPatterns.includes(newPattern.trim())) {
      setWritingPatterns([...writingPatterns, newPattern.trim()])
    }
    setNewPattern('')
  }

  const removeWritingPattern = (pattern: string) => {
    setWritingPatterns(writingPatterns.filter(p => p !== pattern))
  }

  const addOpeningStyle = () => {
    if (!newOpeningStyle.trim()) return
    if (!openingStyles.includes(newOpeningStyle.trim())) {
      setOpeningStyles([...openingStyles, newOpeningStyle.trim()])
    }
    setNewOpeningStyle('')
  }

  const removeOpeningStyle = (style: string) => {
    setOpeningStyles(openingStyles.filter(s => s !== style))
  }

  const toggleOpeningStyle = (style: string) => {
    if (openingStyles.includes(style)) {
      setOpeningStyles(openingStyles.filter(s => s !== style))
    } else {
      setOpeningStyles([...openingStyles, style])
    }
  }

  const addClosingStyle = () => {
    if (!newClosingStyle.trim()) return
    if (!closingStyles.includes(newClosingStyle.trim())) {
      setClosingStyles([...closingStyles, newClosingStyle.trim()])
    }
    setNewClosingStyle('')
  }

  const removeClosingStyle = (style: string) => {
    setClosingStyles(closingStyles.filter(s => s !== style))
  }

  const toggleClosingStyle = (style: string) => {
    if (closingStyles.includes(style)) {
      setClosingStyles(closingStyles.filter(s => s !== style))
    } else {
      setClosingStyles([...closingStyles, style])
    }
  }

  return (
    <div className="space-y-8">
      {/* Notifications */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {analysisNotice && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{analysisNotice}</p>
        </div>
      )}

      {saveSuccess && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Voice profile saved! Your setup checklist is updated.</p>
        </div>
      )}

      {/* 1. VOICE_SAMPLES */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <span className="font-mono text-xs font-semibold tracking-wider text-[var(--muted)] uppercase">
              VOICE_SAMPLES
            </span>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Paste 5–15 real past posts that sound like you. Separate distinct
              posts with{' '}
              <code className="rounded bg-[var(--surface-hover)] px-1 font-mono text-[11px]">
                ---
              </code>
              .
            </p>
          </div>

          <button
            type="button"
            disabled={isAnalyzing}
            onClick={() => {
              setSamplesText(DEMO_SAMPLES)
              resetAllVoiceFields()
            }}
            className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Load sample posts
          </button>
        </div>

        <textarea
          rows={7}
          disabled={isAnalyzing}
          value={samplesText}
          onChange={e => handleSamplesChange(e.target.value)}
          placeholder="Paste 5–15 real past posts..."
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 font-mono text-xs leading-relaxed text-[var(--foreground)] placeholder-[var(--muted)]/50 focus:border-[var(--accent)] focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-60"
        />

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            disabled={isAnalyzing}
            onClick={handleAnalyze}
            className="flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-xs font-semibold text-white shadow-xs transition-all hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Reading posts and extracting style rubric...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                <span>Analyze my voice</span>
              </>
            )}
          </button>

          <span className="text-xs text-[var(--muted)]">
            {samplesText.trim().length > 0
              ? `${samplesText.split(/\s+/).filter(Boolean).length} words parsed`
              : 'Pasting real posts gives the best results'}
          </span>
        </div>
      </section>

      {/* 2 to 6: VOICE RESULT FIELDS (Disabled and locked while analysis is in progress) */}
      <fieldset
        disabled={isAnalyzing}
        className={`space-y-8 border-none p-0 transition-opacity duration-200 ${
          isAnalyzing ? 'cursor-not-allowed opacity-50 select-none' : ''
        }`}
      >
        {/* 2. DERIVED_STYLE_RUBRIC — AUTO-WRITTEN BY CLAUDE */}
        <section className="space-y-2">
          <span className="font-mono text-xs font-semibold tracking-wider text-[var(--muted)] uppercase">
            DERIVED_STYLE_RUBRIC — AUTO-WRITTEN BY CLAUDE
          </span>
          <div className="relative rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
            <textarea
              rows={3}
              disabled={isAnalyzing}
              value={derivedRubric}
              onChange={e => setDerivedRubric(e.target.value)}
              className="w-full resize-none bg-transparent text-sm leading-relaxed font-medium text-emerald-800 focus:outline-hidden disabled:cursor-not-allowed dark:text-emerald-200"
              placeholder="Claude will write your style rubric here..."
            />
            <p className="mt-1 text-[11px] text-emerald-700/70 dark:text-emerald-300/70">
              This rubric is injected into Claude&apos;s system prompt during
              content generation.
            </p>
          </div>
        </section>

        {/* 3. GRID OF VOICE SLIDERS & CONTROLS (Image 2 style) */}
        <section className="space-y-4">
          <span className="font-mono text-xs font-semibold tracking-wider text-[var(--muted)] uppercase">
            VOICE_SLIDERS & DIMENSIONS
          </span>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Formality Slider */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)] uppercase">
                  FORMALITY
                </span>
                <span className="font-mono font-bold text-[var(--foreground)]">
                  {formality !== null ? (
                    `${formality} / 5`
                  ) : (
                    <span className="text-[11px] font-normal text-[var(--muted)]">
                      Not set
                    </span>
                  )}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                value={formality ?? 3}
                onChange={e => setFormality(Number(e.target.value))}
                className={`mt-3 w-full accent-[var(--accent)] ${formality === null ? 'opacity-30' : ''}`}
              />
              <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
                <span>Casual</span>
                <span>Formal</span>
              </div>
            </div>

            {/* Warmth Slider */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)] uppercase">
                  WARMTH
                </span>
                <span className="font-mono font-bold text-[var(--foreground)]">
                  {warmth !== null ? (
                    `${warmth} / 5`
                  ) : (
                    <span className="text-[11px] font-normal text-[var(--muted)]">
                      Not set
                    </span>
                  )}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                value={warmth ?? 3}
                onChange={e => setWarmth(Number(e.target.value))}
                className={`mt-3 w-full accent-[var(--accent)] ${warmth === null ? 'opacity-30' : ''}`}
              />
              <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
                <span>Clinical</span>
                <span>Empathetic</span>
              </div>
            </div>

            {/* Directness Slider */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)] uppercase">
                  DIRECTNESS
                </span>
                <span className="font-mono font-bold text-[var(--foreground)]">
                  {directness !== null ? (
                    `${directness} / 5`
                  ) : (
                    <span className="text-[11px] font-normal text-[var(--muted)]">
                      Not set
                    </span>
                  )}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                value={directness ?? 3}
                onChange={e => setDirectness(Number(e.target.value))}
                className={`mt-3 w-full accent-[var(--accent)] ${directness === null ? 'opacity-30' : ''}`}
              />
              <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
                <span>Diplomatic</span>
                <span>Punchy</span>
              </div>
            </div>

            {/* Humor Selector */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)] uppercase">
                  HUMOR
                </span>
              </div>
              <select
                value={humor}
                onChange={e => setHumor(e.target.value)}
                className={`mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs font-semibold ${
                  humor ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'
                }`}
              >
                <option value="">Select humor...</option>
                <option value="none">none</option>
                <option value="dry">dry</option>
                <option value="playful">playful</option>
              </select>
            </div>

            {/* Energy Selector */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)] uppercase">
                  ENERGY
                </span>
              </div>
              <select
                value={energy}
                onChange={e => setEnergy(e.target.value)}
                className={`mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs font-semibold ${
                  energy ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'
                }`}
              >
                <option value="">Select energy...</option>
                <option value="measured">measured</option>
                <option value="punchy">punchy</option>
              </select>
            </div>

            {/* Perspective Selector */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)] uppercase">
                  PERSPECTIVE
                </span>
              </div>
              <select
                value={perspective}
                onChange={e => setPerspective(e.target.value)}
                className={`mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs font-semibold ${
                  perspective ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'
                }`}
              >
                <option value="">Select perspective...</option>
                <option value="I">I (First person singular)</option>
                <option value="we">we (First person team)</option>
                <option value="third person">
                  third person (Brand/observer)
                </option>
              </select>
            </div>

            {/* Story vs Data */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)] uppercase">
                  STORY_VS_DATA
                </span>
                <span className="font-mono font-bold text-[var(--foreground)]">
                  {storyVsData !== null ? (
                    `${storyVsData} / 5`
                  ) : (
                    <span className="text-[11px] font-normal text-[var(--muted)]">
                      Not set
                    </span>
                  )}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                value={storyVsData ?? 3}
                onChange={e => setStoryVsData(Number(e.target.value))}
                className={`mt-3 w-full accent-[var(--accent)] ${storyVsData === null ? 'opacity-30' : ''}`}
              />
              <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
                <span>Personal story</span>
                <span>Data-driven</span>
              </div>
            </div>

            {/* Emoji Policy */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)] uppercase">
                  EMOJI_POLICY
                </span>
              </div>
              <select
                value={emojiPolicy}
                onChange={e => setEmojiPolicy(e.target.value)}
                className={`mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs font-semibold ${
                  emojiPolicy ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'
                }`}
              >
                <option value="">Select emoji policy...</option>
                <option value="none">none</option>
                <option value="bullets only">bullets only</option>
                <option value="liberal">liberal</option>
              </select>
            </div>

            {/* Hashtag Policy */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)] uppercase">
                  HASHTAG_POLICY
                </span>
              </div>
              <input
                type="text"
                value={hashtagPolicy}
                onChange={e => setHashtagPolicy(e.target.value)}
                placeholder="e.g. 0-3, end of post"
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs font-semibold text-[var(--foreground)] placeholder-[var(--muted)]/50"
              />
            </div>

            {/* Sentence Length */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)] uppercase">
                  SENTENCE_LENGTH
                </span>
              </div>
              <select
                value={sentenceLength}
                onChange={e => setSentenceLength(e.target.value)}
                className={`mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs font-semibold ${
                  sentenceLength ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'
                }`}
              >
                <option value="">Select sentence length...</option>
                <option value="short">short</option>
                <option value="mixed">mixed</option>
                <option value="long">long</option>
              </select>
            </div>

            {/* Paragraph Style */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)] uppercase">
                  PARAGRAPH_STYLE
                </span>
              </div>
              <select
                value={paragraphStyle}
                onChange={e => setParagraphStyle(e.target.value)}
                className={`mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs font-semibold ${
                  paragraphStyle ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'
                }`}
              >
                <option value="">Select paragraph style...</option>
                <option value="short paras">short paras</option>
                <option value="single-line breaks">single-line breaks</option>
                <option value="dense">dense</option>
              </select>
            </div>

            {/* Reading Level Target */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)] uppercase">
                  READING_LEVEL_TARGET
                </span>
              </div>
              <input
                type="text"
                value={readingLevelTarget}
                onChange={e => setReadingLevelTarget(e.target.value)}
                placeholder="e.g. grade 7-9"
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs font-semibold text-[var(--foreground)] placeholder-[var(--muted)]/50"
              />
            </div>
          </div>
        </section>

        {/* 4. BANNED_WORDS[] */}
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xs">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs font-semibold tracking-wider text-[var(--muted)] uppercase">
              BANNED_WORDS[]
            </span>
            <span className="text-xs text-[var(--muted)]">
              Terms strictly filtered out by the deterministic linter
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {bannedWords.map(word => (
              <span
                key={word}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-1 font-mono text-xs text-[var(--foreground)]"
              >
                <span>{word}</span>
                <button
                  type="button"
                  onClick={() => removeBannedWord(word)}
                  className="text-[var(--muted)] hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {bannedWords.length === 0 && (
              <span className="text-xs text-[var(--muted)] italic">
                No banned words yet.
              </span>
            )}
          </div>

          <div className="mt-4 flex max-w-sm items-center gap-2">
            <input
              type="text"
              value={newBannedWord}
              onChange={e => setNewBannedWord(e.target.value)}
              onKeyDown={e =>
                e.key === 'Enter' && (e.preventDefault(), addBannedWord())
              }
              placeholder="Add banned word..."
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] placeholder-[var(--muted)]/50 focus:border-[var(--accent)] focus:outline-hidden"
            />
            <button
              type="button"
              onClick={addBannedWord}
              className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--border)]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add</span>
            </button>
          </div>
        </section>

        {/* 5. WRITING_PATTERNS[] */}
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xs">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs font-semibold tracking-wider text-[var(--muted)] uppercase">
              WRITING_PATTERNS[]
            </span>
            <span className="text-xs text-[var(--muted)]">
              Syntactic frames &amp; contrast structures detected from your
              posts (e.g. &quot;X isn&apos;t the problem. Y is.&quot;)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {writingPatterns.map(pattern => (
              <span
                key={pattern}
                className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1 font-mono text-xs text-purple-800 dark:text-purple-300"
              >
                <span>{pattern}</span>
                <button
                  type="button"
                  onClick={() => removeWritingPattern(pattern)}
                  className="text-[var(--muted)] hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {writingPatterns.length === 0 && (
              <span className="text-xs text-[var(--muted)] italic">
                No custom patterns yet. Claude will extract them during
                analysis, or add your own below.
              </span>
            )}
          </div>

          <div className="mt-4 flex max-w-md items-center gap-2">
            <input
              type="text"
              value={newPattern}
              onChange={e => setNewPattern(e.target.value)}
              onKeyDown={e =>
                e.key === 'Enter' && (e.preventDefault(), addWritingPattern())
              }
              placeholder="e.g. You don't need X. You need Y."
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] placeholder-[var(--muted)]/50 focus:border-[var(--accent)] focus:outline-hidden"
            />
            <button
              type="button"
              onClick={addWritingPattern}
              className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--border)]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Pattern</span>
            </button>
          </div>
        </section>

        {/* 6. SIGNATURE_PHRASES[] */}
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xs">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs font-semibold tracking-wider text-[var(--muted)] uppercase">
              SIGNATURE_PHRASES[]
            </span>
            <span className="text-xs text-[var(--muted)]">
              Phrases you genuinely say to give posts your authentic rhythm
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {signaturePhrases.map(phrase => (
              <span
                key={phrase}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-1 font-mono text-xs text-[var(--foreground)]"
              >
                <span>{phrase}</span>
                <button
                  type="button"
                  onClick={() => removeSignaturePhrase(phrase)}
                  className="text-[var(--muted)] hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {signaturePhrases.length === 0 && (
              <span className="text-xs text-[var(--muted)] italic">
                No signature phrases yet.
              </span>
            )}
          </div>

          <div className="mt-4 flex max-w-sm items-center gap-2">
            <input
              type="text"
              value={newPhrase}
              onChange={e => setNewPhrase(e.target.value)}
              onKeyDown={e =>
                e.key === 'Enter' && (e.preventDefault(), addSignaturePhrase())
              }
              placeholder="Add signature phrase..."
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] placeholder-[var(--muted)]/50 focus:border-[var(--accent)] focus:outline-hidden"
            />
            <button
              type="button"
              onClick={addSignaturePhrase}
              className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--border)]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add</span>
            </button>
          </div>
        </section>

        {/* 7. OPENING & CLOSING STYLES */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* Opening Styles */}
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xs">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-xs font-semibold tracking-wider text-[var(--muted)] uppercase">
                OPENING_HOOK_STYLES[]
              </span>
              <span className="text-xs text-[var(--muted)]">
                Observed sample patterns
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {openingStyles.map(style => (
                <span
                  key={style}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1 text-xs text-[var(--foreground)]"
                >
                  <span>{style}</span>
                  <button
                    type="button"
                    onClick={() => removeOpeningStyle(style)}
                    className="text-[var(--muted)] hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {openingStyles.length === 0 && (
                <span className="text-xs text-[var(--muted)] italic">
                  No opening hook styles yet.
                </span>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                value={newOpeningStyle}
                onChange={e => setNewOpeningStyle(e.target.value)}
                onKeyDown={e =>
                  e.key === 'Enter' && (e.preventDefault(), addOpeningStyle())
                }
                placeholder="Add opening style..."
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] placeholder-[var(--muted)]/50 focus:border-[var(--accent)] focus:outline-hidden"
              />
              <button
                type="button"
                onClick={addOpeningStyle}
                className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--border)]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </button>
            </div>

            <div className="mt-3 border-t border-[var(--border)] pt-2.5">
              <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase">
                Quick Suggestions:
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[
                  'Concrete timeline or metric scene',
                  'Contrarian observation without preamble',
                  'Before vs after struggle',
                  'Direct dialogue / quote hook',
                  'Stat breakdown'
                ].map(suggested => (
                  <button
                    key={suggested}
                    type="button"
                    onClick={() => toggleOpeningStyle(suggested)}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      openingStyles.includes(suggested)
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--surface-hover)] text-[var(--muted)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    + {suggested}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Closing Styles */}
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xs">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-xs font-semibold tracking-wider text-[var(--muted)] uppercase">
                CLOSING_STYLES[]
              </span>
              <span className="text-xs text-[var(--muted)]">
                Observed sample patterns
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {closingStyles.map(style => (
                <span
                  key={style}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1 text-xs text-[var(--foreground)]"
                >
                  <span>{style}</span>
                  <button
                    type="button"
                    onClick={() => removeClosingStyle(style)}
                    className="text-[var(--muted)] hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {closingStyles.length === 0 && (
                <span className="text-xs text-[var(--muted)] italic">
                  No closing styles yet.
                </span>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                value={newClosingStyle}
                onChange={e => setNewClosingStyle(e.target.value)}
                onKeyDown={e =>
                  e.key === 'Enter' && (e.preventDefault(), addClosingStyle())
                }
                placeholder="Add closing style..."
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] placeholder-[var(--muted)]/50 focus:border-[var(--accent)] focus:outline-hidden"
              />
              <button
                type="button"
                onClick={addClosingStyle}
                className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--border)]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </button>
            </div>

            <div className="mt-3 border-t border-[var(--border)] pt-2.5">
              <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase">
                Quick Suggestions:
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[
                  'Reflective inquiry without engagement bait',
                  'Concise imperative rule',
                  'Open question for peer perspectives',
                  'Counter-intuitive moral',
                  'No hard CTA'
                ].map(suggested => (
                  <button
                    key={suggested}
                    type="button"
                    onClick={() => toggleClosingStyle(suggested)}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      closingStyles.includes(suggested)
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--surface-hover)] text-[var(--muted)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    + {suggested}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </fieldset>

      {/* 7. SAVE BUTTON FOOTER */}
      <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-4 shadow-lg backdrop-blur-md">
        <div className="text-xs text-[var(--muted)]">
          {saveSuccess ? (
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              ✓ Voice profile saved and active
            </span>
          ) : (
            <span>Ready to commit voice rubric and style preferences</span>
          )}
        </div>

        <button
          type="button"
          disabled={isPending || isAnalyzing}
          onClick={handleSave}
          className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-6 py-2.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              <span>Save Voice Profile</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
