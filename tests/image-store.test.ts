import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  isStoredImage,
  loadImageDataUrl,
  storeImage,
  storedImageKey,
  viewableImageUrl
} from '../src/lib/media/image-store'

// A 1x1 PNG.
const DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('post image store', () => {
  it('tells a bucket object from a link or inline data', () => {
    assert.equal(isStoredImage('storage://drafts/d/a.png'), true)
    assert.equal(isStoredImage('https://images.example.com/a.png'), false)
    assert.equal(isStoredImage(DATA_URL), false)
    assert.equal(isStoredImage(null), false)
    assert.equal(storedImageKey('storage://drafts/d/a.png'), 'drafts/d/a.png')
  })

  it('leaves images where they are when no bucket is set', async () => {
    assert.equal(process.env.STORAGE_BUCKET ?? '', '')
    assert.equal(await storeImage(DATA_URL, 'draft'), DATA_URL)
    assert.equal(await storeImage(null, 'draft'), null)
  })

  it('passes links and inline data through unchanged', async () => {
    const link = 'https://images.example.com/a.png'
    assert.equal(await storeImage(link, 'draft'), link)
    assert.equal(await viewableImageUrl(link), link)
    assert.equal(await viewableImageUrl(DATA_URL), DATA_URL)
    assert.equal(await loadImageDataUrl(DATA_URL), DATA_URL)
  })
})
