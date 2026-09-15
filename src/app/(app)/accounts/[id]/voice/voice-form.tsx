'use client'

import { showToast } from '@/components/toast-notification'
import {
  AlertCircle,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  GENERIC_PHRASE_BLACKLIST,
  type VoiceAnalysisResult
} from '~/lib/ai/schemas'
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

function cleanErrorMessage(err: unknown): string {
  if (!err) return ''
  if (typeof err === 'string') {
    const trimmed = err.trim()
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          const messages = parsed
            .map((item: any) => item?.message || item?.error || '')
            .filter(Boolean)
          if (messages.length > 0) return messages.join('. ')
        } else if (parsed && typeof parsed === 'object') {
          if (parsed.message) return String(parsed.message)
          if (parsed.error) return String(parsed.error)
        }
      } catch {
        // Not valid JSON, keep as is
      }
    }
    return trimmed
  }
  if (err instanceof Error) {
    return cleanErrorMessage(err.message)
  }
  return String(err)
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
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const clearFieldError = (field: string) => {
    setFieldErrors(prev => {
      if (!prev[field]) return prev
      const updated = { ...prev }
      delete updated[field]
      return updated
    })
    if (error) {
      setError(null)
    }
  }

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
      showToast({
        type: 'error',
        title: 'Sample Posts Required',
        message: 'Please paste sample posts into the box before analyzing.'
      })
      return
    }

    setError(null)
    setIsAnalyzing(true)

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

      const noticeMessage =
        res.provider === 'claude'
          ? `Analyzed successfully with Claude (${res.modelUsed || 'Claude via AI Gateway'}). All style sliders pre-filled.`
          : 'Analyzed with linguistic engine. All style sliders pre-filled.'

      showToast({
        type: 'success',
        title: 'Voice Analyzed Successfully',
        message: noticeMessage
      })
    } catch (err: any) {
      const errMsg = err.message || 'Error running voice analysis'
      setError(errMsg)
      showToast({
        type: 'error',
        title: 'Voice Analysis Failed',
        message: errMsg
      })
      // Fields stay empty/unselected on failure and are re-enabled in finally block
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Handle Save
  const handleSave = () => {
    setError(null)

    // 1. Comprehensive client-side validation
    const errorsMap: Record<string, string> = {}
    const trimmedRubric = derivedRubric.trim()

    if (!trimmedRubric) {
      errorsMap.derivedRubric =
        'Style rubric is required. Click "Analyze my voice" or write a rubric.'
    } else if (trimmedRubric.length < 20) {
      errorsMap.derivedRubric = 'Style rubric must be at least 20 characters.'
    }

    if (formality === null) {
      errorsMap.formality = 'Formality is required (1-5).'
    }
    if (warmth === null) {
      errorsMap.warmth = 'Warmth is required (1-5).'
    }
    if (directness === null) {
      errorsMap.directness = 'Directness is required (1-5).'
    }
    if (storyVsData === null) {
      errorsMap.storyVsData = 'Story vs Data is required (1-5).'
    }
    if (!humor) {
      errorsMap.humor = 'Humor tone is required.'
    }
    if (!energy) {
      errorsMap.energy = 'Energy level is required.'
    }
    if (!perspective) {
      errorsMap.perspective = 'Perspective is required.'
    }
    if (!emojiPolicy) {
      errorsMap.emojiPolicy = 'Emoji policy is required.'
    }
    if (!sentenceLength) {
      errorsMap.sentenceLength = 'Sentence length is required.'
    }
    if (!paragraphStyle) {
      errorsMap.paragraphStyle = 'Paragraph style is required.'
    }

    if (Object.keys(errorsMap).length > 0) {
      setFieldErrors(errorsMap)
      const count = Object.keys(errorsMap).length
      if (count >= 4) {
        setError(
          'Please complete your voice profile settings before saving. You can click "Analyze my voice" above to auto-generate all dimensions from your sample posts, or configure the highlighted fields below.'
        )
      } else {
        setError(Object.values(errorsMap).join(' • '))
      }
      showToast({
        type: 'error',
        title: 'Validation Error',
        message: 'Please complete the highlighted voice fields before saving.'
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    setFieldErrors({})

    startTransition(async () => {
      const res = await saveVoiceConfigAction({
        accountId,
        derivedStyleRubric: trimmedRubric,
        rawSamplesText: samplesText,
        formality: formality!,
        warmth: warmth!,
        directness: directness!,
        humor,
        energy,
        perspective,
        storyVsData: storyVsData!,
        emojiPolicy,
        hashtagPolicy: hashtagPolicy || 'none',
        sentenceLength,
        paragraphStyle,
        readingLevelTarget: readingLevelTarget || 'grade 7-9',
        bannedWords,
        signaturePhrases,
        writingPatterns,
        openingStyles,
        closingStyles
      })

      if (res.success) {
        setError(null)
        setFieldErrors({})
        showToast({
          type: 'success',
          title: 'Voice Profile Saved',
          message: 'Voice profile and style rubric saved successfully.'
        })
        router.refresh()
      } else {
        const errMsg =
          cleanErrorMessage(res.error) || 'Failed to save voice profile'
        setError(errMsg)
        showToast({
          type: 'error',
          title: 'Save Failed',
          message: errMsg
        })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    })
  }

  const addBannedWord = () => {
    const trimmed = newBannedWord.trim().toLowerCase()
    if (!trimmed) {
      setError('Please enter a word to add to banned words.')
      return
    }
    if (trimmed.length < 2) {
      setError('Banned word must be at least 2 characters.')
      return
    }
    if (bannedWords.includes(trimmed)) {
      setError(`"${trimmed}" is already in banned words.`)
      return
    }
    setBannedWords([...bannedWords, trimmed])
    setError(null)
    setNewBannedWord('')
  }

  const removeBannedWord = (word: string) => {
    setBannedWords(bannedWords.filter(w => w !== word))
  }

  const addSignaturePhrase = () => {
    const trimmed = newPhrase.trim()
    if (!trimmed) {
      setError('Please enter a phrase to add to signature phrases.')
      return
    }
    if (trimmed.length < 4) {
      setError('Signature phrase must be at least 4 characters.')
      return
    }
    const normalized = trimmed
      .toLowerCase()
      .replace(/[^\w\s']/g, '')
      .trim()
    if (
      GENERIC_PHRASE_BLACKLIST.has(normalized) ||
      /^(so\s+i|it\s+doesn't|it\s+doesnt|that's\s+why|thats\s+why|that\s+is\s+why|i\s+think|here\s+is)$/i.test(
        normalized
      )
    ) {
      setError(
        `"${trimmed}" is a generic sentence fragment. Please add a distinctive phrase you genuinely use.`
      )
      return
    }
    if (signaturePhrases.includes(trimmed)) {
      setError(`"${trimmed}" is already in signature phrases.`)
      return
    }
    setSignaturePhrases([...signaturePhrases, trimmed])
    setError(null)
    setNewPhrase('')
  }

  const removeSignaturePhrase = (phrase: string) => {
    setSignaturePhrases(signaturePhrases.filter(p => p !== phrase))
  }

  const addWritingPattern = () => {
    const trimmed = newPattern.trim()
    if (!trimmed) {
      setError('Please enter a writing pattern.')
      return
    }
    if (trimmed.length < 5) {
      setError(
        'Writing pattern must be a reusable structure like "You don\'t need X. You need Y."'
      )
      return
    }
    if (writingPatterns.includes(trimmed)) {
      setError(`"${trimmed}" is already in writing patterns.`)
      return
    }
    setWritingPatterns([...writingPatterns, trimmed])
    setError(null)
    setNewPattern('')
  }

  const removeWritingPattern = (pattern: string) => {
    setWritingPatterns(writingPatterns.filter(p => p !== pattern))
  }

  const addOpeningStyle = () => {
    const trimmed = newOpeningStyle.trim()
    if (!trimmed) {
      setError('Please enter an opening style pattern.')
      return
    }
    if (trimmed.length < 4) {
      setError('Opening style pattern must be at least 4 characters.')
      return
    }
    if (openingStyles.includes(trimmed)) {
      setError(`"${trimmed}" is already in opening styles.`)
      return
    }
    setOpeningStyles([...openingStyles, trimmed])
    setError(null)
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
    const trimmed = newClosingStyle.trim()
    if (!trimmed) {
      setError('Please enter a closing style pattern.')
      return
    }
    if (trimmed.length < 4) {
      setError('Closing style pattern must be at least 4 characters.')
      return
    }
    if (closingStyles.includes(trimmed)) {
      setError(`"${trimmed}" is already in closing styles.`)
      return
    }
    setClosingStyles([...closingStyles, trimmed])
    setError(null)
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
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-600 dark:text-red-400">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="leading-relaxed font-semibold">
                {cleanErrorMessage(error)}
              </p>
              {Object.keys(fieldErrors).length > 0 && (
                <p className="text-[11px] opacity-85">
                  Please review and configure the highlighted fields below.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 text-red-500/70 hover:text-red-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 1. VOICE_SAMPLES */}
      <section className="border-border bg-surface rounded-2xl border p-6 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <span className="text-muted font-mono text-xs font-semibold tracking-wider uppercase">
              VOICE_SAMPLES
            </span>
            <p className="text-muted mt-0.5 text-xs">
              Paste 5–15 real past posts that sound like you. Separate distinct
              posts with{' '}
              <code className="bg-surface-hover rounded px-1 font-mono text-[11px]">
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
            className="text-accent flex items-center gap-1.5 text-xs hover:underline disabled:cursor-not-allowed disabled:opacity-50"
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
          className="border-border bg-background text-foreground placeholder-muted/50 focus:border-accent w-full rounded-xl border p-4 font-mono text-xs leading-relaxed focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-60"
        />

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            disabled={isAnalyzing}
            onClick={handleAnalyze}
            className="bg-foreground text-background flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold shadow-xs transition-all hover:opacity-90 disabled:opacity-50"
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

          <span className="text-muted text-xs">
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
          <div className="flex items-center justify-between">
            <span className="text-muted font-mono text-xs font-semibold tracking-wider uppercase">
              DERIVED_STYLE_RUBRIC — AUTO-WRITTEN BY CLAUDE
            </span>
            {fieldErrors.derivedRubric && (
              <span className="text-[11px] font-medium text-red-500">
                * {fieldErrors.derivedRubric}
              </span>
            )}
          </div>
          <div
            className={`relative rounded-xl border p-5 transition-colors ${
              fieldErrors.derivedRubric
                ? 'border-red-500/60 bg-red-500/5 ring-1 ring-red-500/30'
                : 'border-emerald-500/30 bg-emerald-500/10'
            }`}
          >
            <textarea
              rows={3}
              disabled={isAnalyzing}
              value={derivedRubric}
              onChange={e => {
                setDerivedRubric(e.target.value)
                clearFieldError('derivedRubric')
              }}
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
          <span className="text-muted font-mono text-xs font-semibold tracking-wider uppercase">
            VOICE_SLIDERS & DIMENSIONS
          </span>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Formality Slider */}
            <div
              className={`bg-surface rounded-xl border p-4 shadow-2xs transition-colors ${
                fieldErrors.formality
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted font-mono text-[11px] font-semibold uppercase">
                  FORMALITY
                </span>
                <span className="text-foreground font-mono font-bold">
                  {formality !== null ? (
                    `${formality} / 5`
                  ) : fieldErrors.formality ? (
                    <span className="text-[11px] font-semibold text-red-500">
                      Required
                    </span>
                  ) : (
                    <span className="text-muted text-[11px] font-normal">
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
                onChange={e => {
                  setFormality(Number(e.target.value))
                  clearFieldError('formality')
                }}
                className={`accent-accent mt-3 w-full ${formality === null ? 'opacity-30' : ''}`}
              />
              <div className="text-muted mt-1 flex justify-between text-[10px]">
                <span>Casual</span>
                <span>Formal</span>
              </div>
            </div>

            {/* Warmth Slider */}
            <div
              className={`bg-surface rounded-xl border p-4 shadow-2xs transition-colors ${
                fieldErrors.warmth
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted font-mono text-[11px] font-semibold uppercase">
                  WARMTH
                </span>
                <span className="text-foreground font-mono font-bold">
                  {warmth !== null ? (
                    `${warmth} / 5`
                  ) : fieldErrors.warmth ? (
                    <span className="text-[11px] font-semibold text-red-500">
                      Required
                    </span>
                  ) : (
                    <span className="text-muted text-[11px] font-normal">
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
                onChange={e => {
                  setWarmth(Number(e.target.value))
                  clearFieldError('warmth')
                }}
                className={`accent-accent mt-3 w-full ${warmth === null ? 'opacity-30' : ''}`}
              />
              <div className="text-muted mt-1 flex justify-between text-[10px]">
                <span>Clinical</span>
                <span>Empathetic</span>
              </div>
            </div>

            {/* Directness Slider */}
            <div
              className={`bg-surface rounded-xl border p-4 shadow-2xs transition-colors ${
                fieldErrors.directness
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted font-mono text-[11px] font-semibold uppercase">
                  DIRECTNESS
                </span>
                <span className="text-foreground font-mono font-bold">
                  {directness !== null ? (
                    `${directness} / 5`
                  ) : fieldErrors.directness ? (
                    <span className="text-[11px] font-semibold text-red-500">
                      Required
                    </span>
                  ) : (
                    <span className="text-muted text-[11px] font-normal">
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
                onChange={e => {
                  setDirectness(Number(e.target.value))
                  clearFieldError('directness')
                }}
                className={`accent-accent mt-3 w-full ${directness === null ? 'opacity-30' : ''}`}
              />
              <div className="text-muted mt-1 flex justify-between text-[10px]">
                <span>Diplomatic</span>
                <span>Punchy</span>
              </div>
            </div>

            {/* Humor Selector */}
            <div
              className={`bg-surface rounded-xl border p-4 shadow-2xs transition-colors ${
                fieldErrors.humor
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted font-mono text-[11px] font-semibold uppercase">
                  HUMOR
                </span>
                {fieldErrors.humor && (
                  <span className="text-[10px] font-semibold text-red-500">
                    Required
                  </span>
                )}
              </div>
              <select
                value={humor}
                onChange={e => {
                  setHumor(e.target.value)
                  clearFieldError('humor')
                }}
                className={`border-border bg-background mt-2 w-full rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold ${
                  humor ? 'text-foreground' : 'text-muted'
                }`}
              >
                <option value="">Select humor...</option>
                <option value="none">none</option>
                <option value="dry">dry</option>
                <option value="playful">playful</option>
              </select>
            </div>

            {/* Energy Selector */}
            <div
              className={`bg-surface rounded-xl border p-4 shadow-2xs transition-colors ${
                fieldErrors.energy
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted font-mono text-[11px] font-semibold uppercase">
                  ENERGY
                </span>
                {fieldErrors.energy && (
                  <span className="text-[10px] font-semibold text-red-500">
                    Required
                  </span>
                )}
              </div>
              <select
                value={energy}
                onChange={e => {
                  setEnergy(e.target.value)
                  clearFieldError('energy')
                }}
                className={`border-border bg-background mt-2 w-full rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold ${
                  energy ? 'text-foreground' : 'text-muted'
                }`}
              >
                <option value="">Select energy...</option>
                <option value="measured">measured</option>
                <option value="punchy">punchy</option>
              </select>
            </div>

            {/* Perspective Selector */}
            <div
              className={`bg-surface rounded-xl border p-4 shadow-2xs transition-colors ${
                fieldErrors.perspective
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted font-mono text-[11px] font-semibold uppercase">
                  PERSPECTIVE
                </span>
                {fieldErrors.perspective && (
                  <span className="text-[10px] font-semibold text-red-500">
                    Required
                  </span>
                )}
              </div>
              <select
                value={perspective}
                onChange={e => {
                  setPerspective(e.target.value)
                  clearFieldError('perspective')
                }}
                className={`border-border bg-background mt-2 w-full rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold ${
                  perspective ? 'text-foreground' : 'text-muted'
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
            <div
              className={`bg-surface rounded-xl border p-4 shadow-2xs transition-colors ${
                fieldErrors.storyVsData
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted font-mono text-[11px] font-semibold uppercase">
                  STORY_VS_DATA
                </span>
                <span className="text-foreground font-mono font-bold">
                  {storyVsData !== null ? (
                    `${storyVsData} / 5`
                  ) : fieldErrors.storyVsData ? (
                    <span className="text-[11px] font-semibold text-red-500">
                      Required
                    </span>
                  ) : (
                    <span className="text-muted text-[11px] font-normal">
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
                onChange={e => {
                  setStoryVsData(Number(e.target.value))
                  clearFieldError('storyVsData')
                }}
                className={`accent-accent mt-3 w-full ${storyVsData === null ? 'opacity-30' : ''}`}
              />
              <div className="text-muted mt-1 flex justify-between text-[10px]">
                <span>Personal story</span>
                <span>Data-driven</span>
              </div>
            </div>

            {/* Emoji Policy */}
            <div
              className={`bg-surface rounded-xl border p-4 shadow-2xs transition-colors ${
                fieldErrors.emojiPolicy
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted font-mono text-[11px] font-semibold uppercase">
                  EMOJI_POLICY
                </span>
                {fieldErrors.emojiPolicy && (
                  <span className="text-[10px] font-semibold text-red-500">
                    Required
                  </span>
                )}
              </div>
              <select
                value={emojiPolicy}
                onChange={e => {
                  setEmojiPolicy(e.target.value)
                  clearFieldError('emojiPolicy')
                }}
                className={`border-border bg-background mt-2 w-full rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold ${
                  emojiPolicy ? 'text-foreground' : 'text-muted'
                }`}
              >
                <option value="">Select emoji policy...</option>
                <option value="none">none</option>
                <option value="bullets only">bullets only</option>
                <option value="liberal">liberal</option>
              </select>
            </div>

            {/* Hashtag Policy */}
            <div className="border-border bg-surface rounded-xl border p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted font-mono text-[11px] font-semibold uppercase">
                  HASHTAG_POLICY
                </span>
              </div>
              <input
                type="text"
                value={hashtagPolicy}
                onChange={e => setHashtagPolicy(e.target.value)}
                placeholder="e.g. 0-3, end of post"
                className="border-border bg-background text-foreground placeholder-muted/50 mt-2 w-full rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold"
              />
            </div>

            {/* Sentence Length */}
            <div
              className={`bg-surface rounded-xl border p-4 shadow-2xs transition-colors ${
                fieldErrors.sentenceLength
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted font-mono text-[11px] font-semibold uppercase">
                  SENTENCE_LENGTH
                </span>
                {fieldErrors.sentenceLength && (
                  <span className="text-[10px] font-semibold text-red-500">
                    Required
                  </span>
                )}
              </div>
              <select
                value={sentenceLength}
                onChange={e => {
                  setSentenceLength(e.target.value)
                  clearFieldError('sentenceLength')
                }}
                className={`border-border bg-background mt-2 w-full rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold ${
                  sentenceLength ? 'text-foreground' : 'text-muted'
                }`}
              >
                <option value="">Select sentence length...</option>
                <option value="short">short</option>
                <option value="mixed">mixed</option>
                <option value="long">long</option>
              </select>
            </div>

            {/* Paragraph Style */}
            <div
              className={`bg-surface rounded-xl border p-4 shadow-2xs transition-colors ${
                fieldErrors.paragraphStyle
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted font-mono text-[11px] font-semibold uppercase">
                  PARAGRAPH_STYLE
                </span>
                {fieldErrors.paragraphStyle && (
                  <span className="text-[10px] font-semibold text-red-500">
                    Required
                  </span>
                )}
              </div>
              <select
                value={paragraphStyle}
                onChange={e => {
                  setParagraphStyle(e.target.value)
                  clearFieldError('paragraphStyle')
                }}
                className={`border-border bg-background mt-2 w-full rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold ${
                  paragraphStyle ? 'text-foreground' : 'text-muted'
                }`}
              >
                <option value="">Select paragraph style...</option>
                <option value="short paras">short paras</option>
                <option value="single-line breaks">single-line breaks</option>
                <option value="dense">dense</option>
              </select>
            </div>

            {/* Reading Level Target */}
            <div className="border-border bg-surface rounded-xl border p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted font-mono text-[11px] font-semibold uppercase">
                  READING_LEVEL_TARGET
                </span>
              </div>
              <input
                type="text"
                value={readingLevelTarget}
                onChange={e => setReadingLevelTarget(e.target.value)}
                placeholder="e.g. grade 7-9"
                className="border-border bg-background text-foreground placeholder-muted/50 mt-2 w-full rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold"
              />
            </div>
          </div>
        </section>

        {/* 4. BANNED_WORDS[] */}
        <section className="border-border bg-surface rounded-xl border p-5 shadow-xs">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-muted font-mono text-xs font-semibold tracking-wider uppercase">
              BANNED_WORDS[]
            </span>
            <span className="text-muted text-xs">
              Terms strictly filtered out by the deterministic linter
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {bannedWords.map(word => (
              <span
                key={word}
                className="border-border bg-surface-hover text-foreground inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 font-mono text-xs"
              >
                <span>{word}</span>
                <button
                  type="button"
                  onClick={() => removeBannedWord(word)}
                  className="text-muted hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {bannedWords.length === 0 && (
              <span className="text-muted text-xs italic">
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
              className="border-border bg-background text-foreground placeholder-muted/50 focus:border-accent flex-1 rounded-lg border px-3 py-1.5 text-xs focus:outline-hidden"
            />
            <button
              type="button"
              onClick={addBannedWord}
              className="border-border bg-surface-hover text-foreground hover:bg-border flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add</span>
            </button>
          </div>
        </section>

        {/* 5. WRITING_PATTERNS[] */}
        <section className="border-border bg-surface rounded-xl border p-5 shadow-xs">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-muted font-mono text-xs font-semibold tracking-wider uppercase">
              WRITING_PATTERNS[]
            </span>
            <span className="text-muted text-xs">
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
                  className="text-muted hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {writingPatterns.length === 0 && (
              <span className="text-muted text-xs italic">
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
              className="border-border bg-background text-foreground placeholder-muted/50 focus:border-accent flex-1 rounded-lg border px-3 py-1.5 text-xs focus:outline-hidden"
            />
            <button
              type="button"
              onClick={addWritingPattern}
              className="border-border bg-surface-hover text-foreground hover:bg-border flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Pattern</span>
            </button>
          </div>
        </section>

        {/* 6. SIGNATURE_PHRASES[] */}
        <section className="border-border bg-surface rounded-xl border p-5 shadow-xs">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-muted font-mono text-xs font-semibold tracking-wider uppercase">
              SIGNATURE_PHRASES[]
            </span>
            <span className="text-muted text-xs">
              Phrases you genuinely say to give posts your authentic rhythm
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {signaturePhrases.map(phrase => (
              <span
                key={phrase}
                className="border-border bg-surface-hover text-foreground inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 font-mono text-xs"
              >
                <span>{phrase}</span>
                <button
                  type="button"
                  onClick={() => removeSignaturePhrase(phrase)}
                  className="text-muted hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {signaturePhrases.length === 0 && (
              <span className="text-muted text-xs italic">
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
              className="border-border bg-background text-foreground placeholder-muted/50 focus:border-accent flex-1 rounded-lg border px-3 py-1.5 text-xs focus:outline-hidden"
            />
            <button
              type="button"
              onClick={addSignaturePhrase}
              className="border-border bg-surface-hover text-foreground hover:bg-border flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add</span>
            </button>
          </div>
        </section>

        {/* 7. OPENING & CLOSING STYLES */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* Opening Styles */}
          <section className="border-border bg-surface rounded-xl border p-5 shadow-xs">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-muted font-mono text-xs font-semibold tracking-wider uppercase">
                OPENING_HOOK_STYLES[]
              </span>
              <span className="text-muted text-xs">
                Observed sample patterns
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {openingStyles.map(style => (
                <span
                  key={style}
                  className="border-border bg-surface-hover text-foreground inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs"
                >
                  <span>{style}</span>
                  <button
                    type="button"
                    onClick={() => removeOpeningStyle(style)}
                    className="text-muted hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {openingStyles.length === 0 && (
                <span className="text-muted text-xs italic">
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
                className="border-border bg-background text-foreground placeholder-muted/50 focus:border-accent flex-1 rounded-lg border px-3 py-1.5 text-xs focus:outline-hidden"
              />
              <button
                type="button"
                onClick={addOpeningStyle}
                className="border-border bg-surface-hover text-foreground hover:bg-border flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </button>
            </div>

            <div className="border-border mt-3 border-t pt-2.5">
              <span className="text-muted text-[10px] font-semibold tracking-wider uppercase">
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
                        ? 'bg-accent text-background'
                        : 'bg-surface-hover text-muted hover:text-foreground'
                    }`}
                  >
                    + {suggested}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Closing Styles */}
          <section className="border-border bg-surface rounded-xl border p-5 shadow-xs">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-muted font-mono text-xs font-semibold tracking-wider uppercase">
                CLOSING_STYLES[]
              </span>
              <span className="text-muted text-xs">
                Observed sample patterns
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {closingStyles.map(style => (
                <span
                  key={style}
                  className="border-border bg-surface-hover text-foreground inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs"
                >
                  <span>{style}</span>
                  <button
                    type="button"
                    onClick={() => removeClosingStyle(style)}
                    className="text-muted hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {closingStyles.length === 0 && (
                <span className="text-muted text-xs italic">
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
                className="border-border bg-background text-foreground placeholder-muted/50 focus:border-accent flex-1 rounded-lg border px-3 py-1.5 text-xs focus:outline-hidden"
              />
              <button
                type="button"
                onClick={addClosingStyle}
                className="border-border bg-surface-hover text-foreground hover:bg-border flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </button>
            </div>

            <div className="border-border mt-3 border-t pt-2.5">
              <span className="text-muted text-[10px] font-semibold tracking-wider uppercase">
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
                        ? 'bg-accent text-background'
                        : 'bg-surface-hover text-muted hover:text-foreground'
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
      <div className="border-border bg-surface/95 sticky bottom-4 z-20 flex items-center justify-end rounded-2xl border p-4 shadow-lg backdrop-blur-md">
        <button
          type="button"
          disabled={isPending || isAnalyzing}
          onClick={handleSave}
          className="bg-accent text-background hover:bg-accent-hover flex items-center gap-2 rounded-xl px-6 py-2.5 text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
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
