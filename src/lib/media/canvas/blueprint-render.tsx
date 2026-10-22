import type { CSSProperties, ReactNode } from 'react'
import {
  fitFontSize,
  type BlueprintAlign,
  type BlueprintTone,
  type BlueprintWeight,
  type CanvasSize,
  type PlacedBlock,
  type PlacedBlueprint
} from './blueprint'
import { Icon } from './diagram'
import { mix, type CanvasPalette } from './palette'
import { splitHeadline, type CanvasSpec } from './spec'

/**
 * Draws a PlacedBlueprint: the reference image's blocks in its places and
 * shapes, in the brand's colours and typefaces, as satori JSX. Nothing is
 * added that the reference does not have, apart from the logo and website.
 * Panels and shapes go first, then images, then the arrows, then everything
 * else, so arrows run under the cards they join.
 */

const SHADOW = '0 18px 40px rgba(15, 23, 42, 0.12)'
const WHITE = '#ffffff'

interface Fill {
  background?: string
  border?: string
  ink: string
  muted: string
  accent: string
  /** Words in the brand's primary colour, as they read on this fill. */
  primary: string
  /** On a solid colour, where the brand's own colours would not read. */
  strong: boolean
}

/**
 * A block's fill and the colours that read on it. A block without a box of
 * its own takes the colours of the panel it sits on.
 */
function fillFor(
  tone: BlueprintTone,
  palette: CanvasPalette,
  backdrop: BlueprintTone | null = null
): Fill {
  const under =
    backdrop && backdrop !== 'none' && backdrop !== 'outline'
      ? fillFor(backdrop, palette)
      : null
  switch (tone) {
    case 'primary':
      return {
        background: palette.primary,
        ink: palette.onPrimary,
        muted: mix(palette.onPrimary, palette.primary, 0.25),
        accent: palette.onPrimary,
        primary: palette.onPrimary,
        strong: true
      }
    case 'accent':
      return {
        background: palette.accent,
        ink: palette.onAccent,
        muted: mix(palette.onAccent, palette.accent, 0.25),
        accent: palette.onAccent,
        primary: palette.onAccent,
        strong: true
      }
    case 'dark':
      return {
        background: palette.ink,
        ink: WHITE,
        muted: mix(WHITE, palette.ink, 0.3),
        accent: mix(palette.accent, WHITE, 0.3),
        primary: mix(palette.primary, WHITE, 0.35),
        strong: true
      }
    case 'soft':
      return {
        background: palette.primarySoft,
        ink: palette.ink,
        muted: palette.body,
        accent: palette.accent,
        primary: palette.primary,
        strong: false
      }
    case 'surface':
      return {
        background: palette.surface,
        border: `2px solid ${palette.line}`,
        ink: palette.ink,
        muted: palette.body,
        accent: palette.accent,
        primary: palette.primary,
        strong: false
      }
    case 'outline': {
      const line = under?.strong ? under.ink : palette.primary
      return {
        border: `3px solid ${line}`,
        ink: under?.strong ? under.ink : palette.primary,
        muted: under?.muted ?? palette.body,
        accent: under?.accent ?? palette.accent,
        primary: under?.primary ?? palette.primary,
        strong: Boolean(under?.strong)
      }
    }
    default: {
      if (under) {
        const { ink, muted, accent, primary, strong } = under
        return { ink, muted, accent, primary, strong }
      }
      return {
        ink: palette.ink,
        muted: palette.body,
        accent: palette.accent,
        primary: palette.primary,
        strong: false
      }
    }
  }
}

const flexAlign = (align: BlueprintAlign) =>
  align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'

const WEIGHTS: Record<BlueprintWeight, 400 | 600 | 800> = {
  regular: 400,
  medium: 600,
  bold: 800
}

/** The colour a block's words take, on whatever it is filled with. */
function textColorOf(block: PlacedBlock, fill: Fill) {
  switch (block.textColor) {
    case 'primary':
      return fill.primary
    case 'accent':
      return fill.accent
    case 'muted':
      return fill.muted
    default:
      return fill.ink
  }
}

