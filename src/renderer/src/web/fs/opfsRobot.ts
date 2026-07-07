/**
 * Web implementation of the `robot` Api — `robot.yml` persistence on top of
 * the same OPFS/File-System-Access project root as `opfsFs.ts` (epic #267
 * Phase W1). Unlike the Electron backend there's no separate "userData
 * fallback" location: the web build always has exactly one active project
 * root (auto-created in OPFS if the user hasn't picked a real folder), so the
 * `folder` argument other callers pass (mirroring the desktop `currentFolder`)
 * is accepted for API-shape compatibility but not otherwise needed.
 */
import { robotFromYaml, robotToYaml } from '../../../../shared/robot-yaml'
import { blankRobot, type RobotDefinition } from '../../../../shared/robot'
import { resolveFileHandle } from './handleResolver'

const ROBOT_YML_PATH = '/robot.yml'

export function createOpfsRobot(): {
  load: (folder?: string) => Promise<RobotDefinition>
  save: (folder: string | undefined, def: RobotDefinition) => Promise<{ ok: boolean; error?: string }>
  onChanged: (cb: () => void) => () => void
} {
  const listeners = new Set<() => void>()

  return {
    async load(): Promise<RobotDefinition> {
      try {
        const handle = await resolveFileHandle(ROBOT_YML_PATH)
        const file = await handle.getFile()
        return robotFromYaml(await file.text())
      } catch {
        // No robot.yml yet — a fresh, empty definition (matches the Electron
        // backend's behaviour when the file doesn't exist).
        return blankRobot()
      }
    },

    async save(_folder, def): Promise<{ ok: boolean; error?: string }> {
      try {
        const handle = await resolveFileHandle(ROBOT_YML_PATH, { create: true })
        const writable = await handle.createWritable()
        await writable.write(robotToYaml(def))
        await writable.close()
        for (const cb of listeners) cb()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    /**
     * On Electron this fires when ANOTHER window edits robot.yml (there's no
     * separate Board View window on the web build in W1 — board/instrument
     * windows stay inert — so this never fires here today). Kept as real
     * subscribe/unsubscribe plumbing so a same-tab multi-component listener
     * still works if that changes.
     */
    onChanged(cb: () => void): () => void {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}
