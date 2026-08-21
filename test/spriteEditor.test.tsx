import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SpriteEditor } from '../src/renderer/src/components/SpriteEditor'
import {
  OPEN_SPRITE_EDITOR_EVENT
} from '../src/renderer/src/components/sprite-editor-bus'

/** The overlay rendered to static HTML — structure only (no DOM needed). */
const html = (): string => renderToStaticMarkup(<SpriteEditor onClose={() => undefined} />)

describe('Sprite editor overlay', () => {
  it('renders as a modal dialog with the toolbar, stage and filmstrip', () => {
    const out = html()
    expect(out).toContain('role="dialog"')
    expect(out).toContain('aria-modal="true"')
    expect(out).toContain('SPRITE EDITOR')
    // Document fields (name/size/rate) seeded from the blinking-eyes starter.
    expect(out).toContain('value="blinking-eyes"')
    expect(out).toContain('aria-label="Sprite width in pixels"')
    expect(out).toContain('aria-label="Playback frames per second"')
    expect(out).toContain('Modulino / UNO R4 LED matrix')
    // Tools rail, canvas stage, transport + filmstrip.
    expect(out).toContain('aria-label="Drawing tools"')
    expect(out).toContain('Sprite drawing grid, 12 by 8 pixels')
    expect(out).toContain('aria-label="Animation frames"')
    expect(out).toContain('Frame 6')
    // Save / import / export hand-offs.
    expect(out).toContain('Save .spr')
    expect(out).toContain('Import…')
    expect(out).toContain('Animated GIF (.gif)')
    expect(out).toContain('PBM — this frame (.pbm)')
    expect(out).toContain('MicroPython module (.py)')
  })

  it('uses only the unique spred__ BEM prefix for its classes', () => {
    const out = html()
    const own = [...out.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/))
    expect(own.length).toBeGreaterThan(10)
    for (const c of own) expect(c, `class ${c}`).toMatch(/^spred($|__|--)/)
  })

  it('exposes the launch event name the Display instrument dispatches', () => {
    expect(OPEN_SPRITE_EDITOR_EVENT).toBe('snakie:open-sprite-editor')
  })
})