/** The reference's text size, in px, when it gave one; caps the fitted size. */
const sizeCap = (block: PlacedBlock, canvas: CanvasSize, fitted: number) =>
  block.textSize > 0
    ? Math.max(12, Math.min(fitted, Math.round(((block.textSize / 100) * canvas.height) / 1.2)))
    : fitted

const radiusOf = (block: PlacedBlock) =>
  block.shape === 'circle' || block.shape === 'pill'
    ? Math.round(Math.min(block.width, block.height) / 2)
    : block.shape === 'rect'
      ? 0
      : Math.round(Math.min(28, Math.min(block.width, block.height) * 0.18))

/** Padding inside a block with a box drawn round it. */
const paddingOf = (block: PlacedBlock, fill: Fill) =>
  fill.background || fill.border
    ? Math.round(
        Math.min(40, Math.max(10, Math.min(block.width, block.height) * 0.12))
      )
    : 0

function Frame({
  block,
  fill,
  padding,
  style,
  children
}: {
  block: PlacedBlock
  fill: Fill
  padding: number
  style?: CSSProperties
  children?: ReactNode
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: block.left,
        top: block.top,
        width: block.width,
        height: block.height,
        display: 'flex',
        overflow: 'hidden',
        padding,
        borderRadius: radiusOf(block),
        ...(fill.background ? { backgroundColor: fill.background } : {}),
        ...(fill.border ? { border: fill.border } : {}),
        ...(block.elevated ? { boxShadow: SHADOW } : {}),
        ...style
      }}
    >
      {children}
    </div>
  )
}

const inner = (block: PlacedBlock, padding: number) => ({
  width: Math.max(1, block.width - padding * 2),
  height: Math.max(1, block.height - padding * 2)
})

interface BlockProps {
  block: PlacedBlock
  spec: CanvasSpec
  canvas: CanvasSize
}

function Headline({ block, spec, canvas }: BlockProps) {
  const { copy, fonts, palette } = spec
  const fill = fillFor(block.tone, palette, block.backdrop)
  const padding = paddingOf(block, fill)
  const size = sizeCap(
    block,
    canvas,
    fitFontSize(copy.headline, inner(block, padding), {
      max: 150,
      min: 24,
      lineHeight: 1.1,
      glyph: 0.6
    })
  )
  const words = splitHeadline(copy.headline, copy.highlights)
  const color = textColorOf(block, fill)
  return (
    <Frame
      block={block}
      fill={fill}
      padding={padding}
      style={{ flexDirection: 'column', justifyContent: 'center' }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: flexAlign(block.align),
          fontFamily: fonts.heading,
          fontSize: size,
          fontWeight: block.weight === 'regular' ? 400 : fonts.headingWeight,
          lineHeight: 1.1,
          letterSpacing: -1,
          color
        }}
      >
        {words.map((word, i) => (
          <span
            key={i}
            style={{
              marginRight: i < words.length - 1 ? Math.round(size * 0.24) : 0,
              color: word.highlight ? fill.accent : color
            }}
          >
            {word.text}
          </span>
        ))}
      </div>
    </Frame>
  )
}

/**
 * Words in a block with no structure of their own: the tagline, the
 * subheadline, the website, or a label with its own text and detail.
 */
