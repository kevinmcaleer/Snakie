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

/** Which section an import belongs to. */
export function importGroup(module: string): ImportGroup {
  if (module === 'snakie' || module.startsWith('snakie.')) return 'snakie'
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
  /** `module` → the names from-imported from it (empty = plain `import`). */
  private readonly wanted = new Map<string, Set<string>>()

  /** Declare a need. Calling it twice with the same thing is the normal case. */
  need(imp: PyImport): void {
    const names = this.wanted.get(imp.module) ?? new Set<string>()
    if (imp.name) names.add(imp.name)
    this.wanted.set(imp.module, names)
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
    for (const [module, names] of this.wanted) {
      if (names.size === 0) out.add(module.split('.')[0])
      for (const n of names) out.add(n)
    }
    return out
  }

  /** The import section: grouped, sorted, blank-line separated. No trailing newline. */
  render(): string {
    const sections: string[] = []
    for (const group of GROUP_ORDER) {
      const lines = this.renderGroup(group)
      if (lines.length > 0) sections.push(lines.join('\n'))
    }
    return sections.join('\n\n')
  }

  private renderGroup(group: ImportGroup): string[] {
    const plain: string[] = []
    const from: string[] = []
    for (const [module, names] of [...this.wanted].sort(byModule)) {
      if (importGroup(module) !== group) continue
      if (names.size === 0) plain.push(`import ${module}`)
      else from.push(`from ${module} import ${[...names].sort(byName).join(', ')}`)
    }
    return [...plain, ...from]
  }
}

/** Alphabetical by module, so the section never depends on who asked first. */
const byModule = (a: [string, unknown], b: [string, unknown]): number =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0

/** Plain `localeCompare`-free ordering, so a test on one machine holds on another. */
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
