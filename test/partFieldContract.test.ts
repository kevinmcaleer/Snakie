import { describe, it, expect } from 'vitest'
import { partFromYaml, partToYaml } from '../src/shared/part-yaml'
import { normalisePart } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * THE PART FIELD CONTRACT — "adding a field to PartDefinition is not enough".
 * =============================================================================
 *
 * A part's fields pass through three places that each rebuild the object
 * FIELD BY FIELD, keeping only what they explicitly name:
 *
 *   1. `normalisePart`  (part-editor.util.ts) — the canonical in-memory shape
 *   2. `partToYaml`     (part-yaml.ts)        — the writer
 *   3. `partFromYaml`   (part-yaml.ts)        — the reader/coercer
 *
 * Add a field to {@link PartDefinition} and forget any one of them and the field
 * is **silently dropped on save**: no type error, no test failure, no warning —
 * the user's work just isn't there when they reopen the part. That has happened
 * repeatedly (`suggests` in #638, the electrical block in #600, `rear.imageData`
 * in #636), and every time it was a person who noticed, not the build.
 *
 * `test/partYaml.test.ts` already asserts the round-trip, but only over a
 * hand-written fixture — so a new field is unguarded until somebody remembers to
 * add it there, which is the same act of remembering that failed in the first
 * place. This file closes that loop:
 *
 *   **{@link EVERY_FIELD} is typed `Required<PartDefinition>`, so the COMPILER
 *   refuses to build until every field of the interface is populated.**
 *
 * Add a field to `PartDefinition` and `npm run typecheck` fails HERE, pointing at
 * the one place that makes you decide what it does. Populate it, and these tests
 * then check it actually survives all three sinks — naming the field that dropped
 * it rather than diffing two large objects.
 *
 * The only way to opt a field out is to name it in {@link RUNTIME_ONLY} with a
 * reason, which is a deliberate, reviewable act rather than an omission.
 */

/**
 * Every field of {@link PartDefinition}, populated with a distinctive value.
 *
 * `Required<…>` is doing the real work: this is a compile error the moment the
 * interface grows. Values just need to be VALID (they survive normalisation) and
 * distinguishable — this is a contract fixture, not a realistic part.
 */
const EVERY_FIELD: Required<PartDefinition> = {
  // --- Identity & catalogue metadata --------------------------------------
  id: 'contract-part',
  name: 'Contract Part',
  description: 'Every PartDefinition field, populated exactly once.',
  manufacturer: 'Snakie',
  family: 'Sensor',
  tags: ['contract', 'fixture'],
  package: 'SMD',
  pinSpacing: 2.54,
  voltage: '3.3V',
  partNumber: 'SNK-CONTRACT-1',
  properties: { interface: 'I²C', range: '2m' },
  version: '1.2.3',

  // --- Geometry & rendering ------------------------------------------------
  mcu: 'RP2350',
  pcbColor: '#101820',
  aspect: 1.5,
  dimensions: { width: 25, height: 17 },
  polygon: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ],
  shape: { kind: 'polygon', cornerRadius: 0.05 },

  // --- Pins, holes, buttons, decorations -----------------------------------
  headers: [
    {
      edge: 'bottom',
      pins: [
        { name: 'VIN', type: 'pwr', number: 1, x: 0.2, y: 0.9 },
        { name: 'GND', type: 'gnd', number: 2, x: 0.4, y: 0.9 },
        {
          name: 'SDA',
          type: 'io',
          gpio: 4,
          capabilities: ['i2c', 'digital'],
          number: 3,
          x: 0.6,
          y: 0.9,
          shape: 'castellated'
        },
        {
          name: 'SCL',
          type: 'io',
          gpio: 5,
          capabilities: ['i2c', 'digital'],
          number: 4,
          x: 0.8,
          y: 0.9,
          shape: 'header'
        }
      ]
    }
  ],
  mountingHoles: [{ x: 0.1, y: 0.5, diameter: 2 }],
  buttons: [{ label: 'BOOT', x: 0.85, y: 0.5 }],
  features: [{ label: 'RP2350', kind: 'mcu', x: 0.3, y: 0.3, w: 0.2, h: 0.2 }],
  shapes: [
    { kind: 'rect', x: 0.5, y: 0.55, w: 0.2, h: 0.1, fill: '#101010', label: 'U1' }
  ],
  labels: [{ text: 'CONTRACT', x: 0.5, y: 0.2, fontSize: 12 }],
  onboardLeds: [{ kind: 'single', gpio: 25, x: 0.9, y: 0.15, color: '#33ff66' }],
  connectors: [
    {
      kind: 'grove',
      variant: 'i2c',
      // Referenced by `groups` below: an unreferenced group is legitimately
      // pruned, so the group field has to be exercised through a real member.
      group: 'grove-port',
      x: 0.15,
      y: 0.5,
      pins: [
        { name: 'GND', type: 'gnd', x: 0.1, y: 0.4 },
        { name: 'VCC', type: 'pwr', x: 0.1, y: 0.47 },
        { name: 'SDA', type: 'io', capabilities: ['i2c'], x: 0.1, y: 0.54 },
        { name: 'SCL', type: 'io', capabilities: ['i2c'], x: 0.1, y: 0.61 }
      ]
    }
  ],
  footprint: 'xiao',
  mounts: [{ id: 'top-socket', footprint: 'xiao', x: 0.5, y: 0.5 }],
  rails: [{ name: 'V+', pins: ['VIN', 'GND'] }],
  groups: [{ id: 'grove-port', name: 'Grove port', housing: { kind: 'grove', variant: 'i2c', x: 0.15, y: 0.5, rotation: 90 } }],
  ledLabel: 'LED',

  // --- Assets --------------------------------------------------------------
  image: 'image.png',
  imageData: 'data:image/png;base64,iVBORw0KGgo=', // runtime-only — see RUNTIME_ONLY
  imageLayer: { x: 0.1, y: 0.1, w: 0.8, h: 0.8, opacity: 0.9, rotation: 90 },
  rear: {
    image: 'rear.webp',
    imageData: 'data:image/webp;base64,UklGRg==', // runtime-only, like the front's
    imageLayer: { x: 0, y: 0, w: 1, h: 1 }
  },

  // --- Bundled help --------------------------------------------------------
  help: 'help.md',
  helpText: '# Contract Part\n', // runtime-only — see RUNTIME_ONLY

  // --- Concurrency stamp ---------------------------------------------------
  sourceHash: 'e3b0c44298fc1c149afbf4c8996fb924', // runtime-only — see RUNTIME_ONLY

  // --- Schematic -----------------------------------------------------------
  schematic: { aspect: 1, pins: [{ pin: 'SDA', side: 'left', order: 0 }] },

  // --- I²C identity --------------------------------------------------------
  i2cAddresses: [0x29],

  // --- Code library / drivers ----------------------------------------------
  library: { module: 'contract', url: 'github:snakie/contract', docs: 'https://example.com' },
  drivers: [{ source: 'contract.py', target: 'lib/contract.py', label: 'Contract driver' }],
  suggests: [{ module: 'ssd1306', unlocks: 'the 0.96" OLED' }],

  // --- 3-D mesh ------------------------------------------------------------
  mesh: 'model.stl',
  meshUnits: 'mm',
  meshScale: 0.001,

  // --- Mass / centre of mass / contacts ------------------------------------
  mass_g: 9,
  com_xyz: [1, 2, 3],
  contacts: [[0, 0, -5]],

  // --- Circuit sim ---------------------------------------------------------
  electrical: { model: 'consumer', currentDrawA: 0.02, maxCurrentA: 0.05, supplyRange: [2.8, 5], operatingV: [3, 5.5] },

  // --- Editor display state ------------------------------------------------
  layerVisibility: { pcb: true, image: false, holes: true, pins: true, components: true }
}

