import { describe, expect, it } from 'vitest'
import {
  SPRITE_THUMB_LIT,
  cssKey,
  pickThumbFrame,
  spriteSummary,
  spriteThumb,
  spriteThumbSvg,
  svgDataUri
} from '../src/renderer/src/components/sprite-thumb'
import { blankFrame, newSprite, setPixel, type SpriteFrame } from '../src/renderer/src/components/sprite-model'

/** A frame from row strings, `#` = lit. */
const frameOf = (...rows: string[]): SpriteFrame => ({
  pixels: rows.map((row) => [...row].map((c) => c === '#'))
})

/** The `d` attribute of the single path, or '' when nothing is lit. */
const pathData = (svg: string): string => /d="([^"]*)"/.exec(svg)?.[1] ?? ''

describe('which frame an animation shows inline', () => {
  it('shows the first frame that has ink, not blindly frame 0', () => {
    // Animations habitually open blank (a blink, a fade-in); showing that frame
    // would put an empty chip beside the code and read as broken.
    const frames = [blankFrame(4, 4), blankFrame(4, 4), frameOf('##', '##')]
    expect(pickThumbFrame(frames)).toBe(2)
  })

  it('shows frame 0 when there is ink there', () => {
    expect(pickThumbFrame([frameOf('#'), frameOf('#')])).toBe(0)
  })

  it('falls back to frame 0 when the whole animation is blank', () => {
    expect(pickThumbFrame([blankFrame(2, 2), blankFrame(2, 2)])).toBe(0)
  })
})

describe('rendering a frame to SVG', () => {
  it('places one unit per sprite pixel, so CSS does the scaling', () => {
    const svg = spriteThumbSvg(frameOf('#.', '.#'), 2, 2)
    expect(svg).toContain('viewBox="0 0 2 2"')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('shape-rendering="crispEdges"')
  })

  it('draws a rectangle exactly where each lit pixel is', () => {
    // (0,0) and (1,1) lit, nothing else.
    expect(pathData(spriteThumbSvg(frameOf('#.', '.#'), 2, 2))).toBe('M0 0h1v1h-1zM1 1h1v1h-1z')
  })

  it('merges a run of lit pixels into ONE rectangle', () => {
    // A 128-wide lit row is one command, not 128 — this is what keeps a full
    // 128×64 sprite from becoming an 8192-element document.
    const wide = frameOf('#'.repeat(128))
    expect(pathData(spriteThumbSvg(wide, 128, 1))).toBe('M0 0h128v1h-128z')
    // Runs still break at gaps.
    expect(pathData(spriteThumbSvg(frameOf('##.##'), 5, 1))).toBe('M0 0h2v1h-2zM3 0h2v1h-2z')
  })

  it('scales sub-linearly with pixel count for solid art', () => {
    const solid = (n: number): SpriteFrame => frameOf(...Array(n).fill('#'.repeat(n)))
    expect(spriteThumbSvg(solid(64), 64, 64).length).toBeLessThan(
      spriteThumbSvg(solid(8), 8, 8).length * 64
    )
  })

  it('emits no path at all for a blank frame', () => {
    const svg = spriteThumbSvg(blankFrame(8, 8), 8, 8)
    expect(svg).not.toContain('<path')
    expect(svg).toContain('viewBox="0 0 8 8"')
  })

  it('paints in the one colour both skins agree on', () => {
    // `--gold` is #d9a441 in BOTH the dark and Skeuomorph skins, which is what
    // lets one cached data URI serve both themes.
    expect(SPRITE_THUMB_LIT).toBe('#d9a441')
    expect(spriteThumbSvg(frameOf('#'), 1, 1)).toContain(`fill="${SPRITE_THUMB_LIT}"`)
    expect(spriteThumbSvg(frameOf('#'), 1, 1, '#123456')).toContain('fill="#123456"')
  })
})

describe('the data URI', () => {
  it('escapes the characters that would end a CSS url() early', () => {
    const uri = svgDataUri(spriteThumbSvg(frameOf('#'), 1, 1))
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true)
    for (const ch of ['#', '"', "'", '<', '>', ' ', '\n']) {
      expect(uri.includes(ch), `raw ${JSON.stringify(ch)} in the URI`).toBe(false)
    }
    expect(decodeURIComponent(uri.slice('data:image/svg+xml,'.length))).toContain('<svg')
  })
})

describe('the thumbnail a decoration gets', () => {
  it('carries the aspect ratio so a wide sprite gets a wide chip', () => {
    const doc = newSprite('eyes', 12, 8)
    const thumb = spriteThumb(doc.frames, doc.width, doc.height)
    expect(thumb.aspect).toBeCloseTo(12 / 8)
    expect(thumb.frameIndex).toBe(0)
    expect(thumb.dataUri.startsWith('data:image/svg+xml,')).toBe(true)
  })

  it('renders the frame it says it picked', () => {
    let doc = newSprite('eyes', 4, 4)
    doc = { ...doc, frames: [doc.frames[0], doc.frames[0]] }
    doc = setPixel(doc, 1, 2, 3, true) // ink only on frame 1
    const thumb = spriteThumb(doc.frames, doc.width, doc.height)
    expect(thumb.frameIndex).toBe(1)
    expect(decodeURIComponent(thumb.dataUri)).toContain('M2 3h1v1h-1z')
  })

  it('survives a degenerate size without dividing by zero', () => {
    expect(spriteThumb([blankFrame(0, 0)], 0, 0).aspect).toBe(1)
  })
})

describe('cache keys', () => {
  it('are stable, differ on different seeds, and are CSS-identifier safe', () => {
    expect(cssKey('/proj/eyes.spr 1 2')).toBe(cssKey('/proj/eyes.spr 1 2'))
    expect(cssKey('/proj/eyes.spr 1 2')).not.toBe(cssKey('/proj/eyes.spr 9 2'))
    for (const seed of ['/a/b c.spr 1 2', 'C:\\x\\y.spr 0 0', '']) {
      expect(cssKey(seed)).toMatch(/^[0-9a-z]+$/)
    }
  })
})

describe('the hover summary', () => {
  it('reads naturally for one frame and for many', () => {
    expect(spriteSummary(12, 8, 1)).toBe('12×8 · 1 frame')
    expect(spriteSummary(12, 8, 6)).toBe('12×8 · 6 frames')
  })
})
