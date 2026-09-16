import {
  BLOCKS_MANIFEST_VERSION,
  type BlocksManifest,
  type ManifestBlock
} from '../../../../shared/blocks-manifest'
import type { PartDefinition, PartPin } from '../../../../shared/part'
import type { RobotDefinition, RobotPart } from '../../../../shared/robot'
import type { BlockSource } from './manifest'

/**
 * BLOCKS FOLLOW YOUR CIRCUIT (#1017, epic #1007).
 * =============================================================================
 *
 * Wire a BME280 up in Electronics and BME280 blocks are waiting for you in
 * Blocks — with the pins it is ACTUALLY wired to already in them. This is the
 * feature that sells the epic, and the reason it is possible at all is that
 * Snakie has known a part's driver, pins and buses since #129: `robot.yml` says
 * what is on the breadboard and what it is joined to, and `parts.yml` says what
 * each of those pins MEANS. Nothing here is new information — it is the join.
 *
 * TWO WAYS A PART GETS BLOCKS, and the second is the one that matters.
 *
 *  1. It ships a `blocks.yml`. Then those are its blocks, exactly as written,
 *     and this module's only job is to hand the wiring in.
 *  2. It ships nothing. Then blocks are DERIVED — an import, a constructor built
 *     from the pins and buses we can see, and a way to call a method on it.
 *     Rough, but never nothing, which is the whole point: a library of hundreds
 *     of parts cannot wait for someone to hand-write a palette entry each.
 *
 * THE HONEST LIMIT, stated on the block rather than hidden in a doc. We know the
 * part's MODULE (`parts.yml` says `library: {module: vl53l0x}`); we do not know
 * its class, and we cannot know its methods without reading and parsing a Python
 * file we may not even have yet. So the derived constructor puts its guess — the
 * conventional upper-cased module name, right far more often than not — in an
 * EDITABLE FIELD on the face of the block, and the method blocks take the method
 * name the same way. A learner whose sensor is `VL53L0X` never notices; one
 * whose driver calls it `Sensor` can see what is wrong and fix it without
 * leaving the canvas. A guess you can see and correct is a different thing from
 * a guess that fails silently on the board.
 */

/** The bus/pin roles a derived constructor can fill in from real wiring. */
export interface PartWiring {
  /** GPIO numbers by role: `SDA`, `SCL`, `SCK`, `MOSI`, `MISO`, `CS`, `TX`, `RX`. */
  pins: Record<string, number>
  /** The bus instance number the part's pins declare (I²C0 vs I²C1), if any. */
  i2cBus?: number
  spiBus?: number
  /** The single signal pin, for a part wired to one GPIO (an LED, a buzzer). */
  signal?: number
}

/** One part on the breadboard, resolved and ready to contribute blocks. */
export interface PlacedPartBlocks {
  source: BlockSource
  manifest: BlocksManifest
  /** Anything its `blocks.yml` said that we could not honour. */
  warnings: string[]
  /** True when the manifest was derived rather than shipped. */
  derived: boolean
}

/**
 * The board pin label → GPIO map a wiring lookup needs.
 *
 * Passed in rather than read from `board-pins.ts` so this module stays pure and
 * the tests can wire an imaginary board without a canvas.
 */
export type BoardPinLookup = (label: string) => number | undefined

/**
 * Which GPIOs each of a placed part's signal pins is joined to.
 *
 * Only BOARD connections count. A part wired to another part is a real circuit
 * and a real thing to draw, but it is not something a constructor can take an
 * argument for, and quietly treating the far end's pin number as a GPIO would
 * produce code that addresses the wrong hardware.
 */
