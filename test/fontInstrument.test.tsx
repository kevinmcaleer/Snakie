import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FontInstrument } from '../src/renderer/src/components/FontInstrument'
import { INSTRUMENTS, instrumentById } from '../src/renderer/src/components/instruments-registry'
import { HELP_ARTICLES } from '../src/renderer/src/components/help-articles'
import { SEED_HEIGHT, SEED_WIDTH } from '../src/renderer/src/components/font-seed'
import { SAMPLE_TEXT } from '../src/renderer/src/components/font-model'

/** The font editor rendered to static HTML — structure only (no DOM needed). */
const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node)

const DEF = instrumentById('font')!

describe('Font editor instrument (#250)', () => {
  it('is registered as an output singleton with a help article', () => {
    expect(DEF).toBeDefined()
    expect(DEF.kind).toBe('singleton')
    expect(DEF.group).toBe('output')
    expect(DEF.name).toBe('Font editor')
    expect((HELP_ARTICLES['inst-font'] ?? '').length).toBeGreaterThan(200)
  })

  it('does not reuse another instrument’s accent or id', () => {
    const others = INSTRUMENTS.filter((d) => d.id !== 'font')
    expect(others.some((d) => d.accent === DEF.accent)).toBe(false)
    expect(others.some((d) => d.id === DEF.id)).toBe(false)
  })

  it('renders the metrics header, navigator, grid, preview and export', () => {
    const out = html(<FontInstrument def={DEF} />)
    // Header + cell metrics.
    expect(out).toContain('FONT EDITOR')
    expect(out).toContain('CHARSET')
    expect(out).toContain('BASE')
    expect(out).toContain('MONO')
    // Source pill reports the cell and how much of the charset is drawn.
    expect(out).toContain(`${SEED_WIDTH}×${SEED_HEIGHT}`)
    expect(out).toContain('94/95')
    // The charset navigator lists the printable-ASCII slots (space shows as SP).
    expect(out).toContain('aria-label="Character set"')
    expect(out).toContain('>SP<')
    // The pixel grid for the initial selection (`A`) is present and drawable.
    expect(out).toContain('aria-label="Pixel 0, 0"')
    expect(out).toContain('glyf__px--on')
    // The 1× preview line and the export controls.
    expect(out).toContain(SAMPLE_TEXT)
    expect(out).toContain('at actual size')
    expect(out).toContain('myfont.py')
  })

  it('uses only the unique glyf__ BEM prefix for its own classes', () => {
    const out = html(<FontInstrument def={DEF} />)
    const own = [...out.matchAll(/class="([^"]+)"/g)]
      .flatMap((m) => m[1].split(/\s+/))
      // The shared InstrumentWindow chrome legitimately uses `instr…`.
      .filter((c) => c && !c.startsWith('instr'))
    expect(own.length).toBeGreaterThan(10)
    for (const c of own) expect(c, `class ${c}`).toMatch(/^glyf($|__|--)/)
  })
})
