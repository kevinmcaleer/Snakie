import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import {
  buildInstallSnippet,
  INSTALL_OK,
  INSTALL_ERR,
  INSTALL_START
} from '../packages/install'
import {
  installPathFor,
  moduleById,
  type ModuleDef
} from '../../shared/modules-catalog'

/**
 * Per-module install resolution (issue #120).
 * =============================================================================
 *
 * Generalises the #108 instrument-library install path (a single bundled
 * `instruments.py` read off disk and written to the board) to ANY catalog
 * module, and folds in the #20 `mip` install path for modules we reference
 * upstream rather than vendor.
 *
 * A module's `source` decides the install MECHANISM:
 *   - `bundled` → read the shipped `micropython/modules/<file>` and hand its
 *     SOURCE back; the renderer writes it to `/lib/<file>` via `device.writeFile`
 *     (exactly how the #108 banner installs `instruments.py`).
 *   - `mip`    → build a `mip.install(<spec>)` SNIPPET (reusing the #20 builder)
 *     for the renderer to run over `device.exec`.
 *
 * Both arms return a serializable {@link ModuleInstallPlan} so the privileged /
 * offline-reasoning part (reading bundled files, composing snippets) stays in
 * main while the actual device write/exec runs over the renderer's existing,
 * serialized device channel — the same split the packages layer uses.
 */

/** Re-export the mip sentinels so the preload can classify the device output. */
export { INSTALL_OK, INSTALL_ERR, INSTALL_START }

/**
 * Resolve the bundled-modules directory (`micropython/modules`) for the current
 * run. Mirrors `readInstrumentsLibrarySource` in `src/main/index.ts`: packaged
 * builds read from `process.resourcesPath` (the electron-builder `micropython`
 * extraResources entry already ships every `.py` recursively, so the
 * `modules/` stubs ride along); in dev `__dirname` is `out/main`, so the repo
 * root is two levels up.
 */
function modulesDir(): string {
  const packaged = join(process.resourcesPath, 'micropython', 'modules')
  if (app.isPackaged && existsSync(packaged)) return packaged
  return join(__dirname, '..', '..', 'micropython', 'modules')
}

/**
 * Read a bundled module's `.py` source by filename. Returns `''` on any failure
 * (missing file, read error) so the renderer's install flow degrades gracefully
 * — exactly like `instruments:librarySource` (never throws). `file` is a catalog
 * constant (a basename), but we still join+guard against path escapes.
 */
export function readBundledModuleSource(file: string): string {
  try {
    // Defensive: only ever read a basename out of the modules dir.
    const base = file.replace(/[\\/]/g, '')
    if (!base.endsWith('.py')) return ''
    const path = join(modulesDir(), base)
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

/**
 * What `modules:installPlan` returns for the renderer to ACT on. Exactly one of
 * `writeFile` / `snippet` is populated, picked by the module's source kind:
 *   - `bundled` ⇒ `writeFile` = `{ path, contents }`: the renderer ensures the
 *     dir then calls `device.writeFile(path, contents)`.
 *   - `mip`     ⇒ `snippet`: the renderer runs it via `device.exec` and parses
 *     the {@link INSTALL_OK}/{@link INSTALL_ERR} sentinels.
 */
export interface ModuleInstallPlan {
  /** The catalog id this plan installs. */
  id: string
  /** The module name importable on the board once installed (probe key). */
  importName: string
  /** Install mechanism: write a bundled file, or run a `mip` snippet. */
  mechanism: 'writeFile' | 'mip'
  /** Populated for `bundled` modules: where + what to write to the board. */
  writeFile?: { path: string; contents: string }
  /** Populated for `mip` modules: the device snippet to run via `device.exec`. */
  snippet?: string
  /** Non-fatal notes to surface in the UI (e.g. provenance / source hint). */
  notes: string[]
}

/**
 * Build a {@link ModuleInstallPlan} for one catalog module def. Pure aside from
 * reading the bundled file off disk for the `bundled` arm; throws only for an
 * unresolvable bundled source (so the IPC `wrap` reports it cleanly).
 */
export function buildModuleInstallPlan(def: ModuleDef): ModuleInstallPlan {
  const notes: string[] = []
  if (def.source.kind === 'bundled') {
    const path = installPathFor(def)
    if (!path) {
      throw new Error(`module ${def.id} has no install path`)
    }
    const contents = readBundledModuleSource(def.source.file)
    if (!contents) {
      throw new Error(`bundled module source unavailable: ${def.source.file}`)
    }
    if (def.license) notes.push(`${def.name} — bundled ${def.license} driver.`)
    return {
      id: def.id,
      importName: def.importName,
      mechanism: 'writeFile',
      writeFile: { path, contents },
      notes
    }
  }
  // mip source: compose the install snippet (reuse the packages #20 builder).
  notes.push(`Installs ${def.name} from ${def.source.spec} via mip.`)
  return {
    id: def.id,
    importName: def.importName,
    mechanism: 'mip',
    snippet: buildInstallSnippet(def.source.spec),
    notes
  }
}

/**
 * Resolve a catalog id to its install plan, or throw if the id is unknown. The
 * IPC handler calls this; keeping the throw here means the `wrap` helper turns
 * it into a serializable `{ ok:false, error }`.
 */
export function planForId(id: string): ModuleInstallPlan {
  const def = moduleById(id)
  if (!def) throw new Error(`unknown module id: ${id}`)
  return buildModuleInstallPlan(def)
}