function Words({
  block,
  spec,
  canvas,
  text,
  kind
}: BlockProps & {
  text: string
  kind: 'tagline' | 'text' | 'footer' | 'label'
}) {
  const { palette } = spec
  const fill = fillFor(block.tone, palette, block.backdrop)
  const padding = paddingOf(block, fill)
  const box = inner(block, padding)
  const detail = kind === 'label' ? block.detail : ''
  const mainBox = { width: box.width, height: box.height * (detail ? 0.6 : 1) }
  const fitted =
    kind === 'tagline'
      ? fitFontSize(text.toUpperCase(), mainBox, { max: 40, min: 14, glyph: 0.72, maxLines: 2 })
      : kind === 'text'
        ? fitFontSize(text, mainBox, { max: 52, min: 16, lineHeight: 1.35, glyph: 0.52 })
        : fitFontSize(text, mainBox, {
            max: 140,
            min: 14,
            glyph: block.weight === 'bold' || kind === 'footer' ? 0.66 : 0.6,
            maxLines: kind === 'footer' ? 1 : undefined
          })
  const size = sizeCap(block, canvas, fitted)
  const defaultColor =
    kind === 'tagline'
      ? fill.primary
      : kind === 'text' || kind === 'footer'
        ? fill.muted
        : fill.ink
  const color =
    block.textColor === 'default' ? defaultColor : textColorOf(block, fill)
  const weight =
    kind === 'tagline' || kind === 'footer'
      ? block.weight === 'regular'
        ? 400
        : 600
      : kind === 'text' && block.weight === 'medium'
        ? 400
        : WEIGHTS[block.weight]
  return (
    <Frame
      block={block}
      fill={fill}
      padding={padding}
      style={{
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: flexAlign(block.align),
        gap: Math.round(size * 0.2)
      }}
    >
      <div
        style={{
          display: 'flex',
          ...(kind === 'footer' ? { whiteSpace: 'nowrap' as const } : {}),
          // satori fails on an undefined fontFamily, so it is set only when used.
          ...(kind === 'label' && block.weight === 'bold'
            ? { fontFamily: spec.fonts.heading }
            : {}),
          fontSize: size,
          fontWeight: weight,
          lineHeight: kind === 'text' ? 1.35 : 1.15,
          letterSpacing: kind === 'tagline' ? Math.round(size * 0.14) : 0,
          textTransform: kind === 'tagline' ? 'uppercase' : 'none',
          textAlign: block.align,
          color
        }}
      >
        {text}
      </div>
      {detail ? (
        <div
          style={{
            display: 'flex',
            fontSize: Math.min(
              Math.round(size * 0.6),
              fitFontSize(detail, { width: box.width, height: box.height * 0.4 }, { max: 36, min: 12, glyph: 0.52 })
            ),
            lineHeight: 1.3,
            textAlign: block.align,
            color: fill.muted
          }}
        >
          {detail}
        </div>
      ) : null}
    </Frame>
  )
}

function Logo({ block, spec }: BlockProps) {
  const { logo, palette, fonts } = spec
  const align = { alignItems: 'center', justifyContent: flexAlign(block.align) }
  const fill = fillFor('none', palette, block.backdrop)
  if (!logo) {
    if (!spec.wordmark) return null
    const size = fitFontSize(spec.wordmark, block, { max: 44, min: 16, glyph: 0.7, maxLines: 1 })
    return (
      <Frame block={block} fill={fill} padding={0} style={align}>
        <div
          style={{
            display: 'flex',
            whiteSpace: 'nowrap',
            fontFamily: fonts.heading,
            fontSize: size,
            fontWeight: fonts.headingWeight,
            color: fill.ink
          }}
        >
          {spec.wordmark}
        </div>
      </Frame>
    )
  }
  const plate = logo.plate ? Math.round(Math.min(block.height * 0.18, 20)) : 0
  const scale = Math.min(
    (block.width - plate * 2) / logo.width,
    (block.height - plate * 2) / logo.height
  )
  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- satori, not the DOM
    <img
      src={logo.dataUrl}
      width={Math.max(1, Math.round(logo.width * scale))}
      height={Math.max(1, Math.round(logo.height * scale))}
      alt=""
    />
  )
  return (
    <Frame block={block} fill={fill} padding={0} style={align}>
      {plate ? (
        <div
          style={{
            display: 'flex',
            padding: plate,
            borderRadius: plate,
            backgroundColor: palette.ink
          }}
        >
          {image}
        </div>
      ) : (
        image
      )}
    </Frame>
  )
}

/** An icon in a tile: filled when it sits on a pale box, pale on a strong one. */
function IconTile({
  block,
  size,
  fill,
  palette
}: {
  block: PlacedBlock
  size: number
  fill: Fill
  palette: CanvasPalette
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: block.shape === 'circle' ? size / 2 : Math.round(size * 0.28),
        backgroundColor: fill.strong ? mix(fill.ink, fill.background || palette.primary, 0.82) : palette.primarySoft
      }}
    >
      <Icon
        name={block.icon!}
        size={Math.round(size * 0.52)}
        color={fill.strong ? fill.ink : palette.primary}
      />
    </div>
  )
}

