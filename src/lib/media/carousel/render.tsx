import {
  listPoints,
  SLIDE_TEXT,
  type SlideContent,
  type SlideLayout
} from '@/lib/carousel/types'
import { ImageResponse } from 'next/og'
import type { ReactNode } from 'react'
import type { CanvasPattern } from '~/lib/brand/theme'
import { IconTile } from '../canvas/diagram'
import type { SatoriFont } from '../canvas/fonts'
import { mix, type CanvasPalette } from '../canvas/palette'
import {
  splitHeadline,
  type CanvasFonts,
  type CanvasLogo
} from '../canvas/spec'

/**
 * Draws one carousel slide as a PNG with next/og (satori lays it out, resvg
 * rasterises it), the way ../canvas/render draws a single post image: every
 * word is set here in real type in the brand's fonts and colours, and the
 * logo is the uploaded file, so nothing on a slide can come out misspelt.
 *
 * Every slide shares one frame (the logo top-left, the website bottom-left,
 * "n / total" and an arrow bottom-right) so a carousel reads as one piece
 * while swiping; the layout (src/lib/carousel/types) decides what fills the
 * middle. Sizes are set for 1080 wide and scaled with the slide, and text is
 * sized by its length so the longest a slide may hold still fits.
 */

/** Instagram's portrait size, which LinkedIn's document pages also take. */
export const SLIDE_SIZE = { width: 1080, height: 1350 } as const

export interface SlidePicture {
  image: Buffer
  mediaType: 'image/png' | 'image/jpeg'
}

export interface SlideRenderInput {
  slide: SlideContent & { number: number; total: number }
  picture: SlidePicture | null
  palette: CanvasPalette
  fonts: CanvasFonts
  pattern: CanvasPattern
  logo: CanvasLogo | null
  /** Shown where the logo would be when there is no logo file. */
  wordmark: string | null
  /** The website or handle, bottom-left. */
  footer: string | null
  size?: { width: number; height: number }
}

type Size = { width: number; height: number }

/** A photo slide's picture takes this share of the slide's height. */
const PHOTO_SHARE = 0.52

const roundUp16 = (n: number) => Math.ceil(n / 16) * 16

/**
 * The pixel box a picture fills on this layout at this size, both sides
 * rounded up to multiples of 16 for the image model; the renderer crops it
 * to the exact area. Layouts without a picture get the cover's box, so a
 * picture asked for anyway is still made at a usable size.
 */
export function slidePictureFrame(
  layout: SlideLayout,
  size: Size = SLIDE_SIZE
): Size {
  if (layout === 'photo') {
    return {
      width: roundUp16(size.width),
      height: roundUp16(Math.round(size.height * PHOTO_SHARE))
    }
  }
  return { width: roundUp16(size.width), height: roundUp16(size.height) }
}

/** Everything a part of the slide needs, with lengths scaled to its width. */
interface Frame {
  input: SlideRenderInput
  size: Size
  /** A length designed at 1080 wide, at this slide's width. */
  u: (n: number) => number
  isLast: boolean
}

const WHITE = '#ffffff'

