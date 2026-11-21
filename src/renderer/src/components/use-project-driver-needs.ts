import { useEffect, useMemo, useState } from 'react'
import { placedPartsNeedingDrivers, type PartDriverNeed } from './part-editor.util'
import { PARTS_CHANGED_EVENT } from './PartsPanel'
import type { RobotDefinition } from '../../../shared/robot'
import type { PartLibraryWithParts } from '../../../preload/index.d'

/**
 * The project's placed parts that declare MicroPython drivers (#184), for the
 * code editor's Drivers chip.
 *
 * The driver prompt used to live in the Electronics workspace, but placing a part
 * is a drawing action; the line that FAILS without the driver is the import in
 * the code. So the Code workspace asks, and it needs the same answer the board
 * view computed: the project's robot.yml resolved against the installed part
 * libraries. Both are re-read when anything changes them (another window saving
 * robot.yml, a part library installed or edited).
 *
 * `enabled` false skips the loads entirely (no project, or a view that never
 * shows the chip), so the plain editor pays nothing for it.
 */
export function useProjectDriverNeeds(
  folder: string | undefined,
  enabled = true
): PartDriverNeed[] {
  const [robot, setRobot] = useState<RobotDefinition | null>(null)
  const [libraries, setLibraries] = useState<PartLibraryWithParts[]>([])
  const [robotNonce, setRobotNonce] = useState(0)
  const [libNonce, setLibNonce] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const offRobot = window.api.robot.onChanged(() => setRobotNonce((n) => n + 1))
    const onParts = (): void => setLibNonce((n) => n + 1)
    window.addEventListener(PARTS_CHANGED_EVENT, onParts)
    return () => {
      offRobot()
      window.removeEventListener(PARTS_CHANGED_EVENT, onParts)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    let live = true
    window.api.robot
      .load(folder)
      .then((d) => live && setRobot(d))
      .catch(() => live && setRobot(null))
    return () => {
      live = false
    }
  }, [enabled, folder, robotNonce])

  useEffect(() => {
    if (!enabled) return
    let live = true
    window.api.parts
      .listLibraries()
      .then((l) => live && setLibraries(l))
      .catch(() => live && setLibraries([]))
    return () => {
      live = false
    }
  }, [enabled, libNonce])

  return useMemo(
    () => (enabled ? placedPartsNeedingDrivers(robot, libraries) : []),
    [enabled, robot, libraries]
  )
}
