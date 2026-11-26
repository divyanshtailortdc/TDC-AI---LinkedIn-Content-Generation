# Publishing the Video on a Website

## Files

The toolkit's `make.ts` writes these to `output.dir`:

- `<name>.webm`: VP9, about 35% smaller. Modern browsers pick it first.
- `<name>.mp4`: H.264, plays everywhere, including Safari.
- `<name>-poster.jpg`: the frame shown before playback.
- `<name>.vtt`: captions, when segments have narration.

Both video files carry the soundtrack when the config adds narration or music (AAC in MP4, Opus in WebM).

A 75-second 1080p tour comes out at 5 to 8 MB. Serve the files as static assets from the site's public folder or a CDN.

## Tour: Plays Only When the Viewer Presses Play

This is the right default for tours. Nothing downloads until the viewer asks.

```html
<video controls playsinline preload="none"
  poster="/video/product-tour-poster.jpg"
  aria-label="Product tour with a sample workspace">
  <source src="/video/product-tour.webm" type="video/webm" />
  <source src="/video/product-tour.mp4" type="video/mp4" />
</video>
```

- `preload="none"` keeps the page fast; the poster shows until play.
- List WebM first and MP4 second.
- Size it with CSS (`width: 100%; aspect-ratio: 16 / 9`) so the layout doesn't jump.

## With Sound

Browsers block autoplay with sound, so narrated videos always wait for play. Add the captions track so people watching muted, or who can't hear, still follow:

```html
<video controls playsinline preload="none" poster="/video/product-tour-poster.jpg">
  <source src="/video/product-tour.webm" type="video/webm" />
  <source src="/video/product-tour.mp4" type="video/mp4" />
  <track kind="captions" src="/video/product-tour.vtt" srclang="en" label="English" default />
</video>
```

Serve the `.vtt` file from the same origin, or with CORS headers, or the browser ignores it.

## Loop: Autoplays Muted in a Hero

Browsers only autoplay muted video. Load it only near the viewport, pause it off screen, and respect reduced motion:

- Attributes: `muted loop playsinline autoplay` with a poster.
- Start loading with an `IntersectionObserver` when the video nears the viewport, then call `load()` and `play()`. Sources added after the first render don't load on their own.
- Pause when it leaves the viewport.
- When `prefers-reduced-motion: reduce` matches, don't autoplay; show controls instead.
- Catch the promise from `play()`: autoplay can be refused, for example in battery saver mode.

## Placement and Copy

- Put the tour where people decide: under the homepage hero, on the features page, and on the demo booking page.
- Say it is sample data, for example "A tour of a sample workspace for a fictional store."
- Don't hardcode the duration in page copy; re-recordings change it.
- Give the element an `aria-label` that describes it. Silent videos with on-screen text need no captions file; narrated ones do.

## After Publishing

- Play it in a real browser (not headless) and seek around once.
- Hard-refresh after re-exporting: a cached partial file from the old version can stall playback.