function Card({ block, spec, canvas }: BlockProps) {
  const { palette } = spec
  const fill = fillFor(block.tone, palette, block.backdrop)
  const padding = paddingOf(block, fill)
  const box = inner(block, padding)
  const round = block.shape === 'circle'
  const beside =
    !round &&
    (block.iconPlacement === 'left' ||
      (block.iconPlacement === 'auto' && box.width > box.height * 1.6))
  const iconSize = block.icon
    ? Math.round(
        Math.min(
          120,
          Math.max(24, beside ? box.height * 0.8 : Math.min(box.width, box.height) * (round ? 0.3 : 0.32))
        )
      )
    : 0
  const gap = iconSize ? Math.round(Math.max(8, iconSize * 0.25)) : 0
  const textBox = beside
    ? { width: box.width - iconSize - gap, height: box.height }
    : { width: box.width * (round ? 0.8 : 1), height: box.height - iconSize - gap }
  const labelSize = sizeCap(
    block,
    canvas,
    fitFontSize(
      block.text,
      { width: textBox.width, height: textBox.height * (block.detail ? 0.5 : 1) },
      { max: 56, min: 14, lineHeight: 1.18, glyph: block.weight === 'bold' ? 0.62 : 0.58 }
    )
  )
  const detailSize = block.detail
    ? Math.min(
        Math.round(labelSize * 0.75),
        fitFontSize(
          block.detail,
          { width: textBox.width, height: textBox.height * 0.5 },
          { max: 34, min: 12, lineHeight: 1.3, glyph: 0.52 }
        )
      )
    : 0
  const align = round ? 'center' : block.align
  return (
    <Frame
      block={block}
      fill={fill}
      padding={padding}
      style={{
        flexDirection: beside ? 'row' : 'column',
        alignItems: beside ? 'center' : flexAlign(align),
        justifyContent: beside ? flexAlign(align) : 'center',
        gap
      }}
    >
      {block.icon ? (
        <IconTile block={block} size={iconSize} fill={fill} palette={palette} />
      ) : null}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: beside ? 'flex-start' : flexAlign(align),
          gap: Math.round(labelSize * 0.25),
          maxWidth: textBox.width
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: labelSize,
            fontWeight: block.weight === 'regular' ? 600 : 800,
            lineHeight: 1.18,
            textAlign: beside ? 'left' : align,
            color: textColorOf(block, fill)
          }}
        >
          {block.text}
        </div>
        {block.detail ? (
          <div
            style={{
              display: 'flex',
              fontSize: detailSize,
              lineHeight: 1.3,
              textAlign: beside ? 'left' : align,
              color: fill.muted
            }}
          >
            {block.detail}
          </div>
        ) : null}
      </div>
    </Frame>
  )
}

function Stat({ block, spec, canvas }: BlockProps) {
  const { palette, fonts } = spec
  const fill = fillFor(block.tone, palette, block.backdrop)
  const padding = paddingOf(block, fill)
  const box = inner(block, padding)
  const align = block.shape === 'circle' ? 'center' : block.align
  const size = sizeCap(
    block,
    canvas,
    fitFontSize(
      block.text,
      { width: box.width, height: box.height * (block.detail ? 0.6 : 1) },
      { max: 180, min: 24, lineHeight: 1, glyph: 0.66, maxLines: 1 }
    )
  )
  const detailSize = block.detail
    ? Math.min(
        Math.round(size * 0.4),
        fitFontSize(
          block.detail,
          { width: box.width, height: box.height * 0.4 },
          { max: 34, min: 12, lineHeight: 1.25, glyph: 0.52 }
        )
      )
    : 0
  return (
    <Frame
      block={block}
      fill={fill}
      padding={padding}
      style={{
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: flexAlign(align),
        gap: Math.round(size * 0.12)
      }}
    >
      <div
        style={{
          display: 'flex',
          fontFamily: fonts.heading,
          fontSize: size,
          fontWeight: block.weight === 'regular' ? 400 : fonts.headingWeight,
          lineHeight: 1,
          letterSpacing: -1,
          whiteSpace: 'nowrap',
          color: block.textColor === 'default' ? fill.accent : textColorOf(block, fill)
        }}
      >
        {block.text}
      </div>
      {block.detail ? (
        <div
          style={{
            display: 'flex',
            fontSize: detailSize,
            lineHeight: 1.25,
            textAlign: align,
            color: fill.muted
          }}
        >
          {block.detail}
        </div>
      ) : null}
    </Frame>
  )
}

