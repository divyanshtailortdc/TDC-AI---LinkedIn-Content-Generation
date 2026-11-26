/**
 * How short videos are made: recorded on the server with the product-video
 * skill's method (src/lib/video/render), the only way the app makes them.
 * Stored on each video's row as its provider and model, so a row from
 * before (an AI clip) can be told apart.
 *
 * Pure data, safe for tests and the browser.
 */

export const RECORDER_PROVIDER = 'recorder'
export const RECORDER_MODEL_ID = 'product-video/recorder'

/**
 * A video the user uploaded for a post (Create from media): not made by the
 * app, so never disclosed as AI-made and never recorded again.
 */
export const UPLOADED_VIDEO_PROVIDER = 'upload'
export const UPLOADED_VIDEO_MODEL_ID = 'user-upload'
