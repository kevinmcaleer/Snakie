import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PartCatalog } from '../src/renderer/src/components/PartCatalog'
import { partHasRear, partHasRearImage } from '../src/shared/part'
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

describe('hover flip (#636)', () => {
  const withRear: PartLibraryWithParts[] = [
    {
      id: 'snakie-standard',
      name: 'Standard',
      parts: [
        {
          id: 'two-sided',
          name: 'Two Sided',
          headers: [],
          imageData: 'data:image/png;base64,FRONT',
          rear: { imageData: 'data:image/png;base64,BACK' }
        },
        {
          id: 'front-only',
          name: 'Front Only',
          headers: [],
          imageData: 'data:image/png;base64,FRONT'
        }
      ] as unknown as PartLibraryWithParts['parts']
    }
  ]

  it('shows the FRONT face at rest', () => {
    const out = html(<PartCatalog libraries={withRear} onClose={() => {}} onAdd={() => {}} />)
    expect(out).toContain('base64,FRONT')
    expect(out, 'the back is only revealed on hover').not.toContain('base64,BACK')
  })

  it('marks which face is showing, but only for a part that HAS a back', () => {
    // Without the badge, a board whose sides look alike leaves you unsure the
    // hover did anything.
    const out = html(<PartCatalog libraries={withRear} onClose={() => {}} onAdd={() => {}} />)
    expect(out).toContain('pcat__card-face')
    expect((out.match(/pcat__card-face/g) ?? []).length, 'one badge, not two').toBe(1)
  })
})

describe('partHasRearImage', () => {
  it('is true only when there is a picture of the back', () => {
    // A rear FACE is not a rear PHOTO: flipping to a blank back reads as a
    // broken image, so the catalogue gates on the picture.
    expect(partHasRearImage({ rear: { imageData: 'x' } } as never)).toBe(true)
    expect(partHasRearImage({ rear: { image: 'rear.png' } } as never)).toBe(true)
    expect(partHasRearImage({ rear: {} } as never)).toBe(false)
    expect(partHasRearImage({} as never)).toBe(false)
  })

  it('differs from partHasRear, which counts rear PINS', () => {
    const pinsOnly = { headers: [{ pins: [{ side: 'rear' }] }] } as never
    expect(partHasRear(pinsOnly)).toBe(true)
    expect(partHasRearImage(pinsOnly)).toBe(false)
  })
})
