import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PartCatalog } from '../src/renderer/src/components/PartCatalog'
import type { PartLibraryWithParts } from '../src/preload/index.d'

/** The full-screen parts catalog (#613) rendered to static HTML — structure only
 *  (SSR runs no effects/interaction). */
const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)

const LIBS: PartLibraryWithParts[] = [
  {
    id: 'snakie-standard',
    name: 'Standard',
    parts: [
      { id: 'led', name: 'LED', family: 'Output', partNumber: 'LED-5MM', description: 'A basic 5mm LED.', headers: [] },
      { id: 'bme280', name: 'BME280', family: 'Sensor', partNumber: 'BME280', description: 'Temp/pressure/humidity.', headers: [] }
    ]
  },
  {
    id: 'my-parts',
    name: 'My Parts',
    parts: [{ id: 'sg90', name: 'SG90 Servo', family: 'Motor', description: '9g micro servo.', headers: [] }]
  }
] as unknown as PartLibraryWithParts[]

describe('PartCatalog (#613)', () => {
  it('renders a shelf per category with a card per part', () => {
    const out = html(<PartCatalog libraries={LIBS} onClose={() => {}} onAddMany={() => {}} />)
    // Category shelves (uppercased via CSS; the text is the raw category).
    expect(out).toContain('Output')
    expect(out).toContain('Sensor')
    expect(out).toContain('Motor')
    // A card per part with name + SKU + description.
    expect(out).toContain('LED')
    expect(out).toContain('LED-5MM')
    expect(out).toContain('A basic 5mm LED.')
    expect(out).toContain('SG90 Servo')
    expect(out).toContain('9g micro servo.')
  })

  it('starts with 0 selected and a disabled Add-to-project button', () => {
    const out = html(<PartCatalog libraries={LIBS} onClose={() => {}} onAddMany={() => {}} />)
    expect(out).toContain('0 selected')
    expect(out).toContain('Add to project')
    // The Add button is disabled while nothing is selected.
    expect(out).toMatch(/pcat__add[^>]*disabled/)
  })

  it('shows the whole card as the checkbox (a label wrapping a checkbox input)', () => {
    const out = html(<PartCatalog libraries={LIBS} onClose={() => {}} onAddMany={() => {}} />)
    expect(out).toContain('pcat__card')
    expect(out).toContain('type="checkbox"')
    expect(out).toContain('pcat__check') // the stylised box
  })
})