const clampText = (text: string, max: number) => {
  const clean = text.trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Steps down as the text grows, so the longest allowed still fits its area. */
function stepSize(
  length: number,
  steps: Array<[number, number]>,
  last: number
) {
  for (const [max, size] of steps) if (length <= max) return size
  return last
}

const headlineSize = (text: string, kind: 'cover' | 'content' | 'compact') =>
  kind === 'cover'
    ? stepSize(
        text.length,
        [
          [20, 112],
          [36, 100],
          [52, 88],
          [70, 76]
        ],
        64
      )
    : kind === 'content'
      ? stepSize(
          text.length,
          [
            [20, 92],
            [36, 82],
            [52, 72],
            [70, 64]
          ],
          56
        )
      : stepSize(
          text.length,
          [
            [20, 76],
            [36, 68],
            [52, 60],
            [70, 54]
          ],
          48
        )

// A 1080-wide slide shows at about 400 px on a phone: below ~30 px here the
// body would read at under 11 px there.
const bodySize = (text: string, compact = false) =>
  compact
    ? stepSize(
        text.length,
        [
          [90, 36],
          [160, 33],
          [240, 31]
        ],
        30
      )
    : stepSize(
        text.length,
        [
          [90, 44],
          [160, 40],
          [240, 36]
        ],
        33
      )

const pictureSrc = (picture: SlidePicture) =>
  `data:${picture.mediaType};base64,${picture.image.toString('base64')}`

/** The brand background: its pattern fading out toward the text, and a soft glow. */
function Background({ frame }: { frame: Frame }) {
  const { palette, pattern } = frame.input
  const { width, height } = frame.size
  return (
    <svg
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      <defs>
        <pattern
          id="dots"
          width={frame.u(30)}
          height={frame.u(30)}
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx={frame.u(15)}
            cy={frame.u(15)}
            r={frame.u(2)}
            fill={palette.pattern}
          />
        </pattern>
        <pattern
          id="grid"
          width={frame.u(52)}
          height={frame.u(52)}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${frame.u(52)} 0 L 0 0 0 ${frame.u(52)}`}
            fill="none"
            stroke={palette.pattern}
            strokeWidth="1.5"
          />
        </pattern>
        <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={palette.primary} stopOpacity="0.14" />
          <stop offset="1" stopColor={palette.primary} stopOpacity="0" />
        </radialGradient>
        {/* Opaque where the text sits (bottom-left), clear toward the top-right. */}
        <linearGradient id="fade" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={palette.background} stopOpacity="1" />
          <stop offset="0.5" stopColor={palette.background} stopOpacity="0.9" />
          <stop offset="0.85" stopColor={palette.background} stopOpacity="0" />
        </linearGradient>
      </defs>
      {pattern !== 'plain' && (
        <rect width="100%" height="100%" fill={`url(#${pattern})`} />
      )}
      <rect width="100%" height="100%" fill="url(#fade)" />
      <circle
        cx={width * 0.92}
        cy={height * 0.08}
        r={width * 0.55}
        fill="url(#glow)"
      />
    </svg>
  )
}

/** The logo, or the wordmark in its place; `onPicture` puts it on a plate over a photo. */
function Logo({
  frame,
  box,
  onPicture = false
}: {
  frame: Frame
  box: Size
  onPicture?: boolean
}) {
  const { logo, wordmark, palette, fonts } = frame.input
  if (!logo) {
    if (!wordmark)
      return <div style={{ display: 'flex', height: box.height }} />
    const text = clampText(wordmark, 28)
    const fontSize = Math.round(box.height * 0.55)
    return onPicture ? (
      <div
        style={{
          display: 'flex',
          padding: `${frame.u(10)}px ${frame.u(22)}px`,
          borderRadius: frame.u(16),
          backgroundColor: 'rgba(15, 23, 42, 0.55)',
          color: WHITE,
          fontFamily: fonts.heading,
          fontWeight: fonts.headingWeight,
          fontSize
        }}
      >
        {text}
      </div>
    ) : (
      <div
        style={{
          display: 'flex',
          height: box.height,
          alignItems: 'center',
          fontFamily: fonts.heading,
          fontWeight: fonts.headingWeight,
          fontSize,
          color: palette.ink
        }}
      >
        {text}
      </div>
    )
  }
  const scale = Math.min(box.width / logo.width, box.height / logo.height)
  const width = Math.max(1, Math.round(logo.width * scale))
  const height = Math.max(1, Math.round(logo.height * scale))
  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- satori, not the DOM
    <img src={logo.dataUrl} width={width} height={height} alt="" />
  )
  // A light logo is made for dark backgrounds: a dark plate under it. Over a
  // photo a dark logo needs a light one, or it is lost in the picture.
  if (logo.plate || onPicture) {
    return (
      <div
        style={{
          display: 'flex',
          padding: `${frame.u(12)}px ${frame.u(20)}px`,
          borderRadius: frame.u(18),
          backgroundColor: logo.plate
            ? palette.ink
            : 'rgba(255, 255, 255, 0.92)'
        }}
      >
        {image}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', height: box.height, alignItems: 'center' }}>
      {image}
    </div>
  )
}

