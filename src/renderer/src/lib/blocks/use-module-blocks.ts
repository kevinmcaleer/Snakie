import { useEffect, useMemo, useRef, useState } from 'react'
import { normaliseBlocksManifest } from '../../../../shared/blocks-manifest'
import { parsePyImports } from '../../components/part-imports'
import { MODULES } from '../../components/micropython-symbols'
import { CIRCUITPYTHON_MODULES } from '../../components/circuitpython-symbols'
import { inScope } from '../../../../shared/dialect-api'
import type { Dialect } from '../../../../shared/dialect'
import { apiFromCurated, type CuratedMember } from './module-api'
import { manifestForModule, moduleGroupId } from './module-blocks'
import { blockDefinitionsFrom } from './manifest'
import { defineDynamicBlocks, pruneDynamicBlocks } from './registry'
import { reportError } from '../report-error'

/**
 * BLOCKS FOR THE MODULES THIS PROGRAM IMPORTS (#1048, epic #1007).
 * =============================================================================
 *
 * A real driver program converts perfectly and offers nothing: `oled.text(…)`
 * becomes a raw Python block the learner can drag but cannot author more of.
 * This fills the **Modules** drawer from the program's own `import` lines.
 *
 * ON A CHANGE OF IMPORTS, NOT ON A KEYSTROKE. `parsePyImports` gives the import
 * set; this re-registers only when that SET changes, which is the same
 * discipline `use-dynamic-blocks.ts` applies to its own registration key. A
 * learner typing inside a function body must not churn the toolbox.
 *
 * WHICH TIER THIS IS. The issue names three sources, in order of what they buy:
 * the module's own `.py`, a board-side `dir()`, and `.mpy` metadata. This is the
 * fourth one it calls a "free win" — the curated tables that already carry kinds
 * and one-line details for ~39 modules and were wired only to Monaco. It needs
 * no file to exist, no board to be plugged in, and no parsing, and it covers
 * exactly the modules whose source we will never have: the ones frozen into the
 * firmware. The source-reading tiers land on top of it; `module-api.ts` is
 * already written and tested for them.
 *
 * SCOPE IS RESPECTED. `time.sleep_ms` is MicroPython-only, and a CircuitPython
 * board must not be offered a block for it — the tables say so per member, and
 * `inScope` is the same predicate the toolbox filter uses (#1039).
 */

/** The registry source prefix these sets live under. Pruned by this hook alone. */
export const MODULE_SOURCE_PREFIX = 'module:'

/** Every curated module, both runtimes, by name. */
function curatedMembers(module: string, dialect: Dialect): CuratedMember[] | null {
  const entry =
    MODULES.find((m) => m.name === module) ?? CIRCUITPYTHON_MODULES.find((m) => m.name === module)
  if (!entry || !inScope(entry.scope, dialect)) return null
  return (entry.members ?? [])
    .filter((m) => inScope(m.scope ?? entry.scope, dialect))
    .map((m) => ({ name: m.name, kind: m.kind, detail: m.detail }))
}

/**
 * Register a Modules drawer for `source`'s imports. Returns a nonce the canvas
 * rebuilds its toolbox on.
 */
export function useModuleBlocks(source: string, dialect: Dialect): number {
  const [nonce, setNonce] = useState(0)
  const lastKey = useRef('')

  // The SET, sorted, so `import a, b` and `import b, a` are the same key and
  // reordering imports does not churn the toolbox.
  const imports = useMemo(() => [...parsePyImports(source)].sort().join(','), [source])

  useEffect(() => {
    const key = `${dialect}|${imports}`
    if (key === lastKey.current) return
    lastKey.current = key
    try {
      const keep = new Set<string>()
      for (const module of imports ? imports.split(',') : []) {
        const members = curatedMembers(module, dialect)
        if (!members || members.length === 0) continue
        const { manifest } = normaliseBlocksManifest(manifestForModule(apiFromCurated(module, members)))
        if (manifest.blocks.length === 0) continue
        const id = moduleGroupId(module)
        keep.add(id)
        defineDynamicBlocks(
          id,
          blockDefinitionsFrom(manifest, {
            kind: 'module',
            id: module,
            name: module,
            category: 'modules'
          })
        )
      }
      // Only OUR sources: a part's blocks are not this hook's to remove, and
      // `use-dynamic-blocks.ts` says the same about ours.
      pruneDynamicBlocks(keep, MODULE_SOURCE_PREFIX)
      setNonce((n) => n + 1)
    } catch (err) {
      reportError('blocks: registering module blocks', err)
    }
  }, [imports, dialect])

  return nonce
}
