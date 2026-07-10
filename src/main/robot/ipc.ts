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
import { blankRobot, type RobotDefinition } from '../../shared/robot'

/** Result of importing a mesh: the path relative to the URDF's folder, or a
 *  cancellation. */
export interface ImportMeshResult {
  cancelled?: boolean
  error?: string
  /** Mesh path relative to the URDF's folder, e.g. `meshes/wheel.stl`. */
  rel?: string
  /** The copied file's base name, e.g. `wheel.stl`. */
  name?: string
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

export function registerRobotIpc(): void {
  ipcMain.handle('robot:load', async (_e, folder?: string): Promise<RobotDefinition> => {
    try {
      const raw = await fsp.readFile(await robotPath(folder), 'utf-8')
      return robotFromYaml(raw)
    } catch {
      // No file yet → a fresh, empty definition.
      return blankRobot()
    }
  })

  ipcMain.handle(
    'robot:save',
    async (e, args: { folder?: string; def: RobotDefinition }): Promise<{ ok: boolean; error?: string }> => {
      try {
        const path = await robotPath(args?.folder)
        await queuedWrite(path, robotToYaml(args.def))
        // Edits happen in the Board View window; tell the OTHER windows so e.g. the
        // main window's parts-import banner re-reads (a removed part clears its nag).
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed() && w.webContents.id !== e.sender.id) {
            w.webContents.send('robot:didChange')
          }
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
}