/** The small arrow that says there is more to swipe to. */
function Arrow({ frame, onPicture }: { frame: Frame; onPicture: boolean }) {
  const { palette } = frame.input
  const d = frame.u(52)
  const fill = onPicture ? WHITE : palette.primary
  const stroke = onPicture ? palette.ink : palette.onPrimary
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: d,
        height: d,
        borderRadius: d / 2,
        backgroundColor: fill,
        marginLeft: frame.u(16)
      }}
    >
      <svg
        width={Math.round(d * 0.5)}
        height={Math.round(d * 0.5)}
        viewBox="0 0 24 24"
        fill="none"
        stroke={stroke}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </svg>
    </div>
  )
}

/** The bottom row: the website left, the slide number and arrow right. */
function FooterRow({
  frame,
  onPicture = false,
  showFooter = true
}: {
  frame: Frame
  onPicture?: boolean
  showFooter?: boolean
}) {
  const { palette, footer, slide } = frame.input
  const color = onPicture ? 'rgba(255, 255, 255, 0.86)' : palette.muted
  const website = showFooter && footer?.trim() ? clampText(footer, 44) : null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: frame.u(56),
        flexShrink: 0
      }}
    >
      {website ? (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              width: frame.u(12),
              height: frame.u(12),
              borderRadius: frame.u(6),
              marginRight: frame.u(14),
              backgroundColor: onPicture ? WHITE : palette.accent
            }}
          />
          <div
            style={{
              display: 'flex',
              fontSize: frame.u(26),
              fontWeight: 600,
              color
            }}
          >
            {website}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex' }} />
      )}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            display: 'flex',
            fontSize: frame.u(26),
            fontWeight: 600,
            color,
            letterSpacing: frame.u(1)
          }}
        >
          {`${slide.number} / ${slide.total}`}
        </div>
        {!frame.isLast && <Arrow frame={frame} onPicture={onPicture} />}
      </div>
    </div>
  )
}

/** The headline as words, the emphasised ones in `accent`. */
function Headline({
  frame,
  text,
  size,
  color,
  accent,
  align = 'left'
}: {
  frame: Frame
  text: string
  size: number
  color: string
  accent: string
  align?: 'left' | 'center'
}) {
  const { fonts, slide } = frame.input
  const words = splitHeadline(text, slide.design.emphasis ?? [])
  const gap = Math.round(size * 0.12)
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        fontFamily: fonts.heading,
        fontSize: size,
        fontWeight: fonts.headingWeight,
        lineHeight: 1.08,
        letterSpacing: -Math.round(size * 0.015),
        color,
        // The words carry half the gap on each side; the edges give it back.
        marginLeft: -gap,
        marginRight: -gap
      }}
    >
      {words.map((word, i) => (
        <span
          key={i}
          style={{
            marginLeft: gap,
            marginRight: gap,
            color: word.highlight ? accent : color
          }}
        >
          {word.text}
        </span>
      ))}
    </div>
  )
}

function Body({
  frame,
  text,
  size,
  color,
  align = 'left',
  marginTop
}: {
  frame: Frame
  text: string
  size: number
  color: string
  align?: 'left' | 'center'
  marginTop: number
}) {
  if (!text) return null
  return (
    <div
      style={{
        display: 'flex',
        marginTop,
        fontFamily: frame.input.fonts.body,
        fontSize: size,
        lineHeight: 1.42,
        color,
        whiteSpace: 'pre-wrap',
        textAlign: align,
        justifyContent: align === 'center' ? 'center' : 'flex-start'
      }}
    >
      {text}
    </div>
  )
}

/** A short accent bar, the slide's number in two digits beside it. */
function Eyebrow({ frame }: { frame: Frame }) {
  const { palette, fonts, slide } = frame.input
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: frame.u(36)
      }}
    >
      <div
        style={{
          display: 'flex',
          fontFamily: fonts.heading,
          fontWeight: fonts.headingWeight,
          fontSize: frame.u(40),
          color: palette.accent,
          marginRight: frame.u(18)
        }}
      >
        {String(slide.number).padStart(2, '0')}
      </div>
      <div
        style={{
          display: 'flex',
          width: frame.u(64),
          height: frame.u(6),
          borderRadius: frame.u(3),
          backgroundColor: palette.accent
        }}
      />
    </div>
  )
}

