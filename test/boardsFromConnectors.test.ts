import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { partFromYaml } from '../src/shared/part-yaml'
import {
  boardPartFor,
  boardsFromLibraries,
  partToBoardDefinition
} from '../src/renderer/src/components/part-editor.util'
import { enumerateBoardPads } from '../src/renderer/src/components/board-layout'

/**
 * #818 — a board whose I/O is CONNECTORS, not header rails.
 *
 * The Cytron Maker Pi RP2040 has 48 pins and not one of them is on a header —
 * they are all Grove sockets, servo ports and screw terminals. `boardsFromLibraries`
 * counted pads from `headers` alone, found zero, and dropped the board entirely:
 * a `family: Microcontroller` part with a full pinout that never appeared in the
 * MCU picker in either the Code or Electronics workspace.
 *
 * `boardPinsFromPart` (board-pin-check.ts) had always unioned headers and
 * connectors. This is the same union for the Board View — the two halves of the
 * codebase disagreeing about whether a connector pin is a pin is what caused it.
 */
function part(id: string) {
  return partFromYaml(readFileSync(`examples/parts/snakie-standard/${id}/parts.yml`, 'utf-8'))
}

describe('a connector-only board reaches the picker', () => {
  it('is listed, where it used to vanish', () => {
    const p = part('cytron-maker-pi-rp2040')
    expect((p.headers ?? []).reduce((n, h) => n + (h.pins?.length ?? 0), 0)).toBe(0)
    const ids = boardsFromLibraries([{ parts: [p] }]).map((b) => b.id)
    expect(ids).toContain('cytron-maker-pi-rp2040')
  })

  it('projects every connector pin into a pad', () => {
    const p = part('cytron-maker-pi-rp2040')
    const connectorPins = (p.connectors ?? []).reduce((n, c) => n + (c.pins?.length ?? 0), 0)
    const def = partToBoardDefinition(p)
    expect(def.headers.reduce((n, h) => n + h.pins.length, 0)).toBe(connectorPins)
  })

  it('carries the GPIO and the declared I²C role through', () => {
    const def = partToBoardDefinition(part('cytron-maker-pi-rp2040'))
    const pads = def.headers.flatMap((h) => h.pins)
    // GP26 is on BOTH Grove 5 and Grove 6 on this board, so 21 GPIOs, 22 pads.
    expect(pads.filter((x) => typeof x.gpio === 'number')).toHaveLength(22)
    const gp0 = pads.find((x) => x.gpio === 0)
    expect(gp0?.i2c).toBe('SDA')
    expect(gp0?.i2cBus).toBe(0)
  })

  it('spreads a socket’s contacts instead of stacking them on one point', () => {
    // Co-located pads cannot be told apart in the wiring canvas.
    const def = partToBoardDefinition(part('cytron-maker-pi-rp2040'))
    const grove = def.headers.find((h) => h.pins.some((p) => p.name === 'GP3'))
    const xs = new Set(grove?.pins.map((p) => p.x))
    expect(xs.size).toBe(grove?.pins.length)
  })

  it('finds the source part, so the life-like view can draw the real board', () => {
    const p = part('cytron-maker-pi-rp2040')
    expect(boardPartFor([{ parts: [p] }], 'cytron-maker-pi-rp2040')?.id).toBe(
      'cytron-maker-pi-rp2040'
    )
  })
})

describe('boards that already had headers keep their wiring endpoints', () => {
  // `enumerateBoardPads` is the source of truth for the `board.*#index` wiring
  // endpoint. Connector pads are APPENDED, so every previously-saved wire on
  // these three still resolves to the same physical pad.
  for (const [id, headerPads] of [
    ['adafruit-qt-py-rp2040', 14],
    ['motor2040', 20],
    ['servo2040', 92]
  ] as const) {
    it(id, () => {
      const p = part(id)
      const before = (p.headers ?? []).flatMap((h) => h.pins ?? [])
      expect(before).toHaveLength(headerPads)
      const pads = enumerateBoardPads(partToBoardDefinition(p))
      for (let i = 0; i < headerPads; i++) {
        expect(pads[i].pad.name, `${id} index ${i} moved`).toBe(before[i].name)
      }
      // ...and it gained its Qwiic contacts rather than losing them.
      expect(pads.length).toBeGreaterThan(headerPads)
    })
  }
})