/**
 * Fields that deliberately do NOT reach `parts.yml`, each with its reason.
 *
 * Being on this list is a decision, not an oversight — and the tests below hold
 * these to the opposite standard (they must be ABSENT after the round-trip), so
 * a field can't be parked here to silence a failure without that being visible.
 */
const RUNTIME_ONLY: Partial<Record<keyof PartDefinition, string>> = {
  imageData:
    'inlined by the main process on read; parts.yml keeps the relative `image` filename',
  helpText: 'inlined by the main process on read; parts.yml keeps the relative `help` filename',
  sourceHash:
    'a hash of the parts.yml text the part was READ from (#750) — file identity, not part content. Writing it would change the very bytes it stamps.'
}

const ALL_FIELDS = Object.keys(EVERY_FIELD) as (keyof PartDefinition)[]
const PERSISTED = ALL_FIELDS.filter((k) => !(k in RUNTIME_ONLY))
const RUNTIME_KEYS = Object.keys(RUNTIME_ONLY) as (keyof PartDefinition)[]

/** The canonical shape, and what comes back after a save + reload. */
const canonical = normalisePart(EVERY_FIELD)
const reloaded = partFromYaml(partToYaml(canonical))

describe('PartDefinition field contract', () => {
  it('populates every field of the interface (the compiler enforces this)', () => {
    // A tripwire for the fixture itself: `Required<PartDefinition>` is checked at
    // compile time, so this only guards against the fixture being gutted at
    // runtime. The count is deliberately a lower bound, not an exact match — it
    // should never need touching when a field is added.
    expect(ALL_FIELDS.length).toBeGreaterThan(40)
  })

  // The sink that has actually dropped fields in production. A field missing from
  // `normalisePart`'s rebuild vanishes the moment the editor touches the part —
  // before YAML is even involved.
  it.each(PERSISTED)('normalisePart keeps `%s`', (field) => {
    expect(canonical[field]).toBeDefined()
  })

  // The writer + reader pair. Missing from either and the field survives the
  // session but not the save.
  it.each(PERSISTED)('parts.yml round-trips `%s`', (field) => {
    expect(reloaded[field]).toEqual(canonical[field])
  })

  // The other half of the contract: an opt-out has to be real.
  it.each(RUNTIME_KEYS)('drops runtime-only `%s`', (field) => {
    expect(canonical[field]).toBeUndefined()
    expect(reloaded[field]).toBeUndefined()
  })
})

/**
 * `rear` is a nested object with the SAME runtime-only split as the top level
 * (#636), and its `imageData` was dropped for exactly this reason. A top-level
 * `toBeDefined()` on `rear` would pass with an empty-ish object, so its fields
 * are pinned individually.
 */
describe('PartRear field contract', () => {
  it('keeps the rear photo filename and its layer', () => {
    expect(canonical.rear?.image).toBe('rear.webp')
    expect(reloaded.rear?.image).toBe('rear.webp')
    expect(reloaded.rear?.imageLayer).toEqual(canonical.rear?.imageLayer)
  })

  it('drops the rear runtime-only imageData, like the front', () => {
    expect(canonical.rear?.imageData).toBeUndefined()
    expect(reloaded.rear?.imageData).toBeUndefined()
  })
})
