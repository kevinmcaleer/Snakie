/**
 * Community Parts registry layer (#129) — the master list of approved libraries
 * is a JSON document in a GitHub repo (see {@link DEFAULT_REGISTRY_URL});
 * administration is just PRs against that repo.
 *
 * All network access lives HERE in the main process (the renderer CSP blocks
 * outbound requests). The pure parse/version/diff logic lives in
 * `src/shared/part-registry.ts`; this module adds the side effects:
 *   - {@link fetchRegistry}  — GET + parse the registry document.
 *   - {@link checkUpdates}   — registry vs installed manifests → which can update.
 *   - {@link installLibrary} — clone a registry entry's repo into the parts dir,
 *     falling back to {@link installLibraryFromArchive} when `git` isn't usable
 *     (#284 — the zip/tarball install fallback).
 *
 * Everything returns serialisable results / never throws across IPC.
 */

import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'
import { promises as fsp } from 'fs'
import { simpleGit } from 'simple-git'
import * as tar from 'tar'
import {
  diffInstalled,
  githubArchiveUrl,
  parseRegistry
} from '../../shared/part-registry'
import {
  DEFAULT_REGISTRY_URL,
  type LibraryUpdate,
  type PartRegistry,
  type RegistryEntry
} from '../../shared/part'
import { libraryFromYaml, libraryToYaml } from '../../shared/part-yaml'
import { partsDir, readLibraryManifests, sanitiseId, type WriteResult } from './library'

/** Fetch + parse the master registry. Returns an empty list on any failure. */
export async function fetchRegistry(url: string = DEFAULT_REGISTRY_URL): Promise<PartRegistry> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      // Bound the request so a stalled host can't hang the IPC call (mirrors the
      // PyPI search timeout in src/main/packages/search.ts).
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) {
      console.warn(`[parts] registry fetch ${url} → HTTP ${res.status}`)
      return { libraries: [] }
    }
    const text = await res.text()
    return parseRegistry(text)
  } catch (err) {
    console.warn(`[parts] registry fetch failed: ${(err as Error).message}`)
    return { libraries: [] }
  }
}

/** Compare the fetched registry against installed manifests → update statuses. */
export async function checkUpdates(url: string = DEFAULT_REGISTRY_URL): Promise<LibraryUpdate[]> {
  const [registry, installed] = await Promise.all([fetchRegistry(url), readLibraryManifests()])
  return diffInstalled(installed, registry)
}

/** Cached result of the one-time `git` availability probe; see {@link isGitAvailable}. */
let gitAvailableCache: boolean | null = null

/**
 * Probe once whether a `git` executable is on PATH, caching the result for the
 * lifetime of the process — checked on every install (unlike, say,
 * `detectEsptool()` in `src/main/firmware/flasher.ts`, which re-probes each
 * flash), so caching avoids spawning a process on every "Add library" click.
 * Used to decide whether {@link installLibrary} can use its normal
 * `git clone` path or needs to fall back to {@link installLibraryFromArchive}
 * (#284 — the zip/tarball install fallback, also needed for a future
 * git-less web backend).
 */
