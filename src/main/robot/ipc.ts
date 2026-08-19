/**
 * Robot definition file IPC (#128). Reads/writes `robot.yml` — the project's
 * parts + pin-to-pin wiring — for the Board Viewer's Wiring mode.
 *
 * It lives in the open PROJECT FOLDER when the renderer knows one (so it sits
 * next to the user's code and is version-controllable); otherwise it falls back
 * to `<userData>/robot.yml` so the feature still works with no folder open. All
 * handlers return serialisable values and never throw across the bridge.
 */

import { app, ipcMain, BrowserWindow, dialog } from 'electron'
import { basename, dirname, extname, join } from 'path'
import { promises as fsp } from 'fs'
import { robotFromYaml, robotToYaml } from '../../shared/robot-yaml'
import { blankRobot, type RobotDefinition, type RobotPart } from '../../shared/robot'
import { readRobotModel } from '../../shared/krf'
import { generateSkeleton, skeletonJson } from '../../shared/skeleton'
import { resolvePartAsset } from '../parts/library'

/** Result of importing a mesh: the path relative to the URDF's folder, or a
 *  cancellation. */
export interface ImportMeshResult {
  cancelled?: boolean
  error?: string
  /** Mesh path relative to the URDF's folder, e.g. `meshes/wheel.stl`. */
  rel?: string
  /** The copied file's base name, e.g. `wheel.stl`. */
  name?: string
  /** For a copied STL: its largest bounding-box dimension in the file's own units,
   *  so the renderer can guess a mm→m scale (#406). Undefined if not measurable. */
  maxDim?: number
}

/**
 * The largest bounding-box span of an STL (binary OR ASCII), in the file's own
 * units — a cheap DOM/three-free parse so the mm→m import heuristic works
 * without the renderer.  Returns undefined for a malformed buffer (caller falls
 * back to declared units).
 *
 * THE DELIBERATE TWIN of the renderer's `maxSpan` in
 * `src/renderer/src/components/robot-mesh-load.ts` (#742). That one uses
 * three.js, which isn't available here — so this is the one duplicate the
 * refactor kept rather than removed. The two MUST agree: the number they
 * produce picks the mm→m import scale, so a disagreement ships a part a
 * thousand times too big. `test/meshMeasure.test.ts` holds them against the
 * same fixtures; change one and run it.
 *
 * Exported for that test only.
 */
export function stlMaxDim(buf: Buffer): number | undefined {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  const grow = (x: number, y: number, z: number): void => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const tris = buf.length >= 84 ? buf.readUInt32LE(80) : 0
  if (tris > 0 && buf.length === 84 + tris * 50) {
    // BINARY STL: exactly 84 + 50·tris bytes. Each triangle: normal(12) + 3 verts(36) + attr(2).
    for (let t = 0; t < tris; t++) {
      const base = 84 + t * 50 + 12 // skip the facet normal
      for (let v = 0; v < 3; v++) {
        const o = base + v * 12
        grow(buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8))
      }
    }
  } else {
    // ASCII STL: `vertex <x> <y> <z>` lines.
    const text = buf.toString('utf-8')
    if (!/^\s*solid\b/i.test(text)) return undefined
    // The `-` inside the class is what lets a negative EXPONENT (e.g. 1.5e-3) match.
    const re = /\bvertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g
    let m: RegExpExecArray | null
    let found = false
    while ((m = re.exec(text))) {
      found = true
      grow(Number(m[1]), Number(m[2]), Number(m[3]))
    }
    if (!found) return undefined
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ)
  return Number.isFinite(span) ? span : undefined
}

/** Copy `src` into `<urdfDir>/meshes/`, never overwriting (appends -1, -2 …). */
async function copyIntoMeshes(urdfPath: string, src: string): Promise<{ rel: string; name: string }> {
  const meshesDir = join(dirname(urdfPath), 'meshes')
  await fsp.mkdir(meshesDir, { recursive: true })
  const ext = extname(src)
  const stem = basename(src, ext)
  let name = `${stem}${ext}`
  let n = 1
  // Collision-safe: keep an existing file, land the import next to it.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fsp.access(join(meshesDir, name))
      name = `${stem}-${n++}${ext}`
    } catch {
      break
    }
  }
  await fsp.copyFile(src, join(meshesDir, name))
  return { rel: `meshes/${name}`, name }
}

/** Resolve the robot.yml path: `<folder>/robot.yml` if the folder is a real
 *  directory, else `<userData>/robot.yml`. */
async function robotPath(folder?: string): Promise<string> {
  if (folder && folder.trim()) {
    try {
      if ((await fsp.stat(folder)).isDirectory()) return join(folder, 'robot.yml')
    } catch {
      // Not a usable folder → fall through to userData.
    }
  }
  return join(app.getPath('userData'), 'robot.yml')
}

/**
 * Regenerate `<folder>/skeleton.json` from the project URDF after a robot.yml
 * save (#537) — servo↔joint bindings live in robot.yml, so binding edits must
 * refresh the skeleton's servo section. Best-effort: a project without a folder
 * or a linked URDF simply has no skeleton, and failure never breaks the save.
 */
