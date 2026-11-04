'use client'

import { Button } from '@/components/button'
import { showToast } from '@/components/toast-notification'
import {
  contrastRatio,
  DEFAULT_THEME_PREFS,
  MODE_BACKGROUND,
  normalizeHex,
  themeTokens,
  type ModeColors,
  type ThemeMode,
  type ThemePrefs
} from '@/lib/theme-prefs'
import {
  AlertTriangle,
  Moon,
  Paintbrush,
  Pencil,
  RotateCcw,
  Sun
} from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { saveThemePrefsAction } from './actions'

/**
 * Each mode's other tokens from globals.css, and the shades the default
 * colours come with, so a preview shows a mode whichever one is on now.
 */
const MODE_TOKENS: Record<ThemeMode, Record<string, string>> = {
  light: {
    '--background': MODE_BACKGROUND.light,
    '--foreground': '#09090b',
    '--surface': '#ffffff',
    '--border': '#e4e4e7',
    '--muted': '#71717a',
    '--accent-hover': '#27272a',
    '--brand-strong': '#0a5f6f'
  },
  dark: {
    '--background': MODE_BACKGROUND.dark,
    '--foreground': '#fafafa',
    '--surface': '#1b1b1f',
    '--border': '#3a3a42',
    '--muted': '#b0b0b9',
    '--accent-hover': '#e4e4e7',
    '--brand-strong': '#5ad0e3'
  }
}

const MODES: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light mode', icon: Sun },
  { mode: 'dark', label: 'Dark mode', icon: Moon }
]

const FIELDS: { key: keyof ModeColors; label: string; hint: string }[] = [
  {
    key: 'primary',
    label: 'Primary',
    hint: 'Main buttons, links and focus rings.'
  },
  {
    key: 'secondary',
    label: 'Secondary',
    hint: 'The active menu item, highlights and badges.'
  }
]

const samePrefs = (a: ThemePrefs, b: ThemePrefs) =>
  JSON.stringify(a) === JSON.stringify(b)

