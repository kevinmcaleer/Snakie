import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { partFromYaml } from '../src/shared/part-yaml'
import { normalisePart } from '../src/renderer/src/components/part-editor.util'
import { buildNetlist } from '../src/shared/netlist'
import { partSignature } from '../src/shared/footprint-signature'
import type { PartDefinition } from '../src/shared/part'

const load = (id: string): PartDefinition =>
  normalisePart(partFromYaml(readFileSync(join(__dirname, '..', 'examples/parts/snakie-standard', id, 'parts.yml'), 'utf-8')))

/**
 * The XIAO Expansion Base reaches the XIAO's UNDERSIDE battery pads with sprung
 * pogo contacts. Nothing in the model had to change for this: seating bonds a
 * board to its carrier BY PIN NAME and doesn't care which face a pad is on, so
 * naming the carrier's contacts BAT+/BAT- is the whole implementation.
 *
 * It matters because it's the only path by which a battery on the base powers the
 * board above it — without the bond the solver thinks a docked XIAO has no supply.
 */
describe('pogo contacts bond to the seated XIAO’s battery pads', () => {
  it('BAT+/BAT- reach the XIAO through the carrier', () => {
    const base = load('seeed-xiao-expansion-base')
    const xiao = load('seeed-xiao-rp2350')
    const defs = new Map([['base1', base], ['xiao1', xiao]])
    const nl = buildNetlist(
      { parts: [{ id: 'base1', lib: 'l', part: 'b' }, { id: 'xiao1', lib: 'l', part: 'x', mountedOn: 'base1', mount: 'mount-1' }], connections: [] },
      null,
      defs
    )
    const ep = (key: string, def: PartDefinition, name: string): string => {
      const flat = (def.headers ?? []).flatMap((h) => h.pins)
      return `${key}.${name}#${flat.findIndex((p) => p.name === name)}`
    }
    for (const n of ['BAT+', 'BAT-']) {
      const a = nl.nodeOf[ep('base1', base, n)]
      const b = nl.nodeOf[ep('xiao1', xiao, n)]
      expect(a).toBeDefined()
      expect(a).toBe(b)
    }
  })

  it('pogo pins don’t change the carrier’s dock signature', () => {
    // They're carrier pins, not imprinted ones — a XIAO must still seat.
    const base = load('seeed-xiao-expansion-base')
    expect(partSignature(load('seeed-xiao-rp2350'))).toBe(partSignature(load('seeed-xiao-rp2040')))
    expect((base.mounts ?? []).length).toBe(1)
  })
})
