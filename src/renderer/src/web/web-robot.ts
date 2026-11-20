/**
 * WEB robot-definition backend — epic #267.
 * =============================================================================
 *
 * Implements `window.api.robot` in the browser over the web filesystem backend
 * ({@link ./web-fs}), mirroring the Electron main-process layer
 * (`src/main/robot/ipc.ts`): `load` reads `<folder>/robot.yml` →
 * {@link robotFromYaml}; `save` writes {@link robotToYaml} with per-path write
 * queueing so overlapping saves can't interleave. The (de)serialise + sanitise
 * pipeline is the SAME shared, pure code the desktop uses — so servo↔joint
 * bindings, poses, the timeline and the project-URDF link all round-trip
 * identically. This is what lets the Robot view load a project's `servoJointMap`
 * on the web, which in turn lets `SNK SERVO` telemetry from the WASM sim animate
 * the 3-D model.
 *
 * Electron's no-folder fallback is `<userData>/robot.yml`; the web equivalent is
 * a localStorage copy (survives reloads, no folder needed — e.g. the bundled
 * demo arm).
 *
 * `onChanged` matches Electron's semantics exactly: it only ever notified OTHER
 * windows (the saver is excluded), and the web app is single-window — so
 * subscriptions are accepted but never fired. Firing them locally would make
 * views reload in response to their own saves (a feedback-loop risk).
 */
import { robotFromYaml, robotToYaml } from '../../../shared/robot-yaml'
import type { RobotDefinition } from '../../../shared/robot'
import { readRobotModel } from '../../../shared/krf'
import { generateSkeleton, skeletonJson } from '../../../shared/skeleton'
import { stlMaxDim } from '../../../shared/stl-measure'

/** The subset of the web fs backend this layer needs (see {@link ./web-fs}). */
export interface WebRobotFs {
  readFile(path: string): Promise<string>
  writeFile(path: string, contents: string): Promise<void>
  writeFileBytes(path: string, bytes: Uint8Array): Promise<void>
  stat(path: string): Promise<{ isDir: boolean }>
  mkdir(path: string): Promise<void>
}

/** No-folder fallback slot (the web twin of Electron's `<userData>/robot.yml`). */
const LS_KEY = 'snakie.web.robot-yml'

const blankRobot = (): RobotDefinition => ({ parts: [], connections: [] })

const hasFolder = (folder?: string): folder is string =>
  typeof folder === 'string' && folder.trim().length > 0

const robotYmlPath = (folder: string): string => `${folder.replace(/[/\\]+$/, '')}/robot.yml`

/** `parent/of/file.ext` → `parent/of` (empty string for a bare name). */
const dirname = (path: string): string => {
  const at = path.lastIndexOf('/')
  return at > 0 ? path.slice(0, at) : ''
}

interface ImportMeshResult {
  cancelled?: boolean
  error?: string
  rel?: string
  name?: string
  /** The copied STL's largest span in its own units (the mm→m import scale). */
  maxDim?: number
  /** See `MeshCopyOutcome.reason` in robot-part-mesh.ts. */
  reason?: 'unavailable' | 'download-failed'
}

/**
 * The 3-D models the web build carries for library parts: the bundled Standard
 * Parts library's meshes, emitted as static assets by
 * vite-plugin-standard-parts and keyed `<partId>/<mesh>`.
 */
export interface WebPartMeshes {
  /** The one library the URLs belong to (the bundled Standard Parts). */
  libraryId: string
  urls: Record<string, string>
  /** Injected for tests; the page's `fetch` otherwise. */
  fetch?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>
}

type PickedFile = { name: string; getFile(): Promise<File> }