export function ThemePrefsForm({ initialPrefs }: { initialPrefs: ThemePrefs }) {
  const [saved, setSaved] = useState(initialPrefs)
  const [prefs, setPrefs] = useState(initialPrefs)
  const [saving, setSaving] = useState(false)
  // The colours are shown read-only until Edit; Cancel puts back the saved ones.
  const [editing, setEditing] = useState(false)
  const changed = !samePrefs(prefs, saved)

  const cancel = () => {
    setPrefs(saved)
    setEditing(false)
  }

  const setColor = (mode: ThemeMode, key: keyof ModeColors, value: string) =>
    setPrefs(prev => ({ ...prev, [mode]: { ...prev[mode], [key]: value } }))

  const save = async (next: ThemePrefs) => {
    setSaving(true)
    try {
      const result = await saveThemePrefsAction(next)
      if (!result.success) {
        showToast({ type: 'error', title: 'Not saved', message: result.error })
        return
      }
      setSaved(next)
      setPrefs(next)
      setEditing(false)
      showToast({ type: 'success', title: 'Theme saved' })
    } catch {
      showToast({
        type: 'error',
        title: 'Not saved',
        message: 'Please try again.'
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <section
        aria-labelledby="theme-title"
        className="border-border bg-surface rounded-2xl border p-4 shadow-xs"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-60">
            <h2
              id="theme-title"
              className="text-foreground flex items-center gap-2.5 text-base font-semibold"
            >
              <span className="bg-accent/10 rounded-lg p-1.5">
                <Paintbrush aria-hidden className="text-accent h-4 w-4" />
              </span>
              Theme preferences
            </h2>
            <p className="text-muted mt-1.5 text-sm">
              The app&apos;s colours, set apart for light and dark mode. They
              are kept in this browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={saving || samePrefs(prefs, DEFAULT_THEME_PREFS)}
                  onClick={() => setPrefs(DEFAULT_THEME_PREFS)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset all
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={saving}
                  onClick={cancel}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={saving}
                  disabled={!changed}
                  onClick={() => save(prefs)}
                >
                  Save changes
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {MODES.map(({ mode, label, icon: Icon }) => (
          <ModeCard
            key={mode}
            mode={mode}
            label={label}
            icon={Icon}
            editing={editing}
            colors={prefs[mode]}
            onChange={(key, value) => setColor(mode, key, value)}
            onReset={() =>
              setPrefs(prev => ({
                ...prev,
                [mode]: DEFAULT_THEME_PREFS[mode]
              }))
            }
          />
        ))}
      </div>
    </>
  )
}

function ModeCard({
  mode,
  label,
  icon: Icon,
  editing,
  colors,
  onChange,
  onReset
}: {
  mode: ThemeMode
  label: string
  icon: typeof Sun
  /** Off: the colours are shown, not changed. */
  editing: boolean
  colors: ModeColors
  onChange: (key: keyof ModeColors, value: string) => void
  onReset: () => void
}) {
  const isDefault =
    colors.primary === DEFAULT_THEME_PREFS[mode].primary &&
    colors.secondary === DEFAULT_THEME_PREFS[mode].secondary
  // Primary buttons write their label in the page background's colour.
  const lowContrast = contrastRatio(colors.primary, MODE_BACKGROUND[mode]) < 4.5

  return (
    <section
      aria-label={label}
      className="border-border bg-surface @container rounded-2xl border p-4 shadow-xs"
    >
      <div className="mb-3 flex h-6 items-center justify-between gap-3">
        <h3 className="text-foreground flex items-center gap-2 text-sm font-semibold">
          <Icon aria-hidden className="text-muted h-4 w-4" />
          {label}
        </h3>
        {editing && (
          <button
            type="button"
            onClick={onReset}
            disabled={isDefault}
            className="text-muted hover:text-foreground text-xs font-medium underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            Reset to default
          </button>
        )}
      </div>

      {/* Fields beside the preview once the card is wide enough. */}
      <div className="grid gap-4 @xl:grid-cols-2">
        <div className="space-y-4">
          {FIELDS.map(field => (
            <ColorField
              key={field.key}
              id={`${mode}-${field.key}`}
              label={field.label}
              hint={field.hint}
              value={colors[field.key]}
              disabled={!editing}
              onChange={value => onChange(field.key, value)}
            />
          ))}
          {lowContrast && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle
                aria-hidden
                className="mt-px h-3.5 w-3.5 shrink-0"
              />
              Text on primary buttons may be hard to read in this colour.
            </p>
          )}
        </div>
        <ModePreview mode={mode} colors={colors} />
      </div>
    </section>
  )
}

/** A colour swatch that opens the picker, and the same colour as hex. */
function ColorField({
  id,
  label,
  hint,
  value,
  disabled,
  onChange
}: {
  id: string
  label: string
  hint: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  // What is typed, kept until it is a whole #rrggbb colour.
  const [draft, setDraft] = useState(value)
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    setPrevValue(value)
    setDraft(value)
  }

  return (
    <div>
      <label
        htmlFor={id}
        className="text-foreground block text-[13px] font-medium"
      >
        {label}
      </label>
      <p className="text-muted mb-1.5 text-xs">{hint}</p>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className="border-border h-9 w-12 shrink-0 cursor-pointer rounded-lg border bg-transparent p-1 disabled:cursor-default"
        />
        <input
          id={id}
          type="text"
          inputMode="text"
          spellCheck={false}
          maxLength={7}
          value={draft}
          readOnly={disabled}
          onChange={e => {
            setDraft(e.target.value)
            const hex = normalizeHex(e.target.value)
            if (hex) onChange(hex)
          }}
          onBlur={() => setDraft(value)}
          className="border-border bg-surface-hover text-foreground focus-visible:ring-foreground/30 h-9 w-28 rounded-lg border px-3 font-mono text-sm uppercase focus-visible:ring-2 focus-visible:outline-none"
        />
      </div>
    </div>
  )
}

/** A small piece of the app drawn in one mode's colours. */
function ModePreview({
  mode,
  colors
}: {
  mode: ThemeMode
  colors: ModeColors
}) {
  const style = {
    ...MODE_TOKENS[mode],
    '--accent': colors.primary,
    '--brand': colors.secondary,
    ...themeTokens(mode, colors)
  } as CSSProperties

  return (
    <div
      aria-label={`Preview of ${mode} mode`}
      style={style}
      className="border-border bg-background space-y-3 rounded-xl border p-4"
    >
      <p className="text-muted text-[11px] font-semibold tracking-[0.14em] uppercase">
        Preview
      </p>
      <div className="bg-surface border-border space-y-1 rounded-lg border p-2">
        <div className="bg-brand/20 text-brand-strong relative flex h-9 items-center rounded-lg px-3 text-[13px] font-medium">
          <span
            aria-hidden
            className="bg-brand absolute top-0 -left-2 h-full w-0.75 rounded-r-full"
          />
          Active menu item
        </div>
        <div className="text-foreground flex h-9 items-center px-3 text-[13px] font-medium">
          Other menu item
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent text-background inline-flex h-8 items-center rounded-lg px-3.5 text-[13px] font-medium">
          Primary button
        </span>
        <span className="bg-accent/10 text-accent rounded-full px-2.5 py-0.5 text-xs font-semibold">
          Badge
        </span>
        <span className="text-accent text-[13px] font-medium underline underline-offset-2">
          Link
        </span>
      </div>
    </div>
  )
}
