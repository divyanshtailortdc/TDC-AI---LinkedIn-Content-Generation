import { createElement, type CSSProperties } from 'react'
import { ICONS } from './icons'
import type { IconName } from './icon-names'
import { mix, type CanvasPalette } from './palette'
import { VISUAL_PANEL, type CanvasNode, type DiagramSpec } from './spec'

/**
 * The diagrams that fill the visual side, as satori JSX. Every label is real
 * text in the brand's body typeface, so it is spelled exactly as the brief
 * wrote it; positions are worked out here, since satori lays out with
 * flexbox only.
 */

const PANEL = VISUAL_PANEL.width
const PAD = 80

export function Icon({
  name,
  size,
  color,
  strokeWidth = 2
}: {
  name: IconName
  size: number
  color: string
  strokeWidth?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name].map(([tag, attributes], i) => {
        const { key: _key, ...rest } = attributes
        return createElement(tag, { key: i, ...rest })
      })}
    </svg>
  )
}

const shadow = '0 18px 40px rgba(15, 23, 42, 0.10)'

/** A rounded square with the icon in it. */
function IconTile({
  name,
  size,
  palette,
  filled = false
}: {
  name: IconName
  size: number
  palette: CanvasPalette
  filled?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size * 0.28,
        backgroundColor: filled ? palette.primary : palette.primarySoft
      }}
    >
      <Icon
        name={name}
        size={Math.round(size * 0.52)}
        color={filled ? palette.onPrimary : palette.primary}
      />
    </div>
  )
}

const labelStyle = (palette: CanvasPalette, size: number): CSSProperties => ({
  fontSize: size,
  fontWeight: 600,
  lineHeight: 1.18,
  color: palette.ink
})

const detailStyle = (palette: CanvasPalette, size: number): CSSProperties => ({
  fontSize: size,
  lineHeight: 1.3,
  color: palette.muted
})

/** A white pill: icon and label on one line. Also the badge over an illustration. */
export function Pill({
  node,
  palette,
  style
}: {
  node: CanvasNode
  palette: CanvasPalette
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 30px 14px 14px',
        borderRadius: 999,
        backgroundColor: palette.surface,
        border: `2px solid ${palette.line}`,
        boxShadow: shadow,
        ...style
      }}
    >
      <IconTile name={node.icon} size={56} palette={palette} />
      <div style={{ ...labelStyle(palette, 30), whiteSpace: 'nowrap' }}>
        {node.label}
      </div>
    </div>
  )
}

