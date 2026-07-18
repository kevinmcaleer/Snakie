/**
 * WEB modules backend (#513) — real driver/library installs in the browser.
 * =============================================================================
 * The desktop splits this between main (catalog + install plan) and preload
 * (device-driven probe/install). On the web everything the logic needs is
 * already here: the shared catalog, the bundled driver sources (inlined by
 * vite-plugin-standard-parts), and the full `window.api.device` surface — so
 * this ports the preload's probe/install against those. mip installs run ON
 * the board (it does its own networking), so they work over Web Serial on a
 * network-capable board and fail honestly on the simulator.
 */
import {
  MODULES,
  importProbeSnippet,
  MODULE_PRESENT,
  type ModuleDef
} from '../../../shared/modules-catalog'
import {
  INSTALL_OK,
  INSTALL_ERR,
  INSTALL_START,
  buildInstallSnippet
} from '../../../main/packages/install'
import { driverSources } from 'virtual:snakie-standard-parts'
import { MODULE_STUBS } from './web-lib-sources'
import { githubRawUrl } from '../lib/board-packages'

const LIB_DIR = '/lib'

interface InstallPlan {
  id: string
  importName: string
  mechanism: 'writeFile' | 'mip'
  writeFile?: { path: string; contents: string }
  snippet?: string
  mipSpec?: string
  notes: string[]
}

interface InstallProgress {
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

function planFor(id: string): InstallPlan {
  const def = MODULES.find((m: ModuleDef) => m.id === id)
  if (!def) throw new Error(`Unknown module: ${id}`)
  if (def.source.kind === 'bundled') {
    const contents = bundledSource(def.source.file)
    if (contents) {
      return {
        id,
        importName: def.importName,
        mechanism: 'writeFile',
        writeFile: { path: `${LIB_DIR}/${def.source.file}`, contents },
        notes: []
      }
    }
    // Bundled on desktop but not inlined in this web build — fall through to an
    // honest error rather than a stub's silent one.
    throw new Error(`${def.source.file} isn't bundled in the web build yet.`)
  }
  return {
    id,
    importName: def.importName,
    mechanism: 'mip',
    snippet: buildInstallSnippet(def.source.spec),
    mipSpec: def.source.spec,
    notes: []
  }
}

/** Build the web `modules` API surface (merged over the fallback stub). */
export function createWebModulesApi(): Record<string, unknown> {
  return {
    catalog: async (): Promise<ModuleDef[]> => MODULES,
    installPlan: async (id: string): Promise<InstallPlan> => planFor(id),

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

    /** Port of the preload's install: bundled → writeFile; mip → on-board snippet. */
    install: async (
      id: string,
      onProgress?: (p: InstallProgress) => void
    ): Promise<InstallResult> => {
      const emit = (p: InstallProgress): void => onProgress?.(p)
      emit({ id, state: 'started' })
      let plan: InstallPlan
      try {
        plan = planFor(id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        emit({ id, state: 'error', message: msg })
        return { id, ok: false, log: msg, notes: [] }
      }
      for (const note of plan.notes) emit({ id, state: 'note', message: note })

      if (plan.mechanism === 'writeFile' && plan.writeFile) {
        emit({ id, state: 'running', message: `Writing ${plan.writeFile.path}…` })
        try {
          await window.api.device.mkdir(LIB_DIR).catch(() => undefined)
          await window.api.device.writeFile(plan.writeFile.path, plan.writeFile.contents)
          emit({ id, state: 'done', message: `Installed ${id}` })
          window.api.modules.notifyChanged()
          return { id, ok: true, log: `Wrote ${plan.writeFile.path}`, notes: plan.notes }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          emit({ id, state: 'error', message: `Failed to install ${id}` })
          return { id, ok: false, log: msg, notes: plan.notes }
        }
      }

      emit({ id, state: 'running', message: `Installing ${id} with mip…` })
      try {
        const exec = await window.api.device.exec(plan.snippet ?? '')
        const out = `${exec.stdout ?? ''}\n${exec.stderr ?? ''}`.trim()
        const failed = out.includes(INSTALL_ERR) || (exec.stderr ?? '').includes('Traceback')
        const ok = out.includes(INSTALL_OK) && !failed
        const log = out
          .split(/\r?\n/)
          .filter((l) => !l.includes(INSTALL_START) && !l.includes(INSTALL_OK))
          .map((l) => l.replace(INSTALL_ERR, '').trim())
          .filter((l) => l.length > 0)
          .join('\n')
          .trim()
        if (ok) {
          emit({ id, state: 'done', message: `Installed ${id}` })
          window.api.modules.notifyChanged()
          return { id, ok, log: log || out, notes: plan.notes }
        }
        // The board has no mip / no network (e.g. the SIMULATOR) — the browser
        // still has network, so fetch single-file GitHub specs ourselves and
        // write them to /lib.
        const fetched = await browserFetchInstall(plan, emit)
        if (fetched) return fetched
        emit({ id, state: 'error', message: `Failed to install ${id}` })
        return { id, ok: false, log: log || out, notes: plan.notes }
      } catch (err) {
        const fetched = await browserFetchInstall(plan, emit)
        if (fetched) return fetched
        const msg = err instanceof Error ? err.message : String(err)
        emit({ id, state: 'error', message: `Failed to install ${id}` })
        return { id, ok: false, log: msg, notes: plan.notes }
      }
    }
  }
}

/** Fetch a single-file GitHub mip spec in the browser and write it to /lib. */
async function browserFetchInstall(
  plan: InstallPlan,
  emit: (p: InstallProgress) => void
): Promise<InstallResult | null> {
  const url = plan.mipSpec ? githubRawUrl(plan.mipSpec) : null
  if (!url) return null
  const file = url.split('/').pop() ?? `${plan.importName}.py`
  try {
    emit({ id: plan.id, state: 'running', message: `Board has no mip — fetching ${file} in the browser…` })
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`)
    const contents = await res.text()
    await window.api.device.mkdir(LIB_DIR).catch(() => undefined)
    await window.api.device.writeFile(`${LIB_DIR}/${file}`, contents)
    emit({ id: plan.id, state: 'done', message: `Installed ${plan.id}` })
    window.api.modules.notifyChanged()
    return {
      id: plan.id,
      ok: true,
      log: `Board has no mip/network — fetched ${url} in the browser and wrote ${LIB_DIR}/${file}`,
      notes: plan.notes
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit({ id: plan.id, state: 'note', message: `Browser fetch fallback failed: ${msg}` })
    return null
  }
}