export async function isGitAvailable(): Promise<boolean> {
  if (gitAvailableCache !== null) return gitAvailableCache
  gitAvailableCache = await new Promise<boolean>((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('git', ['--version'], { windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
  return gitAvailableCache
}

/** Test-only: clear the cached {@link isGitAvailable} result. */
export function resetGitAvailableCache(): void {
  gitAvailableCache = null
}

/**
 * Reconcile / write `<dest>/library.yml` so its `version` (and other fields)
 * match the registry entry, preserving anything else already in the repo's
 * own manifest (parts, extra metadata). Shared by the git-clone and
 * archive-download install paths.
 */
async function reconcileManifest(dest: string, id: string, entry: RegistryEntry): Promise<void> {
  const manifestPath = join(dest, 'library.yml')
  let manifest = {
    id,
    name: entry.name,
    description: entry.description,
    author: entry.author,
    homepage: entry.repo,
    version: entry.version
  }
  try {
    const existing = libraryFromYaml(await fsp.readFile(manifestPath, 'utf-8'))
    manifest = { ...existing, ...manifest, id }
  } catch {
    // No/invalid manifest in the repo → write our synthesised one.
  }
  await fsp.writeFile(manifestPath, libraryToYaml(manifest), 'utf-8')
}

/**
 * Install (or update) a registry library by cloning its repo into
 * `<parts>/<id>`. A pre-existing folder is removed first (so "update" is a fresh
 * clone). After cloning, the `library.yml` `version` is reconciled with the
 * registry entry so future update checks compare correctly.
 *
 * When `git` isn't on PATH (probed + cached via {@link isGitAvailable}), this
 * transparently falls back to {@link installLibraryFromArchive} instead of
 * failing outright (#284). Never throws.
 */
export async function installLibrary(entry: RegistryEntry): Promise<WriteResult> {
  try {
    const id = sanitiseId(entry.id)
    if (!id) return { ok: false, error: 'Registry entry has no usable id.' }
    if (!entry.repo || !/^https?:\/\//i.test(entry.repo)) {
      return { ok: false, error: 'Registry entry has no valid http(s) repo URL.' }
    }

    if (!(await isGitAvailable())) {
      return installLibraryFromArchive(entry)
    }

    const dir = partsDir()
    await fsp.mkdir(dir, { recursive: true })
    const dest = join(dir, id)

    // Fresh clone: remove any previous copy first (this doubles as "update").
    await fsp.rm(dest, { recursive: true, force: true })
    await simpleGit().clone(entry.repo, dest, ['--depth', '1']).catch((err) => {
      throw new Error(`git clone failed: ${(err as Error).message}`)
    })

    await reconcileManifest(dest, id, entry)
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Install (or update) a registry library WITHOUT `git`: download the repo as a
 * GitHub tarball (`codeload.github.com/.../tar.gz/HEAD` — always resolves to
 * the current default branch, no branch-name lookup needed) and extract it
 * into `<parts>/<id>`. This is the fallback {@link installLibrary} uses
 * automatically when `git` isn't on PATH, and is also exported directly for
 * callers (e.g. a future web backend) that want the archive path
 * unconditionally. GitHub-hosted repos only — same as the registry itself
 * expects — anything else fails with a clear error. Never throws.
 */
export async function installLibraryFromArchive(entry: RegistryEntry): Promise<WriteResult> {
  let tmpFile: string | undefined
  try {
    const id = sanitiseId(entry.id)
    if (!id) return { ok: false, error: 'Registry entry has no usable id.' }
    const archiveUrl = githubArchiveUrl(entry.repo)
    if (!archiveUrl) {
      return {
        ok: false,
        error:
          'Archive install only supports GitHub-hosted repos (github.com/<owner>/<repo>); ' +
          `"${entry.repo}" doesn't look like one.`
      }
    }

    const res = await fetch(archiveUrl, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) {
      return { ok: false, error: `Archive download failed: HTTP ${res.status} for ${archiveUrl}` }
    }
    const buf = Buffer.from(await res.arrayBuffer())

    tmpFile = join(tmpdir(), `snakie-part-${id}-${randomUUID()}.tar.gz`)
    await fsp.writeFile(tmpFile, buf)

    const dir = partsDir()
    await fsp.mkdir(dir, { recursive: true })
    const dest = join(dir, id)

    // Fresh extract: remove any previous copy first (this doubles as "update").
    await fsp.rm(dest, { recursive: true, force: true })
    await fsp.mkdir(dest, { recursive: true })
    // GitHub tarballs wrap everything in one `<owner>-<repo>-<sha>/` folder;
    // strip: 1 flattens it straight into `dest`.
    await tar.extract({ file: tmpFile, cwd: dest, strip: 1 })

    await reconcileManifest(dest, id, entry)
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    if (tmpFile) await fsp.rm(tmpFile, { force: true }).catch(() => {})
  }
}