function HubSpoke({ diagram, palette }: { diagram: DiagramSpec; palette: CanvasPalette }) {
  const hub = diagram.hub || { label: 'Platform', icon: 'sparkles' as IconName }
  const allNodes = diagram.nodes
  // Up to 6 radial nodes; any beyond that become outer badges if badges not provided
  const nodes = allNodes.slice(0, 6)
  const badges = (diagram.badges?.length ? diagram.badges : allNodes.slice(6, 9)).slice(0, 3)

  const center = PANEL / 2
  const hubSize = 270
  const radius = { x: 375, y: 340 }

  // Canonical angles matching the reference image for 6 nodes, or evenly distributed otherwise
  const canonicalSix = [-90, -28, 28, 90, 152, -152]
  const points = nodes.map((_, i) => {
    const deg = nodes.length === 6 ? canonicalSix[i]! : -90 + (360 / nodes.length) * i
    const angle = (deg * Math.PI) / 180
    return {
      x: center + radius.x * Math.cos(angle),
      y: center + radius.y * Math.sin(angle)
    }
  })

  // Format hub label words
  const words = (hub.label || 'Platform').trim().split(/\s+/)

  // Badge positions & curves
  const badgeSpots = [
    { x: PANEL - 290, y: 44, d: 'M 790 84 C 840 150 870 230 870 320' },
    { x: PANEL - 290, y: PANEL - 94, d: 'M 790 980 C 850 930 880 850 870 760' },
    { x: 36, y: PANEL - 94, d: 'M 180 980 C 130 910 130 830 180 750' }
  ]

  return (
    <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: PANEL, height: PANEL }}>
      {/* Background SVG: connector lines, glow rings, and badge dotted curves */}
      <svg width={PANEL} height={PANEL} style={{ position: 'absolute', left: 0, top: 0 }}>
        {/* Hub outer halo ring */}
        <circle
          cx={center}
          cy={center}
          r={hubSize / 2 + 28}
          fill="none"
          stroke={palette.primary}
          strokeWidth={2.5}
          strokeOpacity={0.28}
        />
        {/* Hub outer dashed ring */}
        <circle
          cx={center}
          cy={center}
          r={hubSize / 2 + 52}
          fill="none"
          stroke={palette.primary}
          strokeWidth={2}
          strokeDasharray="4 8"
          strokeOpacity={0.16}
        />
        {/* Radial spoke lines to satellite nodes */}
        {points.map((p, i) => (
          <line
            key={i}
            x1={center}
            y1={center}
            x2={p.x}
            y2={p.y}
            stroke={palette.primary}
            strokeWidth={3.5}
            strokeOpacity={0.65}
          />
        ))}
        {/* Dotted connector lines to outer badges */}
        {badges.map((_, i) => (
          <path
            key={`badge-line-${i}`}
            d={badgeSpots[i]?.d || ''}
            fill="none"
            stroke={palette.primary}
            strokeWidth={2}
            strokeDasharray="4 8"
            strokeOpacity={0.4}
          />
        ))}
      </svg>

      {/* Central Hub Circle */}
      <div
        style={{
          position: 'absolute',
          left: center - hubSize / 2,
          top: center - hubSize / 2,
          width: hubSize,
          height: hubSize,
          borderRadius: hubSize / 2,
          backgroundColor: palette.primary,
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.18)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24
        }}
      >
        {words.length === 3 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 4,
                textTransform: 'uppercase',
                color: 'rgba(255, 255, 255, 0.85)',
                marginBottom: 2
              }}
            >
              {words[0]}
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, color: '#ffffff', lineHeight: 1.12 }}>
              {words[1]}
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, color: '#ffffff', lineHeight: 1.12 }}>
              {words[2]}
            </div>
          </div>
        ) : words.length === 2 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 34, fontWeight: 800, color: '#ffffff', lineHeight: 1.15 }}>
              {words[0]}
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, color: '#ffffff', lineHeight: 1.15 }}>
              {words[1]}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', maxWidth: 220 }}>
            {hub.icon && (
              <div style={{ display: 'flex', marginBottom: 8 }}>
                <Icon name={hub.icon} size={44} color={palette.onPrimary} />
              </div>
            )}
            <div style={{ fontSize: 32, fontWeight: 800, color: '#ffffff', textAlign: 'center', lineHeight: 1.2 }}>
              {hub.label}
            </div>
          </div>
        )}
      </div>

      {/* Satellite Nodes (Clean White Rounded Pills) */}
      {nodes.map((node, i) => {
        const estWidth = 70 + Math.round(node.label.length * 16)
        const left = Math.max(16, Math.min(PANEL - estWidth - 16, Math.round(points[i]!.x - estWidth / 2)))
        const top = Math.max(34, Math.min(PANEL - 60 - 34, Math.round(points[i]!.y - 28)))
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left,
              top,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 26px 12px 18px',
              borderRadius: 999,
              backgroundColor: palette.surface,
              border: `2px solid ${palette.line}`,
              boxShadow: shadow
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: palette.primary,
                flexShrink: 0
              }}
            />
            <div style={{ fontSize: 27, fontWeight: 600, color: palette.ink, whiteSpace: 'nowrap' }}>
              {node.label}
            </div>
          </div>
        )
      })}

      {/* Outer Badges (Dark Accent Pills) */}
      {badges.map((badge, i) => {
        const spot = badgeSpots[i]!
        return (
          <div
            key={`badge-${i}`}
            style={{
              position: 'absolute',
              left: spot.x,
              top: spot.y,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 22px',
              borderRadius: 999,
              backgroundColor: '#0a1120',
              border: '1.5px solid rgba(56, 189, 248, 0.4)',
              boxShadow: '0 16px 36px rgba(0, 0, 0, 0.24)'
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke={palette.accent}
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <div style={{ fontSize: 22, fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap' }}>
              {badge.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Flow({ diagram, palette }: { diagram: DiagramSpec; palette: CanvasPalette }) {
  const n = diagram.nodes.length
  const gap = 56
  // Three steps get taller cards than five, rather than a strip of white.
  const height = Math.min(
    n <= 3 ? 190 : 150,
    Math.floor((PANEL - PAD * 2 - gap * (n - 1)) / n)
  )
  const width = n <= 3 ? 820 : 760
  const total = height * n + gap * (n - 1)
  const top = (PANEL - total) / 2
  const left = (PANEL - width) / 2
  const arrow = mix(palette.background, palette.accent, 0.7)

  return (
    <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: PANEL, height: PANEL }}>
      <svg width={PANEL} height={PANEL} style={{ position: 'absolute', left: 0, top: 0 }}>
        {diagram.nodes.slice(1).map((_, i) => {
          const y1 = top + (height + gap) * i + height + 8
          const y2 = y1 + gap - 16
          const x = PANEL / 2
          return (
            <g key={i}>
              <line x1={x} y1={y1} x2={x} y2={y2 - 6} stroke={arrow} strokeWidth={5} strokeLinecap="round" />
              <path
                d={`M ${x - 12} ${y2 - 14} L ${x} ${y2} L ${x + 12} ${y2 - 14}`}
                fill="none"
                stroke={arrow}
                strokeWidth={5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          )
        })}
      </svg>
      {diagram.nodes.map((node, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left,
            top: top + (height + gap) * i,
            width,
            height,
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            padding: '0 32px',
            borderRadius: 32,
            backgroundColor: palette.surface,
            border: `2px solid ${palette.line}`,
            boxShadow: shadow
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 52,
              height: 52,
              flexShrink: 0,
              borderRadius: 26,
              backgroundColor: palette.accent,
              color: palette.onAccent,
              fontSize: 26,
              fontWeight: 600
            }}
          >
            {i + 1}
          </div>
          <IconTile name={node.icon} size={72} palette={palette} />
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 6 }}>
            <div style={labelStyle(palette, 32)}>{node.label}</div>
            {node.detail && height >= 120 ? (
              <div style={detailStyle(palette, 24)}>{node.detail}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function Stack({ diagram, palette }: { diagram: DiagramSpec; palette: CanvasPalette }) {
  const n = diagram.nodes.length
  const gap = 22
  const height = Math.min(150, Math.floor((PANEL - PAD * 2 - gap * (n - 1)) / n))
  const total = height * n + gap * (n - 1)
  const top = (PANEL - total) / 2

  return (
    <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: PANEL, height: PANEL }}>
      {diagram.nodes.map((node, i) => {
        // Widening towards the bottom, the base darkest: the layers rest on it.
        const depth = n === 1 ? 1 : i / (n - 1)
        const width = 640 + Math.round(depth * 240)
        const fill = mix('#ffffff', palette.primary, 0.14 + depth * 0.86)
        const dark = depth > 0.45
        const text = dark ? palette.onPrimary : palette.ink
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: (PANEL - width) / 2,
              top: top + (height + gap) * i,
              width,
              height,
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              padding: '0 36px',
              borderRadius: 28,
              backgroundColor: fill,
              boxShadow: shadow
            }}
          >
            <Icon name={node.icon} size={52} color={dark ? palette.onPrimary : palette.primary} />
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 4 }}>
              <div style={{ ...labelStyle(palette, 32), color: text }}>{node.label}</div>
              {node.detail && height >= 120 ? (
                <div style={{ ...detailStyle(palette, 24), color: text, opacity: 0.8 }}>
                  {node.detail}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Cards({ diagram, palette }: { diagram: DiagramSpec; palette: CanvasPalette }) {
  const nodes = diagram.nodes
  const gap = 32
  const inner = PANEL - PAD * 2
  const half = (inner - gap) / 2
  // Two side by side; three as one wide card over two; four as a square grid.
  const boxes =
    nodes.length === 2
      ? [
          { x: 0, y: inner / 2 - 230, w: half, h: 460 },
          { x: half + gap, y: inner / 2 - 230, w: half, h: 460 }
        ]
      : nodes.length === 3
        ? [
            { x: 0, y: 0, w: inner, h: half - 60 },
            { x: 0, y: half - 60 + gap, w: half, h: inner - (half - 60) - gap },
            { x: half + gap, y: half - 60 + gap, w: half, h: inner - (half - 60) - gap }
          ]
        : [0, 1, 2, 3].map(i => ({
            x: (i % 2) * (half + gap),
            y: Math.floor(i / 2) * (half + gap),
            w: half,
            h: half
          }))

  return (
    <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: PANEL, height: PANEL }}>
      {nodes.map((node, i) => {
        const box = boxes[i]!
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: PAD + box.x,
              top: PAD + box.y,
              width: box.w,
              height: box.h,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              gap: 22,
              padding: 40,
              borderRadius: 36,
              backgroundColor: palette.surface,
              border: `2px solid ${palette.line}`,
              boxShadow: shadow
            }}
          >
            <IconTile name={node.icon} size={84} palette={palette} filled={i === 0} />
            <div style={labelStyle(palette, 36)}>{node.label}</div>
            {node.detail ? <div style={detailStyle(palette, 26)}>{node.detail}</div> : null}
          </div>
        )
      })}
    </div>
  )
}

function Comparison({ diagram, palette }: { diagram: DiagramSpec; palette: CanvasPalette }) {
  const [leftTitle, rightTitle] = diagram.groups!
  const half = diagram.nodes.length / 2
  const columns = [diagram.nodes.slice(0, half), diagram.nodes.slice(half)]
  const width = 400
  const gap = 112
  const left = (PANEL - width * 2 - gap) / 2
  const rowHeight = 112
  const height = 150 + columns[0]!.length * (rowHeight + 18)
  const top = (PANEL - height) / 2

  return (
    <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: PANEL, height: PANEL }}>
      {columns.map((nodes, c) => {
        const after = c === 1
        return (
          <div
            key={c}
            style={{
              position: 'absolute',
              left: left + c * (width + gap),
              top,
              width,
              height,
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              padding: 26,
              borderRadius: 36,
              backgroundColor: after ? palette.surface : mix(palette.background, '#0f172a', 0.04),
              border: `${after ? 4 : 2}px solid ${after ? palette.primary : palette.line}`,
              boxShadow: after ? shadow : 'none'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignSelf: 'flex-start',
                padding: '12px 26px',
                borderRadius: 999,
                backgroundColor: after ? palette.primary : palette.line,
                color: after ? palette.onPrimary : palette.body,
                fontSize: 28,
                fontWeight: 600,
                marginBottom: 14
              }}
            >
              {after ? rightTitle : leftTitle}
            </div>
            {nodes.map((node, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  height: rowHeight,
                  padding: '0 20px',
                  borderRadius: 24,
                  backgroundColor: palette.surface,
                  border: `2px solid ${palette.line}`
                }}
              >
                {after ? (
                  <IconTile name={node.icon} size={60} palette={palette} />
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 60,
                      height: 60,
                      flexShrink: 0,
                      borderRadius: 17,
                      backgroundColor: mix(palette.background, '#0f172a', 0.06)
                    }}
                  >
                    <Icon name={node.icon} size={31} color={palette.muted} />
                  </div>
                )}
                <div
                  style={{
                    ...labelStyle(palette, 27),
                    color: after ? palette.ink : palette.body,
                    display: 'flex',
                    flex: 1
                  }}
                >
                  {node.label}
                </div>
              </div>
            ))}
          </div>
        )
      })}
      <div
        style={{
          position: 'absolute',
          left: PANEL / 2 - 40,
          top: PANEL / 2 - 40,
          width: 80,
          height: 80,
          borderRadius: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.accent,
          boxShadow: shadow
        }}
      >
        <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke={palette.onAccent} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </div>
    </div>
  )
}

export function Diagram({ diagram, palette }: { diagram: DiagramSpec; palette: CanvasPalette }) {
  switch (diagram.form) {
    case 'hub_spoke':
      return <HubSpoke diagram={diagram} palette={palette} />
    case 'flow':
      return <Flow diagram={diagram} palette={palette} />
    case 'stack':
      return <Stack diagram={diagram} palette={palette} />
    case 'comparison':
      return <Comparison diagram={diagram} palette={palette} />
    default:
      return <Cards diagram={diagram} palette={palette} />
  }
}
