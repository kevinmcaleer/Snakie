import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findPart, type PartDefinition, type PartLibraryWithParts } from '../../../../shared/part'
import type { RobotDefinition } from '../../../../shared/robot'
import {
  normaliseBlocksManifest,
  parseBlocksManifest,
  type BlocksManifest
} from '../../../../shared/blocks-manifest'
import { loadSelectedBoard, watchSelectedBoard } from '../../components/board-pin-source'
import type { BoardPinInfo } from '../../components/board-pin-check'
import { blockDefinitionsFrom, type BlockSource } from './manifest'
import {
  classNameFromApi,
  placedPartBlocks,
  placedPartModules,
  type BoardPinLookup
} from './part-blocks'
import { findModuleSource } from './module-source'
import { readModuleApi } from './module-api'
import { defineDynamicBlocks, pruneDynamicBlocks } from './registry'
import { reportError } from '../report-error'

/**
 * THE DYNAMIC HALF OF THE PALETTE (#1017, epic #1007).
 * =============================================================================
 *
 * The core palette (#1011–#1014) is a fact about this build and registers itself
 * at module load. These blocks are a fact about the LEARNER'S AFTERNOON: what is
 * wired up on the breadboard right now, and which plugins are installed. Both
 * change while the app is running, so both need a hook that reloads them and a
 * toolbox that can be rebuilt underneath a live canvas.
 *
 * WHAT IT WATCHES, and why each one is necessary:
 *
 *  - `robot.onChanged` — a part dropped in Electronics must put its blocks in
 *    the toolbox NOW, in the other window, without a reload. That single
 *    property is the demo this whole issue exists for.
 *  - `parts.onChanged` — the Part Editor can add a driver or change a pin's
 *    signals, which changes the constructor a derived block generates.
 *  - the current folder — a different project is a different breadboard.
 *
 * WHAT IT DOES NOT DO is unregister a block from Blockly. A canvas on screen may
 * be holding one; see `defineDynamicBlocks`.
 */

/** Everything the Blocks view needs to know about the dynamic palette. */
export interface DynamicBlocks {
  /**
   * Bumped whenever the registered set changes — the canvas rebuilds its
   * toolbox on it, and only on it, so a project reload that changes nothing
   * doesn't close the flyout the learner is reading.
   */
  nonce: number
  /** Resolve a part reference to its definition (for the driver banner). */
  partFor: (libraryId: string, partId: string) => PartDefinition | undefined
  /** Anything a manifest said that we could not honour, newest load first. */
  warnings: readonly string[]
}

/**
 * Board pin label (`GP15`, or a bare number) → GPIO number.
 *
 * Built from the SELECTED BOARD rather than from the block palette's pin cache:
 * the cache is filled by a canvas when one mounts, and the wiring has to resolve
 * whether or not that has happened yet. A board with no pins resolved falls back
 * to reading the trailing digits, which is right for every RP2-family silk.
 */
export function boardPinLookup(pins: readonly BoardPinInfo[]): BoardPinLookup {
  const byLabel = new Map<string, number>()
  for (const pin of pins) byLabel.set(pin.label.toUpperCase(), pin.gpio)
  return (label: string) => {
    const raw = String(label ?? '').trim().toUpperCase()
    const known = byLabel.get(raw)
    if (known !== undefined) return known
    // `GP15`, `GPIO15` and `15` all name the same pad, and `robot.yml` records
    // whichever the board part's silk says — which is not always the spelling
    // the blocks palette uses.
    const digits = /(\d+)$/.exec(raw)
    if (!digits) return undefined
    const n = Number(digits[1])
    if (pins.length === 0) return n
    return pins.some((p) => p.gpio === n) ? n : undefined
  }
}