/** The slide on the brand background: logo, the layout's content, the footer row. */
function Framed({
  frame,
  children,
  justify = 'center',
  showFooter = true
}: {
  frame: Frame
  children: ReactNode
  justify?: 'center' | 'flex-start' | 'flex-end'
  showFooter?: boolean
}) {
  const { u } = frame
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: frame.size.width,
        height: frame.size.height,
        display: 'flex',
        flexDirection: 'column',
        padding: `${u(76)}px ${u(84)}px ${u(68)}px ${u(84)}px`
      }}
    >
      <div style={{ display: 'flex', flexShrink: 0 }}>
        <Logo frame={frame} box={{ width: u(240), height: u(64) }} />
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: justify,
          flexGrow: 1,
          minHeight: 0,
          overflow: 'hidden',
          padding: `${u(36)}px 0 ${u(36)}px 0`
        }}
      >
        {children}
      </div>
      <FooterRow frame={frame} showFooter={showFooter} />
    </div>
  )
}

function headlineText(frame: Frame) {
  return clampText(frame.input.slide.headline, SLIDE_TEXT.headline.hard)
}

function bodyText(frame: Frame) {
  return clampText(frame.input.slide.body, SLIDE_TEXT.body.hard)
}

/** The first slide over its picture: the photo to the edges, the words on a dark fade. */
function CoverOnPicture({
  frame,
  picture
}: {
  frame: Frame
  picture: SlidePicture
}) {
  const { u, size } = frame
  const { palette } = frame.input
  const headline = headlineText(frame)
  const body = bodyText(frame)
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        left: 0,
        top: 0,
        width: size.width,
        height: size.height
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- satori */}
      <img
        src={pictureSrc(picture)}
        width={size.width}
        height={size.height}
        alt=""
        style={{ position: 'absolute', left: 0, top: 0, objectFit: 'cover' }}
      />
      <svg
        width={size.width}
        height={size.height}
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <defs>
          <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0f172a" stopOpacity="0.35" />
            <stop offset="0.25" stopColor="#0f172a" stopOpacity="0" />
            <stop offset="0.42" stopColor="#0f172a" stopOpacity="0.05" />
            <stop offset="0.7" stopColor="#0f172a" stopOpacity="0.72" />
            <stop offset="1" stopColor="#0f172a" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#shade)" />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: size.width,
          height: size.height,
          display: 'flex',
          flexDirection: 'column',
          padding: `${u(76)}px ${u(84)}px ${u(68)}px ${u(84)}px`
        }}
      >
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <Logo
            frame={frame}
            box={{ width: u(220), height: u(56) }}
            onPicture
          />
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            flexGrow: 1,
            minHeight: 0,
            overflow: 'hidden',
            paddingBottom: u(40)
          }}
        >
          <div
            style={{
              display: 'flex',
              width: u(72),
              height: u(10),
              borderRadius: u(5),
              backgroundColor: palette.accent,
              marginBottom: u(32)
            }}
          />
          <Headline
            frame={frame}
            text={headline}
            size={u(headlineSize(headline, 'cover'))}
            color={WHITE}
            // The brand accent, lifted toward white so it reads on the dark fade.
            accent={mix(palette.accent, WHITE, 0.45)}
          />
          <Body
            frame={frame}
            text={body}
            size={u(bodySize(body, true))}
            color="rgba(255, 255, 255, 0.88)"
            marginTop={u(28)}
          />
        </div>
        <FooterRow frame={frame} onPicture />
      </div>
    </div>
  )
}

function Cover({ frame }: { frame: Frame }) {
  const { u } = frame
  const { palette, slide } = frame.input
  const headline = headlineText(frame)
  const body = bodyText(frame)
  return (
    <Framed frame={frame}>
      {slide.design.icon ? (
        <div style={{ display: 'flex', marginBottom: u(48) }}>
          <IconTile
            name={slide.design.icon}
            size={u(140)}
            palette={palette}
            filled
          />
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          width: u(80),
          height: u(10),
          borderRadius: u(5),
          backgroundColor: palette.accent,
          marginBottom: u(36)
        }}
      />
      <Headline
        frame={frame}
        text={headline}
        size={u(headlineSize(headline, 'cover'))}
        color={palette.ink}
        accent={palette.accent}
      />
      <Body
        frame={frame}
        text={body}
        size={u(bodySize(body))}
        color={palette.body}
        marginTop={u(36)}
      />
    </Framed>
  )
}

