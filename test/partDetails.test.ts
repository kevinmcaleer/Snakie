import { describe, expect, it } from 'vitest'
import {
  formatDimensions,
  formatI2cAddresses,
  formatMass,
  partCodeModule,
  partDetailSections,
  partDocLinks,
  partDriverRows,
  partHelpBody,
  partHelpDoc,
  partMeshRef,
  partPreviewModes,
  partSpecRows,
  partTagList,
  resolveSuggestedModules
} from '../src/renderer/src/components/part-details'
import type { PartDefinition } from '../src/shared/part'

/**
 * The data behind the full-sized part details view (#748).
 *
 * The properties that matter are the ones a details page lives or dies by: it
 * never shows a row/section it has nothing to put in, it never offers a 3-D tab
 * over a file that cannot be opened, and it never turns a part's own data into a
 * path outside that part's folder.
 */

const part = (over: Partial<PartDefinition> = {}): PartDefinition =>
  ({ id: 'thing', name: 'Thing', headers: [], ...over }) as PartDefinition

const FOLDER = { partsFolder: '/Users/kev/Library/Application Support/Snakie/parts', libraryId: 'snakie-standard' }

describe('formatDimensions / formatMass / formatI2cAddresses', () => {
  it('states real millimetres, without trailing zeros', () => {
    expect(formatDimensions(part({ dimensions: { width: 25.4, height: 17.8 } }))).toBe('25.4 × 17.8 mm')
    expect(formatDimensions(part({ dimensions: { width: 51, height: 21 } }))).toBe('51 × 21 mm')
  })

  it('is absent rather than nonsense when there is no usable measurement', () => {
    expect(formatDimensions(part())).toBeUndefined()
    expect(formatDimensions(part({ dimensions: { width: 0, height: 10 } }))).toBeUndefined()
    expect(formatDimensions(part({ dimensions: { width: NaN, height: 10 } }))).toBeUndefined()
  })

  it('states mass in grams, and only when known', () => {
    expect(formatMass(part({ mass_g: 9 }))).toBe('9 g')
    expect(formatMass(part({ mass_g: 13.55 }))).toBe('13.6 g')
    expect(formatMass(part())).toBeUndefined()
    expect(formatMass(part({ mass_g: 0 }))).toBeUndefined()
  })

  it('states I²C addresses as hex, the way a datasheet does', () => {
    expect(formatI2cAddresses(part({ i2cAddresses: [0x76, 0x77] }))).toBe('0x76, 0x77')
    expect(formatI2cAddresses(part({ i2cAddresses: [0x8] }))).toBe('0x08')
    expect(formatI2cAddresses(part())).toBeUndefined()
    expect(formatI2cAddresses(part({ i2cAddresses: [] }))).toBeUndefined()
  })
})

describe('partSpecRows', () => {
  const full = part({
    manufacturer: 'Seeed Studio',
    partNumber: 'XIAO-RP2040',
    family: 'Microcontroller',
    package: 'SMD',
    voltage: '3.3V',
    dimensions: { width: 21, height: 17.5 },
    mass_g: 2.5,
    pinSpacing: 2.54,
    i2cAddresses: [0x3c],
    version: '1.2.0',
    properties: { Flash: '2MB', Radio: 'BLE' }
  })

  it('never emits a row without a value — an empty row is worse than no row', () => {
    for (const row of partSpecRows(full)) {
      expect(row.label.trim()).not.toBe('')
      expect(row.value.trim()).not.toBe('')
    }
    // A part that declares nothing has no spec table at all.
    expect(partSpecRows(part())).toEqual([])
    // Blank strings count as "not declared", not as a value.
    expect(partSpecRows(part({ manufacturer: '   ', family: '' }))).toEqual([])
  })

  it('carries every declared field, each labelled once', () => {
    const rows = partSpecRows(full)
    const labels = rows.map((r) => r.label)
    expect(labels).toEqual([...new Set(labels)])
    expect(Object.fromEntries(rows.map((r) => [r.label, r.value]))).toMatchObject({
      Manufacturer: 'Seeed Studio',
      'Part #': 'XIAO-RP2040',
      Family: 'Microcontroller',
      Voltage: '3.3V',
      Dimensions: '21 × 17.5 mm',
      Mass: '2.5 g',
      'Pin spacing': '2.54 mm',
      'I²C address': '0x3c',
      Version: '1.2.0'
    })
  })

  it('spells the package code out, and passes an unknown one through untouched', () => {
    expect(partSpecRows(part({ package: 'SMD' }))[0].value).toBe('Surface-mount (SMD)')
    expect(partSpecRows(part({ package: 'THT' }))[0].value).toBe('Through-hole (THT)')
    expect(partSpecRows(part({ package: 'QFN' } as unknown as Partial<PartDefinition>))[0].value).toBe('QFN')
  })

  it("appends the author's own key/values as further spec rows", () => {
    const rows = partSpecRows(full)
    expect(rows.slice(-2)).toEqual([
      { label: 'Flash', value: '2MB' },
      { label: 'Radio', value: 'BLE' }
    ])
  })
})