/** Build the `robot` Api object (assigned to `window.api.robot` on the web). */
export function createWebRobotApi(
  fs: WebRobotFs,
  partMeshes?: WebPartMeshes
): Record<string, unknown> {
  // Per-path write queue — two overlapping saves must not interleave (a
  // createWritable truncates before writing), mirroring main's queuedWrite.
  const writeQueues = new Map<string, Promise<void>>()
  const queuedWrite = (path: string, contents: string): Promise<void> => {
    const prev = writeQueues.get(path) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(() => fs.writeFile(path, contents))
    writeQueues.set(path, next)
    return next
  }

  const subs = new Set<() => void>()
  const urdfSubs = new Set<() => void>()

  /** Write `bytes` into `<urdf-dir>/meshes/` under a free name — foo.stl,
   *  foo-1.stl, foo-2.stl … — never overwriting (like the desktop's
   *  copyIntoMeshes). */
  const writeIntoMeshes = async (
    urdfPath: string,
    fileName: string,
    bytes: Uint8Array
  ): Promise<{ rel: string; name: string }> => {
    const meshesDir = `${dirname(urdfPath) ? dirname(urdfPath) + '/' : ''}meshes`
    await fs.mkdir(meshesDir)
    const dot = fileName.lastIndexOf('.')
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName
    const ext = dot > 0 ? fileName.slice(dot) : ''
    let name = fileName
    for (let n = 1; n < 1000; n++) {
      try {
        await fs.stat(`${meshesDir}/${name}`)
        name = `${stem}-${n}${ext}` // taken — try the next
      } catch {
        break // free
      }
    }
    await fs.writeFileBytes(`${meshesDir}/${name}`, bytes)
    return { rel: `meshes/${name}`, name }
  }

  return {
    load: async (folder?: string): Promise<RobotDefinition> => {
      let text: string
      try {
        text = hasFolder(folder)
          ? await fs.readFile(robotYmlPath(folder))
          : (window.localStorage.getItem(LS_KEY) ?? '')
      } catch {
        // Missing robot.yml / no folder open / unreadable — a blank definition,
        // exactly like the desktop handler.
        return blankRobot()
      }
      try {
        return robotFromYaml(text)
      } catch {
        // Malformed robot.yml (#505): preserve the original before any save can
        // overwrite it — mirrors the desktop handler's .bak backup.
        try {
          if (hasFolder(folder)) await fs.writeFile(`${robotYmlPath(folder)}.bak`, text)
          else window.localStorage.setItem(`${LS_KEY}.bak`, text)
        } catch {
          /* best-effort backup */
        }
        return blankRobot()
      }
    },

    save: async (
      folder: string | undefined,
      def: RobotDefinition
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const text = robotToYaml(def)
        if (hasFolder(folder)) await queuedWrite(robotYmlPath(folder), text)
        else window.localStorage.setItem(LS_KEY, text)
        // Regenerate <folder>/skeleton.json (#537) — servo↔joint bindings live
        // here, so a binding edit must refresh the skeleton's servo section.
        // Best-effort, mirroring the desktop robot:save handler.
        if (hasFolder(folder)) {
          const urdfRel = readRobotModel(def)?.urdf
          if (urdfRel) {
            try {
              const base = folder.replace(/[/\\]+$/, '')
              const urdf = await fs.readFile(`${base}/${urdfRel}`)
              const json = skeletonJson(generateSkeleton(urdf, readRobotModel(def)?.servoJointMap))
              await fs.writeFile(`${base}/skeleton.json`, json)
            } catch {
              // No URDF yet / unreadable — nothing to derive.
            }
          }
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    // #717: targeted model merges — mirrors the desktop robot:patchModel.
    patchModel: async (
      folder: string | undefined,
      patch: {
        ensureUrdf?: string
        boardLink?: string
        linkMass?: { link: string; source: 'measured' | 'library' | 'estimated' | 'none' }
        clearOrphans?: string[]
        addParts?: RobotDefinition['parts']
      }
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        let text: string
        try {
          text = hasFolder(folder)
            ? await fs.readFile(robotYmlPath(folder))
            : (window.localStorage.getItem(LS_KEY) ?? '')
        } catch {
          return { ok: true }
        }
        let def: RobotDefinition
        try {
          def = robotFromYaml(text)
        } catch {
          return { ok: true } // malformed — never "repair" it from here (#505)
        }
        let touched = false
        const model = { ...(def.robot ?? {}) }
        if (patch.ensureUrdf && !model.urdf) {
          model.urdf = patch.ensureUrdf
          model.version = model.version ?? 1
          touched = true
        }
        if (patch.boardLink && model.boardLink !== patch.boardLink) {
          model.boardLink = patch.boardLink
          model.version = model.version ?? 1
          touched = true
        }
        if (patch.linkMass?.link) {
          model.linkMass = { ...(model.linkMass ?? {}), [patch.linkMass.link]: { source: patch.linkMass.source } }
          model.version = model.version ?? 1
          touched = true
        }
        if (patch.clearOrphans?.length && model.orphanedLinks?.length) {
          const rest = model.orphanedLinks.filter((l) => !patch.clearOrphans!.includes(l))
          if (rest.length !== model.orphanedLinks.length) {
            if (rest.length) model.orphanedLinks = rest
            else delete model.orphanedLinks
            touched = true
          }
        }
        let parts = def.parts
        if (patch.addParts?.length) {
          const ids = new Set(['board', ...parts.map((p) => p.id)])
          const fresh = patch.addParts.filter((p) => p && p.id && p.lib && p.part && !ids.has(p.id))
          if (fresh.length) {
            parts = [...parts, ...fresh]
            touched = true
          }
        }
        if (touched) {
          const out = robotToYaml({ ...def, parts, robot: Object.keys(model).length ? model : undefined })
          if (hasFolder(folder)) await queuedWrite(robotYmlPath(folder), out)
          else window.localStorage.setItem(LS_KEY, out)
          for (const cb of subs) cb()
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    // #716: the targeted urdfLink merge — read the CURRENT manifest, patch only
    // the named parts, write back. Mirrors the desktop robot:patchPartLinks
    // handler (single-window here, so the read-modify-write needs no queue
    // beyond queuedWrite's ordering).
    patchPartLinks: async (
      folder: string | undefined,
      links: { partId: string; link: string }[]
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const clean = (Array.isArray(links) ? links : []).filter(
          (l) => l && typeof l.partId === 'string' && typeof l.link === 'string' && l.link
        )
        if (clean.length === 0) return { ok: true }
        let text: string
        try {
          text = hasFolder(folder)
            ? await fs.readFile(robotYmlPath(folder))
            : (window.localStorage.getItem(LS_KEY) ?? '')
        } catch {
          return { ok: true } // no manifest — nothing to patch
        }
        let def: RobotDefinition
        try {
          def = robotFromYaml(text)
        } catch {
          return { ok: true } // malformed — never "repair" it from here (#505)
        }
        let touched = false
        const parts = def.parts.map((p) => {
          const hit = clean.find((l) => l.partId === p.id)
          if (!hit || p.urdfLink === hit.link) return p
          touched = true
          return { ...p, urdfLink: hit.link }
        })
        if (touched) {
          const out = robotToYaml({ ...def, parts })
          if (hasFolder(folder)) await queuedWrite(robotYmlPath(folder), out)
          else window.localStorage.setItem(LS_KEY, out)
          for (const cb of subs) cb()
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    importMesh: async (urdfPath: string, src?: string): Promise<ImportMeshResult> => {
      if (!urdfPath) return { error: 'No robot file to import into' }
      // `src` is an Electron-only path-copy (pulling a URDF's own external meshes
      // into the project) — the browser can't read arbitrary disk paths.
      if (src) return { error: "Copying external meshes isn't available in the browser" }
      const picker = (
        window as unknown as { showOpenFilePicker?: (o?: unknown) => Promise<PickedFile[]> }
      ).showOpenFilePicker
      if (!picker) return { error: 'Mesh import needs a browser with file pickers (Chromium)' }
      let picked: PickedFile
      try {
        const [fh] = await picker({
          types: [
            { description: 'Mesh', accept: { 'application/octet-stream': ['.stl', '.dae'] } }
          ]
        })
        picked = fh
      } catch {
        return { cancelled: true } // user closed the picker
      }
      try {
        const file = await picked.getFile()
        const bytes = new Uint8Array(await file.arrayBuffer())
        return await writeIntoMeshes(urdfPath, picked.name, bytes)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },

    // Copy a library part's model into the project (#406 on the desktop), so
    // "Add to Build" and "Upgrade to mesh" give it its real body here too. The
    // bundled Standard Parts' meshes ship as static assets of the web build:
    // fetched on first use, kept by the service worker's runtime cache, and
    // from then on part of the project's own files like any imported mesh.
    // Anything the web build doesn't carry still says WHY it is a box (#787).
    importPartMesh: async (
      urdfPath: string,
      libraryId: string,
      partId: string,
      mesh: string
    ): Promise<ImportMeshResult> => {
      if (!urdfPath || !mesh) return { error: 'No robot file or mesh to import.' }
      const key = `${partId}/${mesh.trim()}`
      const url =
        partMeshes && libraryId === partMeshes.libraryId ? partMeshes.urls[key] : undefined
      if (!url) {
        return {
          error: `The web app doesn't carry ${libraryId ? `${libraryId}'s ` : ''}model "${mesh}".`,
          reason: 'unavailable'
        }
      }
      let bytes: Uint8Array
      try {
        const get = partMeshes?.fetch ?? ((u: string) => fetch(u))
        const res = await get(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        bytes = new Uint8Array(await res.arrayBuffer())
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
          reason: 'download-failed'
        }
      }
      try {
        const base = mesh.trim().split(/[/\\]/).pop() || 'model.stl'
        const { rel, name } = await writeIntoMeshes(urdfPath, base, bytes)
        const maxDim = /\.stl$/i.test(name) ? stlMaxDim(bytes) : undefined
        return { rel, name, maxDim }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },

    onChanged: (cb: () => void): (() => void) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },

    // #716: single-window on the web, so the URDF-changed bus is a local fanout
    // exactly like onChanged above.
    notifyUrdfChanged: (): void => {
      for (const cb of urdfSubs) cb()
    },
    onUrdfChanged: (cb: () => void): (() => void) => {
      urdfSubs.add(cb)
      return () => urdfSubs.delete(cb)
    }
  }
}
