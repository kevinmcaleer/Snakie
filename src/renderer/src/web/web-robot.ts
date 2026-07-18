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
}

type PickedFile = { name: string; getFile(): Promise<File> }

/** Build the `robot` Api object (assigned to `window.api.robot` on the web). */
export function createWebRobotApi(fs: WebRobotFs): Record<string, unknown> {
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
        const meshesDir = `${dirname(urdfPath) ? dirname(urdfPath) + '/' : ''}meshes`
        await fs.mkdir(meshesDir)
        // Collision-safe name: foo.stl, foo-1.stl, foo-2.stl … (like the desktop).
        const dot = picked.name.lastIndexOf('.')
        const stem = dot > 0 ? picked.name.slice(0, dot) : picked.name
        const ext = dot > 0 ? picked.name.slice(dot) : ''
        let name = picked.name
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
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },

    // Parts libraries aren't on the web yet — RobotView treats a rel-less result
    // as "no mesh to attach" and still writes a valid URDF.
    importPartMesh: async (): Promise<Record<string, never>> => ({}),

    onChanged: (cb: () => void): (() => void) => {
      subs.add(cb)
      return () => subs.delete(cb)
    }
  }
}