export function wiringFor(
  robot: RobotDefinition | null | undefined,
  instance: RobotPart,
  part: PartDefinition,
  boardPin: BoardPinLookup
): PartWiring {
  const byName = new Map<string, PartPin>()
  for (const header of part.headers ?? []) {
    for (const pin of header.pins ?? []) byName.set(pin.name, pin)
  }
  const out: PartWiring = { pins: {} }
  const signals: number[] = []

  for (const conn of robot?.connections ?? []) {
    for (const [near, far] of [
      [conn.from, conn.to],
      [conn.to, conn.from]
    ]) {
      const prefix = `${instance.id}.`
      if (!near.startsWith(prefix)) continue
      if (!far.startsWith('board.')) continue
      const gpio = boardPin(far.slice('board.'.length))
      if (gpio === undefined) continue
      const pin = byName.get(near.slice(prefix.length))
      if (!pin || pin.type === 'pwr' || pin.type === 'gnd') continue

      const role = roleOf(pin)
      // FIRST WIRE WINS. A pin joined twice is unusual but legal (a shared bus
      // fanned out), and overwriting would make the generated constructor depend
      // on the order wires happen to sit in the file.
      if (role && out.pins[role] === undefined) out.pins[role] = gpio
      if (!role) signals.push(gpio)
      if (pin.buses?.i2c !== undefined && out.i2cBus === undefined) out.i2cBus = pin.buses.i2c
      if (pin.buses?.spi !== undefined && out.spiBus === undefined) out.spiBus = pin.buses.spi
    }
  }
  // One plain signal pin is the common case for an LED, a buzzer, a button — and
  // is the thing a derived constructor passes when there is no bus.
  if (signals.length > 0) out.signal = Math.min(...signals)
  else if (out.pins.SDA === undefined && out.pins.SCK === undefined) {
    const first = Object.values(out.pins)[0]
    if (first !== undefined) out.signal = first
  }
  return out
}

/** The bus role a part pin plays, or null for a plain signal pin. */
function roleOf(pin: PartPin): string | null {
  if (pin.signals?.i2c) return pin.signals.i2c // SDA | SCL
  if (pin.signals?.spi) {
    // `parts.yml` speaks the RP2 datasheet's names; the drivers speak the
    // ones every MicroPython example uses, and a manifest author writes the
    // second kind.
    const spi = pin.signals.spi
    if (spi === 'TX') return 'MOSI'
    if (spi === 'RX') return 'MISO'
    if (spi === 'CSn') return 'CS'
    return 'SCK'
  }
  if (pin.signals?.uart) return pin.signals.uart // TX | RX
  return null
}

/**
 * The conventional class name for a module — `vl53l0x` → `VL53L0X`.
 *
 * A guess, and labelled as one everywhere it surfaces. It is right for the large
 * majority of MicroPython drivers, which name the class after the chip in the
 * module named after the chip, and where it is wrong the learner can see the
 * wrong name written on the block.
 */
export function guessClassName(module: string): string {
  const tail = String(module).split(/[./]/).pop() ?? ''
  if (!tail) return 'Sensor'
  // A name that is already mixed-case is somebody's considered choice
  // (`ssd1306` is not, `BME280` would be) — leave it alone.
  if (/[a-z]/.test(tail) && /[A-Z]/.test(tail)) return tail
  return tail.toUpperCase()
}

/**
 * The constructor call a part's wiring implies, as a template.
 *
 * The three cases are the three ways a beginner's part is ever attached, and
 * each produces the code a Snakie lesson would have written by hand.
 */
function constructorExpr(wiring: PartWiring): { expr: string; imports: { module: string; name?: string }[] } {
  const { pins } = wiring
  if (pins.SDA !== undefined && pins.SCL !== undefined) {
    return {
      expr: `{CLASS}(I2C(${wiring.i2cBus ?? 0}, sda=Pin(${pins.SDA}), scl=Pin(${pins.SCL})))`,
      imports: [
        { module: 'machine', name: 'I2C' },
        { module: 'machine', name: 'Pin' }
      ]
    }
  }
  if (pins.SCK !== undefined) {
    const parts = [`${wiring.spiBus ?? 0}`, `sck=Pin(${pins.SCK})`]
    if (pins.MOSI !== undefined) parts.push(`mosi=Pin(${pins.MOSI})`)
    if (pins.MISO !== undefined) parts.push(`miso=Pin(${pins.MISO})`)
    const spi = `SPI(${parts.join(', ')})`
    return {
      expr:
        pins.CS !== undefined
          ? `{CLASS}(${spi}, Pin(${pins.CS}, Pin.OUT))`
          : `{CLASS}(${spi})`,
      imports: [
        { module: 'machine', name: 'SPI' },
        { module: 'machine', name: 'Pin' }
      ]
    }
  }
  if (wiring.signal !== undefined) {
    return {
      expr: `{CLASS}(Pin(${wiring.signal}))`,
      imports: [{ module: 'machine', name: 'Pin' }]
    }
  }
  // Nothing wired yet. Still a real block — it constructs with no arguments,
  // which is what a part with its own defaults wants anyway, and the learner
  // sees the shape before the wires exist.
  return { expr: '{CLASS}()', imports: [] }
}

