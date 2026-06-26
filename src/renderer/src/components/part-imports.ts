/**
 * Part import requirements (#166) — pure helpers backing the "your code is missing
 * imports / libraries for the connected parts" check.
 *
 * A project's `robot.yml` lists placed parts; a part may link a MicroPython library
 * (`library.module` + url/docs). When the board connects or a `.py` file is opened
 * we cross-check those required modules against (a) the file's `import`s and (b)
 * what's installed on the board, and surface a banner. All DOM-free + unit-tested.
 */
import type { RobotDefinition } from '../../../shared/robot'
import type { PartDefinition } from '../../../shared/part'

/** A library module the project's parts need, with where to get it + which parts. */
export interface RequiredModule {
  module: string
  url?: string
  docs?: string
  /** Part labels that need this module (for the banner copy). */
  parts: string[]
}

/** Top-level module names a Python source file imports (best-effort, line-based). */
export function parsePyImports(source: string): Set<string> {
  const mods = new Set<string>()
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    let m = /^from\s+([.\w]+)\s+import\b/.exec(line)
    if (m) {
      const mod = m[1].replace(/^\.+/, '').split('.')[0]
      if (mod) mods.add(mod)
      continue
    }
    m = /^import\s+(.+)$/.exec(line)
    if (m) {
      // `import a, b.c as d` → a, b
      for (const part of m[1].split(',')) {
        const name = part
          .trim()
          .split(/\s+as\s+/)[0]
          .trim()
          .split('.')[0]
        if (name) mods.add(name)
      }
    }
  }
  return mods
}

/** The library modules the project's placed parts need (deduped by module). */
export function requiredPartModules(
  robot: RobotDefinition,
  libraries: { id: string; parts: PartDefinition[] }[]
): RequiredModule[] {
  const byModule = new Map<string, RequiredModule>()
  for (const ref of robot.parts ?? []) {
    const lib = libraries.find((l) => l.id === ref.lib)
    const part = lib?.parts.find((p) => p.id === ref.part)
    const mod = part?.library?.module?.trim()
    if (!mod) continue
    const label = ref.label || part?.name || ref.part
    const existing = byModule.get(mod)
    if (existing) {
      if (!existing.parts.includes(label)) existing.parts.push(label)
    } else {
      byModule.set(mod, { module: mod, url: part?.library?.url, docs: part?.library?.docs, parts: [label] })
    }
  }
  return [...byModule.values()]
}

/** The required modules NOT imported by `source`. */
export function missingImports(required: RequiredModule[], source: string): RequiredModule[] {
  const imported = parsePyImports(source)
  return required.filter((r) => !imported.has(r.module))
}

/** The required modules NOT importable on the board (given the probed-present set). */
export function missingOnBoard(required: RequiredModule[], installed: Set<string>): RequiredModule[] {
  return required.filter((r) => !installed.has(r.module))
}
