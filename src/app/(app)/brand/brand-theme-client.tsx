'use client'

import { PageHeader } from '@/components/page-header'
import { showToast } from '@/components/toast-notification'
import {
  describeColor,
  LOGO_MAX_DATA_URL_LENGTH,
  LOGO_MAX_EDGE,
  LOGO_MIN_EDGE,
  LOGO_PLACEMENT,
  LOGO_UPLOAD_MAX_BYTES,
  LOGO_UPLOAD_TYPES,
  logoBox,
  normalizeHex
} from '@/lib/brand/theme'
import { cn } from '@/lib/cn'
import {
  ImageIcon,
  ImagePlus,
  Loader2,
  Palette,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { saveBrandTheme } from './actions'

const inputClass =
  'border-border bg-surface-hover text-foreground placeholder:text-muted focus:border-accent w-full rounded-md border px-3 py-2 text-sm outline-none'

/** Size of every generated image; the preview places the logo as it will be. */
const CANVAS = { width: 2048, height: 1072 }

interface BrandColors {
  primary: string | null
  secondary: string | null
}

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
    // `window.Image`: the DOM constructor, not next/image.
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
  onChange,
  onError
}: {
  value: string | null
  onChange: (next: string | null) => void
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
    <div className="space-y-1.5">
      {value ? (
        <div className="border-border flex items-center gap-3 rounded-xl border p-2.5">
          <div className="border-border flex h-16 w-32 shrink-0 items-center justify-center rounded-lg border bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL preview */}
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
      <p className="text-muted text-[11px]">
        A transparent PNG or SVG works best.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={LOGO_UPLOAD_TYPES.join(',')}
        className="hidden"
        onChange={e => {
          void accept(e.target.files?.[0])
          // So choosing the same file again still fires.
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
  onChange
}: {
  id: string
  label: string
  hint: string
  value: string | null
  onChange: (next: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  const [shownValue, setShownValue] = useState(value)
  if (value !== shownValue) {
    setShownValue(value)
    setDraft(value ?? '')
  }
  const invalid = draft.trim() !== '' && normalizeHex(draft) === null

  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        aria-label={`${label} colour picker`}
        value={value ?? '#ffffff'}
        onChange={e => onChange(normalizeHex(e.target.value))}
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
            const hex = normalizeHex(e.target.value)
            if (hex) onChange(hex)
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
 * A stand-in image: the two colours as shapes, a headline on the left, and the
 * logo exactly where and how large it will be laid over each generated image.
 */
function BrandPreview({
  colors,
  logo
}: {
  colors: BrandColors
  logo: string | null
}) {
  const [logoSize, setLogoSize] = useState<{
    src: string
    width: number
    height: number
  } | null>(null)

  useEffect(() => {
    if (!logo) return
    let cancelled = false
    loadImage(logo)
      .then(img => {
        if (!cancelled)
          setLogoSize({
            src: logo,
            width: img.naturalWidth,
            height: img.naturalHeight
          })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [logo])

  const box =
    logo && logoSize?.src === logo
      ? logoBox(CANVAS, logoSize, LOGO_PLACEMENT)
      : null
  const pct = (value: number, of: number) => `${(value / of) * 100}%`

  return (
    <div className="space-y-2">
      <div className="border-border relative aspect-[2048/1072] w-full overflow-hidden rounded-xl border bg-[#f6f7f9]">
        <div
          className="absolute rounded-full"
          style={{
            background: colors.primary || '#cbd5e1',
            width: '30%',
            aspectRatio: '1',
            right: '14%',
            top: '10%'
          }}
        />
        <div
          className="absolute rounded-2xl"
          style={{
            background: colors.secondary || '#e2e8f0',
            width: '17%',
            height: '30%',
            right: '38%',
            top: '46%'
          }}
        />
        <p
          className="absolute top-[14%] left-[6%] max-w-[40%] text-[clamp(11px,2.4vw,20px)] leading-tight font-bold"
          style={{ color: colors.secondary || '#111827' }}
        >
          Your post&apos;s point, in up to eight words
        </p>
        {box && logo && (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL preview
          <img
            src={logo}
            alt="Logo placement"
            className="absolute object-contain"
            style={{
              left: pct(box.left, CANVAS.width),
              top: pct(box.top, CANVAS.height),
              width: pct(box.width, CANVAS.width),
              height: pct(box.height, CANVAS.height)
            }}
          />
        )}
      </div>
      <p className="text-muted text-[11px] leading-relaxed">
        A stand-in for placement and colour, not a real image: each image is
        designed from its own post. The logo is your uploaded file, laid over
        the bottom-right corner of the finished image, with a soft backing
        where the background would hide it.
      </p>
    </div>
  )
}

export function BrandThemeClient({
  identityName,
  initialColors,
  initialLogo
}: {
  identityName: string
  initialColors: BrandColors
  initialLogo: string | null
}) {
  const router = useRouter()
  const [colors, setColors] = useState<BrandColors>(initialColors)
  const [logo, setLogo] = useState(initialLogo)
  const [saved, setSaved] = useState(() => ({
    colors: initialColors,
    logo: initialLogo
  }))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    colors.primary !== saved.colors.primary ||
    colors.secondary !== saved.colors.secondary ||
    logo !== saved.logo

  // Leaving with unsaved changes would drop them without a word.
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
    setColors(saved.colors)
    setLogo(saved.logo)
    setError(null)
  }

  const save = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const res = await saveBrandTheme({
        primaryColor: colors.primary,
        secondaryColor: colors.secondary,
        // An unchanged logo is not sent again: undefined keeps the saved file.
        logo: logo === saved.logo ? undefined : logo
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setSaved({ colors, logo })
      showToast({
        type: 'success',
        title: 'Brand theme saved',
        message: 'Every new image will use it.'
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
        description={`The logo and colours on every image generated for ${identityName}.`}
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

            <Section
              icon={ImageIcon}
              title="Logo"
              description="Your actual logo file is laid over every generated image. Image models never draw it, so it is never misspelt or redrawn."
            >
              <LogoField value={logo} onChange={setLogo} onError={setError} />
            </Section>

            <Section
              icon={Palette}
              title="Brand colours"
              description="Every generated image is built from these. A reference image you attach keeps its layout and style but takes these colours. Leave both empty to let each image choose."
            >
              <div className="space-y-3">
                <ColorField
                  id="brand-primary"
                  label="Primary colour"
                  hint="The dominant colour."
                  value={colors.primary}
                  onChange={hex => setColors(c => ({ ...c, primary: hex }))}
                />
                <ColorField
                  id="brand-secondary"
                  label="Secondary colour"
                  hint="Supports the primary."
                  value={colors.secondary}
                  onChange={hex => setColors(c => ({ ...c, secondary: hex }))}
                />
              </div>
            </Section>
          </div>

          <aside className="lg:col-span-6">
            <div className="border-border bg-surface space-y-3 rounded-2xl border p-5 shadow-xs lg:sticky lg:top-0">
              <h2 className="text-foreground text-sm font-semibold">Preview</h2>
              <BrandPreview colors={colors} logo={logo} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
