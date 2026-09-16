/**
 * THE IMPORT MANAGER (#1010, epic #1007).
 * =============================================================================
 *
 * Blocks say what they NEED, not where it goes. A "turn the LED on" block
 * declares `from snakie import Led` every time it emits, and this collects them,
 * removes the duplicates, and writes one tidy import section at the top — so two
 * LED blocks produce one import, and the top of the file looks like a file a
 * person wrote.
 *
 * That is the whole point of the epic in miniature. A learner who graduates to
 * Python (#1016) opens a file whose imports are already in the shape they will
 * be expected to write them in; if the blocks emitted an import per use, the
 * first thing text mode would teach is a habit to unlearn.
 *
 * ORDER is fixed rather than first-seen, because first-seen order means a file's
 * head reshuffles when you drag a block, and a mirror that reshuffles is a
 * mirror nobody reads. Four groups, blank-line separated, matching how the
 * MicroPython docs and every Snakie example are laid out:
 *
 *     import time                 ← 1. the standard library
 *
 *     from machine import Pin     ← 2. the hardware modules
 *
 *     from snakie import Led      ← 3. Snakie's own friendly API
 *
 *     from bme280 import BME280   ← 4. everything else: part and plugin drivers
 *
 * `isort`'s own convention within a group: plain `import x` before
 * `from x import y`, both alphabetical, names inside a from-import alphabetical
 * and deduplicated.
 *
 * Pure and dependency-free, so the whole ordering policy is a unit test rather
 * than something you discover by reading generated files.
 */

/** One thing a block needs in scope. */
export interface PyImport {
  /** The module: `time`, `machine`, `snakie`, `bme280`. */
  module: string
  /** For `from <module> import <name>`. Omit for a plain `import <module>`. */
  name?: string
  /**
   * Import the module under another name: `import instruments as inst` (#1014).
   *
   * Only for a module every Snakie example and doc page already aliases — the
   * generated code is meant to be the code we teach, and a learner who
   * graduates to text and opens `docs/instruments-library.md` should find the
   * same three letters in front of every call. Ignored alongside `name`, since
   * a from-import binds the names themselves.
   */
  alias?: string
}

/** The four sections, in the order they are written. */
export type ImportGroup = 'stdlib' | 'machine' | 'snakie' | 'driver'

/** MicroPython's standard library, as far as a generated program is concerned. */
const STDLIB = new Set([
  'array',
  'binascii',
  'builtins',
  'cmath',
  'collections',
  'errno',
  'gc',
  'hashlib',
  'heapq',
  'io',
  'json',
  'math',
  'os',
  'random',
  're',
  'select',
  'socket',
  'ssl',
  'struct',
  'sys',
  'time',
  'asyncio',
  'uasyncio',
  'zlib'
])

/**
 * The hardware modules. Deliberately narrow: the port modules that ARE the
 * board. A driver that happens to ship with the firmware (`dht`, `onewire`) is
 * still a driver — it is about a component you wired up, which is the
 * distinction the grouping is trying to make visible.
 */
const MACHINE = new Set(['machine', 'micropython', 'rp2', 'esp', 'esp32', 'network', 'bluetooth'])

/**
 * Snakie's OWN on-device libraries — the ones the app itself installs onto a
 * board, not drivers for something you wired up.
 *
 * `turtle` is here because of #1013: the turtle blocks generate `import turtle`,
 * and leaving it in the driver group would file Snakie's own library under
 * "everything else", below a BME280 driver. It is the same kind of thing as
 * `snakie` and `instruments` — shipped in `micropython/`, offered by the
 * install banner, versioned by us.
 */
const SNAKIE = new Set(['instruments', 'turtle'])

/** Which section an import belongs to. */
export function importGroup(module: string): ImportGroup {
  if (SNAKIE.has(module) || module === 'snakie' || module.startsWith('snakie.')) return 'snakie'
  if (STDLIB.has(module)) return 'stdlib'
  if (MACHINE.has(module)) return 'machine'
  return 'driver'
}

const GROUP_ORDER: ImportGroup[] = ['stdlib', 'machine', 'snakie', 'driver']

/**
 * Collects imports during a generation pass and renders the section.
 *
 * A fresh one per pass — it holds no state worth reusing, and a shared one would
 * accumulate imports from a workspace the user has since emptied.
 */
