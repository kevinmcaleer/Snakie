import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import {
  installPathFor,
  moduleById,
  MODULES_LIB_DIR,
  type ModuleDef
} from '../../shared/modules-catalog'
import {
  bundleFailureMessage,
  bundleInstallNote,
  hostInstallNote,
  resolveFailureMessage
} from '../../shared/install-messages'
import {
  httpMipFetch,
  MipResolveError,
  resolveMipSpec,
  type MipFetch
} from '../../shared/mip-resolve'
import {
  BundleResolveError,
  circuitPythonMajor,
  resolveBundleModule,
  selectBundleMajor
} from '../../shared/circuitpy-bundle'
import type { RuntimeInfo } from '../../shared/dialect'
import { createBundleHost, type BundleHost } from './bundle'

/**
 * Per-module install resolution (issue #120, reworked by #776).
 * =============================================================================
 *
 * Generalises the #108 instrument-library install path (a single bundled
 * `instruments.py` read off disk and written to the board) to ANY catalog
 * module, whether Snakie vendors it or references it upstream.
 *
 * **Every install is a file write.** A module's `source` decides only where the
 * bytes come FROM:
 *   - `bundled` → read the shipped `micropython/modules/<file>` and hand its
 *     SOURCE back (exactly how the #108 banner installs `instruments.py`).
 *   - `mip`     → resolve the spec HERE, over the network, past the renderer's
 *     CSP ({@link resolveMipSpec}) — the package's own files, its `deps` and all.
 *   - `bundle`  → the Adafruit CircuitPython Library Bundle (#758), the only
 *     library source CircuitPython has. Needs the BOARD'S CircuitPython version,
 *     because `.mpy` bytecode is published per major — hence the `runtime` on
 *     {@link ModulePlanRequest}, which the preload reads off the live session.
 *
 * `bundle` is also the one source whose files are BYTES rather than text, so a
 * plan file carries an `encoding`. `.mpy` fetched or written as UTF-8 would be
 * silently corrupt — the exact failure `mip-resolve.ts` refuses `.mpy` to avoid
 * — so it travels base64 and is decoded back to bytes at the write.
 *
 * That used to be `mip.install(<spec>)` run ON the board, which needed the
 * BOARD to have an internet connection. Most don't: a Tiny 2350 or a non-W Pico
 * never can, and `mip` itself is missing from CircuitPython and many vendor
 * builds. The computer is the machine with the network, so it does the
 * fetching, and the board does what every board can do — accept files (#776).
 *
 * Both arms return a serializable {@link ModuleInstallPlan} so the privileged /
 * network-facing part stays in main while the actual device writes run over the
 * renderer's existing, serialized device channel — the same split the packages
 * layer uses.
 */

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
 * One file in a plan. `contents` is SOURCE TEXT unless `encoding` says
 * otherwise — `'base64'` marks a binary file (an Adafruit `.mpy`) that the
 * writer must decode back to bytes. Absent means `'utf8'`, so every plan built
 * before #758 keeps its meaning.
 */
export interface ModulePlanFile {
  path: string
  contents: string
  encoding?: 'utf8' | 'base64'
}

/**
 * What `modules:installPlan` returns for the renderer to ACT on: the FILES to
 * put on the board, and where. One shape for every source (#776, #758) — a
 * bundled stub is a one-entry list, an upstream package is however many its
 * `package.json` and `deps` came to, an Adafruit library however many its
 * archive and bundle dependencies came to — because the renderer's job is the
 * same either way: create each ancestor directory, then write.
 */
export interface ModuleInstallPlan {
  /** The catalog id this plan installs. */
  id: string
  /** The module name importable on the board once installed (probe key). */
  importName: string
  /** Every file to write, parents-before-children in dependency order. */
  files: ModulePlanFile[]
  /** The upstream spec these files came from, when there was one (for logs). */
  spec?: string
  /** Non-fatal notes to surface in the UI (e.g. provenance / source hint). */
  notes: string[]
}

