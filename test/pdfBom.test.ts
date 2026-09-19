import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  type BomCatalog,
  type BomRow,
  BOM_HEADING,
  CABLE_KEY,
  JUMPER_KEY,
  buildBom,
  drawBomPages,
  measureBomRows
} from '../src/renderer/src/lib/pdf/sections/bom'
import { BOM_INTRO } from '../src/renderer/src/lib/pdf/sections/narrative'
import { PdfDocument } from '../src/renderer/src/lib/pdf/layout'
import { blankRobot, type RobotDefinition } from '../src/shared/robot'
import { robotFromYaml } from '../src/shared/robot-yaml'
import type { PartDefinition, PartLibraryWithParts } from '../src/shared/part'
import { pageStrings, pages, parsePdf } from './helpers/pdf-inspect'

/**
 * THE BILL OF MATERIALS (#1157) — the shopping list the document never had.
 *
 * Two halves, tested apart: `buildBom` is arithmetic over `robot.yml` and the
 * installed libraries, and `drawBomPages` is a real byte stream read back.
 */

const DEMO = join(__dirname, '..', 'examples', 'servo-arm')
const demoRobot = (): RobotDefinition =>
  robotFromYaml(readFileSync(join(DEMO, 'robot.yml'), 'utf-8'))

function part(over: Partial<PartDefinition> & { id: string }): PartDefinition {
  return { name: over.id, headers: [], ...over }
}

function library(id: string, parts: PartDefinition[]): PartLibraryWithParts {
  return { id, name: id, parts }
}

const catalogue: BomCatalog = {
  libraries: [
    library('snakie-standard', [
      part({
        id: 'sg90',
        name: 'SG90 micro servo',
        manufacturer: 'TowerPro',
        partNumber: 'SG90'
      }),
      part({ id: 'pico', name: 'Raspberry Pi Pico', manufacturer: 'Raspberry Pi' })
    ])
  ],
  boards: [{ id: 'pico', name: 'Raspberry Pi Pico' }]
}

/** A row by its key, for assertions that do not care about the order. */
function row(rows: readonly BomRow[], key: string): BomRow | undefined {
  return rows.find((r) => r.key === key)
}

describe('building the list', () => {
  it('counts a part placed twice as one row of two', () => {
    const rows = buildBom(demoRobot(), catalogue)
    const servo = row(rows, 'snakie-standard:sg90')
    expect(servo).toMatchObject({ name: 'SG90 micro servo', quantity: 2 })
    expect(rows.filter((r) => r.key === 'snakie-standard:sg90')).toHaveLength(1)
  })

  it('opens with the microcontroller, since nothing else works without it', () => {
    const rows = buildBom(demoRobot(), catalogue)
    expect(rows[0]).toMatchObject({ name: 'Raspberry Pi Pico', quantity: 1 })
    expect(rows[0].detail).toContain('Microcontroller')
  })

  it('identifies a part by its maker and part number, so it can be bought', () => {
    const rows = buildBom(demoRobot(), catalogue)
    expect(row(rows, 'snakie-standard:sg90')?.detail).toBe('TowerPro · SG90')
  })

  it('falls back to the description when there is no part number', () => {
    const rows = buildBom(
      { ...blankRobot(), parts: [{ id: 'd1', lib: 'l', part: 'hcsr04' }] },
      {
        libraries: [
          library('l', [
            part({ id: 'hcsr04', name: 'HC-SR04', description: 'Ultrasonic  distance sensor' })
          ])
        ]
      }
    )
    expect(rows[0].detail).toBe('Ultrasonic distance sensor')
  })

  it('still lists a part the libraries no longer have, under its id', () => {
    const rows = buildBom(
      {
        ...blankRobot(),
        parts: [
          { id: 'a', lib: 'gone', part: 'mystery', label: 'Left wheel' },
          { id: 'b', lib: 'gone', part: 'unlabelled' }
        ]
      },
      catalogue
    )
    expect(rows.map((r) => r.name)).toEqual(['mystery', 'unlabelled'])
    // What the project called it is the only clue left to what it is for.
    expect(rows.map((r) => r.detail)).toEqual(['Left wheel', undefined])
  })

  it('never names a repeated part after one of its instances', () => {
    const rows = buildBom(demoRobot())
    const servo = row(rows, 'snakie-standard:sg90')
    expect(servo).toMatchObject({ name: 'sg90', quantity: 2 })
    expect(servo?.detail).toBe('Shoulder servo, Elbow servo')
  })

  it('finds a part whose library was renamed, by its own id', () => {
    const rows = buildBom(
      { ...blankRobot(), parts: [{ id: 's', lib: 'renamed-library', part: 'sg90' }] },
      catalogue
    )
    expect(rows[0].name).toBe('SG90 micro servo')
  })

  it('counts the wire, which no parts list holds', () => {
    const rows = buildBom(demoRobot(), catalogue)
    const wires = row(rows, JUMPER_KEY)
    expect(wires?.quantity).toBe(demoRobot().connections.length)
    expect(wires?.detail).toContain('DuPont')
    expect(row(rows, CABLE_KEY)).toBeUndefined()
  })

  it('counts a cable bundle once, not once per wire in it', () => {
    const robot: RobotDefinition = {
      ...blankRobot(),
      parts: [{ id: 'q', lib: 'snakie-standard', part: 'sg90' }],
      connections: [
        { id: 'a', from: 'q.SDA', to: 'board.GP0', cable: 'qwiic1' },
        { id: 'b', from: 'q.SCL', to: 'board.GP1', cable: 'qwiic1' },
        { id: 'c', from: 'q.VCC', to: 'board.3V3', cable: 'qwiic1' },
        { id: 'd', from: 'q.GND', to: 'board.GND' }
      ]
    }
    const rows = buildBom(robot, catalogue)
    expect(row(rows, CABLE_KEY)?.quantity).toBe(1)
    expect(row(rows, JUMPER_KEY)?.quantity).toBe(1)
  })

  it('names what it can without any catalogue at all', () => {
    const rows = buildBom(demoRobot())
    expect(rows.map((r) => r.name)).toContain('sg90')
    expect(rows[0].name).toBe('pico')
  })

  it('is empty for a project with nothing in it', () => {
    expect(buildBom(blankRobot())).toEqual([])
    expect(buildBom(null)).toEqual([])
    expect(buildBom(undefined, catalogue)).toEqual([])
  })
})