async function regenerateSkeleton(folder: string | undefined, def: RobotDefinition): Promise<void> {
  const urdfRel = readRobotModel(def)?.urdf
  if (!folder || !folder.trim() || !urdfRel) return
  try {
    if (!(await fsp.stat(folder)).isDirectory()) return
    const urdf = await fsp.readFile(join(folder, urdfRel), 'utf-8')
    const json = skeletonJson(generateSkeleton(urdf, readRobotModel(def)?.servoJointMap))
    await fsp.writeFile(join(folder, 'skeleton.json'), json, 'utf-8')
  } catch {
    // No URDF yet / unreadable — nothing to derive.
  }
}

/** Serialise writes per-path so two overlapping saves can't interleave and
 *  truncate each other mid-write (writeFile truncates-then-writes). */
const writeChains = new Map<string, Promise<unknown>>()
function queuedWrite(path: string, data: string): Promise<void> {
  const prev = writeChains.get(path) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(() => fsp.writeFile(path, data, 'utf-8'))
  // Drop the chain entry once it settles and nothing newer has replaced it.
  writeChains.set(path, next)
  void next.finally(() => {
    if (writeChains.get(path) === next) writeChains.delete(path)
  })
  return next
}

/**
 * Serialised READ-modify-write on the same per-path chain as {@link queuedWrite}
 * (#716). The read must queue too — reading outside the chain could see a file a
 * queued write is about to supersede. `fn` gets the current text (`null` when
 * the file doesn't exist) and returns the new text, or `null` for "leave it".
 */
function queuedUpdate(path: string, fn: (raw: string | null) => string | null): Promise<void> {
  const prev = writeChains.get(path) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(async () => {
    let raw: string | null
    try {
      raw = await fsp.readFile(path, 'utf-8')
    } catch {
      raw = null
    }
    const out = fn(raw)
    if (out != null) await fsp.writeFile(path, out, 'utf-8')
  })
  writeChains.set(path, next)
  void next.finally(() => {
    if (writeChains.get(path) === next) writeChains.delete(path)
  })
  return next
}

