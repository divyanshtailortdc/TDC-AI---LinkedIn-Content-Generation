'use client'

import { PrefillBanner } from '@/components/ai-setup/prefill-banner'
import { useSectionPrefill } from '@/components/ai-setup/use-section-prefill'
import { showToast } from '@/components/toast-notification'
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  PenLine,
  Save,
  SlidersHorizontal,
  Sparkles,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type ReactNode } from 'react'
import type { VoiceConfig } from '~/db/schema'
import { parseHashtagPolicy } from '~/lib/ai/hashtags'
import {
  voiceSuggestionValues,
  type VoiceValues
} from '~/lib/ai/identity-setup/merge'
import { WRITING_STYLES } from '~/lib/ai/schemas'
import { saveVoiceConfigAction } from './actions'

interface VoiceFormProps {
  accountId: string
  initialConfig?: VoiceConfig | null
}

const PERSPECTIVE_OPTIONS = [
  { value: 'I', label: 'Me', title: 'Writes as "I"' },
  { value: 'we', label: 'My team', title: 'Writes as "we"' },
  { value: 'third person', label: 'Brand', title: 'Writes in third person' }
]

// Values are the voice_configs.emoji_policy strings resolvePreferences reads.
const EMOJI_OPTIONS = [
  { values: ['none'], label: 'None' },
  { values: ['bullets only', 'bullets_only'], label: 'As bullets' },
  { values: ['liberal'], label: 'Freely' }
]

// A saved hashtag policy is free text; it matches the choice whose range
// covers its count, and is only replaced when the user picks another choice.
const HASHTAG_OPTIONS = [
  { value: 'none', label: 'None', matches: (max: number) => max === 0 },
  {
    value: '0-3, end of post',
    label: 'Up to 3',
    matches: (max: number) => max > 0 && max <= 3
  },
  {
    value: '3-5, end of post',
    label: '3 to 5',
    matches: (max: number) => max > 3
  }
]

// Each 1–5 scale is shown as three choices covering low, middle and high, so
// a saved value is kept unless the user picks a different choice.
const LOW = { value: 2, matches: (n: number) => n <= 2 }
const MID = { value: 3, matches: (n: number) => n === 3 }
const HIGH = { value: 4, matches: (n: number) => n >= 4 }

const VOICE_SCALES = [
  {
    key: 'formality',
    label: 'Formality',
    choices: [
      { label: 'Casual', ...LOW },
      { label: 'Balanced', ...MID },
      { label: 'Formal', ...HIGH }
    ]
  },
  {
    key: 'directness',
    label: 'Directness',
    choices: [
      { label: 'Diplomatic', ...LOW },
      { label: 'Balanced', ...MID },
      { label: 'Punchy', ...HIGH }
    ]
  }
] as const

type ScaleKey = (typeof VOICE_SCALES)[number]['key']

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

function SectionHeading({
  icon,
  title,
  description,
  action
}: {
  icon: ReactNode
  title: string
  description: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-foreground flex items-center gap-2.5 text-base font-semibold">
          <span className="bg-accent/10 text-accent rounded-lg p-1.5">
            {icon}
          </span>
          {title}
        </h2>
        <p className="text-muted mt-1 text-xs leading-relaxed">
          {description}
        </p>
      </div>
      {action}
    </div>
  )
}

