import { ImageResponse } from 'next/og'
import { BlueprintLayout } from './blueprint-render'
import { Diagram, IconTile, Pill, WideDiagram } from './diagram'
import type { SatoriFont } from './fonts'
import { mix } from './palette'
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
 * Supports 4 distinct layout formats to ensure aesthetic variety across posts:
 * - split_left: Text left 45%, visual right 55% (Default B2B layout)
 * - split_right: Visual left 55%, text right 45% (Inverted layout)
 * - top_bottom: Headline across top, horizontal visual/cards across bottom
 * - centered_hero: Centered elevated card with headline and highlight pills
 *
 * With a reference image, its own structure (spec.blueprint) is drawn
 * instead; see ./blueprint-render.
 */

const LOGO_BOX = { width: 340, height: 84 }

/** The dots and grid the background patterns fill with, for an svg's <defs>. */
const patternDefs = (palette: CanvasSpec['palette']) => [
  <pattern key="dots" id="dots" width="34" height="34" patternUnits="userSpaceOnUse">
    <circle cx="17" cy="17" r="2.2" fill={palette.pattern} />
  </pattern>,
  <pattern key="grid" id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
    <path d="M 56 0 L 0 0 0 56" fill="none" stroke={palette.pattern} strokeWidth="1.6" />
  </pattern>
]

/**
 * A reference's own design gets only the brand background and its pattern:
 * the glow and fade belong to the built-in layouts, not to the reference.
 */
function PlainBackground({ spec }: { spec: CanvasSpec }) {
  const { palette, pattern } = spec
  const size = spec.size ?? CANVAS_SIZE
  if (pattern === 'plain') return null
  return (
    <svg
      width={size.width}
      height={size.height}
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      <defs>{patternDefs(palette)}</defs>
      <rect width="100%" height="100%" fill={`url(#${pattern})`} />
    </svg>
  )
}

function Background({ spec }: { spec: CanvasSpec }) {
  const { palette, pattern, layout = 'split_left' } = spec
  const glowX =
    layout === 'split_right'
      ? VISUAL_PANEL.width / 2
      : layout === 'top_bottom' || layout === 'centered_hero'
        ? CANVAS_SIZE.width / 2
        : VISUAL_PANEL.left + VISUAL_PANEL.width / 2
  const glowY = layout === 'top_bottom' ? 740 : CANVAS_SIZE.height / 2

  return (
    <svg
      width={CANVAS_SIZE.width}
      height={CANVAS_SIZE.height}
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      <defs>
        {patternDefs(palette)}
        <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={palette.primary} stopOpacity="0.13" />
          <stop offset="1" stopColor={palette.primary} stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id="fade"
          x1={layout === 'top_bottom' ? '0' : layout === 'split_right' ? '1' : '0'}
          y1="0"
          x2={layout === 'top_bottom' ? '0' : layout === 'split_right' ? '0' : '1'}
          y2={layout === 'top_bottom' ? '1' : '0'}
        >
          <stop offset="0" stopColor={palette.background} stopOpacity="1" />
          <stop offset="0.45" stopColor={palette.background} stopOpacity="0.92" />
          <stop offset="0.75" stopColor={palette.background} stopOpacity="0" />
        </linearGradient>
      </defs>
      {pattern !== 'plain' && (
        <rect width="100%" height="100%" fill={`url(#${pattern})`} />
      )}
      <rect width="100%" height="100%" fill="url(#fade)" />
      <circle cx={glowX} cy={glowY} r={640} fill="url(#glow)" />
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

function TextColumn({
  spec,
  alignRight = false
}: {
  spec: CanvasSpec
  alignRight?: boolean
}) {
  const { copy, palette, fonts } = spec
  const words = splitHeadline(copy.headline, copy.highlights)
  const size = headlineFontSize(copy.headline)
  const left = alignRight
    ? CANVAS_SIZE.width - TEXT_COLUMN.width
    : TEXT_COLUMN.left

  return (
    <div
      style={{
        position: 'absolute',
        left,
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
      {/* eslint-disable-next-line @next/next/no-img-element -- satori */}
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

function TopHeader({ spec }: { spec: CanvasSpec }) {
  const { copy, palette, fonts } = spec
  const words = splitHeadline(copy.headline, copy.highlights)
  const size = Math.min(68, headlineFontSize(copy.headline))

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: CANVAS_SIZE.width,
        height: 440,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        padding: '54px 104px 0 104px'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16
        }}
      >
        <Logo spec={spec} />
        {copy.footer ? (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: palette.accent,
                marginRight: 12
              }}
            />
            <div style={{ fontSize: 24, fontWeight: 600, color: palette.muted }}>
              {copy.footer}
            </div>
          </div>
        ) : null}
      </div>

      {copy.tagline ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <div style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: palette.accent }} />
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
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
          lineHeight: 1.1,
          letterSpacing: -1.2,
          color: palette.ink,
          maxWidth: 1760
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
            marginTop: 12,
            fontSize: 27,
            color: palette.body,
            lineHeight: 1.35,
            maxWidth: 1700
          }}
        >
          {copy.subheadline}
        </div>
      ) : null}
    </div>
  )
}

