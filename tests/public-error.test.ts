import assert from 'node:assert'
import { describe, it } from 'node:test'
import { publicErrorMessage } from '../src/lib/public-error'

describe('the message an unexpected failure shows the user', () => {
  it('keeps a message written for the user', () => {
    assert.strictEqual(
      publicErrorMessage(
        new Error("Could not generate an image from your prompt. the image model's safety filter blocked this prompt"),
        'Failed to generate image.'
      ),
      "Could not generate an image from your prompt. the image model's safety filter blocked this prompt"
    )
  })

  it('never shows a database query, its parameters or a driver error', () => {
    // drizzle-orm wraps every query error as "Failed query: <sql>\nparams: <values>".
    const drizzle = new Error(
      'Failed query: select "image_url" from "post_media" where "post_media"."id" = $1\nparams: 3f1c…'
    )
    drizzle.name = 'DrizzleQueryError'
    const driver = Object.assign(new Error('relation "post_media" does not exist'), {
      name: 'PostgresError',
      code: '42P01'
    })
    const wrapped = new Error('Could not save', { cause: driver })
    for (const err of [drizzle, driver, wrapped, new Error('Failed query: select 1')]) {
      assert.strictEqual(publicErrorMessage(err, 'Failed to load image'), 'Failed to load image')
    }
  })

  it('never shows a programming or storage error', () => {
    const s3 = Object.assign(new Error('The specified key does not exist.'), {
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 }
    })
    for (const err of [
      new TypeError("Cannot read properties of undefined (reading 'imageUrl')"),
      new ReferenceError('x is not defined'),
      s3
    ]) {
      assert.strictEqual(publicErrorMessage(err, 'Failed.'), 'Failed.')
    }
  })

  it('falls back when there is no message to show', () => {
    assert.strictEqual(publicErrorMessage(new Error(''), 'Failed.'), 'Failed.')
    assert.strictEqual(publicErrorMessage('a string', 'Failed.'), 'Failed.')
    assert.strictEqual(publicErrorMessage(undefined, 'Failed.'), 'Failed.')
  })
})