/**
 * The blocks a part gets when it ships no manifest of its own.
 *
 * Three of them, and the set is chosen so that every one is CORRECT PYTHON
 * whatever the driver turns out to be called: construct it, call something on
 * it, read something from it. `#1018`'s escape hatches generalise the last two
 * to any object; these are the same idea scoped to one part, with its wiring
 * already filled in.
 */
export function derivedManifestFor(part: PartDefinition, wiring: PartWiring): BlocksManifest {
  const module = moduleOf(part)
  if (!module) return { version: BLOCKS_MANIFEST_VERSION, blocks: [] }
  const name = part.name || part.id
  const guess = guessClassName(module)
  const ctor = constructorExpr(wiring)
  const imports = [{ module }, ...ctor.imports]
  // The module is imported plainly and the class taken off it, rather than
  // `from <module> import <Class>`: the class name is a GUESS, and a wrong
  // from-import fails at IMPORT time, before the program has done anything,
  // naming a line the learner did not write. A wrong attribute fails on the line
  // that uses it, with the name they can see on the block in the traceback.
  const setupExpr = ctor.expr.replace('{CLASS}', `${module}.{CLASS}`)

  // ONE block constructs, and the other two take it as an argument. The
  // alternative — a class field on all three — lets a learner set two different
  // classes for what is meant to be one object, and the generator would then
  // hoist whichever emitted first. Composition makes that unsayable, and the
  // shadow means they never have to assemble it by hand.
  const blocks: ManifestBlock[] = [
    {
      id: 'object',
      message: `the ${name} (class %1)`,
      shape: 'value',
      args: [{ name: 'CLASS', kind: 'text-field', default: guess }],
      setup: { key: `part:${part.id}:{CLASS}`, name: objectName(part), expr: setupExpr },
      code: '{SETUP}',
      imports,
      tooltip: `The ${name} itself, set up from the pins it is wired to. If its driver calls the class something other than ${guess}, type that name here.`
    },
    {
      id: 'call',
      message: 'do %1 on %2 with %3',
      shape: 'statement',
      args: [
        { name: 'METHOD', kind: 'text-field', default: 'update' },
        { name: 'OBJ', kind: 'any', shadow: 'object' },
        // Empty means NO argument, not `None`: `sensor.update()` is what a
        // no-argument command has to generate, and passing `None` to one is a
        // TypeError on the board.
        { name: 'ARG', kind: 'any', default: '' }
      ],
      code: '{OBJ}.{METHOD}({ARG})',
      tooltip: `Run one of the ${name}'s commands. Leave the last socket empty for a command that takes nothing.`
    },
    {
      id: 'read',
      message: '%1 of %2',
      shape: 'value',
      args: [
        { name: 'METHOD', kind: 'text-field', default: 'read' },
        { name: 'OBJ', kind: 'any', shadow: 'object' }
      ],
      code: '{OBJ}.{METHOD}()',
      tooltip: `Read a value from the ${name}. The name of the reading comes from its driver — check the part's help page.`
    }
  ]
  return { version: BLOCKS_MANIFEST_VERSION, blocks }
}

/** A readable variable name for the part's hoisted object. */
function objectName(part: PartDefinition): string {
  return (part.id || 'part').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'part'
}

/** The MicroPython module a part's code lives in, if it names one. */
export function moduleOf(part: PartDefinition): string | null {
  const declared = part.library?.module?.trim()
  if (declared) return declared
  // A part with no `library` but a copied driver file still tells us its module:
  // `lib/vl53l0x.py` is `import vl53l0x`.
  for (const driver of part.drivers ?? []) {
    const target = String(driver.target ?? '')
    const match = /([A-Za-z_][A-Za-z0-9_]*)\.m?py$/.exec(target)
    if (match) return match[1]
  }
  return null
}

