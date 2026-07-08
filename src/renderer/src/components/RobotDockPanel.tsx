import { useEffect, useState } from 'react'
import { RobotView } from './RobotView'
import { dirname } from './robot-mesh'
import { useWorkspace } from '../store/workspace'
import { readRobotModel } from '../../../shared/krf'
import demoArm from '../assets/demo-arm.urdf?raw'

/**
 * ROBOT DOCK PANEL (#320) — the mini 3-D Robot view that sits above the
 * instrument dock in the **Robot** workspace. It finds the project's URDF via
 * the KRF `robot.yml` (`robot.urdf`, resolved against the workspace folder) and
 * falls back to the bundled demo arm so the panel is never empty. Isometric,
 * compact chrome. An **expand** button opens the project's `.urdf` full-screen
 * as the Pose tool (#312).
 */
export function RobotDockPanel(): JSX.Element {
  const { currentFolder, openFile } = useWorkspace()
  const [urdf, setUrdf] = useState<string>(demoArm)
  // The URDF's folder, so RobotView resolves the robot's meshes (#319). Empty
  // for the bundled demo arm (all primitives — no meshes to resolve).
  const [base, setBase] = useState<string>('')
  // The project URDF's path, so the expand button can open it full-screen.
  const [urdfPath, setUrdfPath] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const robot = await window.api.robot.load(currentFolder ?? undefined)
        const rel = readRobotModel(robot)?.urdf
        if (rel && currentFolder) {
          const path = `${currentFolder.replace(/[/\\]$/, '')}/${rel.replace(/^[/\\]/, '')}`
          const content = await window.api.fs.readFile(path)
          if (live && content.trim()) {
            setUrdf(content)
            setBase(dirname(path))
            setUrdfPath(path)
            return
          }
        }
      } catch {
        // No project URDF (or unreadable) — fall through to the demo arm.
      }
      if (live) {
        setUrdf(demoArm)
        setBase('')
        setUrdfPath(null)
      }
    })()
    return () => {
      live = false
    }
  }, [currentFolder])

  return (
    <div className="robotdock">
      <RobotView urdfContent={urdf} basePath={base} compact />
      {urdfPath && (
        <button
          type="button"
          className="robotdock__expand"
          title="Open the robot full-screen (Pose tool)"
          onClick={() => void openFile('local', urdfPath)}
        >
          ⤢ Pose
        </button>
      )}
    </div>
  )
}

export default RobotDockPanel