describe('partTagList', () => {
  it('trims, drops blanks and de-dupes case-insensitively, keeping author order', () => {
    expect(partTagList(part({ tags: [' wifi ', 'WiFi', '', 'rp2350'] }))).toEqual(['wifi', 'rp2350'])
    expect(partTagList(part())).toEqual([])
  })
})

describe('partDriverRows', () => {
  it('classifies each source by how it actually gets onto the board', () => {
    const rows = partDriverRows(
      part({
        drivers: [
          { source: 'bme280.py', target: 'lib/bme280.py', label: 'BME280 driver' },
          { source: 'github:org/repo/thing.py', target: 'lib' },
          { source: 'https://example.com/x.py', target: 'lib/x.py' },
          { source: 'module:hcsr04', target: '' }
        ]
      })
    )
    expect(rows.map((r) => r.method)).toEqual(['copy', 'mip', 'copy', 'module'])
    // Each row says what it does AND where it comes from.
    expect(rows[0].summary).toContain('bme280.py')
    expect(rows[0].summary).toContain('lib/bme280.py')
    // The `mip` METHOD is still how the spec is classified, but the summary
    // says what actually happens (#776): Snakie downloads it, the board doesn't.
    expect(rows[1].summary).toContain('github:org/repo/thing.py')
    expect(rows[1].summary).toMatch(/download/i)
    expect(rows[2].summary).toContain('https://example.com/x.py')
  })

  it('resolves a module: source through the catalog — its name and install path', () => {
    const [row] = partDriverRows(part({ drivers: [{ source: 'module:hcsr04', target: '' }] }))
    expect(row.label).toBe('HC-SR04 ultrasonic') // the catalog's name, not "module:hcsr04"
    expect(row.target).toBe('/lib/hcsr04.py') // the catalog decides where it lands
    expect(row.summary).toContain('HC-SR04 ultrasonic')
  })

  it('keeps an unknown module visible rather than pretending the part needs nothing', () => {
    const [row] = partDriverRows(part({ drivers: [{ source: 'module:nope', target: '' }] }))
    expect(row.label).toBe('module:nope')
    expect(row.summary).toMatch(/unknown/i)
  })

  it('drops a blank source, and gives every row a unique key', () => {
    const rows = partDriverRows(
      part({ drivers: [{ source: '  ', target: 'lib' }, { source: 'a.py', target: 'lib/a.py' }, { source: 'a.py', target: 'lib/a.py' }] })
    )
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.key)).size).toBe(2)
  })

  it('is empty for a part with no drivers', () => {
    expect(partDriverRows(part())).toEqual([])
  })
})

describe('partCodeModule / partDocLinks', () => {
  it('offers only addresses a browser can open', () => {
    const links = partDocLinks(
      part({ library: { module: 'vl53l0x', url: 'github:org/vl53l0x', docs: 'https://docs.example/vl53l0x' } })
    )
    // The mip spec is an install source, not a page — it must not become a link.
    expect(links.map((l) => l.href)).toEqual(['https://docs.example/vl53l0x'])
    expect(partCodeModule(part({ library: { module: 'vl53l0x' } }))).toBe('vl53l0x')
    expect(partCodeModule(part())).toBeUndefined()
  })

  it("picks up the help file's detailed-guide link, de-duped against the docs link", () => {
    const guide = 'https://www.kevsrobots.com/learn/parts/sg90/'
    const links = partDocLinks(part({ helpText: `---\nkevsrobots: ${guide}\n---\n# SG90\n`, library: { docs: guide } }))
    expect(links).toHaveLength(1)
    expect(links[0].href).toBe(guide)
  })

  it('is empty for a part that links nowhere', () => {
    expect(partDocLinks(part())).toEqual([])
  })
})

describe('resolveSuggestedModules', () => {
  it('resolves catalog ids, de-dupes, and falls back to the module description', () => {
    const rows = resolveSuggestedModules(
      part({
        suggests: [
          { module: 'ssd1306', unlocks: 'the 0.96" OLED' },
          { module: 'ssd1306' }, // same module twice
          { module: 'pcf8563' }
        ]
      })
    )
    expect(rows.map((r) => r.module.id)).toEqual(['ssd1306', 'pcf8563'])
    expect(rows[0].unlocks).toBe('the 0.96" OLED')
    expect(rows[1].unlocks).toBe(rows[1].module.description) // no `unlocks` ⇒ the module's own words
  })

  it('drops an id the catalog does not know — a row promising nothing installable', () => {
    expect(resolveSuggestedModules(part({ suggests: [{ module: 'not-a-module' }] }))).toEqual([])
  })
})