/** A pill, or a button when `button`: a label on one line, in its own shape. */
function Chip({ block, spec, canvas, button = false }: BlockProps & { button?: boolean }) {
  const { palette } = spec
  // A chip without a box of its own is still drawn as one; and one in the
  // colour of the panel it sits on turns white, so it does not vanish.
  const boxed: BlueprintTone =
    block.tone === 'none' ? (button ? 'primary' : 'surface') : block.tone
  const tone: BlueprintTone = boxed === block.backdrop ? 'surface' : boxed
  const fill = fillFor(tone, palette, block.backdrop)
  const shaped = { ...block, shape: block.shape === 'rounded' && !button ? 'pill' : block.shape } as PlacedBlock
  const padY = Math.round(block.height * 0.18)
  const padX = Math.round(Math.min(block.height * 0.45, 40))
  const box = { width: block.width - padX * 2, height: block.height - padY * 2 }
  const iconSize = block.icon ? Math.round(box.height * 0.7) : 0
  const size = sizeCap(
    block,
    canvas,
    fitFontSize(
      block.text,
      { width: box.width - (iconSize ? iconSize * 1.4 : 0), height: box.height },
      { max: 44, min: 12, maxLines: 1, glyph: button ? 0.66 : 0.62 }
    )
  )
  return (
    <Frame
      block={shaped}
      fill={fill}
      padding={0}
      style={{
        alignItems: 'center',
        justifyContent: button ? 'center' : flexAlign(block.align),
        padding: `${padY}px ${padX}px`,
        gap: Math.round(iconSize * 0.4)
      }}
    >
      {iconSize ? (
        <Icon
          name={block.icon!}
          size={iconSize}
          color={fill.strong ? fill.ink : palette.primary}
        />
      ) : null}
      <div
        style={{
          display: 'flex',
          whiteSpace: 'nowrap',
          fontSize: size,
          fontWeight: block.weight === 'regular' ? 400 : button || block.weight === 'bold' ? 800 : 600,
          color: textColorOf(block, fill)
        }}
      >
        {block.text}
      </div>
    </Frame>
  )
}

function Bullet({ block, spec, canvas }: BlockProps) {
  const { palette } = spec
  const fill = fillFor(block.tone, palette, block.backdrop)
  const padding = paddingOf(block, fill)
  const box = inner(block, padding)
  const marker = Math.round(Math.min(box.height * 0.8, 56))
  const size = sizeCap(
    block,
    canvas,
    fitFontSize(
      block.text,
      { width: box.width - marker * 1.4, height: box.height },
      { max: 44, min: 12, lineHeight: 1.3, glyph: 0.55 }
    )
  )
  return (
    <Frame
      block={block}
      fill={fill}
      padding={padding}
      style={{ alignItems: 'center', gap: Math.round(marker * 0.4) }}
    >
      {block.icon ? (
        <Icon name={block.icon} size={Math.round(Math.min(marker, size * 1.3))} color={fill.accent} />
      ) : (
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            width: Math.round(size * 0.45),
            height: Math.round(size * 0.45),
            borderRadius: 999,
            backgroundColor: fill.accent
          }}
        />
      )}
      <div
        style={{
          display: 'flex',
          fontSize: size,
          fontWeight: WEIGHTS[block.weight] === 800 ? 600 : 400,
          lineHeight: 1.3,
          color: textColorOf(block, fill)
        }}
      >
        {block.text}
      </div>
    </Frame>
  )
}

