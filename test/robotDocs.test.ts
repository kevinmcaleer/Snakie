import { describe, expect, it } from 'vitest'
import {
  buildBomRows,
  bomMarkdown,
  buildPinoutRows,
  pinoutMarkdown,
  parseEndpoint
} from '../src/shared/robot-docs'
import type { RobotDefinition } from '../src/shared/robot'
import type { PartDefinition } from '../src/shared/part'

/**
 * The Board Viewer turns a project's robot.yml into a Markdown Bill of Materials
 * (#142) and a pinouts table (#143). These cover the pure generators.
 */

const PARTS: Record<string, PartDefinition> = {
  'lib/vl53': {
    id: 'vl53',
    name: 'VL53L0X',
    description: 'Time-of-flight distance sensor',
    manufacturer: 'STMicroelectronics',
    family: 'Sensor',
    partNumber: 'VL53L0X',
    headers: []
  } as PartDefinition,
  'lib/oled': {
    id: 'oled',
    name: 'SSD1306 OLED',
    family: 'Display',
    headers: []
  } as PartDefinition
}

const resolve = (lib: string, part: string): PartDefinition | null => PARTS[`${lib}/${part}`] ?? null

const MCU: PartDefinition = {
  id: 'pico2w',
  name: 'Raspberry Pi Pico 2 W',
  manufacturer: 'Raspberry Pi',
  family: 'Microcontroller',
  partNumber: 'SC1633',
  headers: []
} as PartDefinition

const robot: RobotDefinition = {
  name: 'Line Follower',
  board: 'pico2w',
  parts: [
    { id: 'tof1', lib: 'lib', part: 'vl53', label: 'Front ToF' },
    { id: 'tof2', lib: 'lib', part: 'vl53' },
    { id: 'oled1', lib: 'lib', part: 'oled' }
  ],
  connections: [
    { id: 'c1', from: 'board.GP4#10', to: 'tof1.SDA#0', net: 'signal' },
    { id: 'c2', from: 'tof1.SCL#1', to: 'board.GP5#11', net: 'signal' },
    { id: 'c3', from: 'board.3V3#36', to: 'tof1.VCC#2', net: 'vcc' },
    { id: 'c4', from: 'tof1.GND#3', to: 'oled1.GND#4', net: 'gnd' }
  ]
}

describe('parseEndpoint', () => {
  it('splits key + pin and strips the #index', () => {
    expect(parseEndpoint('tof1.SDA#3')).toEqual({ key: 'tof1', pin: 'SDA' })
    expect(parseEndpoint('board.GP4')).toEqual({ key: 'board', pin: 'GP4' })
  })
})

describe('buildBomRows', () => {
  it('puts the MCU first, then aggregates parts by type with a quantity', () => {
    const rows = buildBomRows(robot, resolve, { mcu: MCU, mcuName: 'Raspberry Pi Pico 2 W' })
    expect(rows[0]).toMatchObject({ qty: 1, name: 'Raspberry Pi Pico 2 W', manufacturer: 'Raspberry Pi' })
    // Two VL53L0X instances collapse into one row of qty 2.
    const tof = rows.find((r) => r.name === 'VL53L0X')
    expect(tof?.qty).toBe(2)
    const oled = rows.find((r) => r.name === 'SSD1306 OLED')
    expect(oled?.qty).toBe(1)
    // Parts (after the MCU) are sorted by name.
    expect(rows.slice(1).map((r) => r.name)).toEqual(['SSD1306 OLED', 'VL53L0X'])
  })

  it('falls back to the raw part id when the library part is unresolved', () => {
    const r: RobotDefinition = { parts: [{ id: 'x', lib: 'nope', part: 'ghost' }], connections: [] }
    const rows = buildBomRows(r, resolve)
    expect(rows).toEqual([{ qty: 1, name: 'ghost', description: '', manufacturer: '', family: '', partNumber: '' }])
  })
})

describe('bomMarkdown', () => {
  it('renders a Markdown table with the project title + dashes for blanks', () => {
    const md = bomMarkdown(robot, resolve, { mcu: MCU })
    expect(md).toContain('# Line Follower — Bill of Materials')
    expect(md).toContain('| Qty | Part | Description | Manufacturer | Family | Part # |')
    expect(md).toContain('| 2 | VL53L0X | Time-of-flight distance sensor | STMicroelectronics | Sensor | VL53L0X |')
    // OLED has no description/manufacturer/part# → em-dash placeholders.
    expect(md).toContain('| 1 | SSD1306 OLED | — | — | Display | — |')
  })

  it('handles an empty project', () => {
    const md = bomMarkdown({ parts: [], connections: [] }, resolve)
    expect(md).toContain('_No parts in this project yet._')
  })
})

describe('buildPinoutRows', () => {
  it('makes MCU-pin-first rows for board wires and separates part↔part wires', () => {
    const { mcu, other } = buildPinoutRows(robot, resolve, { mcuName: 'Pico 2 W' })
    // GP4, GP5, 3V3 touch the board; GP4/GP5 sort numerically before the non-numeric 3V3.
    expect(mcu.map((r) => r.mcuPin)).toEqual(['GP4', 'GP5', '3V3'])
    const gp4 = mcu.find((r) => r.mcuPin === 'GP4')
    expect(gp4).toMatchObject({ part: 'Front ToF', partPin: 'SDA', net: 'SIGNAL' })
    // The tof1.GND ↔ oled1.GND wire has no board endpoint → "other".
    expect(other).toEqual([{ from: 'Front ToF.GND', to: 'SSD1306 OLED.GND', net: 'GND' }])
  })
})

describe('pinoutMarkdown', () => {
  it('renders the MCU table and an Other connections section', () => {
    const md = pinoutMarkdown(robot, resolve)
    expect(md).toContain('# Line Follower — Pinouts')
    expect(md).toContain('| MCU Pin | Part | Part Pin | Net |')
    expect(md).toContain('| GP4 | Front ToF | SDA | SIGNAL |')
    expect(md).toContain('## Other connections')
    expect(md).toContain('| From | To | Net |')
  })

  it('handles a project with no connections', () => {
    const md = pinoutMarkdown({ parts: [], connections: [] }, resolve)
    expect(md).toContain('_No connections in this project yet._')
  })
})
