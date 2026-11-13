import {
  brandColors,
  describeColor,
  imageStyleLabel,
  type ImageStyle,
  type PictureStyle,
  type ResolvedBrandTheme
} from '~/lib/brand/theme'
import { shapeWords } from './reference-prompt'

/**
 * The image style in words, for its three readers: the art director, who
 * adapts it to the brand and the post (artDirectionFor); the image model,
 * whose prompt gets fixed lines from code so the style never depends on the
 * brief remembering it (buildPicturePrompt, customStyleSuffix); and the
 * corrective pass after the vision check (styleRetryLines).
 *
 * Pure, so tests can read every prompt without the models.
 */

/**
 * How a picture sits in the layout. A photograph or a 3D scene fills the
 * visual side to the image's edges, like an editorial spread; an
 * illustration is drawn on white so it can stand cut out on the brand
 * background, as the diagrams do.
 */
export type PictureDisplay = 'bleed' | 'cutout'

export const PICTURE_DISPLAY: Record<PictureStyle, PictureDisplay> = {
  photorealistic: 'bleed',
  '3d_render': 'bleed',
  illustration: 'cutout'
}

const hexNamed = (hex: string) => `${hex} (${describeColor(hex)})`

/**
 * What the art director is told about the chosen style: what the picture is,
 * how to choose its subject from the brand's world, and what `styleDirection`
 * should say. Empty for minimal graphic design, which is a diagram.
 */
export function artDirectionFor(style: ImageStyle): string {
  switch (style) {
    case 'photorealistic':
      return `Photorealistic: the visual is a real photograph from the image model, filling its side of the layout to the edges. Make it look like a photo a professional took on location for this account, not a stock image and not a picture that looks generated.
- imagePrompt: a photographer's shot description, 40 to 90 words. Describe a scene that could actually be photographed in this account's world — its industry, its customers, the place where the work in the post happens — and what is happening in it, then the camera angle and framing, the light and the mood. A logistics post might be a loading dock at first light; a clinic's, a nurse checking a chart at a bedside; an accountant's, a desk of receipts beside a closed laptop. Show the post's point through a real moment, not a metaphor built from props.
- People are welcome when the post is about people or their work: ordinary, anonymous people, candid and mid-task, often seen from the side, from behind or partly out of focus. Never a famous or named person, never a posed smile at the camera.
- Keep anything readable out of the shot: no screen, monitor, laptop display, document, spreadsheet, whiteboard, sign, label or packaging facing the camera. An image model fills every readable surface with fake lettering, which gives the photo away. Turn such things away from the camera, blur them deep in the background or leave them out, and tell the story with people, hands at work, objects and places instead.
- Avoid the clichés that make an image look fake: handshakes, people pointing at screens, glowing brains, robots, light bulbs, chess or puzzle pieces, rockets, targets, floating holograms and glowing icons.
- styleDirection: one or two sentences fitting the photographic look to this brand and audience — warm documentary light for a family business, crisp cool daylight for a fintech, a gritty on-site look for construction — and naming one or two real things in the scene that carry the brand colour (a wall, a jacket, packaging, a piece of equipment).`
    case '3d_render':
      return `3D Render: the visual is a polished 3D scene from the image model, filling its side of the layout to the edges, with the finish of premium product visualisation.
- imagePrompt: 40 to 80 words describing one to three concrete objects from the post's world that carry its point (a parcel, a stack of blank paper forms, a server rack, a medicine bottle), how they are arranged, their materials, the camera angle and the backdrop. Real objects at real proportions, not abstract blobs, characters or mascots. No human figures, and no screens, labels or printed matter with anything on them.
- styleDirection: one or two sentences fitting the materials and lighting to this brand — sleek glass and cool light for a technology brand, warm matte ceramics for a wellness brand — and saying which objects or surfaces take the brand colours.`
    case 'illustration':
      return `Illustration: the visual is a clean editorial illustration from the image model, drawn on white and cut out onto the brand background, with the 2 or 3 nodes as labelled badges over it.
- imagePrompt: 30 to 70 words describing a simple scene or a few objects from the post's world that read at a glance, isolated on a plain white background. People only as simple stylised figures, without detailed faces or hands.
- styleDirection: one or two sentences fitting the illustration to this brand — its line weight, shape language, level of detail and mood: refined monoline for a law firm, bold geometric shapes for a startup, soft rounded forms for healthcare.`
    case 'minimal_graphic':
      return 'Minimal Graphic Design: the visual is a clean diagram drawn by code from labelled nodes, in the brand colours. There is no picture: leave imagePrompt and styleDirection empty.'
  }
}

