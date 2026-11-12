import assert from 'node:assert'
import { describe, it } from 'node:test'
import { FORMATS } from '../src/lib/formats'
import { SHAPE_SIZES } from '../src/lib/media/canvas/spec'
import { buildReferencePrompt } from '../src/lib/media/reference-prompt'

// An uploaded reference image makes a new image from the reference and the
// reviewer's words alone, never the post, at the post's platform shape.
describe('an image made from an uploaded reference', () => {
  it("follows the reviewer's direction, quoted so it is not drawn as lettering", () => {
    const prompt = buildReferencePrompt(
      'Keep this layout, but about faster order approvals',
      SHAPE_SIZES['1.91:1']
    )
    assert.match(prompt, /provided reference image/)
    assert.match(
      prompt,
      /Follow this direction: "Keep this layout, but about faster order approvals"\./
    )
    assert.match(prompt, /not text to place in it/)
  })

  it('recreates the reference when nothing is typed', () => {
    const prompt = buildReferencePrompt('', SHAPE_SIZES['1.91:1'])
    assert.match(prompt, /Recreate it as a clean, polished, high-quality image/)
    assert.doesNotMatch(prompt, /Follow this direction/)
  })

  it("is asked for in the post's platform shape, not the reference's", () => {
    const shapeOf = (format: keyof typeof FORMATS) =>
      buildReferencePrompt('', SHAPE_SIZES[FORMATS[format].imageShape])
    assert.match(shapeOf('linkedin.post'), /a wide 1\.91:1 landscape image/)
    assert.match(shapeOf('x.post'), /a wide 16:9 landscape image/)
    assert.match(shapeOf('instagram.caption'), /a tall 4:5 portrait image/)
    assert.match(shapeOf('facebook.post'), /a tall 4:5 portrait image/)
  })
})