export class ImportManager {
  /** `module` → the names from-imported from it (empty = plain `import`) + its alias. */
  private readonly wanted = new Map<
    string,
    { names: Set<string>; plain?: boolean; alias?: string; blockId?: string }
  >()

  /**
   * Declare a need.
   *
   * `blockId` is optional and almost always absent: a palette block's imports
   * are a consequence of what it generates, not a thing the learner wrote, and
   * attributing `from snakie import Led` to whichever LED block emitted first
   * would put a highlight on a line nobody chose. The IMPORT BLOCK (#1018) is
   * the exception — its whole visible effect is that line, so it says so, and
   * #1016's hover has something to light up.
   */
  need(imp: PyImport, blockId?: string): void {
    const entry = this.wanted.get(imp.module) ?? { names: new Set<string>() }
    if (imp.name) entry.names.add(imp.name)
    // A NAMELESS need is a plain `import x`, and it is recorded separately from
    // "nobody asked for a name yet" (#1018). A learner can legitimately write
    // both `import machine` and `from machine import Pin`, and collapsing them
    // to the from-form alone would leave every `machine.` in their program
    // undefined — a NameError a long way from the block that caused it.
    else entry.plain = true
    // First alias wins, so the section can't change shape depending on which
    // block happened to emit first.
    if (imp.alias && !entry.alias) entry.alias = imp.alias
    // First claimant wins, for the same reason: a `from x import a, b` line two
    // blocks both asked for belongs to whichever asked first, deterministically.
    if (blockId && !entry.blockId) entry.blockId = blockId
    this.wanted.set(imp.module, entry)
  }

  /** Declare several at once — what a block emitter usually has to hand. */
  needAll(imports: readonly PyImport[]): void {
    for (const imp of imports) this.need(imp)
  }

  /** True when nothing has been declared (so the section is skipped entirely). */
  get empty(): boolean {
    return this.wanted.size === 0
  }

  /**
   * Every identifier these imports bind into the module namespace.
   *
   * The generator feeds this to {@link toPythonIdentifier} as `taken`, so a
   * learner's variable called "time" becomes `time_` instead of replacing the
   * module three lines above it — which fails at the NEXT use of `time.sleep`,
   * a long way from the name that caused it.
   */
  boundNames(): Set<string> {
    const out = new Set<string>()
    for (const [module, { names, plain, alias }] of this.wanted) {
      // The ALIAS is what lands in the namespace, so it is what a learner's own
      // variable must not be allowed to shadow — `inst = 3` above a loop calling
      // `inst.scope(...)` is the failure this prevents.
      if (plain) out.add(alias ?? module.split('.')[0])
      for (const n of names) out.add(n)
    }
    return out
  }

  /**
   * The import section: grouped, sorted, blank-line separated. No trailing
   * newline.
   *
   * `mark` is the generator's source-map marker (#1010), passed in rather than
   * imported so this module stays free of the generator's internals — it knows
   * about Python imports and nothing else. Absent, every line is written plain,
   * which is what the golden-file tests and any other caller want.
   */
  render(mark?: (line: string, blockId: string | undefined) => string): string {
    const sections: string[] = []
    for (const group of GROUP_ORDER) {
      const lines = this.renderGroup(group, mark)
      if (lines.length > 0) sections.push(lines.join('\n'))
    }
    return sections.join('\n\n')
  }

  private renderGroup(
    group: ImportGroup,
    mark?: (line: string, blockId: string | undefined) => string
  ): string[] {
    const plain: string[] = []
    const from: string[] = []
    const write = (line: string, blockId: string | undefined): string =>
      mark ? mark(line, blockId) : line
    for (const [module, entry] of [...this.wanted].sort(byModule)) {
      if (importGroup(module) !== group) continue
      const { names, alias, blockId } = entry
      // BOTH forms when both were asked for. They are different requests about
      // the same module and Python is perfectly happy with both lines.
      if (entry.plain) {
        plain.push(write(alias ? `import ${module} as ${alias}` : `import ${module}`, blockId))
      }
      if (names.size > 0) {
        from.push(write(`from ${module} import ${[...names].sort(byName).join(', ')}`, blockId))
      }
    }
    return [...plain, ...from]
  }
}

/** Alphabetical by module, so the section never depends on who asked first. */
const byModule = (a: [string, unknown], b: [string, unknown]): number =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0

/** Plain `localeCompare`-free ordering, so a test on one machine holds on another. */
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
