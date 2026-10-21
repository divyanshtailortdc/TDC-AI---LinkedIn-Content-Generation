'use client'

import { PageHeader } from '@/components/page-header'
import { showToast } from '@/components/toast-notification'
import { FONT_CHOICES } from '@/lib/brand/fonts'
import {
  BACKGROUND_PATTERNS,
  describeColor,
  displayWebsite,
  isLightBackground,
  LOGO_MAX_DATA_URL_LENGTH,
  LOGO_MAX_EDGE,
  LOGO_MIN_EDGE,
  LOGO_UPLOAD_MAX_BYTES,
  LOGO_UPLOAD_TYPES,
  normalizeHex,
  VISUAL_STYLES,
  type BackgroundPattern,
  type ResolvedBrandTheme,
  type VisualStyle
} from '@/lib/brand/theme'
import { cn } from '@/lib/cn'
import {
  Check,
  ImageIcon,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Palette,
  Trash2,
  Type,
  Upload,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { saveBrandTheme } from './actions'

const inputClass =
  'border-border bg-surface-hover text-foreground placeholder:text-muted focus:border-accent w-full rounded-md border px-3 py-2 text-sm outline-none'

function Section({
  icon: Icon,
  title,
  description,
  children
}: {
  icon: typeof Palette
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-border bg-surface space-y-4 rounded-2xl border p-5 shadow-xs">
      <div>
        <h2 className="text-foreground flex items-center gap-2.5 text-base font-semibold">
          <span className="bg-accent/10 rounded-lg p-1.5">
            <Icon className="text-accent h-4 w-4" />
          </span>
          {title}
        </h2>
        {description && (
          <p className="text-muted mt-1 text-xs">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

/** Reads an image's pixel size in the browser. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(new Error('That file could not be read as an image.'))
    img.src = src
  })
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })

/**
 * Checks an uploaded logo and scales a large raster one down to LOGO_MAX_EDGE
 * as a PNG, so the save stays small. SVGs are sent as they are; the server
 * re-encodes every logo either way.
 */
async function prepareLogo(file: File): Promise<string> {
  if (!(LOGO_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    throw new Error(
      'Use a PNG, SVG, WebP or JPEG file. PNG or SVG with a transparent background works best.'
    )
  }
  if (file.size > LOGO_UPLOAD_MAX_BYTES) {
    throw new Error('That file is over 5 MB. Use a smaller export of the logo.')
  }
  const dataUrl = await readAsDataUrl(file)
  if (file.type === 'image/svg+xml') {
    if (dataUrl.length > LOGO_MAX_DATA_URL_LENGTH) {
      throw new Error(
        'That SVG is too large. Export a simpler version or a PNG.'
      )
    }
    return dataUrl
  }
  const img = await loadImage(dataUrl)
  if (Math.max(img.naturalWidth, img.naturalHeight) < LOGO_MIN_EDGE) {
    throw new Error(
      `That logo is only ${img.naturalWidth}×${img.naturalHeight}px. Use one at least ${LOGO_MIN_EDGE}px wide.`
    )
  }
  const scale = Math.min(
    1,
    LOGO_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight)
  )
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
  const png = canvas.toDataURL('image/png')
  if (png.length > LOGO_MAX_DATA_URL_LENGTH) {
    throw new Error(
      'That logo is too detailed to store. Export a simpler version.'
    )
  }
  return png
}

function LogoField({
  value,
  showLogo,
  onChange,
  onToggleShowLogo,
  onError
}: {
  value: string | null
  showLogo: boolean
  onChange: (next: string | null) => void
  onToggleShowLogo: (next: boolean) => void
  onError: (message: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const accept = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      onChange(await prepareLogo(file))
      onError(null)
    } catch (err) {
      onError(
        err instanceof Error ? err.message : 'That logo could not be used.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {value ? (
        <div className="border-border flex items-center gap-3 rounded-xl border p-2.5">
          <div className="border-border flex h-16 w-36 shrink-0 items-center justify-center rounded-lg border bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview */}
            <img
              src={value}
              alt="Logo preview"
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="border-border bg-surface hover:bg-surface-hover text-foreground inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium"
            >
              <Upload className="h-3.5 w-3.5" />
              Replace
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={e => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault()
            setDragging(false)
            void accept(e.dataTransfer.files?.[0])
          }}
          className={cn(
            'text-muted hover:text-foreground flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-xs transition-colors',
            dragging
              ? 'border-brand bg-brand/10'
              : 'border-border hover:bg-surface-hover'
          )}
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ImagePlus className="h-5 w-5" />
          )}
          <span className="text-foreground font-medium">
            Upload or drop your logo
          </span>
          <span>PNG, SVG, WebP or JPEG</span>
        </button>
      )}

      <div className="flex items-center justify-between rounded-xl border border-border p-3">
        <div>
          <span className="text-foreground block text-xs font-semibold">
            Show logo on images
          </span>
          <span className="text-muted text-[11px]">
            Placed at the top-left of the text canvas on every generated image.
          </span>
        </div>
        <input
          type="checkbox"
          id="show-logo-toggle"
          checked={showLogo}
          onChange={e => onToggleShowLogo(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-accent"
        />
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={LOGO_UPLOAD_TYPES.join(',')}
        className="hidden"
        onChange={e => {
          void accept(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}

function ColorField({
  id,
  label,
  hint,
  value,
  onChange,
  validateLight = false
}: {
  id: string
  label: string
  hint: string
  value: string | null
  onChange: (next: string | null) => void
  validateLight?: boolean
}) {
  const [draft, setDraft] = useState(value ?? '')
  const [shownValue, setShownValue] = useState(value)
  if (value !== shownValue) {
    setShownValue(value)
    setDraft(value ?? '')
  }
  const hex = normalizeHex(draft)
  const invalid =
    draft.trim() !== '' &&
    (hex === null || (validateLight && !isLightBackground(hex)))

  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        aria-label={`${label} colour picker`}
        value={value ?? '#ffffff'}
        onChange={e => {
          const picked = normalizeHex(e.target.value)
          if (!validateLight || (picked && isLightBackground(picked))) {
            onChange(picked)
          }
        }}
        className={cn(
          'border-border h-9 w-9 shrink-0 cursor-pointer rounded-lg border bg-transparent p-0.5',
          !value && 'opacity-40'
        )}
      />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className="text-foreground block text-xs font-semibold"
        >
          {label}
        </label>
        <p className="text-muted text-[11px]">
          {value ? `Reads as ${describeColor(value)}. ${hint}` : hint}
        </p>
      </div>
      <div className="w-28 shrink-0">
        <input
          id={id}
          value={draft}
          placeholder="Not set"
          aria-invalid={invalid}
          onChange={e => {
            setDraft(e.target.value)
            const h = normalizeHex(e.target.value)
            if (h && (!validateLight || isLightBackground(h))) onChange(h)
            else if (!e.target.value.trim()) onChange(null)
          }}
          className={cn(
            inputClass,
            'py-1.5 font-mono text-xs uppercase aria-invalid:border-rose-500'
          )}
        />
      </div>
      <button
        type="button"
        onClick={() => onChange(null)}
        disabled={!value}
        aria-label={`Clear ${label.toLowerCase()}`}
        className="text-muted hover:text-foreground h-7 w-7 shrink-0 cursor-pointer rounded-lg disabled:invisible"
      >
        <X className="mx-auto h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/**
 * A live B2B vector split preview rendering:
 * - Left 45%: Logo (top-left), Category Tagline, Main Headline with highlighted words, Sub-headline, and Footer
 * - Right 55%: Unified vector architecture / Hub-and-Spoke nodes with pills and badges
 */
function BrandPreview({
  theme,
  logo
}: {
  theme: ResolvedBrandTheme
  logo: string | null
}) {
  const primary = theme.primaryColor || '#0297b2'
  const accent = theme.accentColor || '#00a3c4'
  const bg = theme.backgroundColor || '#f8fafc'
  const pattern = theme.backgroundPattern || 'dots'
  const headingFont = theme.headingFont || 'Inter'
  const bodyFont = theme.bodyFont || 'Inter'
  const footer = theme.footerText || 'tdccommerce.com'

  return (
    <div className="space-y-2">
      <div
        className="border-border relative aspect-[2048/1072] w-full overflow-hidden rounded-xl border select-none"
        style={{ backgroundColor: bg, fontFamily: bodyFont }}
      >
        {/* Subtle pattern background */}
        <svg
          className="absolute inset-0 h-full w-full pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id="preview-dots"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="12" cy="12" r="1.5" fill={primary} fillOpacity="0.12" />
            </pattern>
            <pattern
              id="preview-grid"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke={primary}
                strokeWidth="1"
                strokeOpacity="0.08"
              />
            </pattern>
            <radialGradient id="preview-glow" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor={accent} stopOpacity="0.16" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </radialGradient>
          </defs>
          {pattern !== 'plain' && (
            <rect
              width="100%"
              height="100%"
              fill={`url(#preview-${pattern})`}
            />
          )}
          <circle cx="75%" cy="50%" r="35%" fill="url(#preview-glow)" />
        </svg>

        {/* LEFT COLUMN: Text Canvas (45%) */}
        <div className="absolute inset-y-0 left-0 flex w-[48%] flex-col justify-between p-[5%]">
          {/* Logo (Top-Left) */}
          <div className="flex h-10 items-center">
            {theme.showLogo && logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- data url preview
              <img
                src={logo}
                alt="Brand logo"
                className="max-h-8 max-w-[160px] object-contain"
              />
            ) : theme.showLogo ? (
              <span
                className="text-sm font-bold tracking-tight text-slate-900 dark:text-white"
                style={{ fontFamily: headingFont }}
              >
                TDC Commerce
              </span>
            ) : null}
          </div>

          {/* Tagline, Headline & Subheadline */}
          <div className="my-auto space-y-2.5">
            <div className="flex items-center gap-2">
              <div
                className="h-1 w-4 rounded-full"
                style={{ backgroundColor: accent }}
              />
              <span
                className="text-[9px] font-bold tracking-widest uppercase"
                style={{ color: accent }}
              >
                AI-NATIVE UNIFIED ERP
              </span>
            </div>

            <h3
              className="text-[clamp(13px,1.9vw,22px)] font-extrabold leading-[1.15] text-slate-900 dark:text-white"
              style={{ fontFamily: headingFont }}
            >
              Your AI Agent Is Only as Smart as the{' '}
              <span style={{ color: accent }}>Systems It Can See</span>
            </h3>

            <p className="line-clamp-2 text-[clamp(9px,1.0vw,12px)] leading-relaxed text-slate-600 dark:text-slate-300">
              Disconnected tools give AI stale, partial data. One data model gives it the truth.
            </p>
          </div>

          {/* Footer (Bottom-Left) */}
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
            <div
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: accent }}
            />
            <span>{footer}</span>
          </div>
        </div>

        {/* RIGHT COLUMN: Visual Canvas (52%) */}
        <div className="absolute inset-y-0 right-0 flex w-[52%] items-center justify-center p-[4%]">
          <div className="relative flex h-full w-full items-center justify-center">
            {/* Center Hub */}
            <div
              className="relative z-10 flex h-[34%] w-[34%] flex-col items-center justify-center rounded-full p-2 text-center text-white shadow-xl transition-all"
              style={{ backgroundColor: primary }}
            >
              <div className="text-[8px] font-semibold tracking-wider uppercase opacity-90">
                ONE
              </div>
              <div className="text-[clamp(10px,1.2vw,14px)] font-bold leading-tight">
                Data Model
              </div>
            </div>

            {/* Concentric subtle circle */}
            <div
              className="absolute h-[46%] w-[46%] rounded-full border border-dashed"
              style={{ borderColor: accent, opacity: 0.35 }}
            />

            {/* Spoke Pill Nodes around hub */}
            <div className="absolute top-[8%] left-[16%] flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 text-[9px] font-medium text-slate-800 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: primary }} />
              <span>CRM</span>
            </div>

            <div className="absolute top-[8%] right-[16%] flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 text-[9px] font-medium text-slate-800 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: primary }} />
              <span>Storefront</span>
            </div>

            <div className="absolute top-[44%] right-[2%] flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 text-[9px] font-medium text-slate-800 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: primary }} />
              <span>Inventory</span>
            </div>

            <div className="absolute bottom-[10%] right-[14%] flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 text-[9px] font-medium text-slate-800 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: primary }} />
              <span>Orders</span>
            </div>

            <div className="absolute bottom-[10%] left-[14%] flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 text-[9px] font-medium text-slate-800 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: primary }} />
              <span>Accounting</span>
            </div>

            {/* Dark Accent Badges (Agent Pills) */}
            <div className="absolute top-[1%] right-[4%] flex items-center gap-1 rounded-full border border-cyan-400/30 bg-slate-900 px-2 py-0.5 text-[8px] font-semibold text-cyan-400 shadow-md">
              <span className="font-bold">+</span>
              <span>Commerce AI Chat</span>
            </div>

            <div className="absolute bottom-[1%] right-[6%] flex items-center gap-1 rounded-full border border-cyan-400/30 bg-slate-900 px-2 py-0.5 text-[8px] font-semibold text-cyan-400 shadow-md">
              <span className="font-bold">+</span>
              <span>Order Verification</span>
            </div>

            <div className="absolute bottom-[1%] left-[4%] flex items-center gap-1 rounded-full border border-cyan-400/30 bg-slate-900 px-2 py-0.5 text-[8px] font-semibold text-cyan-400 shadow-md">
              <span className="font-bold">+</span>
              <span>Reconciliation Agent</span>
            </div>
          </div>
        </div>
      </div>
      <p className="text-muted text-[11px] leading-relaxed">
        Live render canvas standard: Clean B2B vector diagram split layout with your actual logo, custom brand colours, typography, and crisp nodes.
      </p>
    </div>
  )
}

export function BrandThemeClient({
  identityName,
  initialTheme,
  initialLogo,
  websiteUrl
}: {
  identityName: string
  initialTheme: ResolvedBrandTheme
  initialLogo: string | null
  websiteUrl?: string | null
}) {
  const router = useRouter()
  const [theme, setTheme] = useState<ResolvedBrandTheme>(initialTheme)
  const [logo, setLogo] = useState(initialLogo)
  const [saved, setSaved] = useState(() => ({
    theme: initialTheme,
    logo: initialLogo
  }))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    theme.primaryColor !== saved.theme.primaryColor ||
    theme.accentColor !== saved.theme.accentColor ||
    theme.backgroundColor !== saved.theme.backgroundColor ||
    theme.headingFont !== saved.theme.headingFont ||
    theme.bodyFont !== saved.theme.bodyFont ||
    theme.visualStyle !== saved.theme.visualStyle ||
    theme.backgroundPattern !== saved.theme.backgroundPattern ||
    theme.showLogo !== saved.theme.showLogo ||
    theme.footerText !== saved.theme.footerText ||
    logo !== saved.logo

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const discard = () => {
    setTheme(saved.theme)
    setLogo(saved.logo)
    setError(null)
  }

  const save = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const res = await saveBrandTheme({
        primaryColor: theme.primaryColor,
        accentColor: theme.accentColor,
        secondaryColor: theme.accentColor,
        backgroundColor: theme.backgroundColor,
        headingFont: theme.headingFont,
        bodyFont: theme.bodyFont,
        visualStyle: theme.visualStyle,
        backgroundPattern: theme.backgroundPattern,
        showLogo: theme.showLogo,
        footerText: theme.footerText,
        logo: logo === saved.logo ? undefined : logo
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setSaved({ theme, logo })
      showToast({
        type: 'success',
        title: 'Brand theme saved',
        message: 'Every generated image will use this identity & layout.'
      })
      router.refresh()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save the brand theme.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Brand Theme"
        description={`The logo, colours, typography and visual style on every image generated for ${identityName}.`}
        actions={
          <>
            {dirty && (
              <button
                type="button"
                onClick={discard}
                disabled={isSaving}
                className="border-border bg-surface hover:bg-surface-hover text-foreground inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-medium disabled:opacity-50"
              >
                Discard
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={!dirty || isSaving}
              className="bg-accent text-background hover:bg-accent-hover inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isSaving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </>
        }
      />

      <div className="relative flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-6">
            {error && (
              <div
                role="alert"
                className="flex items-start justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400"
              >
                <span>{error}</span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => setError(null)}
                  className="cursor-pointer p-0.5"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Logo & Visibility */}
            <Section
              icon={ImageIcon}
              title="Logo & Visibility"
              description="Your actual uploaded logo file is placed in the render canvas top-left. Image generation models are never asked to recreate logos."
            >
              <LogoField
                value={logo}
                showLogo={theme.showLogo}
                onChange={setLogo}
                onToggleShowLogo={show => setTheme(t => ({ ...t, showLogo: show }))}
                onError={setError}
              />
            </Section>

            {/* Brand Colours */}
            <Section
              icon={Palette}
              title="Brand Colours"
              description="Every image layout is styled from these. The background must remain light (soft white/gray) to ensure high contrast for typography and diagrams."
            >
              <div className="space-y-3">
                <ColorField
                  id="brand-primary"
                  label="Primary colour"
                  hint="The dominant colour for diagram hubs, icons and badges."
                  value={theme.primaryColor}
                  onChange={hex => setTheme(t => ({ ...t, primaryColor: hex }))}
                />
                <ColorField
                  id="brand-accent"
                  label="Accent colour"
                  hint="Used for highlighted headline words, arrows, and tags."
                  value={theme.accentColor}
                  onChange={hex => setTheme(t => ({ ...t, accentColor: hex }))}
                />
                <ColorField
                  id="brand-background"
                  label="Background colour"
                  hint="Soft white or cool light gray. Must be light."
                  value={theme.backgroundColor}
                  onChange={hex => setTheme(t => ({ ...t, backgroundColor: hex }))}
                  validateLight
                />
              </div>
            </Section>

            {/* Typography */}
            <Section
              icon={Type}
              title="Typography"
              description="Google Fonts used for on-image headlines and labels. Rendered crisp and vector-sharp directly on the canvas."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="heading-font-select"
                    className="text-foreground block text-xs font-semibold"
                  >
                    Headline typeface
                  </label>
                  <select
                    id="heading-font-select"
                    value={theme.headingFont}
                    onChange={e =>
                      setTheme(t => ({ ...t, headingFont: e.target.value }))
                    }
                    className={cn(inputClass, 'mt-1.5')}
                  >
                    {FONT_CHOICES.map(f => (
                      <option key={f.family} value={f.family}>
                        {f.family} ({f.category})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="body-font-select"
                    className="text-foreground block text-xs font-semibold"
                  >
                    Body & label typeface
                  </label>
                  <select
                    id="body-font-select"
                    value={theme.bodyFont}
                    onChange={e =>
                      setTheme(t => ({ ...t, bodyFont: e.target.value }))
                    }
                    className={cn(inputClass, 'mt-1.5')}
                  >
                    {FONT_CHOICES.map(f => (
                      <option key={f.family} value={f.family}>
                        {f.family} ({f.category})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </Section>

            {/* Visual Style & Pattern */}
            <Section
              icon={LayoutGrid}
              title="Visual Style & Aesthetics"
              description="Configure canvas background patterns, default diagram behavior, and footer handle."
            >
              <div className="space-y-4">
                <div>
                  <label className="text-foreground block text-xs font-semibold mb-1.5">
                    Visual layout mode
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {VISUAL_STYLES.map(style => {
                      const active = theme.visualStyle === style.value
                      return (
                        <button
                          key={style.value}
                          type="button"
                          onClick={() =>
                            setTheme(t => ({
                              ...t,
                              visualStyle: style.value as VisualStyle
                            }))
                          }
                          className={cn(
                            'flex flex-col items-center justify-center rounded-xl border p-2.5 text-center text-xs transition-all cursor-pointer',
                            active
                              ? 'border-accent bg-accent/10 font-semibold text-foreground'
                              : 'border-border bg-surface-hover/50 text-muted hover:text-foreground'
                          )}
                        >
                          <span className="flex items-center gap-1">
                            {active && <Check className="h-3 w-3 text-accent" />}
                            {style.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-foreground block text-xs font-semibold mb-1.5">
                    Background pattern
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {BACKGROUND_PATTERNS.map(pat => {
                      const active = theme.backgroundPattern === pat.value
                      return (
                        <button
                          key={pat.value}
                          type="button"
                          onClick={() =>
                            setTheme(t => ({
                              ...t,
                              backgroundPattern: pat.value as BackgroundPattern
                            }))
                          }
                          className={cn(
                            'flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs transition-all cursor-pointer',
                            active
                              ? 'border-accent bg-accent/10 font-semibold text-foreground'
                              : 'border-border bg-surface-hover/50 text-muted hover:text-foreground'
                          )}
                        >
                          {active && <Check className="h-3 w-3 text-accent" />}
                          {pat.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="footer-text-input"
                    className="text-foreground block text-xs font-semibold mb-1.5"
                  >
                    Footer website or handle
                  </label>
                  <input
                    id="footer-text-input"
                    placeholder={displayWebsite(websiteUrl) || 'e.g. tdccommerce.com'}
                    value={theme.footerText ?? ''}
                    onChange={e =>
                      setTheme(t => ({
                        ...t,
                        footerText: e.target.value.trim() || null
                      }))
                    }
                    className={inputClass}
                  />
                  <p className="text-muted mt-1 text-[11px]">
                    Shown in the bottom-left corner with an accent indicator.
                  </p>
                </div>
              </div>
            </Section>
          </div>

          <aside className="lg:col-span-6">
            <div className="border-border bg-surface space-y-3 rounded-2xl border p-5 shadow-xs lg:sticky lg:top-0">
              <h2 className="text-foreground text-sm font-semibold">Live Canvas Preview</h2>
              <BrandPreview theme={theme} logo={logo} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