export function registerRobotIpc(): void {
  ipcMain.handle('robot:load', async (_e, folder?: string): Promise<RobotDefinition> => {
    const path = await robotPath(folder)
    let raw: string
    try {
      raw = await fsp.readFile(path, 'utf-8')
    } catch {
      // No file yet → a fresh, empty definition.
      return blankRobot()
    }
    try {
      return robotFromYaml(raw)
    } catch (err) {
      // MALFORMED robot.yml (bad hand-edit, merge-conflict markers). Returning a
      // blank here used to let the very next save WIPE the user's parts/wiring
      // (#505) — preserve the original alongside before that can happen.
      try {
        await fsp.writeFile(`${path}.bak`, raw, 'utf-8')
        console.warn(`robot.yml is not valid YAML — backed up to robot.yml.bak (${String(err)})`)
      } catch {
        /* best-effort backup */
      }
      return blankRobot()
    }
  })

  ipcMain.handle(
    'robot:save',
    async (_e, args: { folder?: string; def: RobotDefinition }): Promise<{ ok: boolean; error?: string }> => {
      try {
        const path = await robotPath(args?.folder)
        await queuedWrite(path, robotToYaml(args.def))
        await regenerateSkeleton(args?.folder, args.def) // #537 — bindings feed skeleton.json
        // Tell EVERY window, including the sender. This used to skip the sender on
        // the assumption that edits only happen in the separate Board View window —
        // but the Electronics workspace embeds the Board View in the MAIN window
        // (BoardPane), so removing a part there left that same window's
        // parts-import banner still nagging about a part that no longer exists.
        //
        // Safe to echo back: every robot.yml reader guards its reload with a
        // `saveSeqRef` bumped BEFORE the save, so a load triggered by a window's own
        // save either returns what it just wrote or is discarded as stale.
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send('robot:didChange')
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  // #716: a renderer rewrote the project .urdf on disk (the placement bridge
  // appending a part's Build body). Fan it to EVERY window so open Build views
  // re-read the file — mirrors the robot:didChange bus above, but for the URDF,
  // whose writes don't go through robot:save.
  ipcMain.on('robot:urdfChanged', () => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('robot:didUrdfChange')
    }
  })

  // #717: targeted robot.yml MODEL merges for the sync reconcile — same
  // rationale as patchPartLinks below: the dialog's actions complete seconds
  // after their click (mesh copies, queued URDF writes), and saving the
  // renderer's by-then-stale whole document would silently revert anything
  // another window saved meanwhile. Each field merges against the file's
  // CURRENT state under the per-path queue; everything is optional.
  ipcMain.handle(
    'robot:patchModel',
    async (
      _e,
      args: {
        folder?: string
        patch?: {
          /** Link the model's urdf IF ABSENT (never overwrites an existing link). */
          ensureUrdf?: string
          /** Record the MCU board's Build link. */
          boardLink?: string
          /** Record one link's mass-authoring source. */
          linkMass?: { link: string; source: 'measured' | 'library' | 'estimated' | 'none' }
          /** Remove entries from the orphan ledger (resolved by the user). */
          clearOrphans?: string[]
          /** Append part rows (a sync re-add); a row whose id already exists is
           *  SKIPPED — the plan re-offers it rather than main guessing a rename. */
          addParts?: RobotPart[]
        }
      }
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const patch = args?.patch ?? {}
        const path = await robotPath(args?.folder)
        await queuedUpdate(path, (raw) => {
          if (raw == null) return null
          let def: RobotDefinition
          try {
            def = robotFromYaml(raw)
          } catch {
            return null // malformed — never "repair" it from here (#505's lesson)
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
          if (!touched) return null
          return robotToYaml({ ...def, parts, robot: Object.keys(model).length ? model : undefined })
        })
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send('robot:didChange')
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  // #716: record the URDF link a placement created onto its robot.yml part row —
  // a TARGETED merge against the file's CURRENT state, under the per-path write
  // queue. This deliberately does NOT accept a whole document: the patch fires
  // seconds after the drop (mesh copies + URDF writes), and a renderer saving
  // its by-then-stale in-memory robot.yml back would silently revert anything
  // another window saved in between. Merging one field here cannot lose
  // concurrent edits; a part deleted mid-flight simply isn't patched (the #717
  // sync reconciles its leftover Build body).
  ipcMain.handle(
    'robot:patchPartLinks',
    async (
      _e,
      args: { folder?: string; links?: { partId: string; link: string }[] }
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const links = (Array.isArray(args?.links) ? args.links : []).filter(
          (l) => l && typeof l.partId === 'string' && typeof l.link === 'string' && l.link
        )
        if (links.length === 0) return { ok: true }
        const path = await robotPath(args?.folder)
        await queuedUpdate(path, (raw) => {
          if (raw == null) return null // no manifest — nothing to patch
          let def: RobotDefinition
          try {
            def = robotFromYaml(raw)
          } catch {
            return null // malformed — never "repair" it from here (#505's lesson)
          }
          let touched = false
          const parts = def.parts.map((p) => {
            const hit = links.find((l) => l.partId === p.id)
            if (!hit || p.urdfLink === hit.link) return p
            touched = true
            return { ...p, urdfLink: hit.link }
          })
          return touched ? robotToYaml({ ...def, parts }) : null
        })
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send('robot:didChange')
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  // Import an STL/DAE mesh into the robot's KRF folder (#309): a native picker,
  // then copy the chosen file into `<urdf-folder>/meshes/`. The renderer wires
  // the returned relative path into the URDF. The copy is binary-safe. With an
  // explicit `src` (#407) the picker is skipped — used to pull a URDF's own
  // out-of-project meshes into the project so it's self-contained.
  ipcMain.handle(
    'robot:importMesh',
    async (e, args: { urdfPath: string; src?: string }): Promise<ImportMeshResult> => {
      try {
        if (!args?.urdfPath) return { error: 'No robot file to import into.' }
        if (args.src) return await copyIntoMeshes(args.urdfPath, args.src)
        const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
        const opts = {
          title: 'Import mesh',
          properties: ['openFile' as const],
          filters: [
            { name: '3D mesh', extensions: ['stl', 'dae'] },
            { name: 'All files', extensions: ['*'] }
          ]
        }
        const result = win
          ? await dialog.showOpenDialog(win, opts)
          : await dialog.showOpenDialog(opts)
        if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
        return await copyIntoMeshes(args.urdfPath, result.filePaths[0])
      } catch (err) {
        return { error: (err as Error).message }
      }
    }
  )

  // Copy a Parts Library part's BUNDLED mesh into a project URDF's meshes/ folder
  // (#406) — the drop bridge calls this when a mesh-linked part is added to a design.
  // The part's mesh path is resolved + path-traversal guarded in the parts layer.
  ipcMain.handle(
    'robot:importPartMesh',
    async (
      _e,
      args: { urdfPath: string; libraryId: string; partId: string; mesh: string }
    ): Promise<ImportMeshResult> => {
      try {
        if (!args?.urdfPath || !args?.mesh) return { error: 'No robot file or mesh to import.' }
        const src = resolvePartAsset(args.libraryId, args.partId, args.mesh)
        if (!src) return { error: `Unsafe or unknown part mesh: ${args.mesh}` }
        // Refuse a SYMLINKED mesh: copyFile dereferences it, so a community part could
        // ship `model.stl -> ~/.ssh/id_rsa` and exfiltrate its bytes into the project.
        // The lexical isContainedFile guard can't see a symlink's target (#406 review).
        if ((await fsp.lstat(src)).isSymbolicLink()) {
          return { error: `Refusing symlinked part mesh: ${args.mesh}` }
        }
        const { rel, name } = await copyIntoMeshes(args.urdfPath, src)
        let maxDim: number | undefined
        if (/\.stl$/i.test(name)) {
          try {
            maxDim = stlMaxDim(await fsp.readFile(join(dirname(args.urdfPath), 'meshes', name)))
          } catch {
            // Unmeasurable → the renderer falls back to declared units.
          }
        }
        return { rel, name, maxDim }
      } catch (err) {
        return { error: (err as Error).message }
      }
    }
  )
}
