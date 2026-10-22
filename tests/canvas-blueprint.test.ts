import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  canvasSizeFor,
  fitFontSize,
  MAX_BLUEPRINT_BLOCKS,
  mergeRefinedBlueprint,
  placeBlueprint,
  type BlueprintBlock,
  type PlacedBlock
} from '../src/lib/media/canvas/blueprint'
import { CANVAS_SIZE } from '../src/lib/media/canvas/spec'

const block = (
  role: BlueprintBlock['role'],
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<BlueprintBlock> = {}
): BlueprintBlock => ({
  role,
  x,
  y,
  w,
  h,
  text: '',
  detail: '',
  icon: null,
  shape: 'rounded',
  tone: 'none',
  elevated: false,
  align: 'left',
  textSize: 0,
  weight: 'medium',
  textColor: 'default',
  iconPlacement: 'auto',
  ...extra
})

const none = { logo: false, footer: false }

describe('placing a reference blueprint', () => {
  it('turns percentages into canvas pixels', () => {
    const placed = placeBlueprint(
      { blocks: [block('headline', 10, 20, 50, 25)], arrows: [] },
      none
    )
    assert.deepEqual(
      placed?.blocks.map(b => [b.left, b.top, b.width, b.height]),
      [[205, 214, 1024, 268]]
    )
  })

  it('reads fractions of the image as percentages', () => {
    const placed = placeBlueprint(
      { blocks: [block('headline', 0.1, 0.2, 0.5, 0.25)], arrows: [] },
      none
    )
    assert.equal(placed?.blocks[0]?.width, 1024)
  })

  it('needs a headline, so a blueprint without one falls back to a built-in layout', () => {
    assert.equal(
      placeBlueprint(
        { blocks: [block('card', 0, 0, 30, 30, { text: 'Orders' })], arrows: [] },
        none
      ),
      null
    )
  })

  it('keeps boxes on the canvas and drops blocks with nothing to show', () => {
    const placed = placeBlueprint(
      {
        blocks: [
          block('headline', 90, 95, 40, 40),
          block('card', 0, 0, 20, 20),
          block('stat', 0, 50, 20, 20, { text: '3x' }),
          block('headline', 0, 0, 10, 10)
        ],
        arrows: []
      },
      none
    )!
    assert.deepEqual(
      placed.blocks.map(b => b.role),
      ['headline', 'stat']
    )
    const [headline] = placed.blocks
    assert.ok(headline!.left + headline!.width <= CANVAS_SIZE.width)
    assert.ok(headline!.top + headline!.height <= CANVAS_SIZE.height)
  })

  it('adds the logo and website in a free corner when the reference has no place for them', () => {
    const placed = placeBlueprint(
      { blocks: [block('headline', 0, 0, 60, 30)], arrows: [] },
      { logo: true, footer: true }
    )!
    const logo = placed.blocks.find(b => b.role === 'logo')!
    const footer = placed.blocks.find(b => b.role === 'footer')!
    // The headline takes the top left, so the logo goes top right.
    assert.ok(logo.left > CANVAS_SIZE.width / 2 && logo.top < CANVAS_SIZE.height / 2)
    assert.ok(footer.top > CANVAS_SIZE.height / 2)
  })

  it('puts the logo along an edge, clear of every block, when each corner is taken', () => {
    const corners = [
      block('tagline', 4, 4, 30, 6),
      block('pill', 80, 4, 16, 6, { text: 'New' }),
      block('pill', 4, 88, 20, 8, { text: 'Orders' }),
      block('button', 76, 88, 20, 8, { text: 'Read more' })
    ]
    const placed = placeBlueprint(
      { blocks: [block('headline', 10, 30, 60, 30), ...corners], arrows: [] },
      { logo: true, footer: false }
    )!
    const logo = placed.blocks.find(b => b.role === 'logo')!
    for (const other of placed.blocks.filter(b => b !== logo)) {
      const apart =
        logo.left + logo.width <= other.left ||
        other.left + other.width <= logo.left ||
        logo.top + logo.height <= other.top ||
        other.top + other.height <= logo.top
      assert.ok(apart, `logo overlaps the ${other.role}`)
    }
  })

  it('widens a pill into free space when its words outgrow the box', () => {
    const placed = placeBlueprint(
      {
        blocks: [
          block('headline', 0, 20, 60, 30),
          block('pill', 86, 4, 8, 5, { text: '60% fewer order errors' })
        ],
        arrows: []
      },
      none
    )!
    const pill = placed.blocks.find(b => b.role === 'pill')!
    assert.ok(pill.width > (8 / 100) * CANVAS_SIZE.width)
    // It grew leftwards, keeping its place on the right.
    assert.ok(pill.left + pill.width <= CANVAS_SIZE.width)
  })

  it('leaves out a logo or website block the brand has nothing for', () => {
    const placed = placeBlueprint(
      {
        blocks: [
          block('headline', 0, 20, 60, 30),
          block('logo', 0, 0, 10, 10),
          block('footer', 0, 90, 20, 5)
        ],
        arrows: []
      },
      none
    )!
    assert.deepEqual(placed.blocks.map(b => b.role), ['headline'])
  })

  it('keeps arrows between blocks that were kept, by their new indexes', () => {
    const placed = placeBlueprint(
      {
        blocks: [
          block('card', 0, 0, 20, 20),
          block('headline', 0, 30, 60, 20),
          block('card', 50, 60, 20, 20, { text: 'Orders' }),
          block('card', 75, 60, 20, 20, { text: 'Invoices' })
        ],
        arrows: [
          { from: 0, to: 2, style: 'arrow' },
          { from: 2, to: 3, style: 'dashed' },
          { from: 2, to: 3, style: 'arrow' },
          { from: 3, to: 3, style: 'arrow' }
        ]
      },
      none
    )!
    assert.deepEqual(placed.arrows, [{ from: 1, to: 2, style: 'dashed' }])
  })

  it('knows which filled panel a block sits on', () => {
    const placed = placeBlueprint(
      {
        blocks: [
          block('panel', 0, 75, 100, 25, { tone: 'primary' }),
          block('headline', 0, 0, 60, 30),
          block('button', 70, 80, 20, 10, { text: 'Book a demo' })
        ],
        arrows: []
      },
      none
    )!
    assert.deepEqual(
      placed.blocks.map(b => b.backdrop),
      [null, null, 'primary']
    )
  })

  it('keeps a wordless box as an icon or a shape, so the structure survives', () => {
    const placed = placeBlueprint(
      {
        blocks: [
          block('headline', 0, 0, 50, 20),
          block('card', 10, 40, 10, 10, { icon: 'boxes', shape: 'circle', tone: 'outline' }),
          block('pill', 30, 40, 10, 5, { tone: 'soft' }),
          block('card', 50, 40, 10, 10)
        ],
        arrows: [{ from: 0, to: 1, style: 'line' }]
      },
      none
    )!
    assert.deepEqual(placed.blocks.map(b => b.role), ['headline', 'icon', 'shape'])
    assert.deepEqual(placed.arrows, [{ from: 0, to: 1, style: 'line' }])
  })

  it('reads text on a filled shape against that shape', () => {
    const placed = placeBlueprint(
      {
        blocks: [
          block('headline', 0, 0, 50, 20),
          block('shape', 40, 40, 20, 20, { shape: 'circle', tone: 'dark' }),
          block('label', 42, 47, 16, 6, { text: 'One order' })
        ],
        arrows: []
      },
      none
    )!
    assert.equal(placed.blocks[2]!.backdrop, 'dark')
  })

  it('keeps the logo off a card-like panel, but lets it sit on a band', () => {
    const placed = placeBlueprint(
      {
        blocks: [
          block('panel', 0, 0, 100, 14, { tone: 'primary' }),
          block('headline', 10, 30, 80, 20),
          block('panel', 0, 80, 100, 20, { tone: 'dark' }),
          block('panel', 60, 60, 36, 16, { tone: 'dark' })
        ],
        arrows: []
      },
      { logo: true, footer: false }
    )!
    const logo = placed.blocks.find(b => b.role === 'logo')!
    // The top-left corner, on the band; never on the card at the right.
    assert.ok(logo.top < 0.14 * CANVAS_SIZE.height && logo.left < CANVAS_SIZE.width / 2)
  })

  it('pulls labels clear of the icons beside them and in from the edge, lined up', () => {
    // The column on the left of a numbered-steps image: "02" measured from
    // the very edge, "04" running into its circle.
    const circle = (y: number, x = 27) =>
      block('icon', x, y, 9.5, 18, { icon: 'database', shape: 'circle', tone: 'primary' })
    const label = (text: string, x: number, y: number, w: number) =>
      block('label', x, y, w, 5, { text, textSize: 3.5, weight: 'bold' })
    const placed = placeBlueprint(
      {
        blocks: [
          block('headline', 40, 3, 40, 6),
          circle(12),
          label('01 Shared records', 3, 18, 19),
          circle(33, 25),
          label('02 Role access', 0.3, 39, 17),
          circle(55, 25),
          label('03 Change history', 3.4, 61, 19),
          circle(76.5),
          label('04 Live data', 18, 83, 13)
        ],
        arrows: []
      },
      none
    )!
    const icons = placed.blocks.filter(b => b.role === 'icon')
    const labels = placed.blocks.filter(b => b.role === 'label')
    for (const l of labels) {
      assert.ok(l.left >= 0.024 * CANVAS_SIZE.width, `${l.text} starts at the edge`)
      for (const i of icons) {
        const apart =
          l.left + l.width <= i.left ||
          i.left + i.width <= l.left ||
          l.top + l.height <= i.top ||
          i.top + i.height <= l.top
        assert.ok(apart, `${l.text} runs into an icon`)
      }
    }
    // Each label sits right beside its icon, so its words end against it.
    assert.deepEqual(
      labels.map(l => l.align),
      ['right', 'right', 'right', 'right']
    )
  })

  it('clears words from any kind of element, but leaves words that sit inside one', () => {
    const placed = placeBlueprint(
      {
        blocks: [
          block('headline', 5, 5, 60, 12),
          // A decorative square, a card-like panel and a band.
          block('shape', 40, 30, 15, 15, { shape: 'rect', tone: 'soft' }),
          block('label', 20, 35, 25, 5, { text: 'Into the square' }),
          block('panel', 60, 55, 30, 25, { tone: 'dark' }),
          block('label', 50, 60, 15, 5, { text: 'Half on the card' }),
          block('panel', 0, 85, 100, 15, { tone: 'primary' }),
          block('label', 10, 88, 30, 6, { text: 'On the band' }),
          block('label', 64, 64, 20, 5, { text: 'Inside the card' })
        ],
        arrows: []
      },
      none
    )!
    const find = (text: string) => placed.blocks.find(b => b.text === text)!
    const overlaps = (a: PlacedBlock, b: PlacedBlock) =>
      a.left < b.left + b.width &&
      b.left < a.left + a.width &&
      a.top < b.top + b.height &&
      b.top < a.top + a.height
    assert.ok(!overlaps(find('Into the square'), placed.blocks[1]!))
    assert.ok(!overlaps(find('Half on the card'), placed.blocks[3]!))
    // Words wholly on an element stay where the reference has them.
    assert.equal(find('On the band').top, Math.round(0.88 * CANVAS_SIZE.height))
    assert.equal(find('Inside the card').left, Math.round(0.64 * CANVAS_SIZE.width))
  })

  it('keeps a circle round on a canvas of another shape', () => {
    // 20% by 20% of a square reference is a wide oval on the 1.91:1 canvas.
    const placed = placeBlueprint(
      {
        blocks: [
          block('headline', 0, 0, 50, 20),
          block('shape', 40, 40, 20, 20, { shape: 'circle', tone: 'primary' })
        ],
        arrows: []
      },
      none
    )!
    const circle = placed.blocks[1]!
    assert.equal(circle.width, circle.height)
    // Centred where the oval was.
    assert.equal(Math.round(circle.left + circle.width / 2), Math.round(0.5 * CANVAS_SIZE.width))
  })

  it('draws in the size it is given', () => {
    const placed = placeBlueprint(
      { blocks: [block('headline', 10, 40, 50, 50)], arrows: [] },
      { ...none, size: { width: 1600, height: 1600 } }
    )!
    assert.deepEqual(
      [placed.blocks[0]!.top, placed.blocks[0]!.width, placed.blocks[0]!.height],
      [640, 800, 800]
    )
  })

  it(`draws at most ${MAX_BLUEPRINT_BLOCKS} blocks`, () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      block('pill', (i % 10) * 10, Math.floor(i / 10) * 10, 8, 8, { text: `Tag ${i}` })
    )
    const placed = placeBlueprint(
      { blocks: [block('headline', 0, 60, 60, 20), ...many], arrows: [] },
      none
    )!
    assert.equal(placed.blocks.length, MAX_BLUEPRINT_BLOCKS)
  })
})

