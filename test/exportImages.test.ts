// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { inlineImageHrefs } from '../src/renderer/src/components/svg-export'

/**
 * The pictures have to travel with the picture, too.
 *
 * The desktop inlines a part's photo when the main process reads the library,
 * so `imageData` is already a `data:` URL there. The WEB build emits those
 * photos as hashed build assets and names them by URL — and the sandboxed
 * document an `<img>` loads cannot fetch one, so app.snakie.org exported a
 * board with no board on it.
 */

const SRC = (p: string): string =>
  readFileSync(join(__dirname, '..', 'src', 'renderer', 'src', p), 'utf-8')

const png = (href: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg"><image href="${href}" x="0" y="0"/></svg>`

function fetchReturns(body: Uint8Array, type = 'image/png'): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    blob: async () => ({ type, arrayBuffer: async () => body.buffer })
  })))
}

afterEach(() => vi.unstubAllGlobals())

describe('carrying the part photos into an export', () => {
  it('replaces a URL href with the bytes it names', async () => {
    fetchReturns(new Uint8Array([1, 2, 3]))
    const out = await inlineImageHrefs(png('/assets/parts/pico2w-image-BME.png'))
    expect(out).toContain('href="data:image/png;base64,AQID"')
    expect(out).not.toContain('/assets/parts/')
  })

  it('leaves a photo that is already inline alone, and never fetches for it', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const already = png('data:image/png;base64,AQID')
    expect(await inlineImageHrefs(already)).toBe(already)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the export rather than failing it when an image will not load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const svg = png('/assets/parts/gone.png')
    expect(await inlineImageHrefs(svg)).toBe(svg)
  })

  it('reads an href the serialiser escaped', async () => {
    fetchReturns(new Uint8Array([1, 2, 3]))
    const out = await inlineImageHrefs(png('/parts/a.png?v=1&amp;w=2'))
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/parts/a.png?v=1&w=2')
    expect(out).toContain('base64,AQID')
  })

  it('handles the xlink form the serialiser can emit', async () => {
    fetchReturns(new Uint8Array([4]))
    const out = await inlineImageHrefs(
      '<svg><image xlink:href="/parts/a.png"/></svg>'
    )
    expect(out).toContain('xlink:href="data:image/png;base64,BA=="')
  })

  it('fetches each distinct photo once, however many parts use it', async () => {
    fetchReturns(new Uint8Array([9]))
    await inlineImageHrefs(
      png('/parts/a.png') + png('/parts/a.png') + png('/parts/b.png')
    )
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it('does nothing at all to an SVG with no images', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const svg = '<svg><text>GP0</text></svg>'
    expect(await inlineImageHrefs(svg)).toBe(svg)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the export paths that carry them', () => {
  it('the Board Viewer inlines the photos before handing the file over', () => {
    const wiring = SRC('components/WiringCanvas.tsx')
    const handler = wiring.slice(
      wiring.indexOf('const doExport'),
      wiring.indexOf('const doExportMarkdown')
    )
    expect(handler).toContain('await inlineImageHrefs(res.svg)')
    expect(handler).toContain('exportSvgString(svgStr')
  })

  it("the PDF's wiring page does too", () => {
    const capture = SRC('lib/pdf/wiring-capture.ts')
    const wrapper = capture.slice(capture.indexOf('async function withImages'))
    expect(wrapper).toContain('inlineImageHrefs(d.svg)')
    // Everything the capture returns goes through the wrapper — there is one
    // picture of the board now (#1168), and it is the one the document draws.
    expect(capture).toContain('return await withImages(')
  })
})
