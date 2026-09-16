import { useEffect, useMemo, useRef, useState } from 'react'
import { normaliseBlocksManifest } from '../../../../shared/blocks-manifest'
import { parsePyImports } from '../../components/part-imports'
import { MODULES } from '../../components/micropython-symbols'
import { CIRCUITPYTHON_MODULES } from '../../components/circuitpython-symbols'
import { inScope } from '../../../../shared/dialect-api'
import type { Dialect } from '../../../../shared/dialect'
import {
  apiFromCurated,
  readModuleApi,
  type CuratedMember,
  type ModuleApi
} from './module-api'
import { findModuleSource, type ModuleSourceReaders } from './module-source'
import { memberProbeSnippet, readMemberProbe, type ProbedMembers } from './module-probe'
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
/**
 * Everything a module could offer, best tier first (#1048).
 *
 * The tiers are ordered by what they BUY, which is the issue's own ordering:
 *
 *  1. **Its source**, wherever the nearest copy is — real parameter names,
 *     real defaults, and which arguments may be omitted. Parsed, never
 *     imported.
 *  2. **The curated tables** — no file, no board, and the only tier that covers
 *     a module frozen into the firmware without a round trip.
 *  3. **The board's own `dir()`** — names and kinds but no signatures, for a C
 *     module or a `.mpy` that nothing else can describe.
 *
 * A module answered by tier 1 is not asked of tiers 2 and 3: a signature read
 * off the real file beats one inferred from a catalogue, every time.
 */
async function apiForModule(
  module: string,
  dialect: Dialect,
  readers: ModuleSourceReaders,
  probed: ProbedMembers
): Promise<ModuleApi | null> {
  const found = await findModuleSource(module, readers)
  if (found) {
    const api = readModuleApi(module, found.text)
    if (api.classes.length > 0 || api.functions.length > 0 || api.constants.length > 0) return api
  }
  const curated = curatedMembers(module, dialect)
  if (curated && curated.length > 0) return apiFromCurated(module, curated)
  const fromBoard = probed[module]
  if (fromBoard && fromBoard.length > 0) return apiFromCurated(module, fromBoard)
  return null
}

/**
 * Register a Modules drawer for `source`'s imports. Returns a nonce the canvas
 * rebuilds its toolbox on.
 */
export function useModuleBlocks(source: string, dialect: Dialect, folder?: string | null): number {
  const [nonce, setNonce] = useState(0)
  const lastKey = useRef('')

  // The SET, sorted, so `import a, b` and `import b, a` are the same key and
  // reordering imports does not churn the toolbox.
  const imports = useMemo(() => [...parsePyImports(source)].sort().join(','), [source])

  useEffect(() => {
    const key = `${dialect}|${folder ?? ''}|${imports}`
    if (key === lastKey.current) return
    lastKey.current = key
    let live = true

    const run = async (): Promise<void> => {
      const names = imports ? imports.split(',') : []
      if (names.length === 0) {
        pruneDynamicBlocks(new Set(), MODULE_SOURCE_PREFIX)
        setNonce((n) => n + 1)
        return
      }

      const readers: ModuleSourceReaders = {
        folder,
        readLocal: (path) => window.api.fs.readFile(path),
        // Only when something is CONNECTED: a read against no board is a
        // rejected promise per module per keystroke-pause, which is noise.
        readDevice: connected() ? (path) => window.api.device.readFile(path) : null,
        readBundled: (file) => window.api.modules.bundledSource(file)
      }

      // ONE round trip for the board tier, and only for what the other two
      // could not answer — asking the board about `time` when the tables
      // already describe it is a serial round trip spent on nothing.
      const unresolved: string[] = []
      for (const module of names) {
        if (await findModuleSource(module, readers)) continue
        if (curatedMembers(module, dialect)) continue
        unresolved.push(module)
      }
      const probed = unresolved.length > 0 ? await probeMembers(unresolved) : {}
      if (!live) return

      const keep = new Set<string>()
      for (const module of names) {
        const api = await apiForModule(module, dialect, readers, probed)
        if (!api) continue
        const { manifest } = normaliseBlocksManifest(manifestForModule(api))
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
      if (!live) return
      // Only OUR sources: a part's blocks are not this hook's to remove, and
      // `use-dynamic-blocks.ts` says the same about ours.
      pruneDynamicBlocks(keep, MODULE_SOURCE_PREFIX)
      setNonce((n) => n + 1)
    }

    run().catch((err) => reportError('blocks: registering module blocks', err))
    return () => {
      live = false
    }
  }, [imports, dialect, folder])

  return nonce
}

/** Is a board connected right now? Cheap, and re-read on every pass. */
function connected(): boolean {
  try {
    return Boolean(window.api?.device?.readFile)
  } catch {
    return false
  }
}

/** Ask the board about the modules nothing else could describe. Never throws. */
async function probeMembers(modules: readonly string[]): Promise<ProbedMembers> {
  const snippet = memberProbeSnippet(modules)
  if (!snippet) return {}
  try {
    const out = await window.api.device.exec(snippet)
    return readMemberProbe(`${out?.stdout ?? ''}`)
  } catch {
    // No board, a board mid-run, a board that said something odd — all of it is
    // "this tier has no answer", which is what the drawer being empty means.
    return {}
  }
}
