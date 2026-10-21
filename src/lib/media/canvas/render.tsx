import { ImageResponse } from 'next/og'
import { Diagram, Pill } from './diagram'
import type { SatoriFont } from './fonts'
import {
  CANVAS_SIZE,
  headlineFontSize,
  splitHeadline,
  TEXT_COLUMN,
  VISUAL_PANEL,
  type CanvasSpec
} from './spec'

/**
 * Draws a CanvasSpec as a PNG with next/og (satori lays it out, resvg
 * rasterises it). Every word on the image is set here in real type, and the
 * logo is the uploaded file, so neither can come out misspelt or redrawn.
 *
 * No `server-only` import, so tests can render real images.
 */

const LOGO_BOX = { width: 340, height: 84 }

function Background({ spec }: { spec: CanvasSpec }) {
  const { palette, pattern } = spec
  const glow = VISUAL_PANEL.left + VISUAL_PANEL.width / 2
  return (
    <svg
      width={CANVAS_SIZE.width}
      height={CANVAS_SIZE.height}
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      <defs>
        <pattern id="dots" width="34" height="34" patternUnits="userSpaceOnUse">
          <circle cx="17" cy="17" r="2.2" fill={palette.pattern} />
        </pattern>
        <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
          <path d="M 56 0 L 0 0 0 56" fill="none" stroke={palette.pattern} strokeWidth="1.6" />
        </pattern>
        <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={palette.primary} stopOpacity="0.13" />
          <stop offset="1" stopColor={palette.primary} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={palette.background} stopOpacity="1" />
          <stop offset="0.42" stopColor={palette.background} stopOpacity="0.92" />
          <stop offset="0.6" stopColor={palette.background} stopOpacity="0" />
        </linearGradient>
      </defs>
      {pattern !== 'plain' && (
        <rect width="100%" height="100%" fill={`url(#${pattern})`} />
      )}
      {/* The pattern fades out behind the text, so the headline sits on calm ground. */}
      <rect width="100%" height="100%" fill="url(#fade)" />
      <circle cx={glow} cy={CANVAS_SIZE.height / 2} r={560} fill="url(#glow)" />
    </svg>
  )
}

function Logo({ spec }: { spec: CanvasSpec }) {
  const { logo, palette, fonts } = spec
  if (!logo) {
    return spec.wordmark ? (
      <div
        style={{
          fontFamily: fonts.heading,
          fontSize: 38,
          fontWeight: fonts.headingWeight,
          color: palette.ink
        }}
      >
        {spec.wordmark}
      </div>
    ) : (
      <div style={{ display: 'flex', height: LOGO_BOX.height }} />
    )
  }
  const scale = Math.min(LOGO_BOX.width / logo.width, LOGO_BOX.height / logo.height)
  const width = Math.round(logo.width * scale)
  const height = Math.round(logo.height * scale)
  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- satori, not the DOM
    <img src={logo.dataUrl} width={width} height={height} alt="" />
  )
  return logo.plate ? (
    <div
      style={{
        display: 'flex',
        padding: '16px 22px',
        borderRadius: 20,
        backgroundColor: palette.ink
      }}
    >
      {image}
    </div>
  ) : (
    <div style={{ display: 'flex', height: LOGO_BOX.height, alignItems: 'center' }}>
      {image}
    </div>
  )
}

function TextColumn({ spec }: { spec: CanvasSpec }) {
  const { copy, palette, fonts } = spec
  const words = splitHeadline(copy.headline, copy.highlights)
  const size = headlineFontSize(copy.headline)
  return (
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
      <Logo spec={spec} />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {copy.tagline ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 30 }}>
            <div
              style={{
                width: 44,
                height: 6,
                borderRadius: 3,
                backgroundColor: palette.accent
              }}
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
              {copy.tagline}
            </div>
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            fontFamily: fonts.heading,
            fontSize: size,
            fontWeight: fonts.headingWeight,
            lineHeight: 1.07,
            letterSpacing: -1.5,
            color: palette.ink
          }}
        >
          {words.map((word, i) => (
            <span
              key={i}
              style={{
                marginRight: Math.round(size * 0.24),
                color: word.highlight ? palette.accent : palette.ink
              }}
            >
              {word.text}
            </span>
          ))}
        </div>
        {copy.subheadline ? (
          <div
            style={{
              marginTop: 34,
              maxWidth: 780,
              fontSize: 36,
              lineHeight: 1.38,
              color: palette.body
            }}
          >
            {copy.subheadline}
          </div>
        ) : null}
      </div>

      {/* No fragment here: satori drops the gap between a fragment's children. */}
      {copy.footer ? (
        <div style={{ display: 'flex', alignItems: 'center', height: 40 }}>
          <div
            style={{
              display: 'flex',
              width: 12,
              height: 12,
              marginRight: 16,
              borderRadius: 6,
              backgroundColor: palette.accent
            }}
          />
          <div
            style={{
              display: 'flex',
              fontSize: 28,
              fontWeight: 600,
              color: palette.muted
            }}
          >
            {copy.footer}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', height: 40 }} />
      )}
    </div>
  )
}

function Visual({ spec }: { spec: CanvasSpec }) {
  const { visual, palette } = spec
  if (visual.kind === 'diagram') {
    return <Diagram diagram={visual.diagram} palette={palette} />
  }
  const imageUrl = `data:image/png;base64,${visual.image.toString('base64')}`
  const size = visual.framed ? 880 : 1000
  const offset = (VISUAL_PANEL.width - size) / 2
  // Badges sit at the panel's edges, where an illustration with a margin of
  // empty background has nothing to cover.
  const spots = [
    { left: 20, top: 110 },
    { right: 24, top: VISUAL_PANEL.height / 2 - 42 },
    { left: 64, bottom: 110 }
  ]
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        left: 0,
        top: 0,
        width: VISUAL_PANEL.width,
        height: VISUAL_PANEL.height
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- satori, not the DOM */}
      <img
        src={imageUrl}
        width={size}
        height={size}
        alt=""
        style={{
          position: 'absolute',
          left: offset,
          top: offset,
          ...(visual.framed
            ? {
                borderRadius: 48,
                border: `2px solid ${palette.line}`,
                boxShadow: '0 24px 60px rgba(15, 23, 42, 0.14)'
              }
            : {})
        }}
      />
      {visual.badges.map((badge, i) => (
        <Pill
          key={i}
          node={badge}
          palette={palette}
          style={{ position: 'absolute', ...spots[i] }}
        />
      ))}
    </div>
  )
}

export async function renderCanvas(
  spec: CanvasSpec,
  fonts: SatoriFont[]
): Promise<Buffer> {
  const response = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          backgroundColor: spec.palette.background,
          fontFamily: spec.fonts.body,
          color: spec.palette.ink
        }}
      >
        <Background spec={spec} />
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: VISUAL_PANEL.left,
            top: VISUAL_PANEL.top,
            width: VISUAL_PANEL.width,
            height: VISUAL_PANEL.height
          }}
        >
          <Visual spec={spec} />
        </div>
        <TextColumn spec={spec} />
      </div>
    ),
    {
      ...CANVAS_SIZE,
      fonts: fonts.map(f => ({
        name: f.name,
        // satori wants an ArrayBuffer; a Buffer may be a view on a larger pool.
        data: f.data.buffer.slice(
          f.data.byteOffset,
          f.data.byteOffset + f.data.byteLength
        ) as ArrayBuffer,
        weight: f.weight,
        style: f.style
      }))
    }
  )
  const body = await response.arrayBuffer()
  if (body.byteLength === 0) throw new Error('The image could not be drawn.')
  return Buffer.from(body)
}