describe('the shape a reference is rebuilt at', () => {
  it("takes LinkedIn's feed shape nearest the reference's", () => {
    assert.deepEqual(canvasSizeFor({ width: 1200, height: 628 }), CANVAS_SIZE)
    assert.deepEqual(canvasSizeFor({ width: 1920, height: 1080 }), CANVAS_SIZE)
    assert.deepEqual(canvasSizeFor({ width: 1080, height: 1080 }), { width: 1600, height: 1600 })
    assert.deepEqual(canvasSizeFor({ width: 1080, height: 1350 }), { width: 1536, height: 1920 })
    // A story-shaped reference gets the tallest shape the feed shows whole.
    assert.deepEqual(canvasSizeFor({ width: 1080, height: 1920 }), { width: 1536, height: 1920 })
  })
})

describe('correcting a blueprint against its render', () => {
  const original = {
    blocks: [
      block('headline', 5, 5, 50, 20),
      block('card', 60, 10, 30, 30, { text: 'Stock', detail: 'Updates on order' })
    ],
    arrows: []
  }

  it('takes the corrected geometry and styling, but never the words or roles', () => {
    const merged = mergeRefinedBlueprint(original, {
      blocks: [
        block('headline', 6, 4, 48, 22),
        block('card', 58, 12, 32, 28, {
          text: 'Something else',
          detail: 'Changed',
          shape: 'circle',
          tone: 'outline'
        })
      ],
      arrows: []
    })
    const card = merged.blocks[1]!
    assert.deepEqual([card.x, card.y, card.w, card.h], [58, 12, 32, 28])
    assert.equal(card.shape, 'circle')
    assert.equal(card.tone, 'outline')
    assert.equal(card.text, 'Stock')
    assert.equal(card.detail, 'Updates on order')
  })

  it('lets the correction take away an icon the first look added', () => {
    const withIcon = {
      blocks: [original.blocks[0]!, { ...original.blocks[1]!, icon: 'boxes' as const }],
      arrows: []
    }
    const merged = mergeRefinedBlueprint(withIcon, {
      blocks: [original.blocks[0]!, { ...original.blocks[1]!, icon: null }],
      arrows: []
    })
    assert.equal(merged.blocks[1]!.icon, null)
  })

  it('leaves a block alone when the correction changed its role', () => {
    const merged = mergeRefinedBlueprint(original, {
      blocks: [block('headline', 6, 4, 48, 22), block('pill', 0, 0, 10, 5, { text: 'Stock' })],
      arrows: []
    })
    assert.deepEqual(merged.blocks[1], original.blocks[1])
  })

  it('adds only blocks without words, after the existing ones', () => {
    const merged = mergeRefinedBlueprint(original, {
      blocks: [
        ...original.blocks,
        block('shape', 70, 60, 10, 10, { shape: 'circle', tone: 'soft' }),
        block('label', 0, 90, 20, 5, { text: 'New words' }),
        block('divider', 0, 50, 100, 0.5)
      ],
      arrows: [{ from: 0, to: 1, style: 'line' }, { from: 1, to: 3, style: 'arrow' }]
    })
    assert.deepEqual(merged.blocks.slice(2).map(b => b.role), ['shape', 'divider'])
    // Arrows only between the original blocks.
    assert.deepEqual(merged.arrows, [{ from: 0, to: 1, style: 'line' }])
  })
})

describe('fitting text to a block', () => {
  it('sets short text larger than long text in the same box', () => {
    const box = { width: 600, height: 200 }
    const short = fitFontSize('Ship it', box, { max: 120, min: 20 })
    const long = fitFontSize(
      'Every channel reads the same stock, so nobody re-keys an order again',
      box,
      { max: 120, min: 20 }
    )
    assert.ok(short > long)
  })

  it('stays within the box height and the line limit', () => {
    const size = fitFontSize('tdccommerce.com', { width: 300, height: 40 }, {
      max: 60,
      min: 10,
      maxLines: 1
    })
    assert.ok(size * 1.2 <= 40)
    assert.ok(size * 0.58 * 'tdccommerce.com'.length <= 300)
  })

  it('falls back to the minimum when nothing fits', () => {
    assert.equal(
      fitFontSize('a very long sentence indeed', { width: 20, height: 10 }, { max: 40, min: 12 }),
      12
    )
  })
})