/**
 * Every placed part that can contribute blocks, in `robot.yml` order.
 *
 * Deduplicated by `<lib>:<part>`, like the driver banner: two of the same sensor
 * are two objects on the breadboard but one drawer in the toolbox. The FIRST
 * instance's wiring is the one the blocks carry — a choice, and the right one,
 * because the alternative is a drawer per instance and a toolbox that grows with
 * the size of the robot.
 */
export function placedPartBlocks(
  robot: RobotDefinition | null | undefined,
  libraries: readonly { id: string; parts?: PartDefinition[] }[],
  boardPin: BoardPinLookup,
  parseManifest: (text: string) => { manifest: BlocksManifest; warnings: string[] }
): PlacedPartBlocks[] {
  const out: PlacedPartBlocks[] = []
  const seen = new Set<string>()
  for (const instance of robot?.parts ?? []) {
    const key = `${instance.lib}:${instance.part}`
    if (seen.has(key)) continue
    const part = libraries
      .find((l) => l.id === instance.lib)
      ?.parts?.find((p) => p.id === instance.part)
    if (!part) continue
    seen.add(key)

    const wiring = wiringFor(robot, instance, part, boardPin)
    const source: BlockSource = {
      kind: 'part',
      id: `${instance.lib}.${instance.part}`,
      name: part.name || instance.label || instance.part,
      category: 'parts',
      part: { libraryId: instance.lib, partId: instance.part }
    }

    const declared = part.blocksYaml?.trim()
    if (declared) {
      let parsed: { manifest: BlocksManifest; warnings: string[] }
      try {
        parsed = parseManifest(declared)
      } catch (err) {
        // Unreadable YAML is the part author's mistake, and falling back to the
        // derived set means the learner still gets blocks rather than an empty
        // drawer and no explanation.
        const wiredFallback = derivedManifestFor(part, wiring)
        out.push({
          source,
          manifest: wiredFallback,
          warnings: [`${part.name || part.id}: blocks.yml could not be read (${(err as Error).message})`],
          derived: true
        })
        continue
      }
      if (parsed.manifest.blocks.length > 0) {
        out.push({ source, manifest: withWiring(parsed.manifest, wiring), warnings: parsed.warnings, derived: false })
        continue
      }
      // A manifest every one of whose blocks was dropped is worse than none:
      // derive, and keep the warnings so the reason is still findable.
      out.push({ source, manifest: derivedManifestFor(part, wiring), warnings: parsed.warnings, derived: true })
      continue
    }

    const manifest = derivedManifestFor(part, wiring)
    if (manifest.blocks.length === 0) continue
    out.push({ source, manifest, warnings: [], derived: true })
  }
  return out
}

/**
 * Pre-fill a SHIPPED manifest's pin arguments from the real circuit.
 *
 * A `blocks.yml` written by a part author cannot know which GPIO you chose, so
 * it declares `kind: pin, name: SDA` and this puts your SDA in it. The author's
 * own default is the fallback, for a part that is in the library but not yet on
 * the breadboard.
 *
 * It only ever changes a DEFAULT. A learner who picks a different pin keeps it —
 * the wiring seeds the block, it does not own it.
 */
function withWiring(manifest: BlocksManifest, wiring: PartWiring): BlocksManifest {
  const lookup = (name: string, kind: string): number | undefined => {
    const upper = name.toUpperCase()
    // A numeric field called BUS means "which I²C/SPI controller" — the other
    // half of a constructor, and the half that is wrong most often, because the
    // bus a pin belongs to is a fact about the BOARD that a beginner has no way
    // to look up. The part's own pins declare it.
    if (upper === 'BUS' && kind !== 'pin') return wiring.i2cBus ?? wiring.spiBus
    if (kind !== 'pin') return undefined
    if (wiring.pins[upper] !== undefined) return wiring.pins[upper]
    if (upper === 'PIN' || upper === 'SIGNAL') return wiring.signal
    return undefined
  }
  return {
    ...manifest,
    blocks: manifest.blocks.map((block) => ({
      ...block,
      args: block.args?.map((arg) => {
        if (arg.kind !== 'pin' && arg.kind !== 'number-field' && arg.kind !== 'number') return arg
        const wired = lookup(arg.name, arg.kind)
        return wired === undefined ? arg : { ...arg, default: wired }
      })
    }))
  }
}
