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
 *   - {@link installLibrary} — clone a registry entry's repo into the parts dir.
 *
 * Everything returns serialisable results / never throws across IPC.
 */

import { join } from 'path'
import { promises as fsp } from 'fs'
import { simpleGit } from 'simple-git'
import {
  diffInstalled,
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

/**
 * Install (or update) a registry library by cloning its repo into
 * `<parts>/<id>`. A pre-existing folder is removed first (so "update" is a fresh
 * clone). After cloning, the `library.yml` `version` is reconciled with the
 * registry entry so future update checks compare correctly. Never throws.
 */
export async function installLibrary(entry: RegistryEntry): Promise<WriteResult> {
  try {
    const id = sanitiseId(entry.id)
    if (!id) return { ok: false, error: 'Registry entry has no usable id.' }
    if (!entry.repo || !/^https?:\/\//i.test(entry.repo)) {
      return { ok: false, error: 'Registry entry has no valid http(s) repo URL.' }
    }
    const dir = partsDir()
    await fsp.mkdir(dir, { recursive: true })
    const dest = join(dir, id)

    // Fresh clone: remove any previous copy first (this doubles as "update").
    await fsp.rm(dest, { recursive: true, force: true })
    await simpleGit().clone(entry.repo, dest, ['--depth', '1']).catch((err) => {
      throw new Error(`git clone failed: ${(err as Error).message}`)
    })

    // Reconcile / write the manifest so the installed version matches the registry.
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

    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
