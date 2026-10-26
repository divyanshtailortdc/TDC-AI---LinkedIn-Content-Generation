'use client'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import { showToast } from '@/components/toast-notification'
import { findFont, FONT_CHOICES } from '@/lib/brand/fonts'
import {
  describeColor,
  isLightBackground,
  LOGO_MAX_DATA_URL_LENGTH,
  LOGO_MAX_EDGE,
  LOGO_MIN_EDGE,
  LOGO_UPLOAD_MAX_BYTES,
  LOGO_UPLOAD_TYPES,
  normalizeHex,
  type ResolvedBrandTheme
} from '@/lib/brand/theme'
import { cn } from '@/lib/cn'
import { Diagram } from '@/lib/media/canvas/diagram'
import { canvasPalette } from '@/lib/media/canvas/palette'
import {
  CANVAS_SIZE,
  headlineFontSize,
  splitHeadline,
  TEXT_COLUMN,
  VISUAL_PANEL,
  type DiagramSpec
} from '@/lib/media/canvas/spec'
import {
  ImageIcon,
  ImagePlus,
  Loader2,
  Palette,
  Type,
  Upload,
  X
} from 'lucide-react'
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
  // The logo comes off only once the remove is confirmed.
  const [confirmingRemove, setConfirmingRemove] = useState(false)

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
          <div className="border-border relative flex h-16 w-36 shrink-0 items-center justify-center rounded-lg border bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL or api/brand/logo preview */}
            <img
              src={value}
              alt="Logo preview"
              className="max-h-full max-w-full object-contain"
            />
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              aria-label="Remove logo"
              title="Remove logo"
              className="border-border bg-surface text-muted absolute -top-2 -right-2 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border shadow-sm transition-colors hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-400"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="border-border bg-surface hover:bg-surface-hover text-foreground inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium"
          >
            <Upload className="h-3.5 w-3.5" />
            Replace
          </button>
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

      {confirmingRemove && (
        <ConfirmDialog
          title="Remove the logo?"
          description="It comes off every new image once you save. You can upload it again at any time."
          confirmLabel="Yes, remove"
          pendingLabel="Removing…"
          pending={false}
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={() => {
            onChange(null)
            setConfirmingRemove(false)
          }}
        />
      )}
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

/** What the preview says: placeholder words, so it reads as any account's image. */
const SAMPLE_COPY = {
  tagline: 'Your category',
  headline: 'Your headline, with its key point highlighted',
  highlights: ['key point'],
  subheadline: 'A supporting line that explains the idea in a sentence.'
}

const SAMPLE_DIAGRAM: DiagramSpec = {
  form: 'hub_spoke',
  hub: { label: 'Your idea', icon: 'sparkles' },
  nodes: [
    { label: 'Point one', icon: 'target' },
    { label: 'Point two', icon: 'users' },
    { label: 'Point three', icon: 'chart-column' },
    { label: 'Point four', icon: 'zap' }
  ]
}

/** The width of the element, kept up to date as the page resizes. */
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry?.contentRect.width ?? 0)
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/**
 * A sample image in the brand theme: the split layout most images use, drawn
 * at an image's full size with the image renderer's own colours, measures
 * and diagram, then scaled down to fit the box. Scaling the whole image
 * keeps every part in proportion at any width, so nothing overlaps.
 */
