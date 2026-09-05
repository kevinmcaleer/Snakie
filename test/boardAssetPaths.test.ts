import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { BUNDLED_INDEX_URL, thumbUrl } from '../src/renderer/src/lib/board-index-source'

/**
 * The bundled board assets have to be reachable from the PACKAGED app (#947).
 *
 * 0.51.0 shipped a Board Finder that showed twelve boards instead of 237. The
 * twelve were the overlay, which is compiled into JavaScript; the 225 upstream
 * ones live in `boards.json`, fetched at runtime from `/boards/boards.json`.
 *
 * That leading slash is the whole bug. The packaged app loads its renderer with
 * `loadFile`, so the document is a `file://` URL, and an absolute path under
 * `file://` resolves against the FILESYSTEM ROOT rather than the app bundle. The
 * fetch missed, `loadBundledIndex` returned an empty index by design, and the
 * gallery quietly looked small instead of broken.
 *
 * It could not be seen in `npm run dev`, which serves from `/`, and no test
 * caught it because none of them resolved a URL against a `file://` base. So
 * this file does exactly that, rather than asserting the shape of a string:
 * the string is only wrong in one context, and that context is the one that
 * ships.
 */

/** Where the renderer's HTML actually sits in a packaged macOS build. */
const PACKAGED = 'file:///Applications/Snakie.app/Contents/Resources/app.asar/out/renderer/index.html'
const RENDERER_DIR = 'file:///Applications/Snakie.app/Contents/Resources/app.asar/out/renderer/'
/** The dev server, and the web build served from a domain root. */
const DEV = 'http://localhost:5173/index.html'
const WEB = 'https://app.snakie.org/index.html'
/** The web build can also be served from a subpath (`base: '/app/'`). */
const WEB_SUBPATH = 'https://snakie.org/app/index.html'

const resolve = (path: string, base: string): string => new URL(path, base).href

describe('the board index is reachable wherever the app is loaded from', () => {
  it('lands inside the renderer directory in a packaged build', () => {
    // The bug, directly: absolute gave `file:///boards/boards.json`.
    expect(resolve(BUNDLED_INDEX_URL, PACKAGED)).toBe(`${RENDERER_DIR}boards/boards.json`)
  })

  it('still resolves under the dev server and on the web', () => {
    expect(resolve(BUNDLED_INDEX_URL, DEV)).toBe('http://localhost:5173/boards/boards.json')
    expect(resolve(BUNDLED_INDEX_URL, WEB)).toBe('https://app.snakie.org/boards/boards.json')
  })

  it('follows the web build to a subpath, which absolute never did', () => {
    expect(resolve(BUNDLED_INDEX_URL, WEB_SUBPATH)).toBe('https://snakie.org/app/boards/boards.json')
  })

  it('never escapes to the filesystem root', () => {
    // The one shape that is always wrong under `file://`.
    expect(BUNDLED_INDEX_URL.startsWith('/')).toBe(false)
    expect(resolve(BUNDLED_INDEX_URL, PACKAGED).startsWith(RENDERER_DIR)).toBe(true)
  })
})

describe('so are the thumbnails', () => {
  // They had the same leading slash, so every photo in the packaged 0.51.0 was
  // unreachable too — including on the twelve boards that did show.
  it('lands inside the renderer directory in a packaged build', () => {
    expect(resolve(thumbUrl('RPI_PICO.jpg')!, PACKAGED)).toBe(
      `${RENDERER_DIR}boards/thumbs/RPI_PICO.jpg`
    )
  })

  it('is null for a board with no thumbnail, rather than a path to nothing', () => {
    expect(thumbUrl(null)).toBeNull()
  })

  it('never escapes to the filesystem root', () => {
    expect(thumbUrl('X.jpg')!.startsWith('/')).toBe(false)
  })
})

describe('the file it points at is actually shipped', () => {
  /**
   * The other half of the failure: a correct URL to a missing file looks
   * identical from the renderer. `boards.json` IS packaged — it was reachable
   * all along, just not by that URL — and this keeps both halves true together.
   */
  it('is in the public folder the build copies', () => {
    expect(existsSync('src/renderer/public/boards/boards.json')).toBe(true)
  })

  it('holds the full catalogue, not a stub', () => {
    const index = JSON.parse(readFileSync('src/renderer/public/boards/boards.json', 'utf8'))
    // If this ever collapses to a handful, the gallery would look exactly as it
    // did in 0.51.0 — small rather than broken — so the count is worth pinning.
    expect(index.boards.length).toBeGreaterThan(200)
  })

  it('reaches the packaged output', () => {
    // Present only after a build; skipped rather than failing a clean checkout.
    if (!existsSync('out/renderer')) return
    expect(existsSync('out/renderer/boards/boards.json')).toBe(true)
  })
})