function Statement({ frame }: { frame: Frame }) {
  const { u } = frame
  const { palette } = frame.input
  const headline = headlineText(frame)
  const body = bodyText(frame)
  return (
    <Framed frame={frame}>
      <Eyebrow frame={frame} />
      <Headline
        frame={frame}
        text={headline}
        size={u(headlineSize(headline, 'content'))}
        color={palette.ink}
        accent={palette.accent}
      />
      <Body
        frame={frame}
        text={body}
        size={u(bodySize(body))}
        color={palette.body}
        marginTop={u(36)}
      />
    </Framed>
  )
}

function IconSlide({ frame }: { frame: Frame }) {
  const { u } = frame
  const { palette, slide, fonts } = frame.input
  const headline = headlineText(frame)
  const body = bodyText(frame)
  const tile = u(150)
  return (
    <Framed frame={frame}>
      <div style={{ display: 'flex', marginBottom: u(52) }}>
        {slide.design.icon ? (
          <IconTile name={slide.design.icon} size={tile} palette={palette} />
        ) : (
          // No icon: the slide's number stands in the tile's place.
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: tile,
              height: tile,
              borderRadius: tile * 0.28,
              backgroundColor: palette.primary,
              color: palette.onPrimary,
              fontFamily: fonts.heading,
              fontWeight: fonts.headingWeight,
              fontSize: u(68)
            }}
          >
            {String(slide.number)}
          </div>
        )}
      </div>
      <Headline
        frame={frame}
        text={headline}
        size={u(headlineSize(headline, 'content'))}
        color={palette.ink}
        accent={palette.accent}
      />
      <Body
        frame={frame}
        text={body}
        size={u(bodySize(body))}
        color={palette.body}
        marginTop={u(36)}
      />
    </Framed>
  )
}

function StatSlide({ frame, stat }: { frame: Frame; stat: string }) {
  const { u } = frame
  const { palette, fonts } = frame.input
  const headline = headlineText(frame)
  const body = bodyText(frame)
  const statSize = stepSize(
    stat.length,
    [
      [3, 300],
      [5, 250],
      [8, 190]
    ],
    150
  )
  // A long headline under a very large figure would crowd the slide.
  const crowded = headline.length + body.length > 260
  return (
    <Framed frame={frame}>
      <div
        style={{
          display: 'flex',
          fontFamily: fonts.heading,
          fontWeight: fonts.headingWeight,
          fontSize: u(crowded ? Math.round(statSize * 0.75) : statSize),
          lineHeight: 1,
          letterSpacing: -u(Math.round(statSize * 0.03)),
          color: palette.accent,
          marginBottom: u(36)
        }}
      >
        {stat}
      </div>
      <Headline
        frame={frame}
        text={headline}
        size={u(headlineSize(headline, crowded ? 'compact' : 'content') - 6)}
        color={palette.ink}
        accent={palette.accent}
      />
      <Body
        frame={frame}
        text={body}
        size={u(bodySize(body, crowded))}
        color={palette.body}
        marginTop={u(30)}
      />
    </Framed>
  )
}