describe('partHelpDoc / partHelpBody', () => {
  it('renders the prose with the front matter stripped off', () => {
    const body = partHelpBody(part({ helpText: '---\nkevsrobots: https://x.test/\n---\n# SG90\n\nHello.\n' }))
    expect(body.startsWith('# SG90')).toBe(true)
    expect(body).not.toContain('kevsrobots:')
  })

  it('has no help to render for a file that is only front matter', () => {
    // The guide is still a LINK (partDocLinks picks it up); it is not an article,
    // and rendering it would leave an empty panel under a heading.
    const p = part({ helpText: '---\nkevsrobots: https://x.test/\n---\n' })
    expect(partHelpBody(p)).toBe('')
    expect(partHelpDoc(p)?.guideUrl).toBe('https://x.test/')
    expect(partDocLinks(p)).toHaveLength(1)
  })

  it('has no help doc at all when the part ships none', () => {
    expect(partHelpDoc(part())).toBeNull()
    expect(partHelpDoc(part({ helpText: '   ' }))).toBeNull()
    expect(partHelpBody(part())).toBe('')
  })
})

describe('partMeshRef', () => {
  it('resolves a bundled mesh to a path inside the part folder', () => {
    const ref = partMeshRef(part({ mesh: 'model.stl' }), FOLDER)
    expect(ref).toEqual({
      path: `${FOLDER.partsFolder}/snakie-standard/thing/model.stl`,
      kind: 'stl'
    })
  })

  it('accepts the mesh kinds the loader can actually parse, and no others', () => {
    expect(partMeshRef(part({ mesh: 'model.dae' }), FOLDER)?.kind).toBe('dae')
    expect(partMeshRef(part({ mesh: 'MODEL.STL' }), FOLDER)?.kind).toBe('stl')
    // Unsupported kinds resolve to nothing, so no 3-D tab appears over a file the
    // viewer would fail on.
    expect(partMeshRef(part({ mesh: 'model.obj' }), FOLDER)).toBeNull()
    expect(partMeshRef(part({ mesh: 'model.glb' }), FOLDER)).toBeNull()
  })

  it('never resolves outside the part\u2019s own folder', () => {
    for (const mesh of ['../../../../etc/passwd.stl', '/etc/passwd.stl', 'C:/Windows/x.stl', '../sibling/model.stl']) {
      expect(partMeshRef(part({ mesh }), FOLDER), mesh).toBeNull()
    }
    // A nested path INSIDE the folder is fine.
    expect(partMeshRef(part({ mesh: 'meshes/model.stl' }), FOLDER)?.path).toBe(
      `${FOLDER.partsFolder}/snakie-standard/thing/meshes/model.stl`
    )
  })

  it('resolves to nothing without a parts folder — the web build has no filesystem', () => {
    expect(partMeshRef(part({ mesh: 'model.stl' }), { partsFolder: '', libraryId: 'snakie-standard' })).toBeNull()
    expect(partMeshRef(part({ mesh: 'model.stl' }), { partsFolder: FOLDER.partsFolder, libraryId: '' })).toBeNull()
  })

  it('resolves to nothing for a part with no mesh', () => {
    expect(partMeshRef(part(), FOLDER)).toBeNull()
    expect(partMeshRef(part({ mesh: '  ' }), FOLDER)).toBeNull()
  })

  it('normalises Windows separators into one path the loader can read', () => {
    const ref = partMeshRef(part({ mesh: 'model.stl' }), {
      partsFolder: 'C:\\Users\\kev\\AppData\\Roaming\\Snakie\\parts',
      libraryId: 'snakie-standard'
    })
    expect(ref?.path).toBe('C:/Users/kev/AppData/Roaming/Snakie/parts/snakie-standard/thing/model.stl')
  })
})

describe('partPreviewModes / partDetailSections', () => {
  it('offers the 3-D tab only when there is a model behind it', () => {
    expect(partPreviewModes(false)).toEqual(['board', 'schematic'])
    expect(partPreviewModes(true)).toEqual(['board', 'schematic', 'model'])
  })

  it('lists only the panels that have something to say', () => {
    // The barest possible part: a name and no data at all.
    expect(partDetailSections(part())).toEqual([])
    expect(partDetailSections(part({ manufacturer: 'Seeed' }))).toEqual(['specs'])
    expect(partDetailSections(part({ tags: ['wifi'] }))).toEqual(['tags'])
    expect(partDetailSections(part({ library: { module: 'vl53l0x' } }))).toEqual(['drivers'])
    expect(partDetailSections(part({ suggests: [{ module: 'ssd1306' }] }))).toEqual(['works-with'])
    expect(partDetailSections(part({ helpText: '# Hi\n' }))).toEqual(['help'])
  })

  it('keeps the panels in one stable page order however the part is filled in', () => {
    const rich = part({
      manufacturer: 'Seeed',
      tags: ['grove'],
      drivers: [{ source: 'x.py', target: 'lib/x.py' }],
      suggests: [{ module: 'ssd1306' }],
      library: { docs: 'https://docs.test/' },
      helpText: '# Hi\n'
    })
    expect(partDetailSections(rich)).toEqual(['specs', 'tags', 'drivers', 'works-with', 'links', 'help'])
  })
})
