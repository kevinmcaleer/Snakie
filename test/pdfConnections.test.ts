import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PdfDocument } from '../src/renderer/src/lib/pdf/layout'
import {
  CONNECTIONS_HEADING,
  type ConnectionRow,
  buildConnections,
  drawConnectionsPages,
  measureConnectionRows
} from '../src/renderer/src/lib/pdf/sections/connections'
import { CONNECTIONS_INTRO } from '../src/renderer/src/lib/pdf/sections/narrative'
import { blankRobot, type RobotDefinition } from '../src/shared/robot'
import { robotFromYaml } from '../src/shared/robot-yaml'
import { pageStrings, pages, parsePdf } from './helpers/pdf-inspect'

/**
 * THE CONNECTIONS TABLE (#1170) — the wiring as a list you can work down.
 *
 * A picture is a poor thing to wire from: following one curve out of a dozen
 * and landing on the right pin is the part a beginner gets wrong. These are the
 * promises the page makes — the board's end first, in pin order, every wire
 * present exactly once, and nothing at all for a project with no wiring.
 */

/** The demo project's wiring — two servos on a Pico, six wires. */
function demoRobot(): RobotDefinition {
  return robotFromYaml(
    readFileSync(join(__dirname, '..', 'examples', 'servo-arm', 'robot.yml'), 'utf-8')
  )
}

const catalog = {
  libraries: [
    {
      id: 'snakie-standard',
      name: 'Standard',
      parts: [{ id: 'sg90', name: 'SG90 micro servo' }]
    }
  ] as never,
  boards: [{ id: 'pico', name: 'Raspberry Pi Pico' }]
}

