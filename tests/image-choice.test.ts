import assert from 'node:assert'
import { describe, it } from 'node:test'
import { canHaveImage, imageChosenFor, mediaChosenFor, needsImage } from '../src/lib/formats'

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

// "Single image / Carousel" in Create posts: kept in the idea's
// suggestedMedia.carouselFormats; drafting makes exactly that.
describe("drafting reads the idea's carousel choice", () => {
  const chosen = {
    suggestedMedia: {
      mode: 'none',
      imageFormats: ['linkedin.post', 'facebook.post', 'instagram.caption', 'x.post'],
      carouselFormats: ['facebook.post']
    }
  }

  it('makes slides only where Carousel was picked, and one image elsewhere', () => {
    assert.equal(mediaChosenFor(chosen, 'facebook.post'), 'carousel')
    assert.equal(mediaChosenFor(chosen, 'linkedin.post'), 'image')
    assert.equal(mediaChosenFor(chosen, 'instagram.caption'), 'image')
    assert.equal(mediaChosenFor(chosen, 'x.post'), 'image')
  })

  it('keeps an unticked post to its text, and never slides a format without them', () => {
    const noImage = { suggestedMedia: { imageFormats: [], carouselFormats: ['linkedin.post', 'x.post'] } }
    assert.equal(mediaChosenFor(noImage, 'linkedin.post'), 'text')
    assert.equal(
      mediaChosenFor({ suggestedMedia: { imageFormats: ['x.post'], carouselFormats: ['x.post'] } }, 'x.post'),
      'image'
    )
  })

  it('gives an Instagram post an image even unticked, and a video script nothing chosen', () => {
    const none = { suggestedMedia: { imageFormats: [], carouselFormats: [] } }
    assert.equal(mediaChosenFor(none, 'instagram.caption'), 'image')
    assert.equal(mediaChosenFor(none, 'youtube.short'), undefined)
  })

  it('leaves an idea from before the choice to drafting', () => {
    assert.equal(mediaChosenFor({ suggestedMedia: { imageFormats: ['linkedin.post'] } }, 'linkedin.post'), undefined)
    assert.equal(mediaChosenFor({ suggestedMedia: null }, 'facebook.post'), undefined)
    assert.equal(mediaChosenFor({}, 'linkedin.post'), undefined)
  })
})