export function useDynamicBlocks(folder: string | null | undefined): DynamicBlocks {
  const [robot, setRobot] = useState<RobotDefinition | null>(null)
  const [libraries, setLibraries] = useState<PartLibraryWithParts[]>([])
  const [pluginGroups, setPluginGroups] = useState<{ source: BlockSource; manifest: BlocksManifest; warnings: string[] }[]>([])
  const [robotNonce, setRobotNonce] = useState(0)
  const [nonce, setNonce] = useState(0)
  const [warnings, setWarnings] = useState<readonly string[]>([])
  const lastKey = useRef('')

  // robot.yml edits arrive from any window — the Board View, the pop-out, the
  // I²C scanner's "add this part". All of them should fill the toolbox.
  useEffect(() => window.api.robot.onChanged(() => setRobotNonce((n) => n + 1)), [])
  useEffect(() => {
    let live = true
    window.api.robot
      .load(folder ?? undefined)
      .then((d) => live && setRobot(d))
      .catch(() => live && setRobot(null))
    return () => {
      live = false
    }
  }, [folder, robotNonce])

  useEffect(() => {
    let live = true
    const load = (): void => {
      window.api.parts
        .listLibraries()
        .then((libs) => live && setLibraries(libs ?? []))
        .catch(() => undefined)
    }
    load()
    // Absent on some backends (the web build has no library authoring).
    const off = typeof window.api.parts.onChanged === 'function' ? window.api.parts.onChanged(load) : null
    return () => {
      live = false
      off?.()
    }
  }, [])

  // Plugins, once. Re-reading them on every project change would spawn Python
  // work for a question whose answer only changes when a plugin is installed —
  // which is what the Plugins panel's Reload is for.
  useEffect(() => {
    let live = true
    const api = window.api.plugins
    if (!api || typeof api.listBlocks !== 'function') return
    api
      .listBlocks()
      .then((listing) => {
        if (!live) return
        const out: { source: BlockSource; manifest: BlocksManifest; warnings: string[] }[] = []
        for (const provider of listing?.providers ?? []) {
          const { manifest, warnings: warn } = normaliseBlocksManifest({ blocks: provider.blocks })
          if (manifest.blocks.length === 0 && warn.length === 0) continue
          out.push({
            source: {
              kind: 'plugin',
              id: provider.pluginId || provider.name,
              name: provider.name || provider.pluginId,
              category: 'plugins'
            },
            manifest,
            warnings: warn.map((w) => `${provider.name || provider.pluginId}: ${w}`)
          })
        }
        setPluginGroups(out)
      })
      // A plugin host that isn't there is the normal case, not a fault: no
      // Python, no web host, a plugin that crashed on import. The palette is
      // simply the core one plus whatever the parts contribute.
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  // The selected board decides what `board.GP4` in a wire MEANS. It changes from
  // the Board View, in another window, and the toolbox has to follow.
  const [boardPins, setBoardPins] = useState<readonly BoardPinInfo[]>([])
  useEffect(() => {
    let live = true
    const load = (): void => {
      void loadSelectedBoard().then((b) => live && setBoardPins(b.pins))
    }
    load()
    const off = watchSelectedBoard(load)
    return () => {
      live = false
      off()
    }
  }, [])

  /**
   * THE GUESSED CLASS NAME, UPGRADED TO A FACT (#1048).
   *
   * `part-blocks.ts` has always had to guess: `vl53l0x` → `VL53L0X`, right for
   * most drivers and visibly wrong on the block for the rest. Now that a
   * module's source can be found and read, a wired part whose driver we have
   * gets the class the driver actually declares.
   *
   * Resolved OUT OF BAND and folded in when it arrives, rather than blocking
   * the palette on file reads: the blocks appear immediately with the guess,
   * and correct themselves a moment later if the guess was wrong. A part whose
   * driver is nowhere keeps the guess for good, which is exactly the old
   * behaviour.
   */
  const [classNames, setClassNames] = useState<Record<string, string>>({})
  const partModules = useMemo(
    () => placedPartModules(robot, libraries).sort().join(','),
    [robot, libraries]
  )
  useEffect(() => {
    let live = true
    const names = partModules ? partModules.split(',') : []
    if (names.length === 0) {
      setClassNames((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }
    void (async () => {
      const found: Record<string, string> = {}
      for (const module of names) {
        const src = await findModuleSource(module, {
          folder,
          readLocal: (path) => window.api.fs.readFile(path),
          // Only when a board is there: a read against nothing is a rejected
          // promise per module, which is noise in the console and nothing else.
          readDevice: window.api.device?.readFile
            ? (path) => window.api.device.readFile(path)
            : null,
          readBundled: (file) => window.api.modules.bundledSource(file)
        }).catch(() => null)
        if (!src) continue
        const name = classNameFromApi(module, readModuleApi(module, src.text).classes)
        if (name) found[module] = name
      }
      if (!live) return
      setClassNames((prev) =>
        JSON.stringify(prev) === JSON.stringify(found) ? prev : found
      )
    })()
    return () => {
      live = false
    }
  }, [partModules, folder])

  const parts = useMemo(
    () =>
      placedPartBlocks(
        robot,
        libraries,
        boardPinLookup(boardPins),
        parseBlocksManifest,
        (module) => classNames[module]
      ),
    [robot, libraries, boardPins, classNames]
  )

  // Register, and bump the nonce only when the REGISTERED SET actually differs.
  // `robot.onChanged` fires for a part being dragged a pixel, and rebuilding the
  // toolbox on each of those would shut the flyout in the learner's face.
  useEffect(() => {
    const groups = [
      ...parts.map((p) => ({ source: p.source, manifest: p.manifest, warnings: p.warnings })),
      ...pluginGroups
    ]
    const definitions = groups.map((g) => ({
      source: `${g.source.kind}:${g.source.id}`,
      defs: blockDefinitionsFrom(g.manifest, g.source)
    }))
    const key = JSON.stringify(
      definitions.map((d) => [d.source, d.defs.map((b) => [b.type, b.json])])
    )
    if (key === lastKey.current) return
    lastKey.current = key

    try {
      for (const { source, defs } of definitions) defineDynamicBlocks(source, defs)
      pruneDynamicBlocks(new Set(definitions.map((d) => d.source)))
    } catch (err) {
      reportError('blocks: registering part/plugin blocks', err)
    }
    setWarnings(groups.flatMap((g) => g.warnings))
    setNonce((n) => n + 1)
  }, [parts, pluginGroups])

  const partFor = useCallback(
    (libraryId: string, partId: string): PartDefinition | undefined =>
      findPart(libraries, libraryId, partId) ?? undefined,
    [libraries]
  )

  return { nonce, partFor, warnings }
}