describe('building the rows', () => {
  it('has nothing to say about a project with no wiring', () => {
    expect(buildConnections(null)).toEqual([])
    expect(buildConnections(undefined)).toEqual([])
    expect(buildConnections(blankRobot())).toEqual([])
  })

  it('writes out every wire exactly once', () => {
    const robot = demoRobot()
    const rows = buildConnections(robot, catalog)
    expect(rows).toHaveLength(robot.connections.length)
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it("leads with the BOARD's end, whichever way round the wire was drawn", () => {
    // Every wire in the demo is stored part-first (`shoulder.Signal#0` → `board.GP0#0`).
    const rows = buildConnections(demoRobot(), catalog)
    expect(rows.every((r) => r.from.startsWith('Raspberry Pi Pico · '))).toBe(true)
    expect(rows.some((r) => r.to.startsWith('Shoulder servo · '))).toBe(true)
  })

  it('names a part by what the project calls it, then by the catalogue', () => {
    const robot: RobotDefinition = {
      ...blankRobot(),
      board: 'pico',
      parts: [
        { id: 'a', lib: 'snakie-standard', part: 'sg90', label: 'Elbow servo' },
        { id: 'b', lib: 'snakie-standard', part: 'sg90' }
      ] as never,
      connections: [
        { id: '1', from: 'board.GP0#0', to: 'a.Signal#0', net: 'signal' },
        { id: '2', from: 'board.GP1#1', to: 'b.Signal#0', net: 'signal' }
      ] as never
    }
    const rows = buildConnections(robot, catalog)
    expect(rows.map((r) => r.to)).toEqual([
      'Elbow servo · Signal',
      'SG90 micro servo · Signal'
    ])
  })

  it('falls back to the ids when the libraries could not be read', () => {
    const rows = buildConnections(demoRobot())
    expect(rows[0].from.startsWith('pico · ')).toBe(true)
    expect(rows.some((r) => r.to.includes('Shoulder servo'))).toBe(true)
  })

  it('sorts the board pins by number, with the named rails after them', () => {
    const robot: RobotDefinition = {
      ...blankRobot(),
      board: 'pico',
      parts: [{ id: 'p', lib: 'l', part: 'x', label: 'Part' }] as never,
      connections: [
        { id: 'gnd', from: 'board.GND#3', to: 'p.GND#3', net: 'gnd' },
        { id: 'gp10', from: 'board.GP10#10', to: 'p.Echo#2', net: 'signal' },
        { id: 'gp2', from: 'board.GP2#2', to: 'p.Trigger#1', net: 'signal' },
        { id: '3v3', from: 'board.3V3#35', to: 'p.VCC#0', net: 'vcc' }
      ] as never
    }
    expect(buildConnections(robot).map((r) => r.key)).toEqual(['gp2', 'gp10', '3v3', 'gnd'])
  })

  it('puts part-to-part wires after the board, and keeps them', () => {
    const robot: RobotDefinition = {
      ...blankRobot(),
      board: 'pico',
      parts: [
        { id: 'batt', lib: 'l', part: 'b', label: 'Battery' },
        { id: 'drv', lib: 'l', part: 'd', label: 'Motor driver' }
      ] as never,
      connections: [
        { id: 'p2p', from: 'batt.+#0', to: 'drv.VM#0', net: 'vcc' },
        { id: 'onboard', from: 'board.GP0#0', to: 'drv.IN1#1', net: 'signal' }
      ] as never
    }
    const rows = buildConnections(robot)
    expect(rows.map((r) => r.key)).toEqual(['onboard', 'p2p'])
    expect(rows[1]).toMatchObject({ from: 'Battery · +', to: 'Motor driver · VM', net: 'VCC' })
  })

  it('upper-cases the net, and says signal when a wire names none', () => {
    const robot: RobotDefinition = {
      ...blankRobot(),
      board: 'pico',
      parts: [{ id: 'p', lib: 'l', part: 'x' }] as never,
      connections: [{ id: 'w', from: 'board.GP0#0', to: 'p.A#0' }] as never
    }
    expect(buildConnections(robot)[0].net).toBe('SIGNAL')
  })

  it('carries the cable a bundled wire belongs to', () => {
    const robot: RobotDefinition = {
      ...blankRobot(),
      board: 'pico',
      parts: [{ id: 'p', lib: 'l', part: 'x', label: 'Sensor' }] as never,
      connections: [
        { id: 'w', from: 'board.SDA#4', to: 'p.SDA#1', net: 'i2c', cable: 'QWIIC' }
      ] as never
    }
    expect(buildConnections(robot)[0].cable).toBe('QWIIC')
  })
})

describe('drawing the table', () => {
  const rows = (n: number): ConnectionRow[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `w${i}`,
      from: `Raspberry Pi Pico · GP${i}`,
      to: `Sensor ${i} · Signal`,
      net: 'SIGNAL'
    }))

  it('draws no page at all for a project with no wiring', () => {
    const doc = new PdfDocument()
    expect(drawConnectionsPages(doc, [])).toEqual([])
    expect(doc.pageCount).toBe(0)
  })

  it('sets the heading, the intro and both ends of every wire', () => {
    const doc = new PdfDocument()
    drawConnectionsPages(doc, rows(3), { intro: CONNECTIONS_INTRO })
    const pdf = parsePdf(doc.build())
    const text = pageStrings(pdf, pages(pdf)[0]).join(' ')
    expect(text).toContain(CONNECTIONS_HEADING)
    expect(text).toContain('tick it off as you go')
    expect(text).toContain('From')
    expect(text).toContain('To')
    expect(text).toContain('Raspberry Pi Pico · GP0')
    expect(text).toContain('Sensor 2 · Signal')
    expect(text).toContain('SIGNAL')
  })

  it('carries on over as many pages as the wiring needs, and says so', () => {
    const doc = new PdfDocument()
    const drawn = drawConnectionsPages(doc, rows(80), { intro: CONNECTIONS_INTRO })
    expect(drawn.length).toBeGreaterThan(1)
    const pdf = parsePdf(doc.build())
    const first = pageStrings(pdf, pages(pdf)[0]).join(' ')
    const second = pageStrings(pdf, pages(pdf)[1]).join(' ')
    expect(first).toContain(CONNECTIONS_HEADING)
    expect(second).toContain(`${CONNECTIONS_HEADING} (continued)`)
    // The intro is the first page's alone; a continuation is all table.
    expect(second).not.toContain('tick it off as you go')
    // Every wire appears, split across the pages rather than dropped.
    const all = pages(pdf)
      .map((p) => pageStrings(pdf, p).join(' '))
      .join(' ')
    for (const row of rows(80)) expect(all).toContain(row.to)
  })

  it('never splits a row across a page break, and never repeats one', () => {
    const doc = new PdfDocument()
    drawConnectionsPages(doc, rows(80))
    const pdf = parsePdf(doc.build())
    const text = pages(pdf)
      .map((p) => pageStrings(pdf, p).join(' '))
      .join(' ')
    // A row pushed over a break would either lose its second end or print it
    // on both pages; each appears exactly once.
    for (const row of rows(80)) {
      expect(text.split(row.to).length - 1).toBe(1)
    }
  })

  it('gives a wrapped row the height its longest end needs', () => {
    const long = 'A part with a really quite long name indeed · Signal output pin'
    const [plain, wrapped] = measureConnectionRows(
      [
        { key: 'a', from: 'Pico · GP0', to: 'Sensor · Signal', net: 'SIGNAL' },
        { key: 'b', from: 'Pico · GP1', to: long, net: 'SIGNAL' }
      ],
      360
    )
    expect(wrapped.to.length).toBeGreaterThan(1)
    expect(wrapped.height).toBeGreaterThan(plain.height)
  })

  it('adds the cable note under the wire it belongs to', () => {
    const [measured] = measureConnectionRows(
      [{ key: 'a', from: 'Pico · SDA', to: 'Sensor · SDA', net: 'I2C', cable: 'QWIIC' }],
      360
    )
    expect(measured.to.some((l) => l.includes('QWIIC'))).toBe(true)
  })
})