function ListSlide({ frame, points }: { frame: Frame; points: string[] }) {
  const { u } = frame
  const { palette, fonts } = frame.input
  const headline = headlineText(frame)
  const longest = Math.max(...points.map(p => p.length))
  const pointSize = stepSize(
    longest,
    [
      [40, 38],
      [70, 34]
    ],
    30
  )
  return (
    <Framed frame={frame}>
      <Headline
        frame={frame}
        text={headline}
        size={u(headlineSize(headline, 'compact'))}
        color={palette.ink}
        accent={palette.accent}
      />
      <div
        style={{ display: 'flex', flexDirection: 'column', marginTop: u(44) }}
      >
        {points.map((point, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              marginTop: i === 0 ? 0 : u(18),
              padding: `${u(24)}px ${u(28)}px`,
              borderRadius: u(26),
              backgroundColor: palette.surface,
              border: `${Math.max(1, u(2))}px solid ${palette.line}`
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: u(56),
                height: u(56),
                flexShrink: 0,
                borderRadius: u(28),
                backgroundColor: palette.accent,
                color: palette.onAccent,
                fontFamily: fonts.heading,
                fontWeight: fonts.headingWeight,
                fontSize: u(28),
                marginRight: u(26)
              }}
            >
              {String(i + 1)}
            </div>
            <div
              style={{
                display: 'flex',
                flexShrink: 1,
                fontFamily: fonts.body,
                fontSize: u(pointSize),
                fontWeight: 600,
                lineHeight: 1.3,
                color: palette.ink
              }}
            >
              {point}
            </div>
          </div>
        ))}
      </div>
    </Framed>
  )
}

function QuoteSlide({ frame }: { frame: Frame }) {
  const { u } = frame
  const { palette, fonts } = frame.input
  const headline = headlineText(frame)
  const body = bodyText(frame)
  // No body: the headline is the quote, with no one to attribute it to.
  const quote = body || headline
  const attribution = body ? headline : ''
  const quoteSize = stepSize(
    quote.length,
    [
      [80, 62],
      [160, 52],
      [240, 44]
    ],
    38
  )
  return (
    <Framed frame={frame}>
      {/* Drawn rather than typed: a heavy typeface's “ comes out as two slashes. */}
      <svg
        width={u(120)}
        height={u(120)}
        viewBox="0 0 24 24"
        style={{ marginBottom: u(36), marginLeft: -u(10) }}
      >
        <g transform="rotate(180 12 12)" fill={palette.accent}>
          <path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
          <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
        </g>
      </svg>
      <div
        style={{
          display: 'flex',
          fontFamily: fonts.heading,
          fontWeight: 600,
          fontSize: u(quoteSize),
          lineHeight: 1.26,
          letterSpacing: -u(1),
          color: palette.ink,
          whiteSpace: 'pre-wrap'
        }}
      >
        {quote}
      </div>
      {attribution ? (
        <div
          style={{ display: 'flex', alignItems: 'center', marginTop: u(44) }}
        >
          <div
            style={{
              display: 'flex',
              width: u(48),
              height: u(6),
              borderRadius: u(3),
              backgroundColor: palette.accent,
              marginRight: u(20),
              flexShrink: 0
            }}
          />
          <div
            style={{
              display: 'flex',
              fontSize: u(stepSize(attribution.length, [[40, 32]], 28)),
              fontWeight: 600,
              color: palette.muted
            }}
          >
            {attribution}
          </div>
        </div>
      ) : null}
    </Framed>
  )
}

/** A picture across the top, the words under it. */
function PhotoSlide({
  frame,
  picture
}: {
  frame: Frame
  picture: SlidePicture
}) {
  const { u, size } = frame
  const { palette } = frame.input
  const headline = headlineText(frame)
  const body = bodyText(frame)
  const pictureHeight = Math.round(size.height * PHOTO_SHARE)
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        left: 0,
        top: 0,
        width: size.width,
        height: size.height
      }}
    >
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: 0,
          top: 0,
          width: size.width,
          height: pictureHeight,
          overflow: 'hidden'
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- satori */}
        <img
          src={pictureSrc(picture)}
          width={size.width}
          height={pictureHeight}
          alt=""
          style={{ objectFit: 'cover' }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: u(84),
          top: u(60)
        }}
      >
        <Logo frame={frame} box={{ width: u(200), height: u(52) }} onPicture />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: pictureHeight,
          width: size.width,
          height: size.height - pictureHeight,
          display: 'flex',
          flexDirection: 'column',
          padding: `${u(48)}px ${u(84)}px ${u(68)}px ${u(84)}px`
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            flexGrow: 1,
            minHeight: 0,
            overflow: 'hidden',
            paddingBottom: u(24)
          }}
        >
          <Headline
            frame={frame}
            text={headline}
            size={u(headlineSize(headline, 'compact'))}
            color={palette.ink}
            accent={palette.accent}
          />
          <Body
            frame={frame}
            text={body}
            size={u(bodySize(body, true))}
            color={palette.body}
            marginTop={u(22)}
          />
        </div>
        <FooterRow frame={frame} />
      </div>
    </div>
  )
}

