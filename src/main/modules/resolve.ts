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
  MODULES_LIB_DIR,
  type ModuleDef
} from '../../shared/modules-catalog'
import {
  chooseMipRoute,
  hostInstallNote,
  mipInstallFailureMessage,
  type InstallCapabilities
} from '../../shared/install-strategy'
import {
  httpMipFetch,
  MipResolveError,
  resolveMipSpec,
  type MipFetch
} from '../../shared/mip-resolve'
import type { RuntimeInfo } from '../../shared/dialect'

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
 *     for the renderer to run over `device.exec` — **but only if the board can
 *     actually `import mip`** (#776). When the connect probe said it cannot,
 *     the spec is resolved HERE instead (`resolveMipSpec`, past the renderer's
 *     CSP) and the plan degrades to a list of ordinary file WRITES, which reach
 *     a CIRCUITPY drive or the raw REPL through the same `device.writeFile`.
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
 * `writeFile` / `snippet` / `files` is populated, picked by the module's source
 * kind AND the board's capabilities:
 *   - `bundled`            ⇒ `writeFile` = `{ path, contents }`: the renderer
 *     ensures the dir then calls `device.writeFile(path, contents)`.
 *   - `mip`, board has mip ⇒ `snippet`: the renderer runs it via `device.exec`
 *     and parses the {@link INSTALL_OK}/{@link INSTALL_ERR} sentinels.
 *   - `mip`, board has NOT ⇒ `files`: already downloaded here (#776); the
 *     renderer creates each ancestor dir and writes them in order.
 */
export interface ModuleInstallPlan {
  /** The catalog id this plan installs. */
  id: string
  /** The module name importable on the board once installed (probe key). */
  importName: string
  /**
   * Install mechanism:
   *   - `writeFile` — a bundled stub: one file, in {@link writeFile}.
   *   - `mip`       — run {@link snippet} on the board.
   *   - `hostFiles` — the board has no `mip` (#776), so the spec was resolved
   *     on the host: write every entry in {@link files}, parents first.
   */
  mechanism: 'writeFile' | 'mip' | 'hostFiles'
  /** Populated for `bundled` modules: where + what to write to the board. */
  writeFile?: { path: string; contents: string }
  /** Populated for `mip` modules: the device snippet to run via `device.exec`. */
  snippet?: string
  /** Populated for `hostFiles`: every file to write, in dependency order. */
  files?: { path: string; contents: string }[]
  /** The `mip` spec behind this plan, for logs and fallback retries. */
  mipSpec?: string
  /** Non-fatal notes to surface in the UI (e.g. provenance / source hint). */
  notes: string[]
}

/**
 * What the caller knows about the board when it asks for a plan (#776).
 *
 * Serializable, because the RENDERER supplies it: `modules:installPlan` is
 * asked from the preload, which reads the capabilities off the device status it
 * already has. Main deliberately still does not reach into the device singleton
 * (see the header) — it is TOLD what the board can do.
 */
export interface ModulePlanRequest {
  /** What the connect probe learned the board can do. */
  caps?: InstallCapabilities
  /** The probed runtime, used only to name the firmware in an error. */
  runtime?: RuntimeInfo | null
  /** Injected in tests so host resolution never touches the network. */
  fetchText?: MipFetch
}

/**
 * Resolve a `mip` spec on the HOST and turn it into a plan of plain file
 * writes (#776). Only reached when the board said it cannot `import mip`.
 *
 * Any {@link MipResolveError} is re-thrown as the composed, one-line
 * explanation — the message crosses IPC as a string, so it has to carry the
 * whole story by itself rather than relying on an error class surviving.
 */
async function buildHostFilesPlan(
  def: ModuleDef,
  spec: string,
  request: ModulePlanRequest,
  notes: string[]
): Promise<ModuleInstallPlan> {
  try {
    const resolved = await resolveMipSpec(spec, {
      fetchText: request.fetchText ?? httpMipFetch(),
      target: MODULES_LIB_DIR
    })
    notes.push(
      hostInstallNote({
        moduleName: def.name,
        spec,
        fileCount: resolved.files.length,
        target: MODULES_LIB_DIR
      })
    )
    return {
      id: def.id,
      importName: def.importName,
      mechanism: 'hostFiles',
      files: resolved.files.map((f) => ({ path: f.path, contents: f.contents })),
      mipSpec: spec,
      notes
    }
  } catch (err) {
    const kind = err instanceof MipResolveError ? err.kind : 'network'
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      mipInstallFailureMessage({
        moduleName: def.name,
        spec,
        kind,
        detail,
        runtime: request.runtime
      })
    )
  }
}

/**
 * Build a {@link ModuleInstallPlan} for one catalog module def.
 *
 * Offline for the `bundled` arm (a disk read) and for the on-board `mip` arm (a
 * string). It only reaches the network for the host-resolution arm, and only
 * when the board has said it has no `mip`. Throws for an unresolvable source,
 * so the IPC `wrap` reports it cleanly.
 */
export async function buildModuleInstallPlan(
  def: ModuleDef,
  request: ModulePlanRequest = {}
): Promise<ModuleInstallPlan> {
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
  // A `mip` source installs one of two ways, chosen by CAPABILITY (#776): the
  // board's own `mip` when it has one, else host resolution + file writes.
  const spec = def.source.spec
  if (chooseMipRoute(request.caps) === 'host') {
    return buildHostFilesPlan(def, spec, request, notes)
  }
  notes.push(`Installs ${def.name} from ${spec} via mip.`)
  return {
    id: def.id,
    importName: def.importName,
    mechanism: 'mip',
    snippet: buildInstallSnippet(spec),
    mipSpec: spec,
    notes
  }
}

/**
 * Resolve a catalog id to its install plan, or throw if the id is unknown. The
 * IPC handler calls this; keeping the throw here means the `wrap` helper turns
 * it into a serializable `{ ok:false, error }`.
 */
export async function planForId(
  id: string,
  request: ModulePlanRequest = {}
): Promise<ModuleInstallPlan> {
  const def = moduleById(id)
  if (!def) throw new Error(`unknown module id: ${id}`)
  return buildModuleInstallPlan(def, request)
}
