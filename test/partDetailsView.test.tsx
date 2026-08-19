import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PartCatalog } from '../src/renderer/src/components/PartCatalog'
import { PartDetailsView } from '../src/renderer/src/components/PartDetailsView'
import type { PartDefinition } from '../src/shared/part'
import type { PartLibraryWithParts } from '../src/preload/index.d'

/**
 * The full-sized details view and the card disclosure that opens it (#748),
 * rendered to static HTML — structure only (SSR runs no effects or interaction).
 *
 * The part's `help.md` is deliberately absent from these fixtures: `Markdown`
 * sanitises through DOMPurify, which needs a real DOM. What the help panel shows
 * is covered by `partHelpBody` in partDetails.test.ts instead.
 */
const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)

const BME280: PartDefinition = {
  id: 'bme280',
  name: 'BME280',
  description: 'Temperature, pressure and humidity over I²C.',
  family: 'Sensor',
  manufacturer: 'Bosch',
  partNumber: 'BME280',
  package: 'SMD',
  dimensions: { width: 12.7, height: 10.2 },
  mass_g: 1.2,
  i2cAddresses: [0x76, 0x77],
  tags: ['i2c', 'weather'],
  headers: [],
  library: { module: 'bme280', docs: 'https://docs.test/bme280' },
  drivers: [{ source: 'bme280.py', target: 'lib/bme280.py', label: 'BME280 driver' }],
  suggests: [{ module: 'ssd1306', unlocks: 'a live readout on the OLED' }]
} as unknown as PartDefinition

const view = (over: Partial<Parameters<typeof PartDetailsView>[0]> = {}): string =>
  html(
    <PartDetailsView
      libraryId="snakie-standard"
      part={BME280}
      selected={false}
      onToggleSelected={() => {}}
      onClose={() => {}}
      {...over}
    />
  )

describe('PartDetailsView (#748)', () => {
  it('shows the part at full size with its header metadata', () => {
    const out = view()
    expect(out).toContain('BME280')
    expect(out).toContain('Bosch') // manufacturer
    expect(out).toContain('Temperature, pressure and humidity') // description
    expect(out).toContain('Surface-mount (SMD)')
    expect(out).toContain('12.7 × 10.2 mm') // real dimensions
    expect(out).toContain('1.2 g') // mass where known
    expect(out).toContain('0x76, 0x77')
    // Pin labels come from the same read-only PartCanvas the docked pane uses.
    expect(out).toContain('Board view of BME280')
  })

  it('shows what the part installs, and from where', () => {
    const out = view()
    expect(out).toContain('BME280 driver')
    expect(out).toContain('lib/bme280.py')
    expect(out).toContain('Imported as')
    // "Works with" resolves through the modules catalog.
    expect(out).toContain('SSD1306 OLED')
    expect(out).toContain('a live readout on the OLED')
    // Library docs are offered as a link.
    expect(out).toContain('https://docs.test/bme280')
  })

  it('has a close control, top right', () => {
    expect(view()).toContain('aria-label="Close part details"')
  })

  it('lets the part be ticked into the selection from here', () => {
    expect(view({ selected: false })).toContain('+ Select')
    const on = view({ selected: true })
    expect(on).toContain('✓ Selected')
    expect(on).toMatch(/pdt__select[^>]*is-on|is-on[^>]*aria-pressed="true"/)
  })

  it('offers no 3-D tab for a part with no model — no empty frame', () => {
    const out = view()
    expect(out).toContain('>Board<')
    expect(out).toContain('>Schematic<')
    expect(out).not.toContain('>3-D<')
  })

  it('omits every panel a part has nothing to put in', () => {
    const bare = view({ part: { id: 'x', name: 'Bare Thing', headers: [] } as unknown as PartDefinition })
    expect(bare).toContain('Bare Thing')
    for (const heading of ['Specifications', 'Tags', 'Driver', 'Works with', 'Links', 'Guide']) {
      expect(bare, `a part with no data should not render a "${heading}" panel`).not.toContain(
        `>${heading}<`
      )
    }
  })

  it('offers the flip only when the board has a back to see', () => {
    expect(view()).not.toContain('Flip to back')
    const twoSided = view({
      part: { ...BME280, headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', side: 'rear' }] }] } as unknown as PartDefinition
    })
    expect(twoSided).toContain('Flip to back')
  })
})

describe('the card disclosure that opens it (#748)', () => {
  const LIBS: PartLibraryWithParts[] = [
    {
      id: 'snakie-standard',
      name: 'Standard',
      parts: [{ id: 'led', name: 'LED', family: 'Output', description: 'A basic 5mm LED.', headers: [] }]
    }
  ] as unknown as PartLibraryWithParts[]

  it('rides on every card, with its own name and hit area', () => {
    const out = html(<PartCatalog libraries={LIBS} onClose={() => {}} onAddMany={() => {}} />)
    expect(out).toContain('pcat__more')
    expect(out).toContain('aria-label="More about LED"')
  })

  it('is a BUTTON, so activating it cannot tick the card it sits in', () => {
    // The card is a <label> wrapping the checkbox: anything that isn't an
    // interactive control would forward its click to that checkbox.
    const out = html(<PartCatalog libraries={LIBS} onClose={() => {}} onAddMany={() => {}} />)
    expect(out).toMatch(/<button[^>]*type="button"[^>]*class="pcat__more"|<button[^>]*class="pcat__more"[^>]*type="button"/)
  })

  it('leaves the grid alone until it is used — the details are a detour', () => {
    const out = html(<PartCatalog libraries={LIBS} onClose={() => {}} onAddMany={() => {}} />)
    expect(out).toContain('pcat__grid')
    expect(out).not.toContain('pdt__') // nothing of the details view until asked for
  })
})