function SegmentedControl({
  label,
  options
}: {
  label: string
  options: {
    key: string
    label: string
    title?: string
    selected: boolean
    onSelect: () => void
  }[]
}) {
  return (
    <div className="space-y-2">
      <p className="text-foreground text-sm font-medium">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className="border-border bg-surface-hover grid grid-cols-3 gap-1 rounded-xl border p-1"
      >
        {options.map(option => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={option.selected}
            title={option.title}
            onClick={option.onSelect}
            className={`rounded-lg px-2 py-2 text-sm transition-colors ${
              option.selected
                ? 'bg-surface text-foreground font-semibold shadow-xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function VoiceForm({ accountId, initialConfig }: VoiceFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [derivedRubric, setDerivedRubric] = useState(
    initialConfig?.derivedStyleRubric || ''
  )
  const [isEditingSummary, setIsEditingSummary] = useState(false)
  const [tone, setTone] = useState(initialConfig?.tone || '')
  const [perspective, setPerspective] = useState(
    initialConfig?.perspective || ''
  )
  const [emojiPolicy, setEmojiPolicy] = useState(
    initialConfig?.emojiPolicy || ''
  )
  const [hashtagPolicy, setHashtagPolicy] = useState(
    initialConfig?.hashtagPolicy || ''
  )
  const hashtagMax = parseHashtagPolicy(hashtagPolicy)?.max ?? null
  const [scales, setScales] = useState<Record<ScaleKey, number | null>>({
    formality: initialConfig?.formality ?? null,
    directness: initialConfig?.directness ?? null
  })

  // AI setup suggestions fill blank settings only; saving is still manual.
  const prefill = useSectionPrefill<VoiceValues>({
    draftKey: accountId,
    getCurrent: () => ({
      tone,
      derivedStyleRubric: derivedRubric,
      formality: scales.formality,
      directness: scales.directness,
      perspective,
      emojiPolicy,
      hashtagPolicy,
      // Not edited on this page; reported as saved so nothing fills it.
      bannedWords: initialConfig?.bannedWords ?? []
    }),
    setValues: next => {
      if (next.tone !== undefined) setTone(next.tone)
      if (next.derivedStyleRubric !== undefined)
        setDerivedRubric(next.derivedStyleRubric)
      if (next.formality !== undefined || next.directness !== undefined) {
        setScales(prev => ({
          formality: next.formality !== undefined ? next.formality : prev.formality,
          directness:
            next.directness !== undefined ? next.directness : prev.directness
        }))
      }
      if (next.perspective !== undefined) setPerspective(next.perspective)
      if (next.emojiPolicy !== undefined) setEmojiPolicy(next.emojiPolicy)
      if (next.hashtagPolicy !== undefined) setHashtagPolicy(next.hashtagPolicy)
    },
    // Words to avoid are not part of the Voice page, so they are never prefilled.
    suggestionValues: s => {
      const { bannedWords: _bannedWords, ...values } = voiceSuggestionValues(
        s.voice
      )
      return values
    }
  })

  const handleSave = () => {
    setError(null)
    startTransition(async () => {
      // Only what this page edits is sent; every other voice detail keeps its
      // saved value. Anything left unselected falls back to the default.
      const res = await saveVoiceConfigAction({
        accountId,
        derivedStyleRubric: derivedRubric,
        tone: tone || undefined,
        perspective: perspective || undefined,
        emojiPolicy: emojiPolicy || undefined,
        hashtagPolicy: hashtagPolicy || undefined,
        formality: scales.formality ?? undefined,
        directness: scales.directness ?? undefined
      })

      if (res.success) {
        setIsEditingSummary(false)
        showToast({
          type: 'success',
          title: 'Voice Saved',
          message: 'New posts will be written in this voice.'
        })
        router.refresh()
      } else {
        const errMsg = cleanErrorMessage(res.error) || 'Failed to save voice'
        setError(errMsg)
        showToast({ type: 'error', title: 'Save Failed', message: errMsg })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    })
  }

  const sectionClass =
    'border-border bg-surface space-y-5 rounded-2xl border p-6 shadow-xs sm:p-8'

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-relaxed">{cleanErrorMessage(error)}</p>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setError(null)}
            className="shrink-0 text-red-500/70 hover:text-red-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <PrefillBanner
        section="voice"
        prefill={prefill}
        note="These are recommended settings for your stated brand, not learned from your posts."
      />

      {/* 1. Voice summary */}
      <section className={sectionClass}>
        <SectionHeading
          icon={<Sparkles className="h-4 w-4" />}
          title="1. Your voice"
          description="How Claude should sound when it writes for you. It guides every draft."
          action={
            <button
              type="button"
              onClick={() => setIsEditingSummary(editing => !editing)}
              className="text-accent flex shrink-0 items-center gap-1.5 text-xs font-medium hover:underline"
            >
              {isEditingSummary ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Done
                </>
              ) : (
                <>
                  <PenLine className="h-3.5 w-3.5" />
                  Edit
                </>
              )}
            </button>
          }
        />

        {isEditingSummary ? (
          <textarea
            autoFocus
            rows={6}
            value={derivedRubric}
            onChange={e => setDerivedRubric(e.target.value)}
            placeholder="Describe how your posts should sound..."
            className="w-full resize-y rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm leading-relaxed text-emerald-900 focus:border-emerald-500/70 focus:outline-hidden dark:text-emerald-100"
          />
        ) : derivedRubric.trim() ? (
          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm leading-relaxed whitespace-pre-line text-emerald-900 dark:text-emerald-100">
            {derivedRubric}
          </p>
        ) : (
          <p className="border-border text-muted rounded-xl border border-dashed p-4 text-sm">
            No summary yet. Click Edit to describe how your posts should sound,
            or just save the settings below.
          </p>
        )}
      </section>

      {/* 2. Style, speaker, emoji and hashtags */}
      <section className={sectionClass}>
        <SectionHeading
          icon={<SlidersHorizontal className="h-4 w-4" />}
          title="2. Adjust if needed"
          description="Change anything that doesn't sound like you."
        />

        <div className="space-y-2">
          <p className="text-foreground text-sm font-medium">Writing style</p>
          <div
            role="radiogroup"
            aria-label="Writing style"
            className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-5"
          >
            {WRITING_STYLES.map(style => {
              const selected = tone === style.value
              return (
                <button
                  key={style.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTone(style.value)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    selected
                      ? 'border-accent bg-accent/5 ring-accent/30 ring-1'
                      : 'border-border hover:border-accent/40 hover:bg-surface-hover'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-foreground text-sm font-semibold">
                      {style.label}
                    </span>
                    {selected && (
                      <CheckCircle2 className="text-accent h-4 w-4 shrink-0" />
                    )}
                  </span>
                  <span className="text-muted mt-1 block text-xs leading-relaxed">
                    {style.description}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <SegmentedControl
            label="Who is speaking"
            options={PERSPECTIVE_OPTIONS.map(option => ({
              key: option.value,
              label: option.label,
              title: option.title,
              selected: perspective === option.value,
              onSelect: () => setPerspective(option.value)
            }))}
          />

          {VOICE_SCALES.map(scale => {
            const current = scales[scale.key]
            return (
              <SegmentedControl
                key={scale.key}
                label={scale.label}
                options={scale.choices.map(choice => {
                  const selected = current !== null && choice.matches(current)
                  return {
                    key: choice.label,
                    label: choice.label,
                    selected,
                    onSelect: () => {
                      if (!selected) {
                        setScales(prev => ({
                          ...prev,
                          [scale.key]: choice.value
                        }))
                      }
                    }
                  }
                })}
              />
            )
          })}

          <SegmentedControl
            label="Emoji"
            options={EMOJI_OPTIONS.map(option => ({
              key: option.label,
              label: option.label,
              selected: option.values.includes(emojiPolicy),
              onSelect: () => {
                if (!option.values.includes(emojiPolicy)) {
                  setEmojiPolicy(option.values[0]!)
                }
              }
            }))}
          />

          <SegmentedControl
            label="Hashtags"
            options={HASHTAG_OPTIONS.map(option => {
              const selected = hashtagMax !== null && option.matches(hashtagMax)
              return {
                key: option.value,
                label: option.label,
                selected,
                onSelect: () => {
                  if (!selected) setHashtagPolicy(option.value)
                }
              }
            })}
          />
        </div>

        <p className="text-muted border-border border-t pt-4 text-xs">
          Topics, ideas per run, links and subjects to avoid are set in{' '}
          <Link
            href={`/accounts/${accountId}/preferences`}
            className="text-accent inline-flex items-center gap-0.5 font-medium hover:underline"
          >
            Preferences
            <ArrowRight className="h-3 w-3" />
          </Link>
        </p>
      </section>

      {/* Save */}
      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <span className="text-muted text-xs">
          {initialConfig
            ? 'Changes apply to new drafts after you save.'
            : 'Anything left unselected uses a default.'}
        </span>

        <button
          type="button"
          disabled={isPending}
          onClick={handleSave}
          className="bg-accent text-background hover:bg-accent-hover flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save voice
            </>
          )}
        </button>
      </div>
    </div>
  )
}