/** The schema's description of imagePrompt, in the chosen style's terms. */
export function imagePromptFieldGuide(style: ImageStyle): string {
  switch (style) {
    case 'photorealistic':
      return "The photograph the image model takes, as a photographer's shot description: the real scene from this post's world, what is happening, camera angle, framing, light and mood. Never ask for text, signs, labels, logos or famous people."
    case '3d_render':
      return 'The 3D scene the image model renders: the concrete objects, their materials and arrangement, camera angle and backdrop. Never ask for text, labels, logos or human figures.'
    case 'illustration':
      return "The illustration the image model draws, isolated on a plain white background. Name objects by their look, never by words printed on them. Never ask for text, labels, logos or people's hands."
    case 'minimal_graphic':
      return 'Empty: a minimal graphic is a diagram drawn from the nodes.'
  }
}

/**
 * Words in a picture's description that ask for another style than the one
 * chosen: a photograph described as "a flat vector illustration" comes out
 * half drawn. The guard sends such a brief back once.
 */
const STYLE_CLASHES: Record<PictureStyle, string[]> = {
  photorealistic: [
    'illustration',
    'illustrated',
    'vector',
    'cartoon',
    'flat design',
    'isometric',
    '3d render',
    'cgi',
    'claymation',
    'anime'
  ],
  '3d_render': ['photograph', 'photo of', 'vector', 'flat design', 'cartoon', 'anime', 'sketch'],
  illustration: ['photograph', 'photo of', 'photorealistic', '3d render', 'cgi', 'hyperrealistic']
}

/**
 * True when `term` occurs as a whole word other than in a clause that rules
 * it out: briefs routinely say "not a cartoon", which is no clash.
 */
function asksFor(text: string, term: string): boolean {
  const pattern = new RegExp(`\\b${term.replace(/ /g, '\\s+')}\\b`, 'g')
  for (const match of text.matchAll(pattern)) {
    const clause = text.slice(0, match.index).split(/[.;:!?\n]/).pop() || ''
    if (!/\b(?:no|not|without|never|avoid|free of|rather than|instead of)\b/.test(clause.slice(-60))) {
      return true
    }
  }
  return false
}

export function styleClashes(style: ImageStyle, description: string): string[] {
  if (style === 'minimal_graphic') return []
  const text = description.toLowerCase()
  return STYLE_CLASHES[style].filter(word => asksFor(text, word))
}

/** The fixed description of each style, for a picture that fills its frame. */
const STYLE_LINES: Record<ImageStyle, string> = {
  photorealistic:
    'Style: an authentic photograph, indistinguishable from professional editorial photography. Shot on a full-frame camera with a 35mm or 50mm prime lens; natural or naturally motivated light with soft, believable shadows; true-to-life colour and white balance; real-world textures and fine detail; gentle depth of field and subtle film grain. Everything has real proportions and the small imperfections of real life. Any people are ordinary and anonymous, with natural skin texture, relaxed candid poses and correctly formed hands. It must not look generated: no illustration, cartoon, anime, 3D render or CGI look, no plastic or waxy skin, no over-smoothed glossy surfaces, no oversaturated HDR glow, no light rays, holograms or glowing icons.',
  '3d_render':
    'Style: a high-end 3D render with the polish of premium product visualisation: physically based materials such as frosted glass, brushed metal, matte ceramic and soft-touch plastic; soft studio lighting with gentle shadows and reflections; global illumination; subtle depth of field; crisp detail; a clean, seamless backdrop. Objects have real-world proportions and materials. Not toy-like, not clay, no cartoon characters or mascots, not a flat illustration, no human figures.',
  illustration:
    'Style: a clean, modern editorial illustration in flat vector style: simple confident shapes, consistent line weight, subtle shading and generous white space. People, if any, are simple stylised figures without detailed faces or hands. Not a photograph and not a 3D render.',
  minimal_graphic:
    'Style: minimal graphic design: flat geometric shapes on a strict grid, generous negative space, crisp edges and a limited palette. No photographic texture, no 3D, no illustration of scenes.'
}

/** How the brand colours enter a picture without making it look fake. */
function colourLines(style: ImageStyle, theme: ResolvedBrandTheme): string | null {
  const [first, second] = brandColors(theme)
  if (!first) return null
  const both = second
    ? `${hexNamed(first.hex)} and ${hexNamed(second.hex)}`
    : hexNamed(first.hex)
  switch (style) {
    case 'photorealistic':
      // A photo tinted all over in the brand colour is the surest way to make
      // it look generated: the colour belongs to real things in the scene.
      return `Brand colours: ${both}. They appear as real things in the scene — ${hexNamed(first.hex)} on one or two prominent objects or surfaces${second ? `, ${hexNamed(second.hex)} as a smaller accent` : ''} — while everything else keeps natural, neutral colour. Never tint, filter or colour-grade the whole photograph in the brand colour.`
    case '3d_render':
      return `Brand colours: the main objects and materials in ${hexNamed(first.hex)}${second ? `, accents in ${hexNamed(second.hex)}` : ''}, with white, light grey and near-black as neutrals. No other strong colours.`
    case 'illustration':
    case 'minimal_graphic':
      return `Colour palette: ${both}, with white, light grey and near-black as neutrals. No other strong colours.`
  }
}