/** Options for building a plan. */
export interface ModulePlanRequest {
  /** Injected in tests so host resolution never touches the network. */
  fetchText?: MipFetch
  /**
   * What the connected board is running. Only the `bundle` source needs it —
   * the Adafruit bundle is published per CircuitPython MAJOR version, and
   * installing a 10.x `.mpy` on a 9.x board produces an ImportError that says
   * nothing about versions. Absent ⇒ a bundle install refuses rather than
   * guessing.
   */
  runtime?: RuntimeInfo | null
  /** Injected in tests so the bundle route never touches the network. */
  bundle?: BundleHost
}

/**
 * Resolve a CircuitPython library out of the Adafruit bundle (#758).
 *
 * Two things make this different from the `mip` arm. The BOARD'S VERSION is an
 * input — `.mpy` is built per CircuitPython major, so a mismatch is refused up
 * front with a sentence that names both sides rather than letting the board
 * raise an ImportError later. And the files are BYTES: they are base64'd onto
 * the plan and decoded at the write, because a `.mpy` that ever became a string
 * would be corrupt by the time anyone noticed.
 */
async function buildBundlePlan(
  def: ModuleDef,
  module: string,
  request: ModulePlanRequest
): Promise<ModuleInstallPlan> {
  const host = request.bundle ?? createBundleHost()
  try {
    const release = await host.release()
    const major = selectBundleMajor(release, circuitPythonMajor(request.runtime ?? null))
    const resolved = await resolveBundleModule(module, {
      index: await host.index(),
      major,
      fetchBinary: host.fetchBinary,
      inflate: host.inflate,
      target: MODULES_LIB_DIR
    })
    return {
      id: def.id,
      importName: def.importName,
      files: resolved.files.map((f) => ({
        path: f.path,
        contents: Buffer.from(f.bytes).toString('base64'),
        encoding: 'base64' as const
      })),
      spec: module,
      notes: [
        bundleInstallNote({
          name: def.name,
          modules: resolved.modules,
          fileCount: resolved.files.length,
          major: resolved.major,
          target: MODULES_LIB_DIR
        })
      ]
    }
  } catch (err) {
    throw new Error(
      bundleFailureMessage({
        name: def.name,
        module,
        kind: err instanceof BundleResolveError ? err.kind : 'network',
        detail: err instanceof Error ? err.message : String(err)
      })
    )
  }
}

/**
 * Build a {@link ModuleInstallPlan} for one catalog module def.
 *
 * Offline for the `bundled` arm (a disk read); the `mip` and `bundle` arms reach
 * the network, which is the whole point — this process has the internet
 * connection and the board does not. Throws for an unresolvable source, with a
 * message already composed for a human, so the IPC `wrap` reports it cleanly.
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
    return { id: def.id, importName: def.importName, files: [{ path, contents }], notes }
  }

  if (def.source.kind === 'bundle') {
    return buildBundlePlan(def, def.source.module, request)
  }

  // An upstream package: fetch it HERE and hand back its files. The resolver's
  // failure kinds become the user-facing message, because an Error crosses IPC
  // as a bare string — it has to carry the whole story by itself.
  const spec = def.source.spec
  try {
    const resolved = await resolveMipSpec(spec, {
      fetchText: request.fetchText ?? httpMipFetch(),
      target: MODULES_LIB_DIR
    })
    notes.push(
      hostInstallNote({
        name: def.name,
        spec,
        fileCount: resolved.files.length,
        target: resolved.target,
        // Root first, so everything after it came along transitively — the
        // `lsm6dsox` / `ltr381rgb` / `micropython_hs3003` that make Movement,
        // Light and Thermo work, installed BESIDE the package at the root.
        dependencies: resolved.packages.slice(1)
      })
    )
    return {
      id: def.id,
      importName: def.importName,
      files: resolved.files.map((f) => ({ path: f.path, contents: f.contents })),
      spec,
      notes
    }
  } catch (err) {
    throw new Error(
      resolveFailureMessage({
        name: def.name,
        spec,
        kind: err instanceof MipResolveError ? err.kind : 'network',
        detail: err instanceof Error ? err.message : String(err)
      })
    )
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