function WideVisual({ spec }: { spec: CanvasSpec }) {
  const { visual, palette } = spec
  if (visual.kind === 'diagram') {
    return <WideDiagram diagram={visual.diagram} palette={palette} />
  }
  const imageUrl = `data:image/png;base64,${visual.image.toString('base64')}`
  const size = 440
  return (
    <div
      style={{
        display: 'flex',
        width: 1840,
        height: 480,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative'
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- satori */}
      <img
        src={imageUrl}
        width={size}
        height={size}
        alt=""
        style={{
          borderRadius: 36,
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.12)'
        }}
      />
      {visual.badges.map((badge, i) => (
        <Pill
          key={i}
          node={badge}
          palette={palette}
          style={{
            position: 'absolute',
            ...(i === 0
              ? { left: 80, top: 120 }
              : i === 1
                ? { right: 80, top: 120 }
                : { left: 400, bottom: 40 })
          }}
        />
      ))}
    </div>
  )
}

function CenteredHero({ spec }: { spec: CanvasSpec }) {
  const { copy, visual, palette, fonts } = spec
  const words = splitHeadline(copy.headline, copy.highlights)
  const size = Math.min(68, headlineFontSize(copy.headline))
  const nodes =
    visual.kind === 'diagram' ? visual.diagram.nodes : visual.badges
  const badges = visual.kind === 'diagram' ? visual.diagram.badges : []

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: CANVAS_SIZE.width,
        height: CANVAS_SIZE.height,
        display: 'flex'
      }}
    >
      {/* Top row */}
      <div
        style={{
          position: 'absolute',
          left: 104,
          top: 54,
          width: 1840,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <Logo spec={spec} />
        {copy.footer ? (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: palette.accent,
                marginRight: 12
              }}
            />
            <div style={{ fontSize: 24, fontWeight: 600, color: palette.muted }}>
              {copy.footer}
            </div>
          </div>
        ) : null}
      </div>

      {/* Hero card */}
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 156,
          width: 1828,
          height: 820,
          borderRadius: 40,
          backgroundColor: palette.surface,
          border: `2px solid ${palette.line}`,
          boxShadow: '0 28px 70px rgba(15, 23, 42, 0.10)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '58px 72px'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {copy.tagline ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: palette.accent }} />
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
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
              lineHeight: 1.1,
              letterSpacing: -1.2,
              color: palette.ink,
              maxWidth: 1680
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
                marginTop: 18,
                fontSize: 29,
                color: palette.body,
                lineHeight: 1.35,
                maxWidth: 1600
              }}
            >
              {copy.subheadline}
            </div>
          ) : null}
        </div>

        {/* Bottom feature cards or pills */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 40 }}>
          {nodes.length > 0 ? (
            <div style={{ display: 'flex', gap: 24, width: '100%' }}>
              {nodes.slice(0, Math.min(3, nodes.length)).map((node, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    padding: '26px 28px',
                    borderRadius: 24,
                    backgroundColor: mix(palette.background, '#0f172a', 0.03),
                    border: `1.5px solid ${palette.line}`
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
                    <IconTile name={node.icon} size={50} palette={palette} />
                    <div style={{ fontSize: 27, fontWeight: 700, color: palette.ink }}>
                      {node.label}
                    </div>
                  </div>
                  {node.detail ? (
                    <div style={{ fontSize: 20, color: palette.muted, lineHeight: 1.35, marginTop: 4 }}>
                      {node.detail}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {badges && badges.length > 0 ? (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              {badges.slice(0, 3).map((badge, i) => (
                <div
                  key={`badge-${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 24px',
                    borderRadius: 999,
                    backgroundColor: '#0a1120',
                    border: '1.5px solid rgba(56, 189, 248, 0.4)'
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 700, color: palette.accent }}>
                    +
                  </div>
                  <div style={{ fontSize: 23, fontWeight: 600, color: '#f8fafc' }}>
                    {badge.label}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export async function renderCanvas(
  spec: CanvasSpec,
  fonts: SatoriFont[]
): Promise<Buffer> {
  const layout = spec.layout || 'split_left'

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
        {spec.blueprint ? <PlainBackground spec={spec} /> : <Background spec={spec} />}

        {spec.blueprint ? (
          <BlueprintLayout
            spec={spec}
            blueprint={spec.blueprint}
            canvas={spec.size ?? CANVAS_SIZE}
          />
        ) : layout === 'top_bottom' ? (
          <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%' }}>
            <TopHeader spec={spec} />
            <div
              style={{
                display: 'flex',
                position: 'absolute',
                left: 104,
                top: 480,
                width: 1840,
                height: 500
              }}
            >
              <WideVisual spec={spec} />
            </div>
          </div>
        ) : layout === 'centered_hero' ? (
          <CenteredHero spec={spec} />
        ) : layout === 'split_right' ? (
          <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%' }}>
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
              <Visual spec={spec} />
            </div>
            <TextColumn spec={spec} alignRight />
          </div>
        ) : (
          <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%' }}>
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
        )}
      </div>
    ),
    {
      ...(spec.size ?? CANVAS_SIZE),
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