describe('drawing the table', () => {
  const build = (rows: readonly BomRow[]): Uint8Array => {
    const doc = new PdfDocument()
    drawBomPages(doc, rows, { intro: BOM_INTRO })
    return doc.build()
  }

  const textOf = (bytes: Uint8Array): string[][] => {
    const pdf = parsePdf(bytes)
    return pages(pdf).map((p) => pageStrings(pdf, p))
  }

  it('heads the table, says what it is for, and sets a row per item', () => {
    const text = textOf(build(buildBom(demoRobot(), catalogue)))
    expect(text).toHaveLength(1)
    const page = text[0]
    expect(page).toContain(BOM_HEADING)
    expect(page).toContain(BOM_INTRO)
    expect(page).toContain('Qty')
    expect(page).toContain('Item')
    expect(page).toContain('SG90 micro servo')
    expect(page).toContain('2×')
    expect(page).toContain('TowerPro · SG90')
  })

  it('adds no page at all when there is nothing to buy', () => {
    const doc = new PdfDocument()
    expect(drawBomPages(doc, [], { intro: BOM_INTRO })).toEqual([])
    expect(doc.pageCount).toBe(0)
  })

  it('carries a long list onto further pages, whole rows and all of them', () => {
    const many: BomRow[] = Array.from({ length: 40 }, (_, i) => ({
      key: `k${i}`,
      name: `Part number ${i}`,
      detail: 'A part with a description long enough to wrap onto a second line of the table.',
      quantity: i + 1
    }))
    const text = textOf(build(many))
    expect(text.length).toBeGreaterThan(1)
    const flat = text.flat()
    for (const item of many) expect(flat).toContain(item.name)
    expect(text[1]).toContain(`${BOM_HEADING} (continued)`)
    // Every page's rows fit inside the content box — nothing ran off the foot.
    const doc = new PdfDocument()
    const capacity = doc.contentBox.height
    for (const page of drawBomPages(new PdfDocument(), many, { intro: BOM_INTRO })) {
      expect(page.content.height).toBeLessThanOrEqual(capacity)
    }
  })

  it('leaves the first page, and only the first, the room for its intro', () => {
    const doc = new PdfDocument()
    const rows: BomRow[] = Array.from({ length: 60 }, (_, i) => ({
      key: `k${i}`,
      name: `Item ${i}`,
      quantity: 1
    }))
    const measured = measureBomRows(rows, doc.contentBox.width)
    const withIntro = drawBomPages(new PdfDocument(), rows, { intro: BOM_INTRO })
    const without = drawBomPages(new PdfDocument(), rows)
    expect(measured.every((m) => m.height > 0)).toBe(true)
    // The intro costs the first page a row or two; the rest are unchanged, so
    // the document is never longer than one extra page because of it.
    expect(withIntro.length).toBeGreaterThanOrEqual(without.length)
    expect(withIntro.length).toBeLessThanOrEqual(without.length + 1)
  })
})