/** The last slide: the ask, centred, with the logo larger and the website as a button. */
function CtaSlide({ frame }: { frame: Frame }) {
  const { u, size } = frame
  const { palette, footer, fonts } = frame.input
  const headline = headlineText(frame)
  const body = bodyText(frame)
  const website = footer?.trim() ? clampText(footer, 44) : null
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: size.width,
        height: size.height,
        display: 'flex',
        flexDirection: 'column',
        padding: `${u(76)}px ${u(84)}px ${u(68)}px ${u(84)}px`
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flexGrow: 1,
          minHeight: 0,
          overflow: 'hidden'
        }}
      >
        <div style={{ display: 'flex', marginBottom: u(64) }}>
          <Logo frame={frame} box={{ width: u(420), height: u(130) }} />
        </div>
        <Headline
          frame={frame}
          text={headline}
          size={u(headlineSize(headline, 'content'))}
          color={palette.ink}
          accent={palette.accent}
          align="center"
        />
        <Body
          frame={frame}
          text={body}
          size={u(bodySize(body))}
          color={palette.body}
          align="center"
          marginTop={u(34)}
        />
        {website ? (
          <div
            style={{
              display: 'flex',
              marginTop: u(56),
              padding: `${u(24)}px ${u(48)}px`,
              borderRadius: u(999),
              backgroundColor: palette.primary,
              color: palette.onPrimary,
              fontFamily: fonts.body,
              fontWeight: 600,
              fontSize: u(34)
            }}
          >
            {website}
          </div>
        ) : null}
      </div>
      {/* The website is the button above; only the number stays below. */}
      <FooterRow frame={frame} showFooter={false} />
    </div>
  )
}

function SlideBody({ frame }: { frame: Frame }) {
  const { slide, picture } = frame.input
  const layout = slide.design.layout
  if (layout === 'cover') {
    return picture ? (
      <CoverOnPicture frame={frame} picture={picture} />
    ) : (
      <Cover frame={frame} />
    )
  }
  if (layout === 'cta') return <CtaSlide frame={frame} />
  if (layout === 'photo' && picture)
    return <PhotoSlide frame={frame} picture={picture} />
  if (layout === 'icon') return <IconSlide frame={frame} />
  if (layout === 'stat' && slide.design.stat?.trim()) {
    return (
      <StatSlide
        frame={frame}
        stat={clampText(slide.design.stat, SLIDE_TEXT.stat.hard)}
      />
    )
  }
  if (layout === 'list') {
    const points = listPoints(
      clampText(slide.body, SLIDE_TEXT.body.hard)
    ).slice(0, SLIDE_TEXT.listPoints.max)
    // One point is not a list: it reads as a statement.
    if (points.length >= SLIDE_TEXT.listPoints.min) {
      return <ListSlide frame={frame} points={points} />
    }
  }
  if (layout === 'quote') return <QuoteSlide frame={frame} />
  // statement, and any layout missing what it needs (a photo slide without
  // its picture, a stat slide without its figure)
  return <Statement frame={frame} />
}

export async function renderSlide(
  input: SlideRenderInput,
  fonts: SatoriFont[]
): Promise<Buffer> {
  const size = input.size ?? SLIDE_SIZE
  const k = size.width / SLIDE_SIZE.width
  const frame: Frame = {
    input,
    size,
    u: n => Math.round(n * k),
    isLast: input.slide.number >= input.slide.total
  }
  const bleed =
    Boolean(input.picture) &&
    (input.slide.design.layout === 'cover' ||
      input.slide.design.layout === 'photo')

  const response = new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        backgroundColor: input.palette.background,
        fontFamily: input.fonts.body,
        color: input.palette.ink
      }}
    >
      {bleed ? null : <Background frame={frame} />}
      <SlideBody frame={frame} />
    </div>,
    {
      ...size,
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
  if (body.byteLength === 0) throw new Error('The slide could not be drawn.')
  return Buffer.from(body)
}