/** Nothing on a picture is lettered: the headline and logo are drawn by code. */
const NO_TEXT_LINE =
  'No text anywhere in the picture: no letters, words, numbers, signs, labels, captions or interface text. Screens, documents and packaging are blank, turned away or show soft abstract shapes. No logos, emblems, brand names or watermarks.'

/**
 * A photograph or 3D scene cannot draw a "blank" screen convincingly: any
 * readable surface facing the camera comes back covered in fake lettering.
 */
const NO_TEXT_LINE_SCENE =
  'No text anywhere in the picture: no letters, words, numbers, signs, labels, captions or interface text. No screen, monitor, document, sign, label or packaging faces the camera with anything on it: such things are turned away, deep out of focus or out of frame. No logos, emblems, brand names, device makers\' names or watermarks.'

/**
 * The prompt for the picture in a designed image: the scene the art director
 * wrote, the chosen style and its adaptation to the brand, the brand colours,
 * the frame it fills, and the no-text rule. The style lines come from code,
 * so every picture of a style is asked for the same way however the brief
 * was worded.
 */
export function buildPicturePrompt(options: {
  style: PictureStyle
  /** The art director's imagePrompt; the concept when it left that empty. */
  scene: string
  /** The art director's adaptation of the style to this brand and post. */
  styleDirection?: string
  theme: ResolvedBrandTheme
  /** The size the picture is generated at. */
  frame: { width: number; height: number }
}): string {
  const { style, frame } = options
  const display = PICTURE_DISPLAY[style]
  const lines = [options.scene.trim()]
  lines.push(STYLE_LINES[style])
  const direction = options.styleDirection?.trim()
  if (direction) lines.push(`Art direction for this brand: ${direction}`)
  const colours = colourLines(style, options.theme)
  if (colours) lines.push(colours)

  const panoramic = frame.width / frame.height > 2.4
  lines.push(
    display === 'cutout'
      ? // Cut out onto the brand background afterwards (see canvas/illustration).
        'Composition: one clear subject, whole and centred, isolated on a pure seamless white (#ffffff) background, with nothing touching the edges.'
      : panoramic
        ? 'Composition: a wide panoramic frame. Compose horizontally with the subject across the middle band, whole and in focus, and nothing important near the top or bottom edge.'
        : `Composition: ${shapeWords(frame)} frame with one clear focal subject, whole and in focus, with breathing room around it; nothing important touches or is cut off at the edges. Uncluttered enough to read at a glance on a phone.`
  )
  lines.push(display === 'bleed' ? NO_TEXT_LINE_SCENE : NO_TEXT_LINE)
  return lines.join('\n\n')
}

/**
 * The style for an image made from the reviewer's own prompt. It is the
 * default, not an order: a prompt that names its own look ("a watercolour
 * of…") is followed, as with the brand colours.
 */
export function customStyleSuffix(style: ImageStyle): string {
  const lines =
    style === 'illustration'
      ? STYLE_LINES.illustration
      : style === 'photorealistic'
        ? `${STYLE_LINES.photorealistic} The brand colours, if given below, appear on real objects in the scene rather than as a tint over the photograph.`
        : STYLE_LINES[style]
  return `Unless the description above asks for a different look, render it in the ${imageStyleLabel(style)} style. ${lines}`
}

/**
 * Plain positive rules for the second attempt at a picture the vision check
 * found artefacts in, or in another style than asked for.
 */
export function styleRetryLines(
  style: ImageStyle,
  found: { artifacts: string[]; styleMismatch: boolean; lettering?: boolean }
): string {
  const lines: string[] = []
  // Asked for blank screens, a photograph shows the same screens with new
  // gibberish on them; the surfaces have to leave the shot.
  if (found.lettering && (style === 'photorealistic' || style === '3d_render')) {
    lines.push(
      'Reframe the shot so that no screen, monitor, document, sign, label or packaging faces the camera: turn it away, blur it deep out of focus or leave it out, and no device shows a maker\'s name.'
    )
  }
  if (found.styleMismatch) {
    lines.push(
      style === 'photorealistic'
        ? 'Make it unmistakably a real photograph: natural light, real materials and textures, true-to-life colour, the look of a professional camera. Nothing drawn, rendered or stylised.'
        : style === '3d_render'
          ? 'Make it unmistakably a polished 3D render with physically based materials and studio lighting.'
          : 'Make it unmistakably a flat editorial illustration on a pure white background.'
    )
  }
  if (found.artifacts.length > 0) {
    lines.push(
      'Every object, hand and face is correctly formed with real-world proportions; surfaces, edges and lines are straight and continuous where they should be; nothing is warped, melted, duplicated or merged.'
    )
  }
  return lines.join(' ')
}
