import assert from 'node:assert'
import { describe, it } from 'node:test'
import { canHaveImage, imageChosenFor, needsImage } from '../src/lib/formats'

// "Add an image" in Create posts: kept in the idea's suggestedMedia.imageFormats
// and read per format by drafting.
describe('whether a format can or must have an image', () => {
  it('lets every format but a video script carry one', () => {
    for (const id of ['linkedin.post', 'x.post', 'x.thread', 'threads.post', 'facebook.post', 'instagram.caption'] as const) {
      assert.equal(canHaveImage(id), true, id)
    }
    assert.equal(canHaveImage('youtube.short'), false)
    assert.equal(canHaveImage('instagram.reel'), false)
  })

  it('requires one only for an Instagram post', () => {
    assert.equal(needsImage('instagram.caption'), true)
    assert.equal(needsImage('x.post'), false)
    assert.equal(needsImage('facebook.post'), false)
  })
})

describe("drafting reads the idea's image choice", () => {
  const ticked = { suggestedMedia: { mode: 'none', imageFormats: ['x.post', 'linkedin.post'] } }

  it('makes an image for a ticked X post, and none for an unticked Facebook post', () => {
    assert.equal(imageChosenFor(ticked, 'x.post'), true)
    assert.equal(imageChosenFor(ticked, 'linkedin.post'), true)
    assert.equal(imageChosenFor(ticked, 'facebook.post'), false)
  })

  it('always gives an Instagram post one, and a video script none, whatever was ticked', () => {
    const none = { suggestedMedia: { mode: 'none', imageFormats: [] } }
    assert.equal(imageChosenFor(none, 'instagram.caption'), true)
    assert.equal(imageChosenFor({ suggestedMedia: { imageFormats: ['youtube.short'] } }, 'youtube.short'), false)
  })

  it("leaves an idea from before the choice to the format's default", () => {
    assert.equal(imageChosenFor({ suggestedMedia: { mode: 'none' } }, 'x.post'), undefined)
    assert.equal(imageChosenFor({ suggestedMedia: null }, 'linkedin.post'), undefined)
    assert.equal(imageChosenFor({}, 'facebook.post'), undefined)
  })
})