function BrandPreview({
  theme,
  logo,
  identityName
}: {
  theme: ResolvedBrandTheme
  logo: string | null
  identityName: string
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const scale = useWidth(frameRef) / CANVAS_SIZE.width
  const palette = canvasPalette(theme)
  const headingWeight = findFont(theme.headingFont)?.bold ?? 800
  // Auto is settled per image; the sample shows the usual dots.
  const pattern =
    theme.backgroundPattern === 'auto' ? 'dots' : theme.backgroundPattern

  // The logo's own proportions, read once it loads.
  const [logoSize, setLogoSize] = useState<{
    src: string
    width: number
    height: number
  } | null>(null)
  useEffect(() => {
    if (!logo) return
    const img = new window.Image()
    img.onload = () =>
      setLogoSize({ src: logo, width: img.naturalWidth, height: img.naturalHeight })
    img.src = logo
  }, [logo])
  const logoShown = theme.showLogo && logo && logoSize?.src === logo ? logoSize : null

  const words = splitHeadline(SAMPLE_COPY.headline, SAMPLE_COPY.highlights)
  const headlineSize = headlineFontSize(SAMPLE_COPY.headline)
  const logoScale = logoShown
    ? Math.min(340 / logoShown.width, 84 / logoShown.height)
    : 0

  return (
    <div className="space-y-2">
      <div
        ref={frameRef}
        className="border-border relative aspect-[2048/1072] w-full overflow-hidden rounded-xl border select-none"
        aria-label="Sample image in your brand theme"
        role="img"
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: CANVAS_SIZE.width,
            height: CANVAS_SIZE.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            visibility: scale ? 'visible' : 'hidden',
            backgroundColor: palette.background,
            fontFamily: theme.bodyFont,
            color: palette.ink
          }}
        >
          <svg
            width={CANVAS_SIZE.width}
            height={CANVAS_SIZE.height}
            style={{ position: 'absolute', left: 0, top: 0 }}
          >
            <defs>
              <pattern id="preview-dots" width="34" height="34" patternUnits="userSpaceOnUse">
                <circle cx="17" cy="17" r="2.2" fill={palette.pattern} />
              </pattern>
              <pattern id="preview-grid" width="56" height="56" patternUnits="userSpaceOnUse">
                <path d="M 56 0 L 0 0 0 56" fill="none" stroke={palette.pattern} strokeWidth="1.6" />
              </pattern>
              <radialGradient id="preview-glow" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor={palette.primary} stopOpacity="0.13" />
                <stop offset="1" stopColor={palette.primary} stopOpacity="0" />
              </radialGradient>
              <linearGradient id="preview-fade" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={palette.background} stopOpacity="1" />
                <stop offset="0.45" stopColor={palette.background} stopOpacity="0.92" />
                <stop offset="0.75" stopColor={palette.background} stopOpacity="0" />
              </linearGradient>
            </defs>
            {pattern !== 'plain' && (
              <rect width="100%" height="100%" fill={`url(#preview-${pattern})`} />
            )}
            <rect width="100%" height="100%" fill="url(#preview-fade)" />
            <circle
              cx={VISUAL_PANEL.left + VISUAL_PANEL.width / 2}
              cy={CANVAS_SIZE.height / 2}
              r={640}
              fill="url(#preview-glow)"
            />
          </svg>

          {/* The visual, where the image renderer puts it. */}
          <div
            style={{
              position: 'absolute',
              left: VISUAL_PANEL.left,
              top: VISUAL_PANEL.top,
              width: VISUAL_PANEL.width,
              height: VISUAL_PANEL.height
            }}
          >
            <Diagram diagram={SAMPLE_DIAGRAM} palette={palette} />
          </div>

          {/* The text column, at the image renderer's measures. */}
          <div
            style={{
              position: 'absolute',
              left: TEXT_COLUMN.left,
              top: 0,
              width: TEXT_COLUMN.width,
              height: CANVAS_SIZE.height,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: `${TEXT_COLUMN.padY}px ${TEXT_COLUMN.padX - 24}px ${TEXT_COLUMN.padY}px ${TEXT_COLUMN.padX}px`
            }}
          >
            <div style={{ display: 'flex', height: 84, alignItems: 'center' }}>
              {logoShown ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL or api/brand/logo preview
                <img
                  src={logoShown.src}
                  alt=""
                  width={Math.round(logoShown.width * logoScale)}
                  height={Math.round(logoShown.height * logoScale)}
                />
              ) : theme.showLogo && !logo ? (
                <span
                  style={{
                    fontFamily: theme.headingFont,
                    fontSize: 38,
                    fontWeight: headingWeight,
                    color: palette.ink
                  }}
                >
                  {identityName}
                </span>
              ) : null}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 30 }}>
                <div
                  style={{ width: 44, height: 6, borderRadius: 3, backgroundColor: palette.accent }}
                />
                <div
                  style={{
                    fontSize: 27,
                    fontWeight: 600,
                    letterSpacing: 4,
                    textTransform: 'uppercase',
                    color: palette.primary
                  }}
                >
                  {SAMPLE_COPY.tagline}
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  fontFamily: theme.headingFont,
                  fontSize: headlineSize,
                  fontWeight: headingWeight,
                  lineHeight: 1.07,
                  letterSpacing: -1.5,
                  color: palette.ink
                }}
              >
                {words.map((word, i) => (
                  <span
                    key={i}
                    style={{
                      marginRight: Math.round(headlineSize * 0.24),
                      color: word.highlight ? palette.accent : palette.ink
                    }}
                  >
                    {word.text}
                  </span>
                ))}
              </div>
              <div
                style={{
                  marginTop: 34,
                  maxWidth: 780,
                  fontSize: 36,
                  lineHeight: 1.38,
                  color: palette.body
                }}
              >
                {SAMPLE_COPY.subheadline}
              </div>
            </div>

            {/* Only a website typed in on the Posts page goes on images. */}
            <div style={{ display: 'flex', alignItems: 'center', height: 40 }}>
              {theme.footerText ? (
                <>
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      marginRight: 16,
                      borderRadius: 6,
                      backgroundColor: palette.accent
                    }}
                  />
                  <div style={{ fontSize: 28, fontWeight: 600, color: palette.muted }}>
                    {theme.footerText}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function BrandThemeClient({
  identityName,
  initialTheme,
  initialLogo
}: {
  identityName: string
  initialTheme: ResolvedBrandTheme
  initialLogo: string | null
}) {
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
    theme.showLogo !== saved.theme.showLogo ||
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
        showLogo: theme.showLogo,
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
        description={`The logo, colours, typography and background on every image generated for ${identityName}.`}
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

      <div className="relative flex-1 overflow-y-auto p-4 sm:px-6 sm:pb-5">
        <div className="grid w-full gap-6 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-5">
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
          </div>

          <aside className="lg:col-span-7">
            <div className="border-border bg-surface space-y-3 rounded-2xl border p-5 shadow-xs lg:sticky lg:top-0">
              <h2 className="text-foreground text-sm font-semibold">Live Canvas Preview</h2>
              <BrandPreview theme={theme} logo={logo} identityName={identityName} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
