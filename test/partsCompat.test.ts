import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { partFromYaml, partToYaml } from '../src/shared/part-yaml'
import { normalisePart, allConnectors } from '../src/renderer/src/components/part-editor.util'
import { flattenPartPins } from '../src/shared/netlist'

/**
 * COMPATIBILITY WITH THE PUBLISHED FORMAT (#674).
 *
 * `parts.yml` is published: community libraries and app.snakie.org already carry
 * `connectors:` blocks. Read support for that shape is PERMANENT — not a
 * migration window — so this walks every bundled part and asserts the old shape
 * still loads, still round-trips, and still presents its connectors.
 *
 * It also guards the property that makes any future conversion safe: a wiring
 * endpoint is `<key>.<name>#<index>` where the FLATTENED index is authoritative,
 * so the flattened pin order must survive a load/save cycle exactly.
 */
const ROOT = 'examples/parts/snakie-standard'
const IDS = readdirSync(ROOT).filter((d) => existsSync(join(ROOT, d, 'parts.yml')))
const load = (id: string): ReturnType<typeof partFromYaml> =>
  partFromYaml(readFileSync(join(ROOT, id, 'parts.yml'), 'utf8'))

describe('every bundled part loads (#674)', () => {
  it('finds the library', () => {
    expect(IDS.length).toBeGreaterThan(30)
  })

  it.each(IDS)('%s parses and keeps its pins', (id) => {
    const part = load(id)
    expect(part.id).toBeTruthy()
    expect(flattenPartPins(part).length).toBeGreaterThan(0)
  })

  it.each(IDS)('%s survives a save/load cycle with its pin ORDER intact', (id) => {
    // The flattened order is the wiring endpoint index — user data.
    const part = load(id)
    const back = partFromYaml(partToYaml(normalisePart(part)))
    expect(flattenPartPins(back).map((p) => p.name)).toEqual(flattenPartPins(part).map((p) => p.name))
  })
})

describe('the old connectors[] shape still works (#674)', () => {
  const withConnectors = IDS.filter((id) => (load(id).connectors ?? []).length > 0)

  it('is still in use across the bundled library', () => {
    expect(withConnectors.length).toBeGreaterThan(5)
  })

  it.each(withConnectors)('%s still presents its connectors', (id) => {
    const part = load(id)
    expect(allConnectors(part).length).toBeGreaterThanOrEqual(part.connectors!.length)
    for (const c of allConnectors(part)) expect(c.pins.length).toBeGreaterThan(0)
  })
})
