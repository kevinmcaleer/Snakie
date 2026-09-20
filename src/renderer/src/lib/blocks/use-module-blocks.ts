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
import {
  manifestForModule,
  moduleGroupId,
  objectRulesForModule,
  readRulesForModule
} from './module-blocks'
import { blockDefinitionsFrom, blockTypeFor, type BlockSource } from './manifest'
import { defineDynamicBlocks, pruneDynamicBlocks } from './registry'
import {
  pruneDynamicCallRules,
  pruneDynamicObjectRules,
  registerDynamicCallRules,
  registerDynamicObjectRules
} from './python-to-blocks'
import { baseName, moduleNamesFrom, onModuleScan } from './module-scan'
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

/** What the Blocks view needs to know about the module palette. */
export interface ModuleBlocks {
  /** Bumped whenever the registered set changes; the canvas rebuilds on it. */
  nonce: number
  /**
   * TRUE ONCE THE MODULES HAVE BEEN LOOKED FOR (#1252).
   *
   * Finding a module means reading files — beside the program, and over the
   * serial link from `/lib` on the board — so for the first frames of a file's
   * life the Modules drawer is empty whether or not `range_finder.py` is
   * sitting on the device. A file built from that module's blocks is
   * indistinguishable, in those frames, from one whose module is nowhere, and
   * concluding the second is how a perfectly readable program got told its
   * blocks were missing. So nothing concludes anything until this is true.
   */
  settled: boolean
}

/**
 * Register a Modules drawer for `source`'s imports. Returns a nonce the canvas
 * rebuilds its toolbox on, and whether the search has finished at least once.
 */
export function useModuleBlocks(
  source: string,
  dialect: Dialect,
  folder?: string | null,
  /** The program's own file, which a scan must not offer as a module. */
  filePath?: string | null
): ModuleBlocks {
  const [nonce, setNonce] = useState(0)
  // False while a pass is in flight — including the very first one, before
  // which we have not so much as looked at the board.
  const [settled, setSettled] = useState(false)
  const lastKey = useRef('')

  // WHAT A SCAN FOUND (#1048's button), kept beside the folder it was found
  // for: opening another project is a different set of files, and a stale
  // list of drawers from the last one would be the wrong answer to the button.
  const [scanned, setScanned] = useState<{ folder: string | null; names: string[] }>({
    folder: null,
    names: []
  })
  useEffect(
    () =>
      onModuleScan(() => {
        scanModules(folder ?? null, filePath ?? null)
          .then((names) => setScanned({ folder: folder ?? null, names }))
          .catch((err) => reportError('blocks: scanning for modules', err))
      }),
    [folder, filePath]
  )

  // The SET, sorted, so `import a, b` and `import b, a` are the same key and
  // reordering imports does not churn the toolbox. What a scan found joins
  // the program's own imports, so a drawer opened by the button stays open
  // once the learner drags a block out and the import line arrives.
  const imports = useMemo(() => {
    const found = scanned.folder === (folder ?? null) ? scanned.names : []
    return [...new Set([...parsePyImports(source), ...found])].sort().join(',')
  }, [source, scanned, folder])

  useEffect(() => {
    const key = `${dialect}|${folder ?? ''}|${imports}`
    if (key === lastKey.current) return
    lastKey.current = key
    setSettled(false)
    let live = true

    const run = async (): Promise<void> => {
      const names = imports ? imports.split(',') : []
      if (names.length === 0) {
        pruneDynamicBlocks(new Set(), MODULE_SOURCE_PREFIX)
        pruneDynamicCallRules(new Set(), MODULE_SOURCE_PREFIX)
        pruneDynamicObjectRules(new Set(), MODULE_SOURCE_PREFIX)
        setNonce((n) => n + 1)
        setSettled(true)
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
        const from: BlockSource = { kind: 'module', id: module, name: module, category: 'modules' }
        defineDynamicBlocks(id, blockDefinitionsFrom(manifest, from))
        // AND HOW THOSE BLOCKS READ BACK, under the same id, so a program that
        // calls `ping.distance()` opens as the module's block and not as the
        // generic call block. Pruned together with the blocks below.
        const typeFor = (blockId: string): string => blockTypeFor(from, blockId)
        registerDynamicCallRules(id, readRulesForModule(api, typeFor))
        // AND THE TWO SHAPES A CALL RULE CANNOT SAY: `ping.unit`, which
        // is not a call, and `ping = RangeFinder(…)`, which is a call with a
        // name on its left. Same id, so one prune still sweeps everything.
        registerDynamicObjectRules(id, objectRulesForModule(api, typeFor))
      }
      if (!live) return
      // Only OUR sources: a part's blocks are not this hook's to remove, and
      // `use-dynamic-blocks.ts` says the same about ours.
      pruneDynamicBlocks(keep, MODULE_SOURCE_PREFIX)
      pruneDynamicCallRules(keep, MODULE_SOURCE_PREFIX)
      pruneDynamicObjectRules(keep, MODULE_SOURCE_PREFIX)
      setNonce((n) => n + 1)
      setSettled(true)
    }

    // SETTLED EITHER WAY. A pass that threw has still had its look at the
    // board, and leaving the flag false would hold the canvas on "Reading the
    // blocks…" for as long as the file stayed open.
    run().catch((err) => {
      if (live) setSettled(true)
      reportError('blocks: registering module blocks', err)
    })
    return () => {
      live = false
    }
  }, [imports, dialect, folder])

  return { nonce, settled }
}

/**
 * Every module the button can find: the `.py` files beside the program, and
 * the ones on the board — `/lib`, where `mip` and the installer put things, and
 * the root, where a learner drops a file by hand. Never throws: no folder, no
 * board, a board that will not list, all of it is simply "nothing found here".
 */
async function scanModules(folder: string | null, filePath: string | null): Promise<string[]> {
  const files: string[] = []
  if (folder) {
    try {
      const entries = await window.api.fs.readDir(folder)
      for (const entry of entries) if (!entry.isDir) files.push(entry.name)
    } catch {
      // No folder open, or one we cannot list.
    }
  }
  if (connected()) {
    for (const dir of ['/lib', '/']) {
      try {
        const entries = await window.api.device.listDir(dir)
        for (const entry of entries) if (!entry.isDir) files.push(entry.name)
      } catch {
        // No board, or a board mid-run.
      }
    }
  }
  const own = filePath ? baseName(filePath).replace(/\.py$/, '') : null
  return moduleNamesFrom(files, own ? [own] : [])
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
