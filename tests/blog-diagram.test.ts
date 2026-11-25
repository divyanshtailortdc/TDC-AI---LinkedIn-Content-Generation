import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  diagramDescription,
  renderDiagramSvg,
  wrapText,
  type DiagramAttrs
} from '../src/lib/blogs/diagram'

const diagram = (overrides: Partial<DiagramAttrs> = {}): DiagramAttrs => ({
  kind: 'flow',
  title: '',
  items: ['Order', 'Reserve stock', 'Ship'],
  values: [],
  unit: '',
  caption: '',
  alt: '',
  sourceId: '',
  ...overrides
})

const escapeXml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Every opened tag is closed in order; self-closed tags stand alone. */
function isBalanced(svg: string): boolean {
  const stack: string[] = []
  for (const match of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match
    if (selfClosing) continue
    if (closing) {
      if (stack.pop() !== name) return false
    } else stack.push(name!)
  }
  return stack.length === 0
}

const attrValues = (svg: string, marker: string, attr: string) =>
  [...svg.matchAll(new RegExp(`<rect[^>]*${marker}="\\d+"[^>]*>`, 'g'))].map(
    match => Number(new RegExp(`\\s${attr}="([\\d.]+)"`).exec(match[0])![1])
  )

describe('diagrams drawn as SVG', () => {
  it('escapes labels', () => {
    const svg = renderDiagramSvg(
      diagram({
        title: 'Title </svg><script>x</script>',
        items: ['<script>alert("x")</script> & co', 'Second']
      })
    )
    assert.ok(svg.includes('&lt;script&gt;'))
    assert.ok(svg.includes('&amp;'))
    assert.ok(svg.includes('&quot;'))
    assert.ok(!svg.includes('<script'))
    assert.strictEqual(svg.split('</svg>').length - 1, 1)
  })

  it('has a title and a description of the data', () => {
    const d = diagram({ title: 'Order to cash' })
    const svg = renderDiagramSvg(d)
    assert.ok(svg.includes('role="img"'))
    assert.ok(svg.includes('aria-labelledby="diagram-title diagram-desc"'))
    assert.ok(svg.includes('<title id="diagram-title">Order to cash</title>'))
    assert.ok(
      svg.includes(
        `<desc id="diagram-desc">${escapeXml(diagramDescription(d))}</desc>`
      )
    )
  })

  it('bars scale to the largest value', () => {
    const svg = renderDiagramSvg(
      diagram({
        kind: 'bar',
        items: ['Small', 'Medium', 'Large'],
        values: [25, 50, 100],
        unit: '%'
      })
    )
    const widths = attrValues(svg, 'data-bar', 'width')
    assert.strictEqual(widths.length, 3)
    assert.ok(Math.abs(widths[1]! - 2 * widths[0]!) <= 1, `${widths}`)
    assert.ok(Math.abs(widths[2]! - 4 * widths[0]!) <= 1, `${widths}`)
    assert.ok(svg.includes('100%'))
  })

  it('long labels wrap into several lines', () => {
    const svg = renderDiagramSvg(
      diagram({ items: ['word '.repeat(40).trim(), 'Second', 'Third'] })
    )
    assert.ok((svg.match(/<tspan/g) ?? []).length > 3)
    const lines = wrapText('one two three four five six', 60, 15)
    assert.ok(lines.length > 1)
    for (const line of lines) {
      assert.ok(
        line.length * 15 * 0.56 <= 60 || !line.includes(' '),
        `"${line}" is too wide`
      )
    }
  })

  it('uses the brand colour and falls back on a bad one', () => {
    assert.ok(renderDiagramSvg(diagram(), { color: '#ff6600' }).includes('#ff6600'))
    const fallback = renderDiagramSvg(diagram(), {
      color: 'url(javascript:alert(1))'
    })
    assert.ok(!fallback.includes('javascript'))
    assert.ok(fallback.includes('#2563eb'))
  })

  it('lays out a short flow side by side and a long one as a column', () => {
    const short = attrValues(renderDiagramSvg(diagram()), 'data-step', 'y')
    assert.strictEqual(short.length, 3)
    assert.ok(short.every(y => y === short[0]))
    const long = attrValues(
      renderDiagramSvg(
        diagram({ items: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'] })
      ),
      'data-step',
      'y'
    )
    assert.strictEqual(long.length, 6)
    for (let i = 1; i < long.length; i++) assert.ok(long[i]! > long[i - 1]!)
  })

  it('draws a timeline with bold labels', () => {
    const svg = renderDiagramSvg(
      diagram({
        kind: 'timeline',
        items: ['2019 — First release', '2023: Second release']
      })
    )
    assert.match(svg, /<text[^>]*font-weight="600"[^>]*>(?:<tspan[^>]*>)?2019</)
    assert.match(svg, /<text[^>]*font-weight="600"[^>]*>(?:<tspan[^>]*>)?2023</)
  })

  it('the svg is well-formed', () => {
    for (const d of [
      diagram({ title: 'A flow' }),
      diagram({ items: ['One', 'Two', 'Three', 'Four', 'Five'] }),
      diagram({ kind: 'timeline', items: ['2020: a', '2021: b'] }),
      diagram({ kind: 'bar', items: ['a', 'b'], values: [0, 0] }),
      diagram({ kind: 'bar', items: ['a', 'b'], values: [-5, 10], unit: 'days' })
    ]) {
      const svg = renderDiagramSvg(d)
      assert.ok(isBalanced(svg), svg)
      const height = Number(/viewBox="0 0 720 ([\d.]+)"/.exec(svg)?.[1])
      assert.ok(height > 0, `height ${height}`)
    }
  })

  it('ids follow the prefix and stay safe', () => {
    const svg = renderDiagramSvg(diagram(), { idPrefix: 'fig 1"><x' })
    assert.ok(svg.includes('id="fig1x-title"'))
    assert.ok(svg.includes('aria-labelledby="fig1x-title fig1x-desc"'))
  })
})