/** A standalone icon: bare, or in its own filled, tinted or outlined shape. */
function IconBlock({ block, spec }: BlockProps) {
  const { palette } = spec
  const fill = fillFor(block.tone, palette, block.backdrop)
  const boxed = Boolean(fill.background || fill.border)
  const size = Math.round(Math.min(block.width, block.height) * (boxed ? 0.5 : 0.9))
  return (
    <Frame
      block={block}
      fill={fill}
      padding={0}
      style={{ alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon
        name={block.icon!}
        size={size}
        color={
          fill.strong
            ? fill.ink
            : block.textColor === 'accent'
              ? palette.accent
              : palette.primary
        }
      />
    </Frame>
  )
}

/** A decorative shape: a filled, tinted or outlined rectangle, pill or circle. */
function Shape({ block, spec }: BlockProps) {
  const fill = fillFor(block.tone === 'none' ? 'soft' : block.tone, spec.palette, block.backdrop)
  return <Frame block={block} fill={fill} padding={0} />
}

/** A line along the block's longer side. */
function Divider({ block, spec }: BlockProps) {
  const { palette } = spec
  const across = block.width >= block.height
  const thickness = Math.max(2, Math.min(8, across ? block.height : block.width))
  // A hairline unless the reference drew it in a strong colour.
  const under = fillFor('none', palette, block.backdrop)
  const color =
    block.tone === 'primary'
      ? under.primary
      : block.tone === 'accent'
        ? under.accent
        : block.tone === 'dark'
          ? under.ink
          : under.strong
            ? under.muted
            : palette.line
  return (
    <div
      style={{
        position: 'absolute',
        display: 'flex',
        left: across ? block.left : block.left + block.width / 2 - thickness / 2,
        top: across ? block.top + block.height / 2 - thickness / 2 : block.top,
        width: across ? block.width : thickness,
        height: across ? thickness : block.height,
        borderRadius: thickness / 2,
        backgroundColor: color
      }}
    />
  )
}

/**
 * The illustration in the first image block; any other image block, or the
 * first when no illustration could be drawn, is a soft panel with its icon.
 */
function ImageArea({ block, spec, first }: BlockProps & { first: boolean }) {
  const { visual, palette } = spec
  if (!first || visual.kind !== 'illustration') {
    return (
      <Frame
        block={block}
        fill={fillFor(block.tone === 'none' ? 'soft' : block.tone, palette, block.backdrop)}
        padding={0}
        style={{ alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon
          name={block.icon || 'sparkles'}
          size={Math.round(Math.min(block.width, block.height) * 0.36)}
          color={palette.primary}
          strokeWidth={1.6}
        />
      </Frame>
    )
  }
  const size = Math.min(block.width, block.height)
  const src = `data:image/png;base64,${visual.image.toString('base64')}`
  return (
    <Frame
      block={block}
      fill={fillFor(block.shape === 'circle' ? 'soft' : 'none', palette)}
      padding={0}
      style={{ alignItems: 'center', justifyContent: 'center' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- satori */}
      <img src={src} width={size} height={size} alt="" />
    </Frame>
  )
}

/** Where a line from `from` towards `to` leaves `from`'s box, `gap` px out. */
function edgePoint(from: PlacedBlock, to: PlacedBlock, gap: number) {
  const cx = from.left + from.width / 2
  const cy = from.top + from.height / 2
  const dx = to.left + to.width / 2 - cx
  const dy = to.top + to.height / 2 - cy
  const length = Math.hypot(dx, dy) || 1
  // A circle is left at its rim, not at the corner of its box.
  const t =
    from.shape === 'circle'
      ? from.width / 2 / length
      : Math.min(
          dx ? from.width / 2 / Math.abs(dx) : Infinity,
          dy ? from.height / 2 / Math.abs(dy) : Infinity
        )
  return {
    x: cx + dx * t + (dx / length) * gap,
    y: cy + dy * t + (dy / length) * gap
  }
}

function Arrows({
  blueprint,
  palette,
  canvas
}: {
  blueprint: PlacedBlueprint
  palette: CanvasPalette
  canvas: CanvasSize
}) {
  const head = 24
  const segments = blueprint.arrows.flatMap(({ from, to, style }) => {
    const a = blueprint.blocks[from]!
    const b = blueprint.blocks[to]!
    const start = edgePoint(a, b, 10)
    const end = edgePoint(b, a, 10)
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    // Boxes that touch or overlap have no room for a line between them.
    if (length < head * 2) return []
    const ux = dx / length
    const uy = dy / length
    const tip = style === 'arrow'
    const base = tip ? { x: end.x - ux * head, y: end.y - uy * head } : end
    const half = head * 0.45
    return [
      {
        line: { x1: start.x, y1: start.y, x2: base.x, y2: base.y },
        dashed: style === 'dashed',
        points: tip
          ? [
              `${end.x},${end.y}`,
              `${base.x - uy * half},${base.y + ux * half}`,
              `${base.x + uy * half},${base.y - ux * half}`
            ].join(' ')
          : null
      }
    ]
  })
  if (segments.length === 0) return null
  return (
    <svg
      width={canvas.width}
      height={canvas.height}
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      {segments.map((s, i) => (
        <g key={i}>
          <line
            {...s.line}
            stroke={palette.primary}
            strokeOpacity={0.6}
            strokeWidth={4}
            strokeLinecap="round"
            {...(s.dashed ? { strokeDasharray: '12 12' } : {})}
          />
          {s.points ? (
            <polygon points={s.points} fill={palette.primary} fillOpacity={0.75} />
          ) : null}
        </g>
      ))}
    </svg>
  )
}

function Block({ block, spec, canvas, firstImage }: BlockProps & { firstImage: boolean }) {
  const props = { block, spec, canvas }
  switch (block.role) {
    case 'headline':
      return <Headline {...props} />
    case 'tagline':
      return spec.copy.tagline ? <Words {...props} text={spec.copy.tagline} kind="tagline" /> : null
    case 'text':
      return spec.copy.subheadline ? (
        <Words {...props} text={spec.copy.subheadline} kind="text" />
      ) : null
    case 'footer':
      return spec.copy.footer ? <Words {...props} text={spec.copy.footer} kind="footer" /> : null
    case 'label':
      return <Words {...props} text={block.text} kind="label" />
    case 'logo':
      return <Logo {...props} />
    case 'card':
      return <Card {...props} />
    case 'stat':
      return <Stat {...props} />
    case 'pill':
      return <Chip {...props} />
    case 'button':
      return <Chip {...props} button />
    case 'bullet':
      return <Bullet {...props} />
    case 'icon':
      return <IconBlock {...props} />
    case 'image':
      return <ImageArea {...props} first={firstImage} />
    case 'shape':
      return <Shape {...props} />
    case 'divider':
      return <Divider {...props} />
    case 'panel': {
      if (block.tone === 'none') return null
      const across = block.width >= canvas.width * 0.9
      const down = block.height >= canvas.height * 0.9
      const fill = fillFor(block.tone, spec.palette)
      return (
        <Frame
          // A band across the image runs square into its edges, and a panel
          // under the whole image is its background, with no outline.
          block={across || down ? { ...block, shape: 'rect' } : block}
          fill={across && down ? { ...fill, border: undefined } : fill}
          padding={0}
        />
      )
    }
  }
}

export function BlueprintLayout({
  spec,
  blueprint,
  canvas
}: {
  spec: CanvasSpec
  blueprint: PlacedBlueprint
  canvas: CanvasSize
}) {
  const firstImage = blueprint.blocks.findIndex(b => b.role === 'image')
  const back = (b: PlacedBlock) =>
    b.role === 'panel' || b.role === 'shape' || b.role === 'divider'
  // Words go on top of everything, so an icon or card can never hide them.
  const words = (b: PlacedBlock) =>
    b.role === 'headline' ||
    b.role === 'tagline' ||
    b.role === 'text' ||
    b.role === 'label' ||
    b.role === 'bullet' ||
    b.role === 'footer' ||
    b.role === 'logo' ||
    b.role === 'stat'
  const layer = (keep: (block: PlacedBlock) => boolean) =>
    blueprint.blocks.map((block, i) =>
      keep(block) ? (
        <Block key={i} block={block} spec={spec} canvas={canvas} firstImage={i === firstImage} />
      ) : null
    )
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        width: '100%',
        height: '100%'
      }}
    >
      {layer(back)}
      {layer(b => b.role === 'image')}
      <Arrows blueprint={blueprint} palette={spec.palette} canvas={canvas} />
      {layer(b => !back(b) && !words(b) && b.role !== 'image')}
      {layer(words)}
    </div>
  )
}
