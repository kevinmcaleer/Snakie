/**
 * WEB modules backend (#513) — real driver/library installs in the browser.
 * =============================================================================
 * The desktop splits this between main (catalog + install plan) and preload
 * (device-driven probe/install). On the web everything the logic needs is
 * already here: the shared catalog, the bundled driver sources (inlined by
 * vite-plugin-standard-parts), and the full `window.api.device` surface — so
 * this ports the preload's probe/install against those.
 *
 * Installs used to run `mip` ON the board, which needed the BOARD to be online
 * and to ship `mip` — so they never worked on the simulator and never worked on
 * a board without WiFi. #776 replaced that everywhere with host-side
 * resolution, and here "the host" is the browser: it downloads the package over
 * the same shared resolver the desktop uses (raw.githubusercontent.com and the
 * micropython.org index are CORS-open, which is what makes this reachable from
 * a web page) and writes the files down `window.api.device`. So a whole package
 * with transitive `deps` installs here too, over Web Serial or into the
 * simulator's VFS.
 */
import {
  MODULES,
  importProbeSnippet,
  MODULE_PRESENT,
  type ModuleDef
} from '../../../shared/modules-catalog'
import { driverSources } from 'virtual:snakie-standard-parts'
import { MODULE_STUBS } from './web-lib-sources'
import { MipResolveError, resolveMipSpec } from '../../../shared/mip-resolve'
import { hostInstallNote, resolveFailureMessage } from '../../../shared/install-messages'
import {
  webMipFetch,
  writeFilesToDevice,
  type InstallDevice,
  type InstallFile
} from './web-install'
import type { InstallFileProgress } from '../../../shared/install-file-progress'

const LIB_DIR = '/lib'

interface InstallPlan {
  id: string
  importName: string
  /** Every file to write, parents-before-children. */
  files: InstallFile[]
  /** The upstream spec these files came from, when there was one. */
  spec?: string
  notes: string[]
}

interface InstallProgress extends InstallFileProgress {
  id: string
  state: 'started' | 'note' | 'running' | 'done' | 'error'
  message?: string
}
interface InstallResult {
  id: string
  ok: boolean
  log: string
  notes: string[]
}

/** Bundled contents by file basename: the `micropython/modules/` stubs (#522)
 *  first — the same files the desktop packages — then the part-driver sources
 *  (keys are `<partId>/<file>`). */
function bundledSource(file: string): string | null {
  if (MODULE_STUBS[file]) return MODULE_STUBS[file]
  for (const [key, contents] of Object.entries(driverSources)) {
    if (key.endsWith(`/${file}`) || key === file) return contents
  }
  return null
}

/**
 * The web port of `buildModuleInstallPlan`: bundled source off the inlined
 * table, or the upstream package downloaded here in the browser. Throws with an
 * already-composed, human-readable message, exactly as main does.
 */
async function planFor(id: string): Promise<InstallPlan> {
  const def = MODULES.find((m: ModuleDef) => m.id === id)
  if (!def) throw new Error(`Unknown module: ${id}`)
  if (def.source.kind === 'bundled') {
    const contents = bundledSource(def.source.file)
    if (contents) {
      return {
        id,
        importName: def.importName,
        files: [{ path: `${LIB_DIR}/${def.source.file}`, contents }],
        notes: []
      }
    }
    // Bundled on desktop but not inlined in this web build — fall through to an
    // honest error rather than a stub's silent one.
    throw new Error(`${def.source.file} isn't bundled in the web build yet.`)
  }
  if (def.source.kind === 'bundle') {
    // The Adafruit CircuitPython bundle (#758) is published ONLY as GitHub
    // release assets, and those redirect to a host that answers with no
    // `Access-Control-Allow-Origin` header at all — so no page can read them,
    // whatever the CSP says (the same wall `web-hosts.ts` documents for
    // gitlab.com). This is not something a wider allowlist would fix, so say so
    // plainly and point at the app that can.
    throw new Error(
      `Couldn't install ${def.name}: CircuitPython libraries come from the Adafruit ` +
        'CircuitPython Library Bundle, which is published as GitHub release downloads that a ' +
        'web page is not allowed to read. Install it from the Snakie desktop app, or copy the ' +
        'library into /lib yourself with the Files panel.'
    )
  }
  const spec = def.source.spec
  try {
    const resolved = await resolveMipSpec(spec, { fetchText: webMipFetch(), target: LIB_DIR })
    return {
      id,
      importName: def.importName,
      files: resolved.files.map((f) => ({
        path: f.path,
        contents: f.contents,
        // Root spec first, so anything else came along transitively (#895).
        dependency: f.package === resolved.packages[0] ? undefined : f.package
      })),
      spec,
      notes: [
        hostInstallNote({
          name: def.name,
          spec,
          fileCount: resolved.files.length,
          target: resolved.target,
          dependencies: resolved.packages.slice(1)
        })
      ]
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

/** Build the web `modules` API surface (merged over the fallback stub). */
export function createWebModulesApi(): Record<string, unknown> {
  return {
    catalog: async (): Promise<ModuleDef[]> => MODULES,
    installPlan: (id: string): Promise<InstallPlan> => planFor(id),

    /** Port of the preload's batched import probe, over the web device. */
    probeInstalled: async (importNames: string[]): Promise<string[]> => {
      if (importNames.length === 0) return []
      const lines: string[] = []
      for (const name of importNames) {
        const safe = name.replace(/[^A-Za-z0-9_]/g, '')
        lines.push(importProbeSnippet(safe).replace(MODULE_PRESENT, `${MODULE_PRESENT} ${safe}`))
      }
      try {
        const exec = await window.api.device.exec(lines.join('\n'))
        const present = new Set<string>()
        for (const line of `${exec.stdout ?? ''}`.split(/\r?\n/)) {
          const m = line.trim()
          if (m.startsWith(`${MODULE_PRESENT} `)) present.add(m.slice(MODULE_PRESENT.length + 1).trim())
        }
        return importNames.filter((n) => present.has(n.replace(/[^A-Za-z0-9_]/g, '')))
      } catch {
        return []
      }
    },

    /** Port of the preload's install: resolve (bundled or downloaded), then write. */
    install: async (
      id: string,
      onProgress?: (p: InstallProgress) => void
    ): Promise<InstallResult> => {
      const emit = (p: InstallProgress): void => onProgress?.(p)
      emit({ id, state: 'started' })
      emit({ id, state: 'running', message: `Resolving ${id}…` })

      let plan: InstallPlan
      try {
        plan = await planFor(id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        emit({ id, state: 'error', message: `Failed to install ${id}` })
        return { id, ok: false, log: msg, notes: [] }
      }
      for (const note of plan.notes) emit({ id, state: 'note', message: note })

      const written = await writeFilesToDevice(
        id,
        plan.files,
        window.api.device as unknown as InstallDevice,
        (message, detail) => emit({ id, state: 'running', message, ...detail })
      )
      emit({
        id,
        state: written.ok ? 'done' : 'error',
        message: written.ok ? `Installed ${id}` : `Failed to install ${id}`
      })
      if (written.ok) window.api.modules.notifyChanged()
      return { id, ok: written.ok, log: written.log, notes: plan.notes }
    }
  }
}
