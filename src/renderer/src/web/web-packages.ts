/**
 * WEB packages backend (#776 follow-on) — the Packages tab, in the browser.
 * =============================================================================
 *
 * The desktop splits this between main (curated list, PyPI search, and — since
 * #776 — the package DOWNLOAD) and the preload (which writes the resolved files
 * to the board). On the web there is no main process, so `window.api.packages`
 * fell through to the preload fallback stub: `install` resolved `ok: false` and
 * the Packages tab's Install button did nothing, silently, forever.
 *
 * #776 is what makes a web port possible at all. While an install meant
 * `mip.install()` ON the board, the browser had nothing to offer — the board
 * needed its own internet connection either way. Now an install is "resolve on
 * the host, write the files", and in the browser the HOST IS THE PAGE: it can
 * download over the same {@link resolveMipSpec} the desktop uses and write down
 * `window.api.device`, which reaches Web Serial or the simulator's VFS.
 *
 * WHAT THE BROWSER CANNOT DO, and why — see `web-hosts.ts` for the mechanism:
 *
 *  - **Fetch from an arbitrary host.** A page is fenced in by its CSP and by
 *    CORS. Snakie's own catalog only ever names `github:` specs and the
 *    micropython-lib index, both of which are reachable; a hand-typed
 *    `gitlab:…` spec, a custom index URL, or a bare `https://…` on some other
 *    host is NOT, and is refused up front with a sentence saying so rather than
 *    a bare "Failed to fetch". Those installs need the desktop app.
 *  - **`.mpy` bytecode.** Unchanged from the desktop: no bundled mpy-cross, so
 *    only source `.py` is ever installed (the resolver refuses the rest).
 *
 * Everything else — the curated list, PyPI search, `github:` specs, bare index
 * names with transitive `deps`, the `/lib` target, the advanced-option notes —
 * behaves exactly as it does on the desktop, because it is the same code.
 */
import { CURATED_PACKAGES } from '../../../shared/packages/registry'
import { searchPackages } from '../../../shared/packages/search'
import { installNotes, installTarget } from '../../../shared/packages/install'
import type {
  InstallOptions,
  InstallProgress,
  InstallResult,
  PackageInfo
} from '../../../shared/packages/types'
import { MipResolveError, resolveMipSpec } from '../../../shared/mip-resolve'
import { resolveFailureMessage, hostInstallNote } from '../../../shared/install-messages'
import {
  webMipFetch,
  writeFilesToDevice,
  type InstallDevice,
  type InstallFile
} from './web-install'

/** Build the web `packages` API surface (merged over the fallback stub). */
export function createWebPackagesApi(): Record<string, unknown> {
  return {
    /** The curated starter set — the same offline-safe list main serves. */
    topPackages: async (): Promise<PackageInfo[]> => CURATED_PACKAGES,

    /**
     * Search PyPI + the curated set. PyPI's JSON API answers
     * `Access-Control-Allow-Origin: *` and is in the web CSP, so the page reads
     * it directly; if it can't, `searchPackages` degrades to curated matches
     * rather than throwing, exactly as on the desktop.
     */
    search: (query: string): Promise<PackageInfo[]> => searchPackages(query ?? ''),

    /**
     * Install `name` onto the connected device: download it HERE, then write
     * the files. Same two legs as the desktop, same words for each failure —
     * "couldn't fetch it" and "the board wouldn't take it" stay distinct.
     */
    install: async (
      name: string,
      options?: InstallOptions,
      onProgress?: (p: InstallProgress) => void
    ): Promise<InstallResult> => {
      const emit = (p: InstallProgress): void => onProgress?.(p)
      const opts = options ?? {}
      const target = installTarget(opts)
      emit({ name, state: 'started' })
      emit({ name, state: 'running', message: `Downloading ${name}…` })

      let files: InstallFile[]
      const notes = installNotes(opts)
      try {
        const resolved = await resolveMipSpec(name, {
          fetchText: webMipFetch(),
          target,
          index: opts.index?.trim() || undefined
        })
        files = resolved.files.map((f) => ({
          path: f.path,
          contents: f.contents,
          // Root spec first, so anything else came along transitively (#895).
          dependency: f.package === resolved.packages[0] ? undefined : f.package
        }))
        notes.push(
          hostInstallNote({
            name,
            spec: name,
            fileCount: resolved.files.length,
            target: resolved.target,
            dependencies: resolved.packages.slice(1)
          })
        )
      } catch (err) {
        emit({ name, state: 'error', message: `Failed to install ${name}` })
        return {
          name,
          ok: false,
          log: resolveFailureMessage({
            name,
            spec: name,
            kind: err instanceof MipResolveError ? err.kind : 'network',
            detail: err instanceof Error ? err.message : String(err)
          }),
          notes
        }
      }
      for (const note of notes) emit({ name, state: 'note', message: note })

      const written = await writeFilesToDevice(
        name,
        files,
        window.api.device as unknown as InstallDevice,
        (message, detail) => emit({ name, state: 'running', message, ...detail })
      )
      emit({
        name,
        state: written.ok ? 'done' : 'error',
        message: written.ok ? `Installed ${name}` : `Failed to install ${name}`
      })
      if (written.ok) window.api.modules.notifyChanged()
      return { name, ok: written.ok, log: written.log, notes }
    }
  }
}
