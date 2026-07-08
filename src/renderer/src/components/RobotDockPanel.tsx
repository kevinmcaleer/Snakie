import { useEffect, useState } from 'react'
import { RobotView } from './RobotView'
import { dirname } from './robot-mesh'
import { blankUrdf } from './robot-assembly'
import { useWorkspace } from '../store/workspace'
import { useWorkspaceLayout } from '../store/layout'
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
  const { currentFolder, openFile, openBuffer } = useWorkspace()
  const { switchWorkspace } = useWorkspaceLayout()
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

  // Pop the robot out full-screen (the Pose tool + assembly): a saved project
  // URDF opens as its file; the bundled demo arm opens as a buffer. Switch to
  // Code mode so the routed viewer fills the editor pane.
  const popOut = (): void => {
    if (urdfPath) void openFile('local', urdfPath)
    else openBuffer('demo-arm.urdf', urdf)
    switchWorkspace('code')
  }

  // Create a new blank robot (.urdf) and open it full-screen in the pose tool.
  // With a project folder we write a real file (so STL import + persistence work
  // straight away, next-numbered if `robot.urdf` exists); otherwise an untitled
  // buffer the user can Save.
  const newRobot = async (): Promise<void> => {
    const content = blankUrdf('my_robot')
    if (currentFolder) {
      const folder = currentFolder.replace(/[/\\]$/, '')
      let name = 'robot.urdf'
      for (let n = 2; n < 1000; n++) {
        try {
          await window.api.fs.readFile(`${folder}/${name}`)
          name = `robot-${n}.urdf` // taken → try the next
        } catch {
          break // free
        }
      }
      const path = `${folder}/${name}`
      try {
        await window.api.fs.writeFile(path, content)
        await openFile('local', path)
      } catch {
        openBuffer('robot.urdf', content) // write failed → fall back to a buffer
      }
    } else {
      openBuffer('robot.urdf', content)
    }
    switchWorkspace('code')
  }

  // No project robot yet (the demo arm is a stand-in) → nudge toward "New robot".
  const hasProjectRobot = urdfPath !== null

  return (
    <div className="robotdock">
      <RobotView urdfContent={urdf} basePath={base} compact />
      <div className="robotdock__actions">
        <button
          type="button"
          className={`robotdock__btn${hasProjectRobot ? '' : ' robotdock__btn--cta'}`}
          title="Create a new blank robot (.urdf) and open it in the pose tool"
          onClick={() => void newRobot()}
        >
          ＋ New robot
        </button>
        <button
          type="button"
          className="robotdock__btn"
          title="Pop out full-screen (pose tool + assembly)"
          onClick={popOut}
        >
          ⤢ Pop out
        </button>
      </div>
    </div>
  )
}

export default RobotDockPanel
