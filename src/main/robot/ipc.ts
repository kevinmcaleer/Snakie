/**
 * Robot definition file IPC (#128). Reads/writes `robot.yml` — the project's
 * parts + pin-to-pin wiring — for the Board Viewer's Wiring mode.
 *
 * It lives in the open PROJECT FOLDER when the renderer knows one (so it sits
 * next to the user's code and is version-controllable); otherwise it falls back
 * to `<userData>/robot.yml` so the feature still works with no folder open. All
 * handlers return serialisable values and never throw across the bridge.
 */

import { app, ipcMain } from 'electron'
import { join } from 'path'
import { promises as fsp } from 'fs'
import { robotFromYaml, robotToYaml } from '../../shared/robot-yaml'
import { blankRobot, type RobotDefinition } from '../../shared/robot'

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
    async (_e, args: { folder?: string; def: RobotDefinition }): Promise<{ ok: boolean; error?: string }> => {
      try {
        const path = await robotPath(args?.folder)
        await queuedWrite(path, robotToYaml(args.def))
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )
}
